const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarServidor } = require('../servidor.js');

const SENHA = 'senha-do-teste-e2e';
const OUT = path.join(__dirname, 'saida');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
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
    assert.equal(await pg.textContent('.marca-nome'), 'GoldSystem', `${onde}: nome da logo`);
    assert.ok(await pg.isVisible('.marca'), `${onde}: logo visível`);
    assert.ok(await pg.evaluate(() => document.querySelector('.marca-icone').naturalWidth > 0), `${onde}: ícone da logo carregou`);
    assert.equal(await pg.getAttribute('link[rel=icon]', 'href'), 'img/logo-goldsystem.svg', `${onde}: favicon`);
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
  assert.equal(await page.locator('.g-barra').count(), 10, '10 barras no exemplo');
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
  assert.equal(await page.locator('.g-barra').count(), 11);

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
  assert.deepEqual((await page.locator('.g-nome-texto').allTextContents()).sort(), ['Back-end e integrações', 'Publicação']);
  await page.fill('#busca', 'zzzz');
  assert.ok(await page.isVisible('text=Nenhuma atividade encontrada'));
  await page.click('text=Limpar filtros');
  assert.equal(await page.locator('.g-barra').count(), 11);
  await page.selectOption('#filtro-fase', 'Design');
  assert.equal(await page.locator('.g-barra').count(), 3);
  assert.match(await page.textContent('#resumo'), /Progresso \(filtrado\)/);
  await page.selectOption('#filtro-fase', '');

  // lista + excluir + desfazer + duplicar
  await page.click('[data-visao=tabela]');
  assert.equal(await page.locator('.tabela tbody tr').count(), 11);
  assert.equal(await page.isVisible('#grupo-zoom'), false, 'zoom some na lista');
  await page.screenshot({ path: path.join(OUT, '06-lista-desktop.png'), fullPage: true });
  await page.click('[aria-label="Excluir Wireframes"]');
  assert.equal(await page.locator('.tabela tbody tr').count(), 10);
  await page.click('#toast button:has-text("Desfazer")');
  assert.equal(await page.locator('.tabela tbody tr').count(), 11);
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
  assert.equal(await page.locator('.tabela tbody tr').count(), 12, 'persistiu após reload');
  assert.equal(await page.getAttribute('[data-visao=tabela]', 'aria-pressed'), 'true', 'preferência de visão persistiu');
  const celular = await nova({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await entrar(celular.page, URL_A);
  assert.equal(await celular.page.inputValue('#titulo'), 'Obra da casa', 'outro aparelho vê o mesmo título');
  assert.equal(await celular.page.locator('.g-barra').count(), 12, 'outro aparelho vê as mesmas atividades');

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
  await page.waitForSelector('.tabela tbody tr');
  assert.equal(await page.locator('.tabela tbody tr').count(), 12, 'reimportou');
  assert.equal(await page.inputValue('#titulo'), 'Obra da casa');
  // importar inválido
  const ruim = path.join(OUT, 'ruim.json');
  fs.writeFileSync(ruim, JSON.stringify({ tarefas: [{ nome: '', inicio: 'x', fim: 'y' }] }));
  await page.setInputFiles('#arquivo', ruim);
  assert.match(await page.textContent('#toast'), /Importação cancelada\. Tarefa 1/);
  assert.equal(await page.locator('.tabela tbody tr').count(), 12, 'importação inválida não apagou nada');

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
    const menu = await m.page.locator('.menu-itens').boundingBox();
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
  await rede.page.route('**/api/cronograma', (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()));
  await salvarTarefa(rede.page, 'Sem rede');
  await rede.page.waitForFunction(() => document.querySelector('#salvo').textContent.startsWith('Sem conexão'));
  assert.match(await rede.page.textContent('#anuncio'), /Sem conexão com o servidor/);
  assert.equal(await rede.page.isVisible('#salvo'), true, 'indicador de falha visível em 360px');
  await rede.page.unroute('**/api/cronograma');
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
  await semApi.page.route('**/api/cronograma', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' }));
  await semApi.page.goto(URL_A);
  await semApi.page.waitForSelector('text=Servidor do cronograma não encontrado');
  assert.equal(await semApi.page.isVisible('#btn-nova'), false);

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
  assert.deepEqual(erros, [], 'sem erros no console');
  console.log('E2E OK');
})().catch((e) => { console.error('E2E FALHOU:', e.message); process.exit(1); });
