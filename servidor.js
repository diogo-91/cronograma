const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Cronograma = require('./js/cronograma.js');

const RAIZ = __dirname;
const NOME_ARQUIVO_EMPRESAS = 'empresas.json';
const NOME_ARQUIVO_LEGADO = 'cronograma.json';
const NOME_PADRAO_EMPRESA = 'Minha empresa';
const MAX_NOME_EMPRESA = 80;
const MAX_EMPRESAS = 500;
const ID_EMPRESA = /^[\w-]{1,64}$/;
const ROTA_EMPRESA = /^\/api\/empresas\/([\w-]{1,64})$/;
const NOME_ARQUIVO_SEGREDO = 'segredo-sessao';
const LIMITE_CORPO = 2 * 1024 * 1024;
const LIMITE_CORPO_LOGIN = 1024;
const ID_GRAVACAO = /^[\w-]{1,64}$/;
const DURACAO_SESSAO_S = 30 * 24 * 60 * 60;
const MAX_FALHAS_LOGIN = 5;
const JANELA_FALHAS_MS = 15 * 60 * 1000;
const ARQUIVO_PUBLICO = /^\/(?:index\.html|css\/[\w-]+\.css|js\/[\w-]+\.js|img\/[\w-]+\.(?:svg|png)|fonts\/[\w-]+\.woff2)$/;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function idGravacaoValido(valor) {
  return typeof valor === 'string' && ID_GRAVACAO.test(valor) ? valor : null;
}

function lerDocumento(texto) {
  const r = Cronograma.importarDados(texto);
  if (!r.ok) return null;
  const { revisao, idGravacao } = JSON.parse(texto);
  return Number.isInteger(revisao) && revisao >= 0 ? { revisao, idGravacao: idGravacaoValido(idGravacao), ...r.dados } : null;
}

function verificarEscrita(pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  try {
    fs.accessSync(pasta, fs.constants.W_OK);
  } catch {
    throw new Error(`Sem permissão de escrita em ${pasta}. Confira o volume persistente (PASTA_DADOS).`);
  }
}

function lerOuCriarSegredo(pasta) {
  const arquivo = path.join(pasta, NOME_ARQUIVO_SEGREDO);
  try {
    const segredo = fs.readFileSync(arquivo);
    if (segredo.length >= 32) return segredo;
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
  }
  const segredo = crypto.randomBytes(32);
  try {
    fs.writeFileSync(arquivo, segredo, { mode: 0o600, flag: 'wx' });
    return segredo;
  } catch (erro) {
    if (erro.code === 'EEXIST') return fs.readFileSync(arquivo);
    throw erro;
  }
}

function nomeValido(valor) {
  const nome = typeof valor === 'string' ? valor.trim() : '';
  return nome && nome.length <= MAX_NOME_EMPRESA ? nome : null;
}

function novaEmpresa(nome, extras = {}) {
  return { id: Cronograma.novoId(), nome, revisao: 0, idGravacao: null, tarefas: [], ...extras };
}

function lerEmpresas(texto) {
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!bruto || !Array.isArray(bruto.empresas) || !bruto.empresas.length) return null;
  const empresas = [];
  for (const e of bruto.empresas) {
    const nome = nomeValido(e?.nome);
    if (!nome || typeof e.id !== 'string' || !ID_EMPRESA.test(e.id) || !Number.isInteger(e.revisao) || e.revisao < 0) return null;
    const r = Cronograma.importarDados(JSON.stringify({ titulo: nome, tarefas: e.tarefas }));
    if (!r.ok) return null;
    empresas.push({ id: e.id, nome, revisao: e.revisao, idGravacao: idGravacaoValido(e.idGravacao), tarefas: r.dados.tarefas });
  }
  return { empresas };
}

function criarArmazenamento(pasta) {
  const arquivo = path.join(pasta, NOME_ARQUIVO_EMPRESAS);
  const legado = path.join(pasta, NOME_ARQUIVO_LEGADO);
  let doc = null;
  let versaoNoDisco = null;

  function guardarIlegivel(caminho) {
    const copia = `${caminho}.ilegivel-${Date.now()}`;
    fs.renameSync(caminho, copia);
    console.error(`Arquivo de dados ilegível guardado em ${copia}.`);
  }

  function lerDoDisco() {
    let estado;
    try {
      estado = fs.statSync(arquivo);
    } catch (erro) {
      if (erro.code === 'ENOENT') return;
      throw erro;
    }
    if (estado.mtimeMs === versaoNoDisco) return;
    const lido = lerEmpresas(fs.readFileSync(arquivo, 'utf8'));
    if (lido) {
      doc = lido;
      versaoNoDisco = estado.mtimeMs;
      return;
    }
    guardarIlegivel(arquivo);
    doc = null;
    versaoNoDisco = null;
  }

  function gravar(novo) {
    const temporario = `${arquivo}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    const fd = fs.openSync(temporario, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(novo));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporario, arquivo);
    doc = novo;
    versaoNoDisco = fs.statSync(arquivo).mtimeMs;
  }

  function inicializar() {
    let primeira = novaEmpresa(NOME_PADRAO_EMPRESA);
    if (fs.existsSync(legado)) {
      const antigo = lerDocumento(fs.readFileSync(legado, 'utf8'));
      if (antigo) {
        const nome = antigo.titulo.trim().slice(0, MAX_NOME_EMPRESA) || NOME_PADRAO_EMPRESA;
        primeira = novaEmpresa(nome, { revisao: antigo.revisao, idGravacao: antigo.idGravacao, tarefas: antigo.tarefas });
      }
      gravar({ empresas: [primeira] });
      if (antigo) fs.renameSync(legado, `${legado}.migrado`);
      else guardarIlegivel(legado);
      return;
    }
    gravar({ empresas: [primeira] });
  }

  function atual() {
    lerDoDisco();
    if (!doc) inicializar();
    return doc;
  }

  atual();
  return { atual, gravar };
}

function criarAutenticacao(senha, segredo) {
  const chave = crypto.createHmac('sha256', segredo).update(senha).digest();
  const resumoSenha = crypto.createHash('sha256').update(senha).digest();
  const falhas = new Map();
  const assinar = (expira) => crypto.createHmac('sha256', chave).update(expira).digest('base64url');

  return {
    senhaConfere(tentativa) {
      return crypto.timingSafeEqual(crypto.createHash('sha256').update(tentativa).digest(), resumoSenha);
    },
    criarToken(agoraS) {
      const expira = String(agoraS + DURACAO_SESSAO_S);
      return `${expira}.${assinar(expira)}`;
    },
    tokenValido(token, agoraS) {
      const [expira, assinatura = ''] = token.split('.');
      if (!(Number(expira) > agoraS)) return false;
      const esperado = Buffer.from(assinar(expira));
      const recebido = Buffer.from(assinatura);
      return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
    },
    bloqueado(ip, agora) {
      const registro = falhas.get(ip);
      return Boolean(registro && registro.n >= MAX_FALHAS_LOGIN && agora < registro.ate);
    },
    registrarTentativa(ip, agora) {
      const registro = falhas.get(ip);
      const n = registro && agora < registro.ate ? registro.n : 0;
      falhas.set(ip, { n: n + 1, ate: agora + JANELA_FALHAS_MS });
      if (falhas.size > 10000) for (const [chaveIp, r] of falhas) if (r.ate <= agora) falhas.delete(chaveIp);
    },
    esquecerFalhas(ip) {
      falhas.delete(ip);
    },
  };
}

function lerCookie(req, nome) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [chave, ...valor] = parte.trim().split('=');
    if (chave === nome) return valor.join('=');
  }
  return '';
}

function ipDe(req) {
  const encaminhado = req.headers['x-forwarded-for'];
  return encaminhado ? encaminhado.split(',').pop().trim() : req.socket.remoteAddress;
}

function cookieSessao(req, valor, maxAge) {
  const https = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `sessao=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

function lerJson(req, limite = LIMITE_CORPO) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
    return Promise.reject(new ErroHttp(415, 'Envie os dados como JSON.'));
  }
  return new Promise((aceitar, recusar) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho <= limite) partes.push(parte);
    });
    req.on('end', () => {
      if (tamanho > limite) return recusar(new ErroHttp(413, 'Dados grandes demais.'));
      try {
        aceitar(JSON.parse(Buffer.concat(partes).toString('utf8')));
      } catch {
        recusar(new ErroHttp(400, 'JSON inválido.'));
      }
    });
    req.on('error', recusar);
  });
}

function responderJson(res, status, corpo, extras = {}) {
  res.writeHead(status, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras });
  res.end(JSON.stringify(corpo));
}

function servirArquivo(req, res, caminho) {
  const pedido = caminho === '/' ? '/index.html' : caminho;
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !ARQUIVO_PUBLICO.test(pedido)) {
    return responderJson(res, 404, { erro: 'Não encontrado.' });
  }
  const arquivo = path.join(RAIZ, pedido);
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) return responderJson(res, 404, { erro: 'Não encontrado.' });
    res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': TIPOS[path.extname(arquivo)], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : conteudo);
  });
}

function criarServidor({ senha, pastaDados }) {
  if (!senha) throw new Error('Defina a variável de ambiente SENHA com a senha de acesso ao cronograma.');
  if (senha.length < 8) throw new Error('A SENHA precisa ter pelo menos 8 caracteres.');
  verificarEscrita(pastaDados);
  const armazenamento = criarArmazenamento(pastaDados);
  const auth = criarAutenticacao(senha, lerOuCriarSegredo(pastaDados));
  const agoraS = () => Math.floor(Date.now() / 1000);

  async function entrar(req, res) {
    const ip = ipDe(req);
    if (auth.bloqueado(ip, Date.now())) throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    auth.registrarTentativa(ip, Date.now());
    const corpo = await lerJson(req, LIMITE_CORPO_LOGIN);
    const tentativa = typeof corpo?.senha === 'string' ? corpo.senha : '';
    if (!auth.senhaConfere(tentativa)) throw new ErroHttp(401, 'Senha incorreta.');
    auth.esquecerFalhas(ip);
    responderJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, auth.criarToken(agoraS()), DURACAO_SESSAO_S) });
  }

  function buscarEmpresa(id) {
    const empresa = armazenamento.atual().empresas.find((e) => e.id === id);
    if (!empresa) throw new ErroHttp(404, 'Empresa não encontrada. Ela pode ter sido excluída em outro aparelho.');
    return empresa;
  }

  function cronogramaDa(empresa) {
    return { revisao: empresa.revisao, idGravacao: empresa.idGravacao, titulo: empresa.nome, tarefas: empresa.tarefas };
  }

  function listarEmpresas(res) {
    const empresas = armazenamento.atual().empresas.map((e) => ({ id: e.id, nome: e.nome, atividades: e.tarefas.length }));
    responderJson(res, 200, { empresas });
  }

  async function criarEmpresa(req, res) {
    const corpo = await lerJson(req, LIMITE_CORPO_LOGIN);
    const nome = nomeValido(corpo?.nome);
    if (!nome) throw new ErroHttp(400, `Informe o nome da empresa (até ${MAX_NOME_EMPRESA} caracteres).`);
    const { empresas } = armazenamento.atual();
    if (empresas.length >= MAX_EMPRESAS) throw new ErroHttp(400, `Limite de ${MAX_EMPRESAS} empresas atingido.`);
    const nova = novaEmpresa(nome);
    armazenamento.gravar({ empresas: [...empresas, nova] });
    responderJson(res, 201, { id: nova.id, nome: nova.nome });
  }

  async function salvar(req, res, id) {
    const corpo = await lerJson(req);
    if (!corpo || typeof corpo !== 'object') throw new ErroHttp(400, 'Dados inválidos.');
    const empresa = buscarEmpresa(id);
    if (corpo.revisaoBase !== empresa.revisao) {
      return responderJson(res, 409, { erro: 'O cronograma foi alterado em outro aparelho.', atual: cronogramaDa(empresa) });
    }
    const r = Cronograma.importarDados(JSON.stringify({ titulo: corpo.titulo, tarefas: corpo.tarefas }));
    if (!r.ok) throw new ErroHttp(400, r.erro);
    const atualizada = {
      id,
      nome: nomeValido(corpo.titulo) || empresa.nome,
      revisao: empresa.revisao + 1,
      idGravacao: idGravacaoValido(corpo.idGravacao),
      tarefas: r.dados.tarefas,
    };
    const { empresas } = armazenamento.atual();
    armazenamento.gravar({ empresas: empresas.map((e) => (e.id === id ? atualizada : e)) });
    responderJson(res, 200, { revisao: atualizada.revisao });
  }

  function excluirEmpresa(res, id) {
    buscarEmpresa(id);
    const { empresas } = armazenamento.atual();
    if (empresas.length === 1) throw new ErroHttp(409, 'Precisa existir pelo menos uma empresa.');
    armazenamento.gravar({ empresas: empresas.filter((e) => e.id !== id) });
    responderJson(res, 200, { ok: true });
  }

  return http.createServer(async (req, res) => {
    try {
      const caminho = req.url.split('?')[0];
      const rota = `${req.method} ${caminho}`;
      if (rota === 'POST /api/login') return await entrar(req, res);
      if (rota === 'POST /api/logout') return responderJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, '', 0) });
      if (caminho.startsWith('/api/')) {
        if (!auth.tokenValido(lerCookie(req, 'sessao'), agoraS())) throw new ErroHttp(401, 'Entre com a senha para continuar.');
        if (rota === 'GET /api/empresas') return listarEmpresas(res);
        if (rota === 'POST /api/empresas') return await criarEmpresa(req, res);
        const [, id] = ROTA_EMPRESA.exec(caminho) || [];
        if (id && req.method === 'GET') return responderJson(res, 200, cronogramaDa(buscarEmpresa(id)));
        if (id && req.method === 'PUT') return await salvar(req, res, id);
        if (id && req.method === 'DELETE') return excluirEmpresa(res, id);
        throw new ErroHttp(404, 'Não encontrado.');
      }
      servirArquivo(req, res, caminho);
    } catch (erro) {
      if (erro instanceof ErroHttp) return responderJson(res, erro.status, { erro: erro.message });
      console.error(erro);
      responderJson(res, 500, { erro: 'Erro interno no servidor.' });
    }
  });
}

if (require.main === module) {
  const porta = Number(process.env.PORTA) || 3000;
  let servidor;
  try {
    servidor = criarServidor({ senha: process.env.SENHA, pastaDados: process.env.PASTA_DADOS || path.join(RAIZ, 'dados') });
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
  servidor.listen(porta, () => console.log(`Cronograma no ar na porta ${porta}`));
  process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
}

module.exports = { criarServidor };
