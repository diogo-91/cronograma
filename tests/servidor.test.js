const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { criarServidor } = require('../servidor.js');

const SENHA = 'senha-de-teste';
const TAREFA = { nome: 'Fundação', inicio: '2026-10-01', fim: '2026-10-02', progresso: 10 };

async function subir(t, { pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cronograma-')), senha = SENHA } = {}) {
  const servidor = criarServidor({ senha, pastaDados: pasta });
  await new Promise((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const fechar = () => new Promise((fim) => servidor.close(fim));
  t.after(fechar);
  return { base: `http://127.0.0.1:${servidor.address().port}`, pasta, fechar };
}

async function entrar(base, { senha = SENHA, cabecalhos = {} } = {}) {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecalhos },
    body: JSON.stringify({ senha }),
  });
  const setCookie = r.headers.get('set-cookie') || '';
  return { status: r.status, setCookie, cookie: setCookie.split(';')[0] };
}

async function primeiraEmpresa(base, cookie) {
  const r = await fetch(`${base}/api/empresas`, { headers: { Cookie: cookie } });
  return r.status === 200 ? (await r.json()).empresas[0].id : 'inexistente';
}

async function api(base, cookie, metodo = 'GET', corpo, id) {
  const empresa = id || (await primeiraEmpresa(base, cookie));
  return fetch(`${base}/api/empresas/${empresa}`, {
    method: metodo,
    headers: { Cookie: cookie, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo && JSON.stringify(corpo),
  });
}

function getCru(base, caminho) {
  return new Promise((ok, falha) => {
    http.get(`${base}${caminho}`, (r) => { r.resume(); ok(r.statusCode); }).on('error', falha);
  });
}

test('API do cronograma exige login', async (t) => {
  const { base } = await subir(t);
  assert.equal((await api(base, '')).status, 401);
  assert.equal((await api(base, '', 'PUT', { revisaoBase: 0, titulo: 'x', tarefas: [] })).status, 401);
});

test('login recusa senha errada e, com a certa, devolve cookie HttpOnly e SameSite=Lax', async (t) => {
  const { base } = await subir(t);
  assert.equal((await entrar(base, { senha: 'errada' })).status, 401);
  const ok = await entrar(base);
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /^sessao=[^;]+/);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Lax/);
  assert.doesNotMatch(ok.setCookie, /Secure/);
  const https = await entrar(base, { cabecalhos: { 'X-Forwarded-Proto': 'https' } });
  assert.match(https.setCookie, /Secure/);
});

test('cronograma novo começa vazio na revisão 0', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  const r = await api(base, cookie);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { revisao: 0, idGravacao: null, titulo: 'Minha empresa', tarefas: [] });
});

test('PUT grava, incrementa a revisão e persiste entre reinícios do servidor', async (t) => {
  const primeiro = await subir(t);
  const { cookie } = await entrar(primeiro.base);
  const r = await api(primeiro.base, cookie, 'PUT', { revisaoBase: 0, titulo: 'Obra', tarefas: [TAREFA] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { revisao: 1 });
  await primeiro.fechar();

  const segundo = await subir(t, { pasta: primeiro.pasta });
  const sessao = await entrar(segundo.base);
  const doc = await (await api(segundo.base, sessao.cookie)).json();
  assert.equal(doc.revisao, 1);
  assert.equal(doc.titulo, 'Obra');
  assert.equal(doc.tarefas.length, 1);
  assert.equal(doc.tarefas[0].nome, 'Fundação');
  assert.equal(typeof doc.tarefas[0].id, 'string');
});

test('PUT com revisão desatualizada devolve 409 com a versão atual, sem sobrescrever', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'Do celular', tarefas: [TAREFA] });
  const r = await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'Do computador', tarefas: [] });
  assert.equal(r.status, 409);
  const corpo = await r.json();
  assert.equal(corpo.atual.revisao, 1);
  assert.equal(corpo.atual.titulo, 'Do celular');
});

test('PUT com tarefa inválida devolve 400 e não grava', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  const r = await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'x', tarefas: [{ nome: '', inicio: 'x', fim: 'y' }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /Tarefa 1/);
  assert.equal((await (await api(base, cookie)).json()).revisao, 0);
});

test('API só aceita JSON e recusa corpo grande demais', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  const texto = await fetch(`${base}/api/empresas/${await primeiraEmpresa(base, cookie)}`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(texto.status, 415);
  const enorme = await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'x'.repeat(3 * 1024 * 1024), tarefas: [] });
  assert.equal(enorme.status, 413);
});

test('cookie adulterado ou de outra senha não autentica', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  const adulterado = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'BB' : 'AA');
  assert.equal((await api(base, adulterado)).status, 401);
  const outro = await subir(t, { senha: 'outra-senha-longa' });
  assert.equal((await api(outro.base, cookie)).status, 401);
});

test('muitas senhas erradas bloqueiam só o endereço que errou', async (t) => {
  const { base } = await subir(t);
  const atacante = { 'X-Forwarded-For': '203.0.113.9' };
  for (let i = 0; i < 5; i++) assert.equal((await entrar(base, { senha: 'chute', cabecalhos: atacante })).status, 401);
  assert.equal((await entrar(base, { cabecalhos: atacante })).status, 429);
  assert.equal((await entrar(base, { cabecalhos: { 'X-Forwarded-For': '198.51.100.7' } })).status, 200);
});

test('arquivo de dados ilegível é guardado à parte e o servidor começa vazio', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cronograma-'));
  fs.writeFileSync(path.join(pasta, 'cronograma.json'), '{conteudo quebrado');
  const { base } = await subir(t, { pasta });
  const { cookie } = await entrar(base);
  assert.equal((await (await api(base, cookie)).json()).revisao, 0);
  const copia = fs.readdirSync(pasta).find((n) => n.startsWith('cronograma.json.ilegivel-'));
  assert.ok(copia, 'cópia do arquivo ilegível');
  assert.equal(fs.readFileSync(path.join(pasta, copia), 'utf8'), '{conteudo quebrado');
  assert.equal((await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'Novo', tarefas: [] })).status, 200);
});

test('serve só os arquivos do app, com tipo correto', async (t) => {
  const { base } = await subir(t);
  const pagina = await fetch(`${base}/`);
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get('content-type'), /text\/html/);
  assert.match(await pagina.text(), /<title>Cronograma<\/title>/);
  assert.match((await fetch(`${base}/css/styles.css`)).headers.get('content-type'), /text\/css/);
  assert.match((await fetch(`${base}/js/app.js`)).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/fonts/inter-latin-wght-normal.woff2`)).headers.get('content-type'), 'font/woff2');
  for (const caminho of ['/servidor.js', '/package.json', '/js/%2e%2e/servidor.js', '/..%2fservidor.js', '/tests/servidor.test.js', '/cronograma.json']) {
    assert.equal(await getCru(base, caminho), 404, caminho);
  }
});

test('respostas trazem cabeçalhos de segurança', async (t) => {
  const { base } = await subir(t);
  const r = await fetch(`${base}/`);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('sair apaga o cookie de sessão', async (t) => {
  const { base } = await subir(t);
  const r = await fetch(`${base}/api/logout`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('servidor exige senha com pelo menos 8 caracteres', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cronograma-'));
  assert.throws(() => criarServidor({ senha: undefined, pastaDados: pasta }), /SENHA/);
  assert.throws(() => criarServidor({ senha: 'curta', pastaDados: pasta }), /8 caracteres/);
});

function loginLento(base, senha, ip) {
  const url = new URL(`${base}/api/login`);
  const corpo = JSON.stringify({ senha });
  const req = http.request({
    hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo), 'X-Forwarded-For': ip },
  });
  const resposta = new Promise((ok, falha) => {
    req.on('response', (r) => { r.resume(); ok(r.statusCode); });
    req.on('error', falha);
  });
  req.flushHeaders();
  return { enviarCorpo: () => req.end(corpo), resposta };
}

test('limite de tentativas vale também para pedidos simultâneos', async (t) => {
  const { base } = await subir(t);
  const ip = '203.0.113.50';
  const pedidos = Array.from({ length: 20 }, () => loginLento(base, 'chute', ip));
  await new Promise((pronto) => setTimeout(pronto, 150));
  pedidos.forEach((p) => p.enviarCorpo());
  const status = await Promise.all(pedidos.map((p) => p.resposta));
  assert.ok(status.filter((s) => s === 401).length <= 5, `respostas: ${status.join(',')}`);
  assert.equal((await entrar(base, { cabecalhos: { 'X-Forwarded-For': ip } })).status, 429);
});

test('login recusa corpo maior que 1 KB', async (t) => {
  const { base } = await subir(t);
  assert.equal((await entrar(base, { senha: 'x'.repeat(2000) })).status, 413);
});

test('sessão é assinada com segredo do servidor, não só com a senha', async (t) => {
  const primeiro = await subir(t);
  const { cookie } = await entrar(primeiro.base);
  await primeiro.fechar();
  const mesmaPasta = await subir(t, { pasta: primeiro.pasta });
  assert.equal((await api(mesmaPasta.base, cookie)).status, 200, 'sessão sobrevive ao reinício');
  const outraPasta = await subir(t);
  assert.equal((await api(outraPasta.base, cookie)).status, 401, 'mesma senha, outro segredo: cookie não vale');
  const segredo = fs.statSync(path.join(primeiro.pasta, 'segredo-sessao'));
  assert.equal(segredo.mode & 0o777, 0o600);
});

test('gravação guarda o idGravacao enviado e o devolve no conflito', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  await api(base, cookie, 'PUT', { revisaoBase: 0, idGravacao: 'envio-1', titulo: 'x', tarefas: [] });
  assert.equal((await (await api(base, cookie)).json()).idGravacao, 'envio-1');
  const conflito = await api(base, cookie, 'PUT', { revisaoBase: 0, idGravacao: 'envio-2', titulo: 'y', tarefas: [] });
  assert.equal(conflito.status, 409);
  assert.equal((await conflito.json()).atual.idGravacao, 'envio-1');
  await api(base, cookie, 'PUT', { revisaoBase: 1, idGravacao: '<script>', titulo: 'z', tarefas: [] });
  assert.equal((await (await api(base, cookie)).json()).idGravacao, null);
});

test('dois processos no mesmo volume enxergam as gravações um do outro', async (t) => {
  const a = await subir(t);
  const b = await subir(t, { pasta: a.pasta });
  const sessaoA = await entrar(a.base);
  const sessaoB = await entrar(b.base);
  assert.equal((await api(a.base, sessaoA.cookie, 'PUT', { revisaoBase: 0, titulo: 'Pelo A', tarefas: [TAREFA] })).status, 200);
  const vistoPorB = await (await api(b.base, sessaoB.cookie)).json();
  assert.equal(vistoPorB.revisao, 1);
  assert.equal(vistoPorB.titulo, 'Pelo A');
  assert.equal((await api(b.base, sessaoB.cookie, 'PUT', { revisaoBase: 0, titulo: 'Pelo B', tarefas: [] })).status, 409);
});

function criarEmpresa(base, cookie, nome) {
  return fetch(`${base}/api/empresas`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) });
}

async function listar(base, cookie) {
  return (await (await fetch(`${base}/api/empresas`, { headers: { Cookie: cookie } })).json()).empresas;
}

test('cronograma da versão anterior vira a primeira empresa, sem perder nada', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cronograma-'));
  fs.writeFileSync(path.join(pasta, 'cronograma.json'), JSON.stringify({ revisao: 3, idGravacao: null, titulo: 'Obra antiga', tarefas: [{ id: 'a1', ...TAREFA }] }));
  const { base } = await subir(t, { pasta });
  const { cookie } = await entrar(base);
  const empresas = await listar(base, cookie);
  assert.deepEqual(empresas.map((e) => [e.nome, e.atividades]), [['Obra antiga', 1]]);
  const doc = await (await api(base, cookie)).json();
  assert.equal(doc.revisao, 3);
  assert.equal(doc.tarefas[0].id, 'a1');
  assert.ok(fs.existsSync(path.join(pasta, 'cronograma.json.migrado')), 'arquivo antigo guardado');
  assert.ok(!fs.existsSync(path.join(pasta, 'cronograma.json')));
});

test('cada empresa tem seu próprio cronograma e sua própria revisão', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  const criada = await criarEmpresa(base, cookie, '  Construtora Alfa ');
  assert.equal(criada.status, 201);
  const { id, nome } = await criada.json();
  assert.equal(nome, 'Construtora Alfa');
  const [primeira] = await listar(base, cookie);
  assert.equal((await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'Construtora Alfa', tarefas: [TAREFA] }, id)).status, 200);
  assert.equal((await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: primeira.nome, tarefas: [] }, primeira.id)).status, 200, 'revisão da outra empresa não mudou');
  assert.equal((await (await api(base, cookie, 'GET', undefined, id)).json()).tarefas.length, 1);
  assert.equal((await (await api(base, cookie, 'GET', undefined, primeira.id)).json()).tarefas.length, 0);
  assert.deepEqual((await listar(base, cookie)).map((e) => [e.nome, e.atividades]), [['Minha empresa', 0], ['Construtora Alfa', 1]]);
});

test('renomear o cronograma renomeia a empresa na lista', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'Padaria Sol', tarefas: [] });
  assert.equal((await listar(base, cookie))[0].nome, 'Padaria Sol');
});

test('empresa pode ser excluída, menos a última', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  const { id } = await (await criarEmpresa(base, cookie, 'Temporária')).json();
  const apagar = (alvo) => fetch(`${base}/api/empresas/${alvo}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal((await apagar(id)).status, 200);
  assert.equal((await api(base, cookie, 'GET', undefined, id)).status, 404);
  assert.equal((await api(base, cookie, 'PUT', { revisaoBase: 0, titulo: 'x', tarefas: [] }, id)).status, 404);
  const [ultima] = await listar(base, cookie);
  assert.equal((await apagar(ultima.id)).status, 409);
  assert.equal((await listar(base, cookie)).length, 1);
});

test('nome de empresa é obrigatório e limitado', async (t) => {
  const { base } = await subir(t);
  const { cookie } = await entrar(base);
  assert.equal((await criarEmpresa(base, cookie, '   ')).status, 400);
  assert.equal((await criarEmpresa(base, cookie, 'x'.repeat(81))).status, 400);
  assert.equal((await fetch(`${base}/api/empresas`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
});

test('arquivo de empresas ilegível é guardado à parte', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cronograma-'));
  fs.writeFileSync(path.join(pasta, 'empresas.json'), '{"empresas": 7}');
  const { base } = await subir(t, { pasta });
  const { cookie } = await entrar(base);
  assert.equal((await listar(base, cookie)).length, 1);
  assert.ok(fs.readdirSync(pasta).some((n) => n.startsWith('empresas.json.ilegivel-')));
});
