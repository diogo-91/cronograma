const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarServidor } = require('../servidor.js');
const C = require('../js/cronograma.js');

const SENHA = 'senha-do-teste-e2e';
const OUT = path.join(__dirname, 'saida');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const servidores = [];
  const erros = [];
  const novoServidor = async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cronograma-e2e-'));
    const servidor = criarServidor({ senha: SENHA, pastaDados: pasta });
    await new Promise((pronto) => servidor.listen(0, '127.0.0.1', pronto));
    servidores.push(servidor);
    return `http://127.0.0.1:${servidor.address().port}/`;
  };
  const nova = async (opts) => {
    const ctx = await browser.newContext({ acceptDownloads: true, locale: 'pt-BR', ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push('console: ' + m.text());
    });
    page.on('dialog', (d) => d.accept());
    return { ctx, page };
  };
  const entrar = async (pg, url) => {
    await pg.goto(url);
    await pg.waitForSelector('body[data-tela="login"]');
    await pg.fill('#senha', SENHA);
    await pg.click('#form-login button[type=submit]');
    await pg.waitForSelector('body[data-tela="app"]');
  };
  const aguardarSalvo = (pg) => pg.waitForFunction(() => document.querySelector('#salvo').textContent === 'Salvo no servidor');
  const aguardarAnuncio = (pg, texto) => pg.waitForFunction((t) => document.querySelector('#anuncio').textContent.includes(t), texto);
  const salvarTarefa = async (pg, nome, inicio, fim) => {
    await pg.click('#btn-nova');
    await pg.fill('#f-nome', nome);
    if (inicio) await pg.fill('#f-inicio', inicio);
    if (fim) await pg.fill('#f-fim', fim);
    await pg.click('#form-tarefa button[type=submit]');
  };
  const logo = async (pg, onde) => {
    assert.equal(await pg.getAttribute('.marca-logo', 'alt'), 'GoldSystem', `${onde}: nome da logo`);
    assert.ok(await pg.isVisible('.marca-logo'), `${onde}: logo visível`);
    assert.ok(await pg.evaluate(() => document.querySelector('.marca-logo').naturalWidth > 0), `${onde}: imagem da logo carregou`);
    assert.equal(await pg.getAttribute('link[rel=icon]', 'href'), 'img/icone-goldsystem.png', `${onde}: favicon`);
    assert.equal(await pg.evaluate(() => fetch('img/icone-goldsystem.png').then((r) => r.status)), 200, `${onde}: favicon servido`);
  };

  // ---------- Login ----------
  const URL_A = await novoServidor();
  const { ctx, page } = await nova({ viewport: { width: 1366, height: 860 } });
  await page.goto(URL_A);
  await page.waitForSelector('body[data-tela="login"]');
  await logo(page, 'login');
  await page.screenshot({ path: path.join(OUT, '00-login.png') });
  await page.fill('#senha', 'senha-errada');
  await page.click('#form-login button[type=submit]');
  await page.waitForSelector('#erro-login:has-text("Senha incorreta.")');
  await page.fill('#senha', SENHA);
  await page.click('#form-login button[type=submit]');
  await page.waitForSelector('body[data-tela="app"]');

  // ---------- Desktop ----------
  assert.ok(await page.isVisible('text=Seu cronograma está vazio'), 'estado vazio');
  await logo(page, 'desktop');
  await page.screenshot({ path: path.join(OUT, '01-vazio-desktop.png') });

  await page.click('text=Ver um exemplo');
  assert.equal(await page.locator('.g-barra').count(), 9, '9 barras no exemplo');
  assert.equal(await page.locator('.g-marco').count(), 1, '1 marco no exemplo');
  assert.ok(await page.isVisible('.g-hoje'), 'linha de hoje');
  await page.screenshot({ path: path.join(OUT, '02-gantt-semana-desktop.png') });

  // validação: nome vazio
  await page.click('#btn-nova');
  await page.fill('#f-nome', '   ');
  await page.click('#form-tarefa button[type=submit]');
  assert.equal(await page.textContent('#e-nome'), 'Informe o nome da atividade.');
  assert.equal(await page.getAttribute('#f-nome', 'aria-invalid'), 'true');
  // término antes do início
  await page.fill('#f-nome', 'Reunião de kickoff');
  assert.equal(await page.textContent('#e-nome'), '', 'erro do nome some ao corrigir');
  assert.equal(await page.getAttribute('#f-nome', 'aria-invalid'), 'false');
  await page.fill('#f-fase', 'Planejamento');
  await page.fill('#f-inicio', '2026-10-20');
  // aoMudarInicio deve ter empurrado o fim para depois do início se necessário
  const fimAuto = await page.inputValue('#f-fim');
  assert.ok(fimAuto >= '2026-10-20', 'fim acompanha início: ' + fimAuto);
  await page.fill('#f-fim', '2026-10-19');
  await page.dispatchEvent('#f-fim', 'change');
  await page.click('#form-tarefa button[type=submit]');
  assert.equal(await page.textContent('#e-fim'), 'O término não pode ser antes do início.');
  await page.fill('#f-fim', '2026-10-22');
  await page.dispatchEvent('#f-fim', 'change');
  assert.match(await page.textContent('#f-duracao'), /3 dias/);
  await page.fill('#f-progresso', '40');
  await page.dispatchEvent('#f-progresso', 'input');
  assert.equal(await page.inputValue('#f-progresso-faixa'), '40');
  assert.equal(await page.evaluate(() => document.querySelector('#f-progresso-faixa').style.getPropertyValue('--v')), '40%');
  await page.screenshot({ path: path.join(OUT, '03-dialogo-desktop.png') });
  await page.click('#form-tarefa button[type=submit]');
  assert.equal(await page.isVisible('#dialogo'), false, 'diálogo fechou');
  assert.equal(await page.locator('.g-barra').count(), 10);

  // editar via barra
  await page.click('.g-barra[aria-label^="Reunião de kickoff"]');
  assert.equal(await page.textContent('#dialogo-titulo'), 'Editar atividade');
  assert.equal(await page.inputValue('#f-nome'), 'Reunião de kickoff');
  await page.fill('#f-progresso', '100');
  await page.click('#form-tarefa button[type=submit]');
  assert.match(await page.getAttribute('.g-barra[aria-label^="Reunião de kickoff"]', 'class'), /concluida/);

  // zoom dia / mês
  await page.click('[data-zoom=dia]');
  assert.ok((await page.locator('.g-marca').count()) > 30);
  await page.screenshot({ path: path.join(OUT, '04-gantt-dia-desktop.png') });
  await page.click('[data-zoom=mes]');
  assert.equal(await page.locator('.g-marca').count(), 0);
  await page.screenshot({ path: path.join(OUT, '05-gantt-mes-desktop.png') });
  await page.click('[data-zoom=semana]');

  // filtros
  await page.selectOption('#filtro-status', 'atrasada');
  const atrasadas = await page.locator('.g-nome-texto').allTextContents();
  assert.deepEqual(atrasadas, ['Aprovação do conteúdo']);
  await page.selectOption('#filtro-status', '');
  await page.fill('#busca', 'DIEGO');
  assert.deepEqual((await page.locator('.g-nome-texto').allTextContents()).sort(), ['Back-end e integrações', 'Publicação no ar']);
  await page.fill('#busca', 'zzzz');
  assert.ok(await page.isVisible('text=Nenhuma atividade encontrada'));
  await page.click('text=Limpar filtros');
  assert.equal(await page.locator('.g-barra').count(), 10);
  await page.selectOption('#filtro-fase', 'Design');
  assert.equal(await page.locator('.g-barra').count(), 3);
  assert.match(await page.textContent('#resumo'), /Progresso \(filtrado\)/);
  await page.selectOption('#filtro-fase', '');

  // lista + excluir + desfazer + duplicar
  await page.click('[data-visao=tabela]');
  assert.equal(await page.locator('.tabela tbody tr.linha-tarefa').count(), 11);
  assert.equal(await page.isVisible('#grupo-zoom'), false, 'zoom some na lista');
  await page.screenshot({ path: path.join(OUT, '06-lista-desktop.png'), fullPage: true });
  await page.click('[aria-label="Excluir Wireframes"]');
  assert.equal(await page.locator('.tabela tbody tr.linha-tarefa').count(), 10);
  await page.click('#toast button:has-text("Desfazer")');
  assert.equal(await page.locator('.tabela tbody tr.linha-tarefa').count(), 11);
  await aguardarSalvo(page);
  await page.click('[aria-label="Duplicar Wireframes"]');
  assert.ok(await page.isVisible('text=Wireframes (cópia)'));

  // título
  await page.fill('#titulo', 'Obra da casa');
  await page.press('#titulo', 'Enter');
  assert.equal(await page.title(), 'Obra da casa · Cronograma');

  // persistência no servidor: recarregar e abrir em outro aparelho
  await aguardarSalvo(page);
  await page.reload();
  await page.waitForSelector('body[data-tela="app"]');
  assert.equal(await page.inputValue('#titulo'), 'Obra da casa');
  assert.equal(await page.locator('.tabela tbody tr.linha-tarefa').count(), 12, 'persistiu após reload');
  assert.equal(await page.getAttribute('[data-visao=tabela]', 'aria-pressed'), 'true', 'preferência de visão persistiu');
  const celular = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await entrar(celular.page, URL_A);
  assert.equal(await celular.page.inputValue('#titulo'), 'Obra da casa', 'outro aparelho vê o mesmo título');
  assert.equal(await celular.page.locator('.g-barra').count(), 11, 'outro aparelho vê as mesmas atividades');

  // exportar CSV
  await page.click('#menu summary');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('[data-acao=exportar-csv]')]);
  const csv = fs.readFileSync(await dlCsv.path(), 'utf8');
  assert.match(dlCsv.suggestedFilename(), /^cronograma-obra-da-casa-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(csv.split('\r\n').length, 13);
  // exportar JSON e reimportar
  await page.click('#menu summary');
  const [dlJson] = await Promise.all([page.waitForEvent('download'), page.click('[data-acao=exportar-json]')]);
  const jsonPath = path.join(OUT, 'backup.json');
  await dlJson.saveAs(jsonPath);
  await page.click('#menu summary');
  await page.click('[data-acao=apagar-tudo]');
  assert.ok(await page.isVisible('text=Seu cronograma está vazio'));
  await aguardarSalvo(page);
  await page.setInputFiles('#arquivo', jsonPath);
  await page.waitForSelector('.tabela tbody tr.linha-tarefa');
  assert.equal(await page.locator('.tabela tbody tr.linha-tarefa').count(), 12, 'reimportou');
  assert.equal(await page.inputValue('#titulo'), 'Obra da casa');
  await aguardarAnuncio(page, '12 atividades importadas.');
  // importar inválido
  const ruim = path.join(OUT, 'ruim.json');
  fs.writeFileSync(ruim, JSON.stringify({ tarefas: [{ nome: '', inicio: 'x', fim: 'y' }] }));
  await page.setInputFiles('#arquivo', ruim);
  await aguardarAnuncio(page, 'Importação cancelada. Tarefa 1');
  assert.equal(await page.locator('.tabela tbody tr.linha-tarefa').count(), 12, 'importação inválida não apagou nada');

  // XSS: nome com HTML não vira markup
  await page.click('#btn-nova');
  await page.fill('#f-nome', '<img src=x onerror="window.__xss=1">');
  await page.click('#form-tarefa button[type=submit]');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator('.tabela img').count(), 0);

  // ---------- Sistema em modo escuro: a página continua clara ----------
  const escuro = await nova({ viewport: { width: 1366, height: 860 }, colorScheme: 'dark' });
  await entrar(escuro.page, await novoServidor());
  await escuro.page.click('text=Ver um exemplo');
  assert.equal(await escuro.page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 245, 243)');
  assert.equal(await escuro.page.evaluate(() => getComputedStyle(document.querySelector('.topo')).backgroundColor), 'rgba(255, 255, 255, 0.82)');
  await escuro.page.screenshot({ path: path.join(OUT, '07-tema-claro-com-sistema-escuro.png') });

  // ---------- Mobile ----------
  for (const [nome, vp] of [['mobile-360', { width: 360, height: 740 }], ['mobile-390', { width: 390, height: 844 }], ['tablet-768', { width: 768, height: 1024 }]]) {
    const m = await nova({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await entrar(m.page, await novoServidor());
    const semOverflow = async (etapa) => {
      const r = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      assert.ok(r.sw <= r.iw, `${nome}/${etapa}: rolagem horizontal na página (${r.sw} > ${r.iw})`);
    };
    await semOverflow('vazio');
    await logo(m.page, nome);
    await m.page.screenshot({ path: path.join(OUT, `10-${nome}-vazio.png`) });
    await m.page.click('text=Ver um exemplo');
    await semOverflow('gantt');
    await m.page.screenshot({ path: path.join(OUT, `11-${nome}-gantt.png`) });
    const fab = await m.page.locator('#btn-nova').boundingBox();
    assert.ok(fab.height >= 44, 'botão nova atividade com alvo de toque >= 44px');
    await m.page.click('[data-visao=tabela]');
    await semOverflow('lista');
    await m.page.screenshot({ path: path.join(OUT, `12-${nome}-lista.png`), fullPage: true });
    await m.page.click('#btn-nova');
    await semOverflow('dialogo');
    const caixa = await m.page.locator('#dialogo').boundingBox();
    assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= vp.width + 1, 'diálogo cabe na largura');
    const vazando = await m.page.evaluate(() => {
      const d = document.querySelector('#dialogo').getBoundingClientRect();
      return [...document.querySelectorAll('#dialogo input, #dialogo textarea, #dialogo button')]
        .filter((e) => e.offsetParent && e.getBoundingClientRect().right > d.right - 8).map((e) => e.id || e.textContent.trim());
    });
    assert.deepEqual(vazando, [], `${nome}: campos vazando do diálogo`);
    await m.page.screenshot({ path: path.join(OUT, `13-${nome}-dialogo.png`) });
    await m.page.click('#dialogo [data-fechar].btn');
    await m.page.click('#menu summary');
    const menu = await m.page.locator('#menu .menu-itens').boundingBox();
    assert.ok(menu.x >= 0, `${nome}: menu sai pela esquerda (x=${menu.x})`);
    await m.page.screenshot({ path: path.join(OUT, `14-${nome}-menu.png`) });
  }

  // ---------- Correções da revisão ----------

  // foco volta para a atividade salva; anúncio para leitor de tela
  await page.click('[data-visao=gantt]');
  await salvarTarefa(page, 'Foco depois de salvar');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.includes('Foco depois de salvar')), true, 'foco na atividade salva');
  await aguardarAnuncio(page, 'Atividade salva.');

  // progresso com texto inválido no campo numérico não vira 0% em silêncio
  await page.click('#btn-nova');
  await page.fill('#f-nome', 'Progresso inválido');
  await page.fill('#f-progresso', '');
  await page.focus('#f-progresso');
  await page.keyboard.type('5e');
  await page.click('#form-tarefa button[type=submit]');
  assert.equal(await page.textContent('#e-progresso'), 'Digite um número de 0 a 100.');
  await page.click('#dialogo [data-fechar].btn');

  // digitar o ano no início não manda o término para o ano 3851
  await page.click('#btn-nova');
  await page.fill('#f-nome', 'Ano digitado');
  await page.fill('#f-inicio', '2026-10-08');
  await page.dispatchEvent('#f-inicio', 'change');
  await page.fill('#f-fim', '2026-10-14');
  await page.dispatchEvent('#f-fim', 'change');
  await page.focus('#f-inicio');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('2027');
  const inicioDigitado = await page.inputValue('#f-inicio');
  const fimDigitado = await page.inputValue('#f-fim');
  assert.equal(inicioDigitado.slice(0, 4), '2027', 'ano digitado no início: ' + inicioDigitado);
  assert.ok(fimDigitado < '2100', 'término não explode: ' + fimDigitado);
  await page.click('#dialogo [data-fechar].btn');

  // impressão encolhe o Gantt para caber na página e desfaz depois
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const zoomImpressao = Number(await page.evaluate(() => document.querySelector('.g-grade').style.zoom));
  assert.ok(zoomImpressao > 0 && zoomImpressao < 1, 'zoom de impressão: ' + zoomImpressao);
  await page.pdf({ path: path.join(OUT, '08-impressao-gantt.pdf'), landscape: true, printBackground: true });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.evaluate(() => document.querySelector('.g-grade').style.zoom), '');

  // filtro invisível não esconde a primeira atividade de um cronograma vazio
  await page.selectOption('#filtro-status', 'atrasada');
  await page.click('#menu summary');
  await page.click('[data-acao=apagar-tudo]');
  await salvarTarefa(page, 'Primeira de novo');
  assert.equal(await page.locator('.g-barra').count(), 1, 'atividade nova visível');

  // período longo: escala por dia fica indisponível e cai para semana
  await salvarTarefa(page, 'Cinco anos', '2026-01-01', '2030-12-31');
  await page.click('[data-zoom=semana]');
  assert.equal(await page.isDisabled('[data-zoom=dia]'), true);
  assert.equal(await page.getAttribute('[data-zoom=semana]', 'aria-pressed'), 'true');
  await salvarTarefa(page, 'Trinta anos', '2026-01-01', '2056-12-31');
  assert.equal(await page.getAttribute('[data-zoom=mes]', 'aria-pressed'), 'true');
  assert.equal(await page.isDisabled('[data-zoom=semana]'), true);

  // outro aparelho mudou os dados: ao voltar para a aba, recarrega em vez de sobrescrever
  await aguardarSalvo(page);
  await celular.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await celular.page.waitForSelector('.g-nome-texto:has-text("Trinta anos")');
  await salvarTarefa(celular.page, 'Feita no celular');
  await aguardarSalvo(celular.page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('.g-nome-texto:has-text("Feita no celular")');

  // conflito: os dois aparelhos editam sem atualizar; o segundo a gravar recebe a versão do primeiro
  await celular.page.fill('#titulo', 'Título do celular');
  await aguardarSalvo(celular.page);
  await salvarTarefa(page, 'Feita no computador sem atualizar');
  await aguardarAnuncio(page, 'alterado em outro aparelho');
  assert.equal(await page.inputValue('#titulo'), 'Título do celular');
  assert.equal(await page.locator('.g-nome-texto:has-text("Feita no computador sem atualizar")').count(), 0);
  assert.equal(await page.locator('.g-nome-texto:has-text("Feita no celular")').count(), 1);

  // sem rede: nada de "Atividade salva" falso; envia quando a conexão volta
  const rede = await nova({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await entrar(rede.page, await novoServidor());
  await rede.page.route('**/api/empresas/*', (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()));
  await salvarTarefa(rede.page, 'Sem rede');
  await rede.page.waitForFunction(() => document.querySelector('#salvo').textContent.startsWith('Sem conexão'));
  assert.match(await rede.page.textContent('#anuncio'), /Sem conexão com o servidor/);
  assert.equal(await rede.page.isVisible('#salvo'), true, 'indicador de falha visível em 360px');
  await rede.page.unroute('**/api/empresas/*');
  await rede.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await aguardarSalvo(rede.page);
  await rede.page.reload();
  await rede.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await rede.page.locator('.g-nome-texto:has-text("Sem rede")').count(), 1, 'gravou ao voltar a conexão');

  // sessão expirada: pede a senha e envia o que estava pendente
  await rede.ctx.clearCookies();
  await salvarTarefa(rede.page, 'Depois de expirar');
  await rede.page.waitForSelector('body[data-tela="login"]');
  await rede.page.fill('#senha', SENHA);
  await rede.page.click('#form-login button[type=submit]');
  await rede.page.waitForSelector('body[data-tela="app"]');
  await aguardarSalvo(rede.page);
  await rede.page.reload();
  await rede.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await rede.page.locator('.g-nome-texto:has-text("Depois de expirar")').count(), 1, 'pendente enviado após novo login');

  // dados que estavam só no navegador sobem para o servidor no primeiro acesso
  const URL_MIGRACAO = await novoServidor();
  const antigo = await nova({ viewport: { width: 1366, height: 860 } });
  await antigo.page.goto(URL_MIGRACAO);
  await antigo.page.evaluate(() => localStorage.setItem('cronograma:v1', JSON.stringify({
    titulo: 'Do navegador antigo',
    tarefas: [{ id: 'a', nome: 'Antiga', inicio: '2026-10-01', fim: '2026-10-03', progresso: 50 }],
  })));
  await antigo.page.fill('#senha', SENHA);
  await antigo.page.click('#form-login button[type=submit]');
  await aguardarAnuncio(antigo.page, 'Atividades enviadas para o servidor.');
  assert.equal(await antigo.page.evaluate(() => localStorage.getItem('cronograma:v1')), null, 'cópia local removida após enviar');
  const novoAparelho = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await entrar(novoAparelho.page, URL_MIGRACAO);
  assert.equal(await novoAparelho.page.inputValue('#titulo'), 'Do navegador antigo');

  // endereço servindo só os arquivos (Build Pack errado) explica o que fazer
  const semApi = await nova({ viewport: { width: 1366, height: 860 } });
  await semApi.page.route('**/api/empresas', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' }));
  await semApi.page.goto(URL_A);
  await semApi.page.waitForSelector('text=Servidor do cronograma não encontrado');
  assert.equal(await semApi.page.isVisible('#btn-nova'), false);

  // resposta perdida: a gravação chegou ao servidor, mas o aparelho não soube; não vira conflito falso
  const perda = await nova({ viewport: { width: 1366, height: 860 } });
  await entrar(perda.page, await novoServidor());
  let perderResposta = true;
  await perda.page.route('**/api/empresas/*', async (r) => {
    if (r.request().method() !== 'PUT' || !perderResposta) return r.continue();
    perderResposta = false;
    await r.fetch();
    return r.abort();
  });
  await salvarTarefa(perda.page, 'B gravada sem resposta');
  await perda.page.waitForFunction(() => document.querySelector('#salvo').textContent.startsWith('Sem conexão'));
  await salvarTarefa(perda.page, 'C depois da falha');
  await aguardarSalvo(perda.page);
  assert.doesNotMatch(await perda.page.textContent('#anuncio'), /outro aparelho/);
  await perda.page.unroute('**/api/empresas/*');
  await perda.page.reload();
  await perda.page.waitForSelector('body[data-tela="app"]');
  assert.deepEqual((await perda.page.locator('.g-nome-texto').allTextContents()).sort(), ['B gravada sem resposta', 'C depois da falha']);

  // servidor recusou os dados: o indicador não diz "Salvo no servidor"; importação grande é barrada antes
  await perda.page.route('**/api/empresas/*', (r) => (r.request().method() === 'PUT'
    ? r.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ erro: 'Dados grandes demais.' }) })
    : r.continue()));
  await salvarTarefa(perda.page, 'Recusada');
  await perda.page.waitForFunction(() => document.querySelector('#salvo').textContent.startsWith('Não salvo'));
  assert.match(await perda.page.textContent('#anuncio'), /recusou/);
  await perda.page.unroute('**/api/empresas/*');
  const grande = path.join(OUT, 'grande.json');
  fs.writeFileSync(grande, JSON.stringify({
    titulo: 'Grande',
    tarefas: Array.from({ length: 9000 }, (_, i) => ({ nome: `Atividade número ${i}`, inicio: '2026-10-01', fim: '2026-10-02', notas: 'x'.repeat(150) })),
  }));
  await perda.page.setInputFiles('#arquivo', grande);
  await aguardarAnuncio(perda.page, 'grande demais');

  // sincronização lenta não desfaz o que foi gravado enquanto ela estava a caminho
  const URL_LENTO = await novoServidor();
  const lento = await nova({ viewport: { width: 1366, height: 860 } });
  await entrar(lento.page, URL_LENTO);
  let atrasarGet = true;
  await lento.page.route('**/api/empresas/*', async (r) => {
    if (r.request().method() !== 'GET' || !atrasarGet) return r.continue();
    atrasarGet = false;
    const antiga = await r.fetch();
    await new Promise((ok) => setTimeout(ok, 2000));
    return r.fulfill({ response: antiga });
  });
  await lento.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await salvarTarefa(lento.page, 'D durante a sincronização');
  await aguardarSalvo(lento.page);
  await lento.page.waitForTimeout(2500);
  assert.equal(await lento.page.locator('.g-nome-texto:has-text("D durante a sincronização")').count(), 1, 'GET antigo não apagou D');
  await salvarTarefa(lento.page, 'E depois');
  await aguardarSalvo(lento.page);
  assert.doesNotMatch(await lento.page.textContent('#anuncio'), /outro aparelho/);
  await lento.page.unroute('**/api/empresas/*');

  // edição feita durante um envio que termina em conflito não ganha aviso falso de sucesso depois
  const outroLento = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await entrar(outroLento.page, URL_LENTO);
  await salvarTarefa(outroLento.page, 'Do outro aparelho');
  await aguardarSalvo(outroLento.page);
  await lento.page.click('[data-visao=tabela]');
  await lento.page.evaluate(() => {
    window.__anuncios = [];
    new MutationObserver((registros) => {
      for (const r of registros) for (const no of r.addedNodes) window.__anuncios.push(no.textContent);
    })
      .observe(document.querySelector('#anuncio'), { childList: true, characterData: true, subtree: true });
  });
  await lento.page.route('**/api/empresas/*', async (r) => {
    if (r.request().method() === 'PUT') await new Promise((ok) => setTimeout(ok, 1500));
    return r.continue();
  });
  await salvarTarefa(lento.page, 'X vai conflitar');
  await lento.page.waitForTimeout(700);
  await lento.page.click('[aria-label="Duplicar E depois"]');
  await aguardarAnuncio(lento.page, 'outro aparelho');
  await lento.page.unroute('**/api/empresas/*');
  await salvarTarefa(lento.page, 'Z depois do conflito');
  await aguardarSalvo(lento.page);
  await lento.page.waitForTimeout(300);
  const anuncios = await lento.page.evaluate(() => window.__anuncios);
  assert.ok(!anuncios.includes('Atividade duplicada.'), `aviso falso: ${anuncios.join(' | ')}`);

  // entrar enquanto um envio sem sessão está a caminho não perde a alteração pendente
  const sessao = await nova({ viewport: { width: 1366, height: 860 } });
  await entrar(sessao.page, await novoServidor());
  await sessao.ctx.clearCookies();
  await salvarTarefa(sessao.page, 'Pendente B');
  await sessao.page.waitForSelector('body[data-tela="login"]');
  await sessao.page.route('**/api/empresas/*', async (r) => {
    if (r.request().method() !== 'PUT') return r.continue();
    const resposta = await r.fetch();
    await new Promise((ok) => setTimeout(ok, 1500));
    return r.fulfill({ response: resposta });
  });
  await sessao.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sessao.page.fill('#senha', SENHA);
  await sessao.page.click('#form-login button[type=submit]');
  await sessao.page.waitForSelector('body[data-tela="app"]');
  await sessao.page.waitForTimeout(2000);
  await aguardarSalvo(sessao.page);
  assert.equal(await sessao.page.evaluate(() => document.body.dataset.tela), 'app', 'não pediu a senha de novo');
  await sessao.page.reload();
  await sessao.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await sessao.page.locator('.g-nome-texto:has-text("Pendente B")').count(), 1, 'pendente chegou ao servidor');

  // empresas: cada uma com seu cronograma, troca pelo menu, outro aparelho vê as mesmas
  const URL_EMPRESAS = await novoServidor();
  const emp = await nova({ viewport: { width: 1366, height: 860 } });
  await entrar(emp.page, URL_EMPRESAS);
  assert.equal(await emp.page.inputValue('#titulo'), 'Minha empresa');
  await salvarTarefa(emp.page, 'Tarefa da primeira');
  await aguardarSalvo(emp.page);
  await emp.page.click('#menu-empresas summary');
  await emp.page.click('#btn-nova-empresa');
  await emp.page.click('#form-empresa button[type=submit]');
  assert.equal(await emp.page.textContent('#e-empresa'), 'Informe o nome da empresa.');
  await emp.page.fill('#f-empresa', 'Construtora Alfa');
  await emp.page.click('#form-empresa button[type=submit]');
  await emp.page.waitForFunction(() => document.querySelector('#titulo').value === 'Construtora Alfa');
  assert.ok(await emp.page.isVisible('text=Seu cronograma está vazio'), 'empresa nova começa vazia');
  await salvarTarefa(emp.page, 'Tarefa da Alfa');
  await aguardarSalvo(emp.page);
  await emp.page.click('#menu-empresas summary');
  await emp.page.screenshot({ path: path.join(OUT, '15-menu-empresas-desktop.png') });
  await emp.page.click('#lista-empresas button:has-text("Minha empresa")');
  await emp.page.waitForFunction(() => document.querySelector('#titulo').value === 'Minha empresa');
  assert.deepEqual(await emp.page.locator('.g-nome-texto').allTextContents(), ['Tarefa da primeira']);
  await emp.page.fill('#titulo', 'Padaria Sol');
  await emp.page.press('#titulo', 'Enter');
  await aguardarSalvo(emp.page);

  const emp2 = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await entrar(emp2.page, URL_EMPRESAS);
  await emp2.page.click('#menu-empresas summary');
  assert.deepEqual(await emp2.page.locator('#lista-empresas .empresa-nome').allTextContents(), ['Padaria Sol', 'Construtora Alfa']);
  const menuCelular = await emp2.page.locator('#menu-empresas .menu-itens').boundingBox();
  assert.ok(menuCelular.x >= 0 && menuCelular.x + menuCelular.width <= 390, `menu de empresas cabe na tela (${menuCelular.x}, ${menuCelular.width})`);
  await emp2.page.screenshot({ path: path.join(OUT, '16-menu-empresas-celular.png') });
  await emp2.page.click('#lista-empresas button:has-text("Construtora Alfa")');
  await emp2.page.waitForFunction(() => document.querySelector('#titulo').value === 'Construtora Alfa');
  assert.deepEqual(await emp2.page.locator('.g-nome-texto').allTextContents(), ['Tarefa da Alfa']);
  await emp2.page.reload();
  await emp2.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await emp2.page.inputValue('#titulo'), 'Construtora Alfa', 'aparelho lembra a última empresa aberta');

  await emp2.page.click('#menu summary');
  await emp2.page.click('[data-acao=excluir-empresa]');
  await aguardarAnuncio(emp2.page, 'Empresa excluída.');
  assert.equal(await emp2.page.inputValue('#titulo'), 'Padaria Sol');
  await emp.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await emp.page.waitForFunction(() => document.querySelectorAll('#lista-empresas button').length === 1);
  await emp.page.click('#menu summary');
  await emp.page.click('[data-acao=excluir-empresa]');
  await aguardarAnuncio(emp.page, 'única empresa');

  // notas com formatação e checklist
  const notas = await nova({ viewport: { width: 1366, height: 860 } });
  await entrar(notas.page, await novoServidor());
  await notas.page.click('#btn-nova');
  await notas.page.fill('#f-nome', 'Com checklist');
  await notas.page.click('#f-notas');
  await notas.page.click('[data-comando=bold]');
  await notas.page.keyboard.type('Importante');
  await notas.page.click('[data-comando=bold]');
  await notas.page.keyboard.type(' resto normal');
  await notas.page.click('#btn-item-checklist');
  await notas.page.keyboard.type('Comprar cimento');
  await notas.page.keyboard.press('Enter');
  await notas.page.keyboard.type('Contratar pedreiro');
  await notas.page.check('#f-checklist li:first-child input[type=checkbox]');
  assert.equal(await notas.page.textContent('#f-checklist-resumo'), '1 de 2 concluídos');
  await notas.page.screenshot({ path: path.join(OUT, '17-notas-checklist.png') });
  await notas.page.click('#form-tarefa button[type=submit]');
  await aguardarSalvo(notas.page);
  await notas.page.reload();
  await notas.page.waitForSelector('body[data-tela="app"]');
  assert.match(await notas.page.textContent('.g-nome-datas'), /✓ 1\/2$/);
  await notas.page.click('.g-nome:has-text("Com checklist")');
  assert.match(await notas.page.innerHTML('#f-notas'), /^<b>Importante<\/b>(\s|&nbsp;)resto normal$/);
  assert.deepEqual(await notas.page.$$eval('#f-checklist input[type=text]', (els) => els.map((e) => e.value)), ['Comprar cimento', 'Contratar pedreiro']);
  assert.deepEqual(await notas.page.$$eval('#f-checklist input[type=checkbox]', (els) => els.map((e) => e.checked)), [true, false]);
  await notas.page.click('#dialogo [data-fechar].btn');
  await notas.page.click('[data-visao=tabela]');
  assert.match(await notas.page.textContent('.tabela .checklist-resumo'), /1\/2 itens/);
  assert.match(await notas.page.textContent('.tabela .notas'), /^Importante resto normal$/);

  await notas.page.evaluate(async () => {
    const { empresas } = await (await fetch('api/empresas')).json();
    const url = `api/empresas/${empresas[0].id}`;
    const doc = await (await fetch(url)).json();
    doc.tarefas[0].notas = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b onclick="window.__xss=3" style="color:red">ok</b><a href="javascript:alert(1)">link</a>';
    await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revisaoBase: doc.revisao, titulo: doc.titulo, tarefas: doc.tarefas }) });
  });
  await notas.page.reload();
  await notas.page.waitForSelector('body[data-tela="app"]');
  await notas.page.click('.nome-link:has-text("Com checklist")');
  assert.equal(await notas.page.innerHTML('#f-notas'), '<b>ok</b>link');
  await notas.page.click('#f-notas b');
  assert.equal(await notas.page.evaluate(() => window.__xss), undefined, 'nada do HTML injetado executou');
  await notas.page.click('#dialogo [data-fechar].btn');

  // etapa 1: marcos, fases como grupos, ordem manual
  const URL_GRUPOS = await novoServidor();
  const gr = await nova({ viewport: { width: 1366, height: 1400 } });
  await entrar(gr.page, URL_GRUPOS);
  await gr.page.click('text=Ver um exemplo');
  await aguardarSalvo(gr.page);
  const fasesNaTela = (pg) => pg.locator('.g-grupo-nome').allTextContents();
  const nomesNaTela = (pg) => pg.locator('.g-nome-texto').allTextContents();
  assert.deepEqual(await fasesNaTela(gr.page), ['Planejamento', 'Design', 'Desenvolvimento', 'Testes', 'Lançamento']);
  assert.equal(await gr.page.locator('.g-resumo').count(), 5, 'barra-resumo por fase');
  await gr.page.screenshot({ path: path.join(OUT, '18-gantt-grupos.png') });

  // marco pelo editor
  await gr.page.click('#btn-nova');
  await gr.page.fill('#f-nome', 'Aprovação do cliente');
  await gr.page.fill('#f-fase', 'Lançamento');
  await gr.page.check('#f-marco');
  assert.equal(await gr.page.isVisible('#f-fim'), false, 'marco não tem término');
  assert.equal(await gr.page.isVisible('#f-progresso'), false, 'marco não tem progresso em %');
  assert.equal(await gr.page.textContent('#rotulo-inicio'), 'Data *');
  await gr.page.check('#f-marco-feito');
  await gr.page.click('#form-tarefa button[type=submit]');
  await aguardarSalvo(gr.page);
  assert.equal(await gr.page.locator('.g-marco').count(), 2);
  assert.match(await gr.page.getAttribute('.g-marco[aria-label^="Marco Aprovação do cliente"]', 'class'), /concluida/);
  assert.deepEqual((await nomesNaTela(gr.page)).slice(-3), ['Publicação no ar', 'Divulgação', 'Aprovação do cliente'], 'nova atividade vai para o fim da fase');

  // recolher e lembrar
  await gr.page.click('[aria-label="Recolher Design"]');
  assert.ok(!(await nomesNaTela(gr.page)).includes('Wireframes'), 'Design recolhido');
  await gr.page.reload();
  await gr.page.waitForSelector('body[data-tela="app"]');
  assert.ok(!(await nomesNaTela(gr.page)).includes('Wireframes'), 'recolhimento lembrado');
  await gr.page.click('[aria-label="Expandir Design"]');
  assert.ok((await nomesNaTela(gr.page)).includes('Wireframes'));

  // teclado: subir uma atividade e um grupo
  await gr.page.focus('.alca[data-alca="tarefa"][aria-label*="Identidade visual"]');
  await gr.page.keyboard.press('ArrowUp');
  await gr.page.keyboard.press('ArrowUp');
  const design = async () => {
    const nomes = await nomesNaTela(gr.page);
    return nomes.slice(nomes.indexOf('Identidade visual') - 1, nomes.indexOf('Identidade visual') + 2);
  };
  assert.deepEqual(await design(), ['Cronograma e orçamento', 'Identidade visual', 'Wireframes']);
  assert.equal(await gr.page.evaluate(() => document.activeElement.dataset.valor) !== undefined, true, 'foco continua na alça');
  await gr.page.focus('.alca[data-alca="fase"][aria-label*="Testes"]');
  await gr.page.keyboard.press('ArrowUp');
  assert.deepEqual(await fasesNaTela(gr.page), ['Planejamento', 'Design', 'Testes', 'Desenvolvimento', 'Lançamento']);

  // arrastar com o mouse: atividade para outra fase e grupo inteiro
  const arrastar = async (pg, alcaSel, alvoSel, posicao = 'cima') => {
    const a = await pg.locator(alcaSel).boundingBox();
    const b = await pg.locator(alvoSel).boundingBox();
    const y = posicao === 'cima' ? b.y + 4 : b.y + b.height - 4;
    await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await pg.mouse.down();
    for (let i = 1; i <= 8; i++) await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((y - a.y - a.height / 2) * i) / 8);
    await pg.mouse.up();
  };
  await arrastar(gr.page, '.alca[data-alca="tarefa"][aria-label*="Front-end"]', '.g-linha[data-arrastavel="tarefa"]:has(.g-nome-texto:text-is("Testes e ajustes"))');
  await aguardarSalvo(gr.page);
  const testes = await gr.page.evaluate(() => [...document.querySelectorAll('.g-linha')].map((l) => l.querySelector('.g-grupo-nome, .g-nome-texto').textContent));
  const iTestes = testes.indexOf('Testes');
  assert.deepEqual(testes.slice(iTestes, iTestes + 3), ['Testes', 'Front-end', 'Testes e ajustes'], 'Front-end foi para a fase Testes: ' + testes.join(' / '));
  await arrastar(gr.page, '.alca[data-alca="fase"][aria-label*="Lançamento"]', '.g-grupo[data-fase="Planejamento"]');
  await aguardarSalvo(gr.page);
  assert.equal((await fasesNaTela(gr.page))[0], 'Lançamento', 'grupo inteiro arrastado para o topo');

  // a ordem é do servidor: outro aparelho vê igual
  const gr2 = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await entrar(gr2.page, URL_GRUPOS);
  assert.deepEqual(await fasesNaTela(gr2.page), await fasesNaTela(gr.page));
  assert.deepEqual(await nomesNaTela(gr2.page), await nomesNaTela(gr.page));
  await gr2.page.screenshot({ path: path.join(OUT, '19-gantt-grupos-celular.png') });
  await gr2.page.click('[data-visao=tabela]');
  await gr2.page.screenshot({ path: path.join(OUT, '20-lista-grupos-celular.png'), fullPage: true });

  // com filtro não dá para arrastar; ordenar por data desfaz a ordem manual
  await gr.page.fill('#busca', 'a');
  assert.equal(await gr.page.locator('.alca').count(), 0, 'alças escondidas com filtro');
  await gr.page.fill('#busca', '');
  await gr.page.click('#menu summary');
  await gr.page.click('[data-acao=ordenar-data]');
  await aguardarSalvo(gr.page);
  assert.equal((await fasesNaTela(gr.page))[0], 'Planejamento', 'ordem por data volta Planejamento ao topo');

  // etapa 2: arrastar barras, puxar pontas e progresso, teclado, desfazer e refazer
  const curta = (n) => C.formatarData(C.isoDeDia(C.diaNumero(C.hojeISO()) + n)).slice(0, 5);
  const br = await nova({ viewport: { width: 1366, height: 1400 } });
  const URL_BARRAS = await novoServidor();
  await entrar(br.page, URL_BARRAS);
  await br.page.click('text=Ver um exemplo');
  await aguardarSalvo(br.page);
  await br.page.click('[data-zoom=dia]');
  const datasDe = (nome) => br.page.locator(`.g-linha:has(.g-nome-texto:text-is("${nome}")) .g-nome-datas`).textContent();
  const barraDe = (nome) => `[data-barra][aria-label^="${nome}:"], [data-barra][aria-label^="Marco ${nome}:"]`;
  const arrastarX = async (sel, dx, ponto = 'meio', dy = 0) => {
    if (typeof ponto === 'string') await br.page.locator(sel).scrollIntoViewIfNeeded();
    const b = await br.page.locator(sel).boundingBox();
    const x = ponto === 'meio' ? b.x + b.width / 2 : ponto === 'fim' ? b.x + b.width - 2 : ponto === 'inicio' ? b.x + 2 : ponto;
    const y = b.y + b.height / 2 + dy;
    await br.page.mouse.move(x, y);
    await br.page.mouse.down();
    for (let i = 1; i <= 6; i++) await br.page.mouse.move(x + (dx * i) / 6, y);
    await br.page.mouse.up();
  };
  assert.equal(await datasDe('Front-end'), `${curta(3)} – ${curta(17)}`);
  await arrastarX(barraDe('Front-end'), 72);
  await aguardarSalvo(br.page);
  assert.equal(await datasDe('Front-end'), `${curta(5)} – ${curta(19)}`, 'arrastar move 2 dias');
  assert.equal(await br.page.isVisible('#dialogo'), false, 'arrastar não abre o editor');
  await arrastarX(barraDe('Front-end'), 108, 'fim');
  await aguardarSalvo(br.page);
  assert.equal(await datasDe('Front-end'), `${curta(5)} – ${curta(22)}`, 'ponta direita muda o término');
  await arrastarX(barraDe('Front-end'), -36, 'inicio');
  await aguardarSalvo(br.page);
  assert.equal(await datasDe('Front-end'), `${curta(4)} – ${curta(22)}`, 'ponta esquerda muda o início');
  await br.page.hover(barraDe('Front-end'));
  const fb = await br.page.locator(barraDe('Front-end')).boundingBox();
  await arrastarX(barraDe('Front-end'), fb.width / 2, fb.x + 2, fb.height / 2 - 3);
  await aguardarSalvo(br.page);
  assert.match(await br.page.getAttribute(barraDe('Front-end'), 'aria-label'), /50% concluído/, 'puxador de progresso');
  await br.page.screenshot({ path: path.join(OUT, '21-arrastar-barras.png') });

  await br.page.focus(barraDe('Testes e ajustes'));
  await br.page.keyboard.press('ArrowRight');
  await br.page.keyboard.press('Shift+ArrowRight');
  await aguardarSalvo(br.page);
  assert.equal(await datasDe('Testes e ajustes'), `${curta(24)} – ${curta(31)}`, 'setas movem e Shift muda o término (já empurrada pelo Front-end)');
  await arrastarX(barraDe('Publicação no ar'), 36);
  await aguardarSalvo(br.page);
  assert.match(await datasDe('Publicação no ar'), new RegExp(`^${curta(33)} · marco`), 'marco arrastado 1 dia');

  await br.page.keyboard.press('Control+z');
  await aguardarSalvo(br.page);
  assert.match(await datasDe('Publicação no ar'), new RegExp(`^${curta(32)} · marco`), 'Ctrl+Z desfaz o marco');
  await br.page.click('#btn-desfazer');
  await aguardarSalvo(br.page);
  assert.equal(await datasDe('Testes e ajustes'), `${curta(24)} – ${curta(30)}`, 'botão desfaz o Shift+seta');
  await br.page.click('#btn-refazer');
  await aguardarSalvo(br.page);
  assert.equal(await datasDe('Testes e ajustes'), `${curta(24)} – ${curta(31)}`, 'refazer');
  await br.page.click('#btn-refazer');
  await aguardarSalvo(br.page);
  assert.match(await datasDe('Publicação no ar'), new RegExp(`^${curta(33)} · marco`), 'refazer o marco');
  assert.equal(await br.page.isDisabled('#btn-refazer'), true, 'nada mais para refazer');

  await br.page.click(barraDe('Wireframes'));
  assert.equal(await br.page.isVisible('#dialogo'), true, 'clique sem arrastar abre o editor');
  await br.page.click('#dialogo [data-fechar].btn');

  // toque: segurar e arrastar move; arrastar logo de cara é rolagem e não mexe
  const tocar = (sel, segurarMs, passos) => br.page.evaluate(async ([sel, segurarMs, passos]) => {
    const b = document.querySelector(sel);
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const disparar = (tipo, dx) => b.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: x + dx, clientY: y }));
    disparar('pointerdown', 0);
    await new Promise((ok) => setTimeout(ok, segurarMs));
    for (const dx of passos) disparar('pointermove', dx);
    disparar('pointerup', passos[passos.length - 1]);
  }, [sel, segurarMs, passos]);
  await tocar(barraDe('Divulgação'), 50, [20, 72]);
  await br.page.waitForTimeout(600);
  assert.equal(await datasDe('Divulgação'), `${curta(34)} – ${curta(41)}`, 'deslizar sem segurar não move (é rolagem)');
  await tocar(barraDe('Divulgação'), 450, [20, 72]);
  await aguardarSalvo(br.page);
  assert.equal(await datasDe('Divulgação'), `${curta(36)} – ${curta(43)}`, 'segurar e arrastar move pelo toque');

  await br.page.reload();
  await br.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await datasDe('Front-end'), `${curta(4)} – ${curta(22)}`, 'datas arrastadas ficaram no servidor');
  await arrastarX(barraDe('Front-end'), 36);
  await aguardarSalvo(br.page);
  assert.equal(await br.page.isDisabled('#btn-desfazer'), false);
  const outroBr = await nova({ viewport: { width: 1366, height: 900 } });
  await entrar(outroBr.page, URL_BARRAS);
  await outroBr.page.fill('#titulo', 'Editado em outro aparelho');
  await aguardarSalvo(outroBr.page);
  await br.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await br.page.waitForFunction(() => document.querySelector('#titulo').value === 'Editado em outro aparelho');
  assert.equal(await br.page.isDisabled('#btn-desfazer'), true, 'versão de outro aparelho zera o histórico');

  // etapa 3: dependências com setas e reagendamento
  const dp = await nova({ viewport: { width: 1366, height: 1400 } });
  await entrar(dp.page, await novoServidor());
  await dp.page.click('text=Ver um exemplo');
  await aguardarSalvo(dp.page);
  const datasDp = (nome) => dp.page.locator(`.g-linha:has(.g-nome-texto:text-is("${nome}")) .g-nome-datas`).textContent();
  const abrirDp = async (nome) => {
    await dp.page.click(`.g-nome-abrir:has(.g-nome-texto:text-is("${nome}"))`);
    await dp.page.waitForSelector('#dialogo[open]');
  };
  assert.equal(await dp.page.locator('.g-seta').count(), 10, 'uma seta por dependência do exemplo');
  await dp.page.screenshot({ path: path.join(OUT, '22-gantt-dependencias.png') });

  // o editor não oferece quem formaria ciclo
  await abrirDp('Levantamento de requisitos');
  assert.equal(await dp.page.isDisabled('#btn-dependencia'), true, 'todas as outras dependem dela: nada a oferecer');
  await dp.page.click('#dialogo [data-fechar].btn');
  await abrirDp('Testes e ajustes');
  assert.deepEqual(await dp.page.$$eval('#f-dependencias select', (s) => s.map((x) => x.selectedOptions[0].textContent)), ['Front-end', 'Back-end e integrações']);
  await dp.page.click('#btn-dependencia');
  const oferecidas = await dp.page.$$eval('#f-dependencias li:last-child select option', (o) => o.map((x) => x.textContent));
  for (const proibida of ['Testes e ajustes', 'Publicação no ar', 'Divulgação', 'Front-end', 'Back-end e integrações']) {
    assert.ok(!oferecidas.includes(proibida), `não oferece ${proibida}`);
  }
  await dp.page.click('#dialogo [data-fechar].btn');

  // criar dependência pelo editor empurra a própria atividade
  await abrirDp('Identidade visual');
  await dp.page.click('#btn-dependencia');
  await dp.page.selectOption('#f-dependencias li:last-child select', { label: 'Back-end e integrações' });
  await dp.page.fill('#f-dependencias li:last-child input[type=number]', '1');
  await dp.page.screenshot({ path: path.join(OUT, '23-editor-dependencias.png') });
  await dp.page.click('#form-tarefa button[type=submit]');
  await aguardarAnuncio(dp.page, 'As datas dela foram ajustadas');
  assert.equal(await datasDp('Identidade visual'), `${curta(20)} – ${curta(28)}`, 'começa 1 dia depois do fim do back-end (18), mesma duração');
  assert.equal(await dp.page.locator('.g-seta').count(), 11);

  // arrastar uma predecessora empurra a cadeia, e desfazer volta tudo
  await dp.page.click('[data-zoom=dia]');
  const fe = '[data-barra][aria-label^="Front-end:"]';
  await dp.page.locator(fe).scrollIntoViewIfNeeded();
  const caixaFe = await dp.page.locator(fe).boundingBox();
  await dp.page.mouse.move(caixaFe.x + caixaFe.width / 2, caixaFe.y + caixaFe.height / 2);
  await dp.page.mouse.down();
  for (let i = 1; i <= 6; i++) await dp.page.mouse.move(caixaFe.x + caixaFe.width / 2 + (72 * i) / 6, caixaFe.y + caixaFe.height / 2);
  await dp.page.mouse.up();
  await aguardarAnuncio(dp.page, '3 atividades seguintes foram reagendadas');
  assert.equal(await datasDp('Testes e ajustes'), `${curta(20)} – ${curta(26)}`);
  assert.match(await datasDp('Publicação no ar'), new RegExp(`^${curta(27)} · marco`));
  assert.equal(await datasDp('Divulgação'), `${curta(28)} – ${curta(35)}`);
  await dp.page.click('#toast button:has-text("Desfazer")');
  await aguardarSalvo(dp.page);
  assert.equal(await datasDp('Testes e ajustes'), `${curta(18)} – ${curta(24)}`, 'desfazer volta a cadeia inteira');
  assert.equal(await datasDp('Front-end'), `${curta(3)} – ${curta(17)}`);

  // lista mostra de quem depende; excluir remove os vínculos
  await dp.page.click('[data-visao=tabela]');
  assert.match(await dp.page.textContent('.tabela tr.linha-tarefa:has(.nome-link:has-text("Testes e ajustes")) .dependencias-resumo'), /depois de: Front-end, Back-end e integrações/);
  await dp.page.click('[aria-label="Excluir Publicação no ar"]');
  await aguardarSalvo(dp.page);
  assert.equal(await dp.page.locator('.tabela tr.linha-tarefa:has(.nome-link:has-text("Divulgação")) .dependencias-resumo').count(), 0, 'Divulgação perdeu o vínculo com o marco excluído');
  await dp.page.click('[data-visao=gantt]');
  assert.equal(await dp.page.locator('.g-seta').count(), 9, 'setas do marco excluído somem');
  await dp.page.reload();
  await dp.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await dp.page.locator('.g-seta').count(), 9, 'vínculos ficaram no servidor');

  // etapa 4: dias úteis, feriados e caminho crítico
  const cal = await nova({ viewport: { width: 1366, height: 1100 } });
  await entrar(cal.page, await novoServidor());
  const obra = path.join(OUT, 'obra.json');
  fs.writeFileSync(obra, JSON.stringify({ titulo: 'Obra', tarefas: [
    { id: 'a', nome: 'Fundação', fase: 'Obra', inicio: '2026-11-09', fim: '2026-11-13' },
    { id: 'b', nome: 'Alvenaria', fase: 'Obra', inicio: '2026-11-14', fim: '2026-11-15', dependencias: [{ id: 'a', folga: 0 }] },
    { id: 'c', nome: 'Compras', fase: 'Obra', inicio: '2026-11-09', fim: '2026-11-10' },
    { id: 'd', nome: 'Vistoria', fase: 'Obra', inicio: '2026-11-14', fim: '2026-11-14', dependencias: [{ id: 'a', folga: 0 }] },
  ] }));
  await cal.page.setInputFiles('#arquivo', obra);
  await aguardarAnuncio(cal.page, '4 atividades importadas.');
  const datasCal = (nome) => cal.page.locator(`.g-linha:has(.g-nome-texto:text-is("${nome}")) .g-nome-datas`).textContent();
  assert.equal(await datasCal('Alvenaria'), '14/11 – 15/11', 'sem calendário, sábado e domingo valem');

  await cal.page.click('#menu summary');
  await cal.page.click('[data-acao=calendario]');
  await cal.page.check('#f-dias-uteis');
  await cal.page.selectOption('#f-ano-feriados', '2026');
  await cal.page.click('#btn-feriados-nacionais');
  assert.equal(await cal.page.textContent('#f-feriados-total'), '10 feriados');
  await cal.page.click('#btn-feriados-nacionais');
  assert.equal(await cal.page.textContent('#f-feriados-total'), '10 feriados', 'não duplica');
  await cal.page.click('#btn-feriado');
  assert.equal(await cal.page.textContent('#e-feriado'), 'Escolha a data do feriado.');
  await cal.page.fill('#f-feriado-data', '2026-11-16');
  await cal.page.fill('#f-feriado-nome', 'Ponte');
  await cal.page.click('#btn-feriado');
  assert.equal(await cal.page.textContent('#f-feriados-total'), '11 feriados');
  await cal.page.screenshot({ path: path.join(OUT, '24-calendario-feriados.png') });
  await cal.page.click('#form-calendario button[type=submit]');
  await aguardarAnuncio(cal.page, 'Calendário salvo. 2 atividades seguintes foram reagendadas');
  assert.equal(await datasCal('Alvenaria'), '17/11 – 17/11', 'pula fim de semana e a ponte de segunda');
  assert.equal(await datasCal('Vistoria'), '17/11 – 17/11');

  await cal.page.click('.g-nome-abrir:has(.g-nome-texto:text-is("Alvenaria"))');
  await cal.page.fill('#f-fim', '2026-11-23');
  await cal.page.dispatchEvent('#f-fim', 'change');
  assert.match(await cal.page.textContent('#f-duracao'), /7 dias corridos \(4 dias úteis\)/, '20/11 é feriado; 21 e 22 são fim de semana');
  await cal.page.click('#form-tarefa button[type=submit]');
  await aguardarSalvo(cal.page);

  await cal.page.click('#btn-critico');
  const criticas = await cal.page.$$eval('.g-barra.critica, .g-marco.critica', (els) => els.map((b) => b.getAttribute('aria-label').split(':')[0]).sort());
  assert.deepEqual(criticas, ['Alvenaria', 'Fundação']);
  assert.equal(await cal.page.locator('.g-seta.critica').count(), 1, 'seta crítica só entre Fundação e Alvenaria');
  await cal.page.click('[data-zoom=dia]');
  assert.ok((await cal.page.locator('.g-feriado').count()) >= 2, 'feriados sombreados no Gantt');
  await cal.page.screenshot({ path: path.join(OUT, '25-caminho-critico.png') });

  await cal.page.focus('[data-barra][aria-label^="Compras:"]');
  for (let i = 0; i < 4; i++) await cal.page.keyboard.press('ArrowRight');
  await aguardarSalvo(cal.page);
  assert.equal(await datasCal('Compras'), '13/11 – 17/11', 'setas param só em dias úteis: sexta e terça, pulando a ponte');

  await cal.page.click('[data-visao=tabela]');
  assert.equal(await cal.page.textContent('.tabela tr.linha-tarefa:has(.nome-link:has-text("Alvenaria")) .c-dur'), '4 dias úteis');
  assert.equal(await cal.page.locator('.tabela .selo.critica').count(), 2);
  await cal.page.click('#menu summary');
  const [csvCal] = await Promise.all([cal.page.waitForEvent('download'), cal.page.click('[data-acao=exportar-csv]')]);
  assert.match(fs.readFileSync(await csvCal.path(), 'utf8'), /Duração \(dias úteis\)/);

  await cal.page.reload();
  await cal.page.waitForSelector('body[data-tela="app"]');
  await cal.page.click('#menu summary');
  await cal.page.click('[data-acao=calendario]');
  assert.equal(await cal.page.isChecked('#f-dias-uteis'), true, 'calendário ficou no servidor');
  assert.equal(await cal.page.textContent('#f-feriados-total'), '11 feriados');
  await cal.page.click('[data-fechar-calendario].btn');

  // etapa 5: linha de base e carga por responsável
  const lb = await nova({ viewport: { width: 1366, height: 1000 } });
  const urlLb = await novoServidor();
  await entrar(lb.page, urlLb);
  const equipe = path.join(OUT, 'equipe.json');
  fs.writeFileSync(equipe, JSON.stringify({ titulo: 'Equipe', tarefas: [
    { id: 'a', nome: 'Projeto', fase: 'Plano', responsavel: 'Ana', inicio: '2026-11-09', fim: '2026-11-13' },
    { id: 'b', nome: 'Licença', fase: 'Plano', responsavel: 'Ana', inicio: '2026-11-11', fim: '2026-11-12' },
    { id: 'c', nome: 'Compra', fase: 'Obra', responsavel: 'Bruno', inicio: '2026-11-16', fim: '2026-11-18' },
    { id: 'd', nome: 'Entrega', fase: 'Obra', responsavel: 'Bruno', tipo: 'marco', inicio: '2026-11-20', fim: '2026-11-20' },
  ] }));
  await lb.page.setInputFiles('#arquivo', equipe);
  await aguardarAnuncio(lb.page, '4 atividades importadas.');
  assert.equal(await lb.page.locator('.g-base').count(), 0, 'sem linha de base, nada de faixa');
  await lb.page.click('#menu summary');
  assert.equal(await lb.page.isVisible('#menu-remover-base'), false);
  await lb.page.click('[data-acao=linha-base]');
  await aguardarAnuncio(lb.page, 'Linha de base salva com 4 atividades.');
  await aguardarSalvo(lb.page);
  assert.equal(await lb.page.locator('.g-base').count(), 4, 'uma faixa por atividade, marco incluído');

  await lb.page.focus('[data-barra][aria-label^="Compra:"]');
  await lb.page.keyboard.press('ArrowRight');
  await lb.page.keyboard.press('ArrowRight');
  await aguardarSalvo(lb.page);
  assert.match(await lb.page.getAttribute('[data-barra][aria-label^="Compra:"]', 'aria-label'), /Linha de base: 16\/11\/2026 a 18\/11\/2026, 2 dias de atraso/);
  assert.match(await lb.page.getAttribute('[data-barra][aria-label^="Projeto:"]', 'aria-label'), /no prazo/);
  const faixa = await lb.page.locator('.g-linha:has(.g-nome-texto:text-is("Compra")) .g-base').boundingBox();
  const barra = await lb.page.locator('[data-barra][aria-label^="Compra:"]').boundingBox();
  assert.ok(barra.x - faixa.x > 20, 'a faixa da base ficou nas datas antigas, a barra andou');
  await lb.page.click('[data-zoom=dia]');
  await lb.page.screenshot({ path: path.join(OUT, '26-linha-de-base.png') });

  await lb.page.reload();
  await lb.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await lb.page.locator('.g-base').count(), 4, 'linha de base ficou no servidor');
  await lb.page.click('[data-visao=tabela]');
  assert.deepEqual(await lb.page.$$eval('.tabela .selo.desvio', (els) => els.map((e) => e.textContent)), ['+2 dias'], 'só a Compra desviou');

  await lb.page.click('[data-visao=carga]');
  assert.equal(await lb.page.isVisible('#grupo-critico'), false);
  const celula = (pessoa, i) => lb.page.locator(`.carga tbody tr:has(th:has-text("${pessoa}")) td`).nth(i);
  assert.deepEqual(await lb.page.$$eval('.carga thead th', (els) => els.map((e) => e.textContent)), ['Responsável', '09/11', '16/11']);
  assert.equal(await celula('Ana', 0).textContent(), '2', 'Projeto e Licença ao mesmo tempo');
  assert.match(await celula('Ana', 0).getAttribute('class'), /sobrecarga/);
  assert.match(await celula('Ana', 0).getAttribute('title'), /Projeto, Licença/);
  assert.equal(await celula('Bruno', 0).textContent(), '', 'marco não ocupa');
  assert.equal(await celula('Bruno', 1).textContent(), '1');
  assert.match(await celula('Bruno', 1).getAttribute('class'), /ocupada/);
  await lb.page.screenshot({ path: path.join(OUT, '27-carga.png') });

  const lbCel = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await entrar(lbCel.page, urlLb);
  await lbCel.page.click('[data-visao=carga]');
  await lbCel.page.waitForSelector('.carga');
  assert.ok(await lbCel.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'carga não cria rolagem lateral na página');
  await lbCel.page.screenshot({ path: path.join(OUT, '28-carga-celular.png') });

  await lb.page.click('[data-visao=gantt]');
  await lb.page.click('#menu summary');
  await lb.page.click('[data-acao=remover-linha-base]');
  await aguardarAnuncio(lb.page, 'Linha de base removida.');
  assert.equal(await lb.page.locator('.g-base').count(), 0);
  await lb.page.click('#btn-desfazer');
  assert.equal(await lb.page.locator('.g-base').count(), 4, 'desfazer devolve a linha de base');
  await aguardarSalvo(lb.page);

  // backup em JSON leva calendário e linha de base
  const abrirCal = async () => { await lb.page.click('#menu summary'); await lb.page.click('[data-acao=calendario]'); };
  await abrirCal();
  await lb.page.check('#f-dias-uteis');
  await lb.page.fill('#f-feriado-data', '2026-11-20');
  await lb.page.fill('#f-feriado-nome', 'Consciência Negra');
  await lb.page.click('#btn-feriado');
  await lb.page.click('#form-calendario button[type=submit]');
  await aguardarSalvo(lb.page);
  await lb.page.click('#menu summary');
  const [dlLb] = await Promise.all([lb.page.waitForEvent('download'), lb.page.click('[data-acao=exportar-json]')]);
  const backupLb = path.join(OUT, 'backup-completo.json');
  await dlLb.saveAs(backupLb);
  const conteudoLb = JSON.parse(fs.readFileSync(backupLb, 'utf8'));
  assert.equal(conteudoLb.calendario.feriados.length, 1);
  assert.equal(conteudoLb.linhaBase.tarefas.length, 4);
  await abrirCal();
  await lb.page.uncheck('#f-dias-uteis');
  await lb.page.click('.item-feriado .btn-icone');
  await lb.page.click('#form-calendario button[type=submit]');
  await lb.page.click('#menu summary');
  await lb.page.click('[data-acao=remover-linha-base]');
  await aguardarSalvo(lb.page);
  assert.equal(await lb.page.locator('.g-base').count(), 0);
  await lb.page.setInputFiles('#arquivo', backupLb);
  await aguardarAnuncio(lb.page, '4 atividades importadas.');
  await aguardarSalvo(lb.page);
  await lb.page.reload();
  await lb.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await lb.page.locator('.g-base').count(), 4, 'linha de base voltou do backup e ficou no servidor');
  await abrirCal();
  assert.equal(await lb.page.isChecked('#f-dias-uteis'), true, 'calendário voltou do backup');
  assert.equal(await lb.page.textContent('#f-feriados-total'), '1 feriado');
  await lb.page.click('[data-fechar-calendario].btn');

  // visão geral: todas as empresas juntas
  const vg = await nova({ viewport: { width: 1366, height: 1000 } });
  const urlVg = await novoServidor();
  await entrar(vg.page, urlVg);
  const hojeVg = C.diaNumero(C.hojeISO());
  const dVg = (n) => C.isoDeDia(hojeVg + n);
  const importarVg = async (nome, tarefas) => {
    const arq = path.join(OUT, `geral-${nome}.json`);
    fs.writeFileSync(arq, JSON.stringify({ tarefas }));
    await vg.page.setInputFiles('#arquivo', arq);
    await aguardarAnuncio(vg.page, `${tarefas.length} atividades importadas.`);
    await aguardarSalvo(vg.page);
  };
  await vg.page.fill('#titulo', 'Alfa');
  await vg.page.press('#titulo', 'Enter');
  await importarVg('alfa', [
    { id: 'x', nome: 'Painel elétrico', responsavel: 'Ana', inicio: dVg(0), fim: dVg(3), progresso: 20 },
    { id: 'y', nome: 'Motor 50cv', responsavel: 'Bruno', inicio: dVg(5), fim: dVg(9) },
  ]);
  await vg.page.click('#menu-empresas summary');
  await vg.page.click('#btn-nova-empresa');
  await vg.page.fill('#f-empresa', 'Beta');
  await vg.page.click('#form-empresa button[type=submit]');
  await vg.page.waitForFunction(() => document.querySelector('#titulo').value === 'Beta');
  await importarVg('beta', [
    { id: 'x', nome: 'Bomba d’água', responsavel: 'Ana', inicio: dVg(-6), fim: dVg(-2), progresso: 40 },
    { id: 'z', nome: 'Rebobinagem', responsavel: 'Ana', inicio: dVg(0), fim: dVg(1), progresso: 0 },
  ]);

  await vg.page.click('#menu-empresas summary');
  await vg.page.click('#btn-visao-geral');
  await vg.page.waitForSelector('body[data-tela="geral"]');
  assert.equal(await vg.page.isVisible('#titulo'), false);
  assert.equal(await vg.page.isVisible('.titulo-geral'), true);
  assert.equal(await vg.page.isVisible('#btn-nova'), false, 'visão geral não cria atividade solta');
  assert.equal(await vg.page.textContent('#geral-resumo .kpi-atividades .cartao-valor'), '4');
  assert.equal(await vg.page.textContent('#geral-resumo .kpi-atrasadas .cartao-valor'), '1');
  assert.deepEqual(await vg.page.$$eval('#geral-gantt .g-nome-texto', (els) => els.map((e) => e.textContent)), ['Alfa', 'Beta']);
  assert.match(await vg.page.textContent('#geral-gantt [data-empresa] .atrasadas'), /1 atrasada/);
  assert.equal(await vg.page.locator('#geral-gantt .g-resumo-empresa').count(), 2);
  assert.equal(await vg.page.textContent('#geral-atrasadas-titulo'), 'Atrasadas (1)');
  assert.match(await vg.page.textContent('#geral-atrasadas li'), /Bomba d’água.*Beta · Ana · venceu em .* \(há 2 dias\)/);
  const anaGeral = await vg.page.$$eval('#geral-carga tbody tr:has(th:has-text("Ana")) td', (tds) => tds.map((td) => [td.textContent, td.className, td.title]));
  const cheia = anaGeral.find(([, , titulo]) => titulo.includes('Painel elétrico (Alfa)') && titulo.includes('Rebobinagem (Beta)'));
  assert.ok(cheia, 'Ana tem atividade em Alfa e em Beta na mesma semana');
  assert.equal(cheia[0], '2');
  assert.match(cheia[1], /sobrecarga/);
  await vg.page.screenshot({ path: path.join(OUT, '29-visao-geral.png'), fullPage: true });

  const vgCel = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await entrar(vgCel.page, urlVg);
  await vgCel.page.click('#menu-empresas summary');
  await vgCel.page.click('#btn-visao-geral');
  await vgCel.page.waitForSelector('body[data-tela="geral"]');
  assert.ok(await vgCel.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'visão geral sem rolagem lateral no celular');
  await vgCel.page.screenshot({ path: path.join(OUT, '30-visao-geral-celular.png'), fullPage: true });

  await vg.page.click('.atrasada-item');
  await vg.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await vg.page.inputValue('#titulo'), 'Beta', 'atrasada abre a empresa dela');
  await vg.page.click('#menu-empresas summary');
  await vg.page.click('#btn-visao-geral');
  await vg.page.waitForSelector('body[data-tela="geral"]');
  await vg.page.click('#geral-gantt [data-empresa]:has(.g-nome-texto:text-is("Alfa")) .g-resumo-empresa');
  await vg.page.waitForSelector('body[data-tela="app"]');
  assert.equal(await vg.page.inputValue('#titulo'), 'Alfa', 'barra abre a empresa');
  assert.equal(await vg.page.locator('#vista-gantt .g-barra').count(), 2);

  // sair volta para a tela de senha
  await page.click('#menu summary');
  await page.click('[data-acao=sair]');
  await page.waitForSelector('body[data-tela="login"]');
  await page.reload();
  await page.waitForSelector('body[data-tela="login"]');

  // celular: botão flutuante tem nome acessível; diálogo sem rolagem dupla em tela baixa
  const baixo = await nova({ viewport: { width: 360, height: 560 }, isMobile: true, hasTouch: true });
  await entrar(baixo.page, await novoServidor());
  assert.equal(await baixo.page.getByRole('button', { name: 'Nova atividade', exact: true }).isVisible(), true);
  await baixo.page.click('#btn-nova');
  const rolagemDupla = await baixo.page.evaluate(() => { const d = document.querySelector('#dialogo'); return d.scrollHeight - d.clientHeight; });
  assert.equal(rolagemDupla, 0, 'diálogo não rola por fora do formulário');

  await browser.close();
  for (const servidor of servidores) {
    servidor.closeAllConnections();
    servidor.close();
  }
  if (erros.length) console.error(erros.join('\n'));
  assert.deepEqual(erros, [], 'sem erros no console');
  console.log('E2E OK');
})().catch((e) => {
  console.error('E2E FALHOU:', e.message, (e.stack.match(/app\.e2e\.js:\d+/) || [''])[0]);
  process.exit(1);
});
