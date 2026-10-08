const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const URL_APP = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const OUT = path.join(__dirname, 'saida');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const erros = [];
  const nova = async (opts) => {
    const ctx = await browser.newContext({ acceptDownloads: true, locale: 'pt-BR', ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
    page.on('dialog', (d) => d.accept());
    return { ctx, page };
  };

  // ---------- Desktop ----------
  const { ctx, page } = await nova({ viewport: { width: 1366, height: 860 } });
  await page.goto(URL_APP);
  assert.ok(await page.isVisible('text=Seu cronograma está vazio'), 'estado vazio');
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
  await page.click('[aria-label="Duplicar Wireframes"]');
  assert.ok(await page.isVisible('text=Wireframes (cópia)'));

  // título
  await page.fill('#titulo', 'Obra da casa');
  await page.press('#titulo', 'Enter');
  assert.equal(await page.title(), 'Obra da casa · Cronograma');

  // persistência
  await page.reload();
  assert.equal(await page.inputValue('#titulo'), 'Obra da casa');
  assert.equal(await page.locator('.tabela tbody tr').count(), 12, 'persistiu após reload');
  assert.equal(await page.getAttribute('[data-visao=tabela]', 'aria-pressed'), 'true', 'preferência de visão persistiu');

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

  // ---------- Dark mode ----------
  const dark = await nova({ viewport: { width: 1366, height: 860 }, colorScheme: 'dark' });
  await dark.page.goto(URL_APP);
  await dark.page.click('text=Ver um exemplo');
  await dark.page.screenshot({ path: path.join(OUT, '07-gantt-dark.png') });

  // ---------- Mobile ----------
  for (const [nome, vp] of [['mobile-360', { width: 360, height: 740 }], ['mobile-390', { width: 390, height: 844 }], ['tablet-768', { width: 768, height: 1024 }]]) {
    const m = await nova({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await m.page.goto(URL_APP);
    const semOverflow = async (etapa) => {
      const r = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      assert.ok(r.sw <= r.iw, `${nome}/${etapa}: rolagem horizontal na página (${r.sw} > ${r.iw})`);
    };
    await semOverflow('vazio');
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

  await browser.close();
  assert.deepEqual(erros, [], 'sem erros no console');
  console.log('E2E OK');
})().catch((e) => { console.error('E2E FALHOU:', e.message); process.exit(1); });
