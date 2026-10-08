const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Cronograma = require('./js/cronograma.js');

const RAIZ = __dirname;
const NOME_ARQUIVO_DADOS = 'cronograma.json';
const LIMITE_CORPO = 2 * 1024 * 1024;
const DURACAO_SESSAO_S = 30 * 24 * 60 * 60;
const MAX_FALHAS_LOGIN = 5;
const JANELA_FALHAS_MS = 15 * 60 * 1000;
const ARQUIVO_PUBLICO = /^\/(?:index\.html|css\/[\w-]+\.css|js\/[\w-]+\.js|img\/[\w-]+\.svg|fonts\/[\w-]+\.woff2)$/;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
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

function lerDocumento(texto) {
  const r = Cronograma.importarDados(texto);
  if (!r.ok) return null;
  const { revisao } = JSON.parse(texto);
  return Number.isInteger(revisao) && revisao >= 0 ? { revisao, ...r.dados } : null;
}

function criarArmazenamento(pasta) {
  const arquivo = path.join(pasta, NOME_ARQUIVO_DADOS);
  fs.mkdirSync(pasta, { recursive: true });
  try {
    fs.accessSync(pasta, fs.constants.W_OK);
  } catch {
    throw new Error(`Sem permissão de escrita em ${pasta}. Confira o volume persistente (PASTA_DADOS).`);
  }
  let doc = { revisao: 0, titulo: 'Meu cronograma', tarefas: [] };
  if (fs.existsSync(arquivo)) {
    const lido = lerDocumento(fs.readFileSync(arquivo, 'utf8'));
    if (lido) {
      doc = lido;
    } else {
      const copia = `${arquivo}.ilegivel-${Date.now()}`;
      fs.renameSync(arquivo, copia);
      console.error(`Arquivo de dados ilegível guardado em ${copia}; começando com o cronograma vazio.`);
    }
  }
  return {
    atual: () => doc,
    gravar(novo) {
      const temporario = `${arquivo}.tmp`;
      const fd = fs.openSync(temporario, 'w');
      try {
        fs.writeFileSync(fd, JSON.stringify(novo));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporario, arquivo);
      doc = novo;
    },
  };
}

function criarAutenticacao(senha) {
  const chave = crypto.createHash('sha256').update(`cronograma-sessao:${senha}`).digest();
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
    registrarFalha(ip, agora) {
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

function lerJson(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
    return Promise.reject(new ErroHttp(415, 'Envie os dados como JSON.'));
  }
  return new Promise((aceitar, recusar) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho <= LIMITE_CORPO) partes.push(parte);
    });
    req.on('end', () => {
      if (tamanho > LIMITE_CORPO) return recusar(new ErroHttp(413, 'Dados grandes demais.'));
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
  const armazenamento = criarArmazenamento(pastaDados);
  const auth = criarAutenticacao(senha);
  const agoraS = () => Math.floor(Date.now() / 1000);

  async function entrar(req, res) {
    const ip = ipDe(req);
    if (auth.bloqueado(ip, Date.now())) throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    const corpo = await lerJson(req);
    const tentativa = typeof corpo?.senha === 'string' ? corpo.senha : '';
    if (!auth.senhaConfere(tentativa)) {
      auth.registrarFalha(ip, Date.now());
      throw new ErroHttp(401, 'Senha incorreta.');
    }
    auth.esquecerFalhas(ip);
    responderJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, auth.criarToken(agoraS()), DURACAO_SESSAO_S) });
  }

  async function salvar(req, res) {
    const corpo = await lerJson(req);
    if (!corpo || typeof corpo !== 'object') throw new ErroHttp(400, 'Dados inválidos.');
    const atual = armazenamento.atual();
    if (corpo.revisaoBase !== atual.revisao) {
      return responderJson(res, 409, { erro: 'O cronograma foi alterado em outro aparelho.', atual });
    }
    const r = Cronograma.importarDados(JSON.stringify({ titulo: corpo.titulo, tarefas: corpo.tarefas }));
    if (!r.ok) throw new ErroHttp(400, r.erro);
    const novo = { revisao: atual.revisao + 1, ...r.dados };
    armazenamento.gravar(novo);
    responderJson(res, 200, { revisao: novo.revisao });
  }

  return http.createServer(async (req, res) => {
    try {
      const caminho = req.url.split('?')[0];
      const rota = `${req.method} ${caminho}`;
      if (rota === 'POST /api/login') return await entrar(req, res);
      if (rota === 'POST /api/logout') return responderJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, '', 0) });
      if (caminho.startsWith('/api/')) {
        if (!auth.tokenValido(lerCookie(req, 'sessao'), agoraS())) throw new ErroHttp(401, 'Entre com a senha para continuar.');
        if (rota === 'GET /api/cronograma') return responderJson(res, 200, armazenamento.atual());
        if (rota === 'PUT /api/cronograma') return await salvar(req, res);
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
