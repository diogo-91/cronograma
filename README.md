# Cronograma

Ferramenta web para montar e acompanhar cronogramas de atividades: cadastro com datas de início e término, gráfico de Gantt, lista, filtros e exportação. Funciona no computador e no celular, sem servidor e sem cadastro.

## Como usar

- **No computador:** baixe o repositório e abra `index.html` no navegador (duplo clique funciona).
- **Pelo celular ou link:** publique com GitHub Pages em *Settings → Pages → Build and deployment → Deploy from a branch*, escolha o branch com o código e a pasta `/ (root)`. O link fica `https://<usuario>.github.io/cronograma/`.

## O que faz

- Atividades com nome, fase, responsável, início, término, progresso (%) e notas.
- Status automático pela data de hoje: *Não iniciada*, *Em andamento*, *Atrasada* (passou do término sem 100%) e *Concluída*.
- **Gantt** com escala por dia, semana ou mês, linha de hoje, cores por fase e barra de progresso. Clique na barra ou no nome para editar.
- **Lista** em tabela no computador e em cartões no celular, com duplicar e excluir (com "Desfazer").
- Resumo com progresso geral ponderado pela duração, contagem por status e período total.
- Busca (ignora acentos e maiúsculas) e filtros por fase e status.
- **Arquivo:** backup em JSON (exportar/importar), exportação CSV para Excel (separador `;`, datas dd/mm/aaaa), impressão / PDF.
- Tema claro e escuro automático.

## Onde ficam os dados

No `localStorage` do navegador, salvos a cada alteração. Eles não saem do seu aparelho e não sincronizam entre navegadores. Para levar o cronograma a outro aparelho ou guardar uma cópia, use *Arquivo → Exportar backup (JSON)* e depois *Importar backup* no outro lugar. Limpar os dados do site no navegador apaga o cronograma.

## Desenvolvimento

Não há build: HTML, CSS e JavaScript puros.

```
js/cronograma.js   lógica pura (datas, status, validação, filtros, resumo, escala do Gantt, CSV, importação)
js/app.js          interface (renderização, diálogo, armazenamento, importar/exportar)
css/styles.css     layout responsivo, tema claro/escuro e impressão
tests/             testes unitários da lógica (node:test)
e2e/               teste ponta a ponta no navegador (Playwright)
```

```
npm test                          # testes unitários, sem dependências
npm install                       # instala o Playwright para o teste E2E
npx playwright install chromium   # baixa o navegador, se ainda não tiver
npm run test:e2e                  # desktop, modo escuro e celular (360, 390, 768 px); prints em e2e/saida/
npm start                         # servidor local opcional
```
