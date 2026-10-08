# Cronograma · GoldSystem

Ferramenta web para montar e acompanhar cronogramas de atividades: cadastro com datas de início e término, gráfico de Gantt, lista, filtros e exportação. Os dados ficam no servidor, então o mesmo cronograma aparece no computador e no celular. O acesso é protegido por senha.

## Publicar no Coolify

1. Na aplicação do cronograma, em **Configuration → General**, troque o **Build Pack** para **Dockerfile** (o arquivo `Dockerfile` está na raiz do repositório).
2. Em **Ports Exposes**, use `3000`.
3. Em **Environment Variables**, crie `SENHA` com a senha de acesso (mínimo de 8 caracteres). Marque como segredo, se a opção existir.
4. Em **Persistent Storage**, adicione um **Volume Mount** com destino (`Destination Path`) `/data`. É ali que fica o arquivo `cronograma.json`; sem o volume, os dados somem a cada novo deploy.
5. Faça o **Deploy** e abra o endereço da aplicação. Use um domínio com `https://`: em `http://` a senha e o cookie de sessão trafegam sem criptografia.
6. Não publique a porta `3000` diretamente (*Ports Mappings* vazio): o limite de tentativas de senha confia no endereço informado pelo proxy do Coolify.

Se o log mostrar `Sem permissão de escrita em /data`, o volume foi criado como pasta do servidor (bind mount) em vez de volume do Docker. Use **Volume Mount**.

Se a página disser "Servidor do cronograma não encontrado", o Build Pack ainda está como Static.

## O que faz

- **Empresas:** cada empresa tem seu próprio cronograma. O botão *Empresas*, ao lado do nome, lista as empresas para trocar e cria novas; o nome é editado no próprio título; *Arquivo → Excluir esta empresa* remove uma (sempre fica pelo menos uma). Cada aparelho lembra a última empresa aberta.
- Atividades com nome, fase, responsável, início, término, progresso (%), notas e checklist.
- **Notas com formatação:** negrito, itálico, sublinhado, listas com marcadores e numeradas. Só essas marcações são guardadas (sem atributos), e colar texto de fora entra sem formatação.
- **Checklist** por atividade: itens marcáveis (Enter cria o próximo, Backspace num item vazio apaga). O contador aparece na lista e no Gantt; o progresso continua manual.
- Status automático pela data de hoje: *Não iniciada*, *Em andamento*, *Atrasada* (passou do término sem 100%) e *Concluída*.
- **Gantt** com escala por dia, semana ou mês, linha de hoje, cores por fase e barra de progresso. Clique na barra ou no nome para editar. Em períodos longos a escala engrossa sozinha (dia até ~3 anos, semana até ~20 anos).
- **Lista** em tabela no computador e em cartões no celular, com duplicar e excluir (com "Desfazer").
- Resumo com progresso geral ponderado pela duração, contagem por status e período total.
- Busca (ignora acentos e maiúsculas) e filtros por fase e status.
- **Arquivo:** backup em JSON (exportar/importar), exportação CSV para Excel (separador `;`, datas dd/mm/aaaa), impressão / PDF e Sair.
- Tema claro, com a marca GoldSystem no topo e no ícone da aba.

## Onde ficam os dados

No servidor, no arquivo `empresas.json` dentro do volume `/data` (um cronograma por empresa, cada um com sua revisão). Quem vinha da versão de cronograma único tem o `cronograma.json` convertido sozinho na primeira empresa; o arquivo antigo fica guardado como `cronograma.json.migrado`. Cada alteração é enviada logo depois de feita; o indicador abaixo do título mostra *Salvando…*, *Salvo no servidor* ou *Sem conexão: alterações pendentes* (nesse caso o app tenta de novo sozinho e reenvia quando a conexão volta).

- **Vários aparelhos:** ao voltar para a aba, o app busca a versão mais recente. Se dois aparelhos editarem ao mesmo tempo sem atualizar, o segundo a gravar recebe a versão do primeiro e um aviso para refazer a última alteração, em vez de apagar o que o outro fez.
- **Senha:** uma só, definida em `SENHA`. Quem tem a senha vê e edita o mesmo cronograma. Após 5 tentativas erradas, o endereço que errou espera 15 minutos.
- **Sessão:** dura 30 dias e é assinada com um segredo aleatório guardado em `/data/segredo-sessao` (o cookie não serve para descobrir a senha). *Sair* encerra a sessão só naquele aparelho; para encerrar em todos, troque a `SENHA` ou apague `/data/segredo-sessao` e reinicie.
- **Dados antigos do navegador:** se você usava a versão anterior (que salvava só no navegador), no primeiro acesso o app oferece enviar essas atividades para o servidor.
- **Backup:** faça *Arquivo → Exportar backup (JSON)* de vez em quando, ou copie o volume `/data` pelo Coolify.

## Desenvolvimento

Não há build nem dependências de produção: HTML, CSS e JavaScript puros no navegador e Node.js puro no servidor.

```
servidor.js        servidor HTTP: arquivos do app, login, API do cronograma, gravação em arquivo
js/cronograma.js   lógica pura (datas, status, validação, filtros, resumo, escala do Gantt, CSV, importação), usada no navegador e no servidor
js/app.js          interface (renderização, diálogo, gravação no servidor, importar/exportar)
css/styles.css     layout responsivo, tema e impressão
img/               logo GoldSystem (topo e favicon)
fonts/             fonte Inter embutida (licença OFL em fonts/OFL-Inter.txt)
tests/             testes unitários da lógica e do servidor (node:test)
e2e/               teste ponta a ponta no navegador (Playwright)
Dockerfile         imagem para o Coolify (Node 22, usuário sem privilégios, dados em /data)
```

```
SENHA=uma-senha-longa npm start   # http://localhost:3000, dados em ./dados
npm test                          # testes unitários e do servidor, sem dependências
npm install                       # instala o Playwright para o teste E2E
npx playwright install chromium   # baixa o navegador, se ainda não tiver
npm run test:e2e                  # login, vários aparelhos, conflito, queda de rede, celular e desktop; prints em e2e/saida/
```

Variáveis do servidor: `SENHA` (obrigatória), `PORTA` (padrão `3000`) e `PASTA_DADOS` (padrão `./dados`; no Docker, `/data`).
