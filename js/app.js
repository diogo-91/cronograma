(() => {
  'use strict';

  const C = Cronograma;
  const CHAVE_DADOS_DO_NAVEGADOR = 'cronograma:v1';
  const CHAVE_PREFS = 'cronograma:prefs';
  const ESPERA_PARA_GRAVAR_MS = 400;
  const ESPERA_NOVA_TENTATIVA_MS = 10000;
  const LIMITE_ENVIO_AO_SAIR = 60000;
  const TEXTO_INDICADOR = {
    salvo: 'Salvo no servidor',
    salvando: 'Salvando…',
    pendente: 'Sem conexão: alterações pendentes',
    recusado: 'Não salvo: o servidor recusou os dados',
  };
  const TITULO_PADRAO = 'Meu cronograma';
  const VISOES = ['gantt', 'tabela'];
  const ZOOMS = ['dia', 'semana', 'mes'];
  const NUM_CORES = 8;
  const TAMANHO_MAXIMO_IMPORTACAO = 1.5 * 1024 * 1024;
  const LARGURA_IMPRESSAO = 960;
  const CAMPOS = ['nome', 'fase', 'responsavel', 'inicio', 'fim', 'progresso', 'notas'];
  const ICONES = {
    duplicar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    excluir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    atividades: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    concluidas: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
    andamento: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    atrasadas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    pendentes: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-dasharray="3.5 3"/></svg>',
    ilustracao: `<svg class="ilustracao" viewBox="0 0 240 150" aria-hidden="true">
      <rect x="12" y="10" width="216" height="128" rx="16" fill="#ffffff" stroke="#e6e4de"/>
      <path d="M12 40h216" stroke="#e6e4de"/>
      <circle cx="30" cy="25" r="4" fill="#f2d27a"/><circle cx="44" cy="25" r="4" fill="#e6e4de"/><circle cx="58" cy="25" r="4" fill="#e6e4de"/>
      <rect x="30" y="54" width="78" height="14" rx="7" fill="#d4a12a"/>
      <rect x="64" y="78" width="104" height="14" rx="7" fill="#6366f1" opacity="0.85"/>
      <rect x="112" y="102" width="88" height="14" rx="7" fill="#14b8a6" opacity="0.85"/>
      <path d="M140 46v84" stroke="#e5484d" stroke-width="2" stroke-dasharray="4 4"/>
      <circle cx="140" cy="46" r="4" fill="#e5484d"/>
    </svg>`,
  };

  const $ = (seletor) => document.querySelector(seletor);
  const form = $('#form-tarefa');
  const dialogo = $('#dialogo');
  const caixaGantt = $('#vista-gantt');

  const estado = {
    titulo: TITULO_PADRAO,
    tarefas: [],
    visao: 'gantt',
    zoom: 'semana',
    filtros: { texto: '', fase: '', status: '' },
    editando: null,
  };
  let rolarParaHoje = true;
  let hojeNoGantt = null;
  let duracaoEditada = 7;
  let temporizadorAviso = null;
  let revisao = 0;
  let alteracoesPendentes = false;
  let envioEmCurso = false;
  let aguardandoEnvio = [];
  let temporizadorGravar = null;
  let geracaoSessao = 0;
  let empresas = [];
  let empresaAtual = null;
  let empresaPreferida = null;
  let nomeAntesDeEditar = '';
  const gravacoesSemResposta = new Set();

  function el(tag, props = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [chave, valor] of Object.entries(props)) {
      if (valor == null || valor === false) continue;
      if (chave === 'style') for (const [prop, v] of Object.entries(valor)) e.style.setProperty(prop, v);
      else if (chave.startsWith('on')) e.addEventListener(chave.slice(2), valor);
      else e.setAttribute(chave, valor === true ? '' : valor);
    }
    e.append(...filhos.filter((f) => f != null && f !== false));
    return e;
  }

  function icone(nome) {
    const modelo = document.createElement('template');
    modelo.innerHTML = ICONES[nome];
    return modelo.content.firstElementChild;
  }

  function corDa(tarefa, cores) {
    return cores.has(tarefa.fase) ? `var(--fase-${cores.get(tarefa.fase) % NUM_CORES})` : 'var(--fase-sem)';
  }

  function dataCurta(iso) {
    return C.formatarData(iso).slice(0, 5);
  }

  function ler(chave) {
    try {
      return localStorage.getItem(chave);
    } catch {
      return null;
    }
  }

  function gravar(chave, valor) {
    try {
      localStorage.setItem(chave, valor);
    } catch {}
  }

  function remover(chave) {
    try {
      localStorage.removeItem(chave);
    } catch {}
  }

  async function chamarApi(metodo, url, corpo, extras = {}) {
    try {
      const resposta = await fetch(url, {
        method: metodo,
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        body: corpo === undefined || typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
        ...extras,
      });
      const dados = await resposta.json().catch(() => null);
      return { status: resposta.status, dados };
    } catch {
      return { status: 0, dados: null };
    }
  }

  function mostrarTela(tela) {
    document.body.dataset.tela = tela;
  }

  function aplicarDocumento(doc) {
    revisao = doc.revisao;
    estado.titulo = doc.titulo;
    estado.tarefas = doc.tarefas;
  }

  function tratarFalhaDeCarga(status) {
    if (status === 401) mostrarLogin();
    else mostrarFalhaConexao(status);
    return false;
  }

  async function carregarDoServidor(idDesejado) {
    const lista = await chamarApi('GET', 'api/empresas');
    if (lista.status !== 200) return tratarFalhaDeCarga(lista.status);
    empresas = lista.dados.empresas;
    const existe = (id) => empresas.some((e) => e.id === id);
    const id = [idDesejado, empresaAtual, empresaPreferida].find(existe) || empresas[0].id;
    const r = await chamarApi('GET', `api/empresas/${id}`);
    if (r.status !== 200) return tratarFalhaDeCarga(r.status);
    empresaAtual = id;
    salvarPrefs();
    aplicarDocumento(r.dados);
    return true;
  }

  async function trocarEmpresa(id) {
    $('#menu-empresas').open = false;
    if (id === empresaAtual) return;
    if (alteracoesPendentes || envioEmCurso) {
      enviar();
      avisar('Salvando as alterações desta empresa. Tente trocar de novo em instantes.');
      return;
    }
    if (!(await carregarDoServidor(id))) return;
    zerarFiltros();
    rolarParaHoje = true;
    render();
    window.scrollTo(0, 0);
  }

  function renderEmpresas() {
    $('#lista-empresas').replaceChildren(...empresas.map((e) => {
      const atual = e.id === empresaAtual;
      const total = atual ? estado.tarefas.length : e.atividades;
      return el('button', { type: 'button', 'aria-current': String(atual), onclick: () => trocarEmpresa(e.id) },
        el('span', { class: 'empresa-nome' }, atual ? estado.titulo || e.nome : e.nome),
        el('span', { class: 'empresa-total' }, `${total} ${total === 1 ? 'atividade' : 'atividades'}`));
    }));
  }

  function entrarNoApp() {
    mostrarTela('app');
    indicar(alteracoesPendentes || envioEmCurso ? 'salvando' : 'salvo');
    rolarParaHoje = true;
    render();
    oferecerDadosDoNavegador();
  }

  function mostrarLogin() {
    if (dialogo.open) dialogo.close();
    mostrarTela('login');
    $('#senha').value = '';
    $('#erro-login').textContent = '';
    $('#senha').focus();
  }

  function mostrarFalhaConexao(status) {
    mostrarTela('falha');
    for (const seletor of ['#resumo', '.ferramentas', '#vista-gantt', '#vista-tabela']) $(seletor).hidden = true;
    const semServidor = status === 404;
    $('#vazio').hidden = false;
    $('#vazio').replaceChildren(
      el('h2', {}, semServidor ? 'Servidor do cronograma não encontrado' : 'Sem conexão com o servidor'),
      el('p', {}, semServidor
        ? 'Este endereço está entregando só os arquivos do site. No Coolify, publique com o Build Pack "Dockerfile" (passo a passo no README).'
        : 'Não foi possível carregar o cronograma. Confira sua conexão e tente de novo.'),
      el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'btn primario', onclick: () => location.reload() }, 'Tentar de novo')),
    );
  }

  function oferecerDadosDoNavegador() {
    if (estado.tarefas.length) return;
    const bruto = ler(CHAVE_DADOS_DO_NAVEGADOR);
    const r = bruto ? C.importarDados(bruto) : { ok: false };
    if (!r.ok || !r.dados.tarefas.length) return;
    if (!confirm(`Encontramos ${r.dados.tarefas.length} atividades salvas só neste navegador. Enviar para o servidor para usar em qualquer aparelho?`)) return;
    substituirTudo(r.dados.titulo, r.dados.tarefas).then((ok) => {
      if (!ok) return;
      remover(CHAVE_DADOS_DO_NAVEGADOR);
      avisar('Atividades enviadas para o servidor.');
    });
  }

  function carregarPrefs() {
    let prefs = {};
    try {
      prefs = JSON.parse(ler(CHAVE_PREFS)) || {};
    } catch {
      prefs = {};
    }
    if (VISOES.includes(prefs.visao)) estado.visao = prefs.visao;
    if (ZOOMS.includes(prefs.zoom)) estado.zoom = prefs.zoom;
    if (typeof prefs.empresa === 'string') empresaPreferida = prefs.empresa;
  }

  function indicar(situacao) {
    const indicador = $('#salvo');
    indicador.textContent = TEXTO_INDICADOR[situacao];
    indicador.classList.toggle('falhou', situacao === 'pendente' || situacao === 'recusado');
    indicador.classList.toggle('salvando', situacao === 'salvando');
  }

  function salvar() {
    alteracoesPendentes = true;
    indicar('salvando');
    clearTimeout(temporizadorGravar);
    temporizadorGravar = setTimeout(enviar, ESPERA_PARA_GRAVAR_MS);
    return new Promise((resolver) => aguardandoEnvio.push(resolver));
  }

  async function enviar({ aoSair = false } = {}) {
    clearTimeout(temporizadorGravar);
    if (envioEmCurso || !alteracoesPendentes) return;
    envioEmCurso = true;
    alteracoesPendentes = false;
    const avisados = aguardandoEnvio;
    aguardandoEnvio = [];
    const idGravacao = C.novoId();
    const geracao = geracaoSessao;
    const corpo = JSON.stringify({ revisaoBase: revisao, idGravacao, titulo: estado.titulo, tarefas: estado.tarefas });
    const manterViva = aoSair && new TextEncoder().encode(corpo).length < LIMITE_ENVIO_AO_SAIR;
    gravacoesSemResposta.add(idGravacao);
    const r = await chamarApi('PUT', `api/empresas/${empresaAtual}`, corpo, { keepalive: manterViva });
    envioEmCurso = false;
    if (r.status !== 0) gravacoesSemResposta.delete(idGravacao);
    const atual = r.status === 409 ? r.dados.atual : null;

    if (r.status === 200) {
      revisao = r.dados.revisao;
      gravacoesSemResposta.clear();
      for (const resolver of avisados) resolver(true);
      if (alteracoesPendentes) enviar();
      else indicar('salvo');
      return;
    }
    if (atual && atual.revisao < revisao) {
      avisar('O servidor estava com uma versão mais antiga do cronograma. Enviando a versão deste aparelho.');
    }
    if (atual && (gravacoesSemResposta.has(atual.idGravacao) || atual.revisao < revisao)) {
      revisao = atual.revisao;
      gravacoesSemResposta.clear();
      tentarDeNovo(avisados);
      enviar();
      return;
    }
    if (atual) {
      for (const resolver of avisados) resolver(false);
      receberConflito(atual);
      return;
    }
    if (r.status === 401) {
      tentarDeNovo(avisados);
      if (geracao !== geracaoSessao) enviar();
      else mostrarLogin();
      indicar('pendente');
      return;
    }
    if (r.status === 404) {
      for (const resolver of avisados) resolver(false);
      avisar('Esta empresa foi excluída em outro aparelho.');
      if (await carregarDoServidor()) render();
      return;
    }
    if (r.status === 400 || r.status === 413) {
      alteracoesPendentes = true;
      for (const resolver of avisados) resolver(false);
      indicar('recusado');
      avisar(`O servidor recusou a gravação. ${r.dados?.erro || ''}`);
      return;
    }
    tentarDeNovo(avisados);
    temporizadorGravar = setTimeout(enviar, ESPERA_NOVA_TENTATIVA_MS);
    indicar('pendente');
    avisar('Sem conexão com o servidor. As alterações serão enviadas assim que a conexão voltar.');
  }

  function tentarDeNovo(avisados) {
    alteracoesPendentes = true;
    aguardandoEnvio = [...avisados, ...aguardandoEnvio];
  }

  function receberConflito(atual) {
    clearTimeout(temporizadorGravar);
    alteracoesPendentes = false;
    for (const resolver of aguardandoEnvio) resolver(false);
    aguardandoEnvio = [];
    gravacoesSemResposta.clear();
    aplicarDocumento(atual);
    render();
    avisar('Este cronograma foi alterado em outro aparelho. Carreguei a versão mais recente: confira e refaça sua última alteração.');
  }

  async function sincronizar() {
    const ocupado = () => document.body.dataset.tela !== 'app' || alteracoesPendentes || envioEmCurso || dialogo.open;
    if (ocupado()) return;
    const revisaoAntes = revisao;
    const empresaAntes = empresaAtual;
    const lista = await chamarApi('GET', 'api/empresas');
    if (lista.status === 401) return mostrarLogin();
    if (lista.status === 200) empresas = lista.dados.empresas;
    if (!empresas.some((e) => e.id === empresaAtual)) {
      if (!ocupado() && (await carregarDoServidor())) render();
      return;
    }
    const r = await chamarApi('GET', `api/empresas/${empresaAtual}`);
    if (r.status === 401) return mostrarLogin();
    const semMudancaLocal = revisao === revisaoAntes && empresaAtual === empresaAntes;
    if (r.status === 200 && r.dados.revisao > revisao && semMudancaLocal && !ocupado()) aplicarDocumento(r.dados);
    render();
  }

  function salvarPrefs() {
    gravar(CHAVE_PREFS, JSON.stringify({ visao: estado.visao, zoom: estado.zoom, empresa: empresaAtual }));
  }

  function avisar(mensagem, acao) {
    const toast = $('#toast');
    toast.replaceChildren(el('span', {}, mensagem));
    if (acao) toast.append(el('button', { type: 'button', onclick: () => { toast.hidden = true; acao.executar(); } }, acao.rotulo));
    toast.hidden = false;
    $('#anuncio').textContent = mensagem;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { toast.hidden = true; }, acao ? 7000 : 3500);
  }

  function render() {
    const hoje = C.hojeISO();
    const cores = C.indicesDeCor(estado.tarefas);
    if (estado.filtros.fase && !cores.has(estado.filtros.fase)) estado.filtros.fase = '';
    if (estado.tarefas.length === 0) zerarFiltros();
    const visiveis = C.filtrarTarefas(C.ordenarTarefas(estado.tarefas), estado.filtros, hoje);
    const filtrando = Boolean(estado.filtros.texto || estado.filtros.fase || estado.filtros.status);
    const semTarefas = estado.tarefas.length === 0;
    const vazio = semTarefas || visiveis.length === 0;

    document.title = `${estado.titulo.trim() || TITULO_PADRAO} · Cronograma`;
    if (document.activeElement !== $('#titulo')) $('#titulo').value = estado.titulo;
    renderEmpresas();
    for (const b of document.querySelectorAll('[data-visao]')) b.setAttribute('aria-pressed', String(b.dataset.visao === estado.visao));

    $('#resumo').hidden = semTarefas;
    $('.ferramentas').hidden = semTarefas;
    $('#grupo-zoom').hidden = estado.visao !== 'gantt';
    $('#vazio').hidden = !vazio;
    caixaGantt.hidden = vazio || estado.visao !== 'gantt';
    $('#vista-tabela').hidden = vazio || estado.visao !== 'tabela';

    renderResumo(C.resumo(visiveis, hoje), filtrando);
    renderOpcoes(cores);
    if (vazio) renderVazio(semTarefas);
    else if (estado.visao === 'gantt') renderGantt(visiveis, cores, hoje);
    else renderTabela(visiveis, cores, hoje);
  }

  function renderResumo(r, filtrando) {
    const indicador = (rotulo, valor, tipo) =>
      el('div', { class: `cartao kpi kpi-${tipo}` },
        el('span', { class: 'kpi-icone' }, icone(tipo)),
        el('div', { class: 'cartao-rotulo' }, rotulo),
        el('div', { class: 'cartao-valor' }, String(valor)));
    const periodo = r.inicio
      ? [el('span', {}, `${C.formatarData(r.inicio)} a ${C.formatarData(r.fim)}`), ' · ', el('span', {}, `${r.dias} ${r.dias === 1 ? 'dia' : 'dias'} corridos`)]
      : ['Sem atividades'];
    $('#resumo').replaceChildren(
      el('div', { class: 'cartao cartao-progresso' },
        el('div', { class: 'anel', style: { '--p': r.progressoGeral }, role: 'img', 'aria-label': `${r.progressoGeral}% concluído` },
          el('span', { class: 'anel-valor' }, `${r.progressoGeral}%`)),
        el('div', { class: 'progresso-texto' },
          el('div', { class: 'cartao-rotulo' }, filtrando ? 'Progresso (filtrado)' : 'Progresso geral'),
          el('div', { class: 'progresso-frase' }, `${r.concluidas} de ${r.total} ${r.total === 1 ? 'atividade concluída' : 'atividades concluídas'}`),
          el('div', { class: 'periodo' }, ...periodo))),
      indicador('Atividades', r.total, 'atividades'),
      indicador('Concluídas', r.concluidas, 'concluidas'),
      indicador('Em andamento', r.andamento, 'andamento'),
      indicador('Atrasadas', r.atrasadas, 'atrasadas'),
      indicador('Não iniciadas', r.pendentes, 'pendentes'),
    );
  }

  function renderOpcoes(cores) {
    const fases = [...cores.keys()];
    const filtroFase = $('#filtro-fase');
    filtroFase.replaceChildren(el('option', { value: '' }, 'Todas as fases'), ...fases.map((f) => el('option', { value: f }, f)));
    filtroFase.value = estado.filtros.fase;
    $('#lista-fases').replaceChildren(...fases.map((f) => el('option', { value: f })));
    const responsaveis = [...new Set(estado.tarefas.map((t) => t.responsavel).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('#lista-responsaveis').replaceChildren(...responsaveis.map((r) => el('option', { value: r })));
  }

  function renderVazio(semTarefas) {
    const conteudo = semTarefas
      ? [
          icone('ilustracao'),
          el('h2', {}, 'Seu cronograma está vazio'),
          el('p', {}, 'Cadastre as atividades com datas de início e término e acompanhe tudo no gráfico de Gantt ou em lista. Os dados ficam salvos no servidor e aparecem em qualquer aparelho.'),
          el('div', { class: 'botoes' },
            el('button', { type: 'button', class: 'btn primario', onclick: () => abrirEditor(null) }, 'Criar primeira atividade'),
            el('button', { type: 'button', class: 'btn', onclick: carregarExemplo }, 'Ver um exemplo')),
        ]
      : [
          el('h2', {}, 'Nenhuma atividade encontrada'),
          el('p', {}, 'Nenhuma atividade corresponde aos filtros atuais.'),
          el('div', { class: 'botoes' }, el('button', { type: 'button', class: 'btn', onclick: limparFiltros }, 'Limpar filtros')),
        ];
    $('#vazio').replaceChildren(...conteudo);
  }

  function renderGantt(lista, cores, hoje) {
    const e = C.escalaGantt(lista, estado.zoom, hoje);
    const px = (n) => `${n}px`;
    hojeNoGantt = e.hojeLeft === null ? null : e.hojeLeft + e.pxDia / 2;
    for (const b of document.querySelectorAll('[data-zoom]')) {
      b.setAttribute('aria-pressed', String(b.dataset.zoom === e.zoom));
      b.disabled = C.zoomEfetivo(lista, b.dataset.zoom) !== b.dataset.zoom;
      b.title = b.disabled ? 'Período longo demais para esta escala' : '';
    }

    const fundo = el('div', { class: 'g-fundo' });
    for (const divisao of e.zoom === 'mes' ? e.meses : e.marcas) {
      if (divisao.fimDeSemana) fundo.append(el('div', { class: 'g-fds', style: { left: px(divisao.left), width: px(divisao.width) } }));
      fundo.append(el('div', { class: 'g-linha-v', style: { left: px(divisao.left) } }));
    }
    if (hojeNoGantt !== null) fundo.append(el('div', { class: 'g-hoje', style: { left: px(hojeNoGantt) } }));

    const escala = el('div', { class: 'g-escala' },
      ...e.meses.map((m) => el('div', { class: 'g-mes', style: { left: px(m.left), width: px(m.width) } }, el('span', {}, m.rotulo))),
      ...e.marcas.map((m) =>
        el('div', {
          class: `g-marca${m.fimDeSemana ? ' fds' : ''}${e.zoom === 'semana' ? ' semana' : ''}${m.left === e.hojeLeft && e.zoom === 'dia' ? ' hoje' : ''}`,
          style: { left: px(m.left), width: px(m.width) },
        }, m.rotulo)),
      hojeNoGantt !== null && el('div', { class: 'g-hoje-marcador', title: `Hoje, ${C.formatarData(hoje)}`, style: { left: px(hojeNoGantt) } }),
    );

    const linhas = lista.map((t) => {
      const status = C.statusTarefa(t, hoje);
      const barra = e.barras[t.id];
      const descricao = `${t.nome}: ${C.formatarData(t.inicio)} a ${C.formatarData(t.fim)}, ${t.progresso}% concluído, ${C.ROTULO_STATUS[status]}`;
      return el('div', { class: 'g-linha', style: { '--cor': corDa(t, cores) } },
        el('button', { type: 'button', class: 'g-nome', title: t.nome, 'data-id': t.id, onclick: () => abrirEditor(t.id) },
          el('span', { class: 'g-nome-texto' }, t.nome),
          el('span', { class: 'g-nome-datas' }, `${dataCurta(t.inicio)} – ${dataCurta(t.fim)}`)),
        el('div', { class: 'g-trilho' },
          el('button', {
            type: 'button',
            class: `g-barra ${status}`,
            style: { left: px(barra.left), width: px(barra.width) },
            title: descricao,
            'aria-label': descricao,
            onclick: () => abrirEditor(t.id),
          },
          el('span', { class: 'g-progresso', style: { width: `${t.progresso}%` } }),
          el('span', { class: 'g-rotulo' }, status === 'atrasada' ? `${t.progresso}% · atrasada` : `${t.progresso}%`))));
    });

    const { scrollLeft, scrollTop } = caixaGantt;
    caixaGantt.replaceChildren(
      el('div', { class: 'g-grade', style: { '--largura': px(e.larguraTotal) } },
        el('div', { class: 'g-cabecalho' }, el('div', { class: 'g-canto' }, 'Atividade'), escala),
        fundo,
        ...linhas),
    );
    $('#btn-hoje').disabled = hojeNoGantt === null;
    if (rolarParaHoje) {
      rolarParaHoje = false;
      irParaHoje();
    } else {
      caixaGantt.scrollLeft = scrollLeft;
      caixaGantt.scrollTop = scrollTop;
    }
  }

  function irParaHoje() {
    if (hojeNoGantt === null) {
      caixaGantt.scrollLeft = 0;
      return;
    }
    const larguraNome = caixaGantt.querySelector('.g-canto').offsetWidth;
    caixaGantt.scrollLeft = Math.max(0, hojeNoGantt - (caixaGantt.clientWidth - larguraNome) / 3);
  }

  function renderTabela(lista, cores, hoje) {
    const celula = (rotulo, valor, classe) => el('td', { 'data-rotulo': rotulo, class: valor ? classe : `${classe} vazio-celula` }, valor || '—');
    const linhas = lista.map((t) => {
      const status = C.statusTarefa(t, hoje);
      const dias = C.duracaoDias(t);
      return el('tr', { style: { '--cor': corDa(t, cores) } },
        el('td', { class: 'c-nome' },
          el('button', { type: 'button', class: 'nome-link', 'data-id': t.id, onclick: () => abrirEditor(t.id) }, el('span', { class: 'ponto' }), el('span', {}, t.nome)),
          t.notas && el('div', { class: 'notas' }, t.notas)),
        celula('Fase', t.fase, 'c-fase'),
        el('td', { 'data-rotulo': 'Responsável', class: t.responsavel ? 'c-resp' : 'c-resp vazio-celula' },
          t.responsavel
            ? el('span', { class: 'pessoa' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, C.iniciais(t.responsavel)), el('span', {}, t.responsavel))
            : '—'),
        celula('Início', C.formatarData(t.inicio), 'data c-inicio'),
        celula('Término', C.formatarData(t.fim), 'data c-fim'),
        celula('Duração', `${dias} ${dias === 1 ? 'dia' : 'dias'}`, 'num c-dur'),
        el('td', { class: 'c-progresso' },
          el('div', { class: 'progresso-celula' }, el('div', { class: 'medidor' }, el('span', { style: { width: `${t.progresso}%` } })), el('b', {}, `${t.progresso}%`))),
        el('td', { class: 'c-status' }, el('span', { class: `selo ${status}` }, C.ROTULO_STATUS[status])),
        el('td', { class: 'c-acoes' },
          el('div', { class: 'acoes-linha' },
            el('button', { type: 'button', class: 'btn-icone', title: 'Duplicar', 'aria-label': `Duplicar ${t.nome}`, onclick: () => duplicar(t.id) }, icone('duplicar')),
            el('button', { type: 'button', class: 'btn-icone perigo', title: 'Excluir', 'aria-label': `Excluir ${t.nome}`, onclick: () => excluir(t.id) }, icone('excluir')))));
    });
    const cabecalho = ['Atividade', 'Fase', 'Responsável', 'Início', 'Término', 'Duração', 'Progresso', 'Status', ''];
    $('#vista-tabela').replaceChildren(
      el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ...cabecalho.map((c, i) => el('th', { class: i === 5 ? 'num' : null, scope: 'col' }, c)))),
        el('tbody', {}, ...linhas)),
    );
  }

  function abrirEditor(id) {
    const tarefa = estado.tarefas.find((t) => t.id === id);
    const hoje = C.hojeISO();
    const valores = tarefa || {
      nome: '',
      fase: estado.filtros.fase,
      responsavel: '',
      inicio: hoje,
      fim: C.isoDeDia(C.diaNumero(hoje) + 6),
      progresso: 0,
      notas: '',
    };
    estado.editando = tarefa ? tarefa.id : null;
    for (const campo of CAMPOS) form.elements[campo].value = valores[campo];
    atualizarFaixa(valores.progresso);
    $('#dialogo-titulo').textContent = tarefa ? 'Editar atividade' : 'Nova atividade';
    $('#btn-excluir').hidden = !tarefa;
    duracaoEditada = C.duracaoDias(valores);
    mostrarErros({});
    atualizarDuracao();
    dialogo.showModal();
    if (!tarefa) form.elements.nome.focus();
  }

  function atualizarFaixa(valor) {
    const faixa = $('#f-progresso-faixa');
    faixa.value = valor;
    faixa.style.setProperty('--v', `${faixa.value}%`);
  }

  function limparErro(campo) {
    const p = form.querySelector(`[data-erro="${campo}"]`);
    if (!p) return;
    p.textContent = '';
    form.elements[campo].setAttribute('aria-invalid', 'false');
  }

  function mostrarErros(erros) {
    for (const p of form.querySelectorAll('[data-erro]')) {
      const campo = p.dataset.erro;
      p.textContent = erros[campo] || '';
      form.elements[campo].setAttribute('aria-invalid', String(Boolean(erros[campo])));
    }
  }

  function atualizarDuracao() {
    const inicio = C.diaNumero(form.elements.inicio.value);
    const fim = C.diaNumero(form.elements.fim.value);
    const dias = fim - inicio + 1;
    $('#f-duracao').textContent = dias >= 1 ? `Duração: ${dias} ${dias === 1 ? 'dia' : 'dias'} corridos` : '';
    if (dias >= 1) duracaoEditada = dias;
  }

  function aoMudarInicio() {
    const inicio = C.diaNumero(form.elements.inicio.value);
    const fim = C.diaNumero(form.elements.fim.value);
    if (!Number.isNaN(inicio) && (Number.isNaN(fim) || fim < inicio)) {
      form.elements.fim.value = C.isoDeDia(inicio + duracaoEditada - 1);
    }
    atualizarDuracao();
  }

  function salvarEditor(evento) {
    evento.preventDefault();
    const r = C.validarTarefa(Object.fromEntries(new FormData(form)));
    if (form.elements.progresso.validity.badInput) r.erros.progresso = 'Digite um número de 0 a 100.';
    mostrarErros(r.erros);
    if (Object.keys(r.erros).length) {
      form.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    const indice = estado.tarefas.findIndex((t) => t.id === estado.editando);
    const tarefa = { id: indice >= 0 ? estado.editando : C.novoId(), ...r.tarefa };
    if (indice >= 0) estado.tarefas[indice] = tarefa;
    else estado.tarefas.push(tarefa);
    dialogo.close();
    const gravacao = salvar();
    render();
    focarTarefa(tarefa.id);
    const oculta = C.filtrarTarefas([tarefa], estado.filtros, C.hojeISO()).length === 0;
    gravacao.then((ok) => {
      if (ok) avisar(oculta ? 'Atividade salva, mas oculta pelos filtros atuais.' : 'Atividade salva.', oculta && { rotulo: 'Limpar filtros', executar: limparFiltros });
    });
  }

  function focarTarefa(id) {
    const alvo = [...document.querySelectorAll('[data-id]')].find((e) => e.dataset.id === id && e.offsetParent);
    if (alvo) alvo.focus();
    else $('#btn-nova').focus({ preventScroll: true });
  }

  function excluir(id) {
    const indice = estado.tarefas.findIndex((t) => t.id === id);
    if (indice < 0) {
      render();
      avisar('Essa atividade já tinha sido excluída.');
      return;
    }
    const [removida] = estado.tarefas.splice(indice, 1);
    const gravacao = salvar();
    render();
    focarTarefa(null);
    gravacao.then((ok) => {
      if (!ok) return;
      avisar(`"${removida.nome}" excluída.`, {
        rotulo: 'Desfazer',
        executar: () => {
          estado.tarefas.push(removida);
          salvar();
          render();
          focarTarefa(removida.id);
        },
      });
    });
  }

  function duplicar(id) {
    const original = estado.tarefas.find((t) => t.id === id);
    if (!original) return;
    const copia = { ...original, id: C.novoId(), nome: `${original.nome} (cópia)`, progresso: 0 };
    estado.tarefas.push(copia);
    const gravacao = salvar();
    render();
    focarTarefa(copia.id);
    gravacao.then((ok) => ok && avisar('Atividade duplicada.'));
  }

  function zerarFiltros() {
    estado.filtros = { texto: '', fase: '', status: '' };
    $('#busca').value = '';
    $('#filtro-status').value = '';
  }

  function limparFiltros() {
    zerarFiltros();
    render();
  }

  function substituirTudo(titulo, tarefas) {
    estado.titulo = titulo;
    estado.tarefas = tarefas;
    zerarFiltros();
    rolarParaHoje = true;
    const gravacao = salvar();
    render();
    return gravacao;
  }

  function carregarExemplo() {
    if (estado.tarefas.length && !confirm('Substituir o cronograma atual pelo exemplo?')) return;
    const hoje = C.diaNumero(C.hojeISO());
    const itens = [
      ['Levantamento de requisitos', 'Planejamento', 'Ana', -16, -10, 100],
      ['Cronograma e orçamento', 'Planejamento', 'Ana', -9, -6, 100],
      ['Wireframes', 'Design', 'Bruno', -7, 1, 70],
      ['Aprovação do conteúdo', 'Design', 'Carla', -6, -1, 60],
      ['Identidade visual', 'Design', 'Bruno', -3, 5, 30],
      ['Back-end e integrações', 'Desenvolvimento', 'Diego', 0, 18, 10],
      ['Front-end', 'Desenvolvimento', 'Elisa', 3, 17, 0],
      ['Testes e ajustes', 'Testes', 'Carla', 18, 24, 0],
      ['Publicação', 'Lançamento', 'Diego', 25, 25, 0],
      ['Divulgação', 'Lançamento', 'Ana', 26, 33, 0],
    ];
    substituirTudo(estado.titulo, itens.map(([nome, fase, responsavel, inicio, fim, progresso]) => ({
      id: C.novoId(), nome, fase, responsavel, inicio: C.isoDeDia(hoje + inicio), fim: C.isoDeDia(hoje + fim), progresso, notas: '',
    }))).then((ok) => ok && avisar('Exemplo carregado. Edite ou apague à vontade.'));
  }

  function nomeArquivo() {
    const base = (estado.titulo || TITULO_PADRAO).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return `cronograma-${base || 'meu'}-${C.hojeISO()}`;
  }

  function baixar(nome, conteudo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const link = el('a', { href: url, download: nome });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importarArquivo(evento) {
    const arquivo = evento.target.files[0];
    evento.target.value = '';
    if (!arquivo) return;
    if (arquivo.size > TAMANHO_MAXIMO_IMPORTACAO) {
      avisar('Arquivo grande demais para ser um backup de cronograma.');
      return;
    }
    const r = C.importarDados(await arquivo.text());
    if (!r.ok) {
      avisar(`Importação cancelada. ${r.erro}`);
      return;
    }
    if (estado.tarefas.length && !confirm(`Substituir o cronograma atual (${estado.tarefas.length} atividades) pelo conteúdo de "${arquivo.name}"?`)) return;
    substituirTudo(estado.titulo, r.dados.tarefas).then((ok) => ok && avisar(`${r.dados.tarefas.length} atividades importadas.`));
  }

  const acoesMenu = {
    'exportar-json': () =>
      baixar(`${nomeArquivo()}.json`, JSON.stringify({ versao: 1, titulo: estado.titulo, tarefas: C.ordenarTarefas(estado.tarefas) }, null, 2), 'application/json'),
    'importar-json': () => $('#arquivo').click(),
    'exportar-csv': () => baixar(`${nomeArquivo()}.csv`, C.paraCSV(C.ordenarTarefas(estado.tarefas), C.hojeISO()), 'text/csv;charset=utf-8'),
    imprimir: () => window.print(),
    exemplo: carregarExemplo,
    'apagar-tudo': () => {
      if (!estado.tarefas.length || !confirm(`Apagar as ${estado.tarefas.length} atividades deste cronograma? Essa ação não pode ser desfeita.`)) return;
      substituirTudo(estado.titulo, []).then((ok) => ok && avisar('Atividades apagadas.'));
    },
    'excluir-empresa': async () => {
      if (empresas.length <= 1) {
        avisar('Esta é a única empresa. Crie outra antes de excluir esta.');
        return;
      }
      if (!confirm(`Excluir a empresa "${estado.titulo}" e todo o cronograma dela? Essa ação não pode ser desfeita.`)) return;
      if (alteracoesPendentes || envioEmCurso) {
        avisar('Aguarde terminar de salvar antes de excluir.');
        return;
      }
      const r = await chamarApi('DELETE', `api/empresas/${empresaAtual}`);
      if (r.status !== 200 && r.status !== 404) {
        avisar(r.dados?.erro || 'Não foi possível excluir a empresa.');
        return;
      }
      empresaAtual = null;
      if (!(await carregarDoServidor())) return;
      zerarFiltros();
      rolarParaHoje = true;
      render();
      avisar('Empresa excluída.');
    },
    sair: async () => {
      if (alteracoesPendentes || envioEmCurso) {
        avisar('Aguarde terminar de salvar antes de sair.');
        return;
      }
      await chamarApi('POST', 'api/logout');
      aplicarDocumento({ revisao: 0, titulo: TITULO_PADRAO, tarefas: [] });
      empresas = [];
      empresaAtual = null;
      mostrarLogin();
    },
  };

  $('#titulo').addEventListener('focus', () => {
    nomeAntesDeEditar = estado.titulo;
  });
  $('#titulo').addEventListener('input', (ev) => {
    estado.titulo = ev.target.value;
    renderEmpresas();
    document.title = `${estado.titulo.trim() || TITULO_PADRAO} · Cronograma`;
    salvar();
  });
  $('#titulo').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ev.target.blur();
  });
  $('#titulo').addEventListener('blur', () => {
    if (estado.titulo.trim()) return;
    estado.titulo = nomeAntesDeEditar || TITULO_PADRAO;
    salvar();
    render();
  });

  $('#btn-nova').addEventListener('click', () => abrirEditor(null));
  $('#busca').addEventListener('input', (ev) => {
    estado.filtros.texto = ev.target.value;
    render();
  });
  $('#filtro-fase').addEventListener('change', (ev) => {
    estado.filtros.fase = ev.target.value;
    render();
  });
  $('#filtro-status').addEventListener('change', (ev) => {
    estado.filtros.status = ev.target.value;
    render();
  });
  for (const b of document.querySelectorAll('[data-visao]')) {
    b.addEventListener('click', () => {
      estado.visao = b.dataset.visao;
      rolarParaHoje = estado.visao === 'gantt';
      salvarPrefs();
      render();
    });
  }
  for (const b of document.querySelectorAll('[data-zoom]')) {
    b.addEventListener('click', () => {
      estado.zoom = b.dataset.zoom;
      rolarParaHoje = true;
      salvarPrefs();
      render();
    });
  }
  $('#btn-hoje').addEventListener('click', irParaHoje);

  const menuEmpresas = $('#menu-empresas');
  const dialogoEmpresa = $('#dialogo-empresa');
  $('#btn-nova-empresa').addEventListener('click', () => {
    menuEmpresas.open = false;
    $('#f-empresa').value = '';
    $('#e-empresa').textContent = '';
    dialogoEmpresa.showModal();
    $('#f-empresa').focus();
  });
  for (const b of document.querySelectorAll('[data-fechar-empresa]')) b.addEventListener('click', () => dialogoEmpresa.close());
  $('#form-empresa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = $('#f-empresa').value.trim();
    if (!nome) {
      $('#e-empresa').textContent = 'Informe o nome da empresa.';
      $('#f-empresa').focus();
      return;
    }
    const r = await chamarApi('POST', 'api/empresas', { nome });
    if (r.status === 401) return mostrarLogin();
    if (r.status !== 201) {
      $('#e-empresa').textContent = r.dados?.erro || 'Não foi possível criar a empresa. Confira a conexão.';
      return;
    }
    dialogoEmpresa.close();
    empresas = [...empresas, { id: r.dados.id, nome: r.dados.nome, atividades: 0 }];
    await trocarEmpresa(r.dados.id);
    if (empresaAtual === r.dados.id) avisar(`Empresa "${r.dados.nome}" criada.`);
  });

  const menu = $('#menu');
  menu.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-acao]');
    if (!botao) return;
    menu.open = false;
    acoesMenu[botao.dataset.acao]();
  });
  document.addEventListener('click', (ev) => {
    if (menu.open && !menu.contains(ev.target)) menu.open = false;
    if (menuEmpresas.open && !menuEmpresas.contains(ev.target)) menuEmpresas.open = false;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      menu.open = false;
      menuEmpresas.open = false;
    }
  });
  $('#arquivo').addEventListener('change', importarArquivo);

  form.addEventListener('submit', salvarEditor);
  form.elements.inicio.addEventListener('change', aoMudarInicio);
  form.elements.fim.addEventListener('change', atualizarDuracao);
  $('#f-progresso-faixa').addEventListener('input', (ev) => {
    form.elements.progresso.value = ev.target.value;
    atualizarFaixa(ev.target.value);
    limparErro('progresso');
  });
  form.elements.progresso.addEventListener('input', (ev) => atualizarFaixa(ev.target.value));
  form.addEventListener('input', (ev) => {
    const campos = ev.target.name === 'inicio' || ev.target.name === 'fim' ? ['inicio', 'fim'] : [ev.target.name];
    for (const campo of campos) limparErro(campo);
  });
  $('#btn-excluir').addEventListener('click', () => {
    const id = estado.editando;
    dialogo.close();
    excluir(id);
  });
  for (const b of document.querySelectorAll('[data-fechar]')) b.addEventListener('click', () => dialogo.close());
  let pressionouFundo = false;
  dialogo.addEventListener('pointerdown', (ev) => { pressionouFundo = ev.target === dialogo; });
  dialogo.addEventListener('click', (ev) => {
    if (pressionouFundo && ev.target === dialogo) dialogo.close();
  });

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = ev.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const r = await chamarApi('POST', 'api/login', { senha: $('#senha').value });
    botao.disabled = false;
    if (r.status !== 200) {
      $('#erro-login').textContent = r.dados?.erro || 'Não foi possível conectar ao servidor.';
      $('#senha').select();
      return;
    }
    geracaoSessao += 1;
    if (alteracoesPendentes || envioEmCurso) {
      entrarNoApp();
      enviar();
    } else if (await carregarDoServidor()) {
      entrarNoApp();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sincronizar();
    else if (alteracoesPendentes) enviar({ aoSair: true });
  });
  window.addEventListener('focus', sincronizar);
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) sincronizar();
  });
  window.addEventListener('online', () => {
    if (alteracoesPendentes) enviar();
  });
  window.addEventListener('pagehide', () => {
    if (alteracoesPendentes) enviar({ aoSair: true });
  });
  window.addEventListener('beforeunload', (ev) => {
    if (!alteracoesPendentes && !envioEmCurso) return;
    ev.preventDefault();
    ev.returnValue = '';
  });
  window.addEventListener('beforeprint', () => {
    const grade = caixaGantt.querySelector('.g-grade');
    if (!grade || caixaGantt.hidden) return;
    const colunaNome = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col-nome-impressao'));
    const larguraNecessaria = colunaNome + parseFloat(grade.style.getPropertyValue('--largura'));
    grade.style.zoom = String(Math.min(1, LARGURA_IMPRESSAO / larguraNecessaria));
  });
  window.addEventListener('afterprint', () => {
    const grade = caixaGantt.querySelector('.g-grade');
    if (grade) grade.style.zoom = '';
  });

  carregarPrefs();
  carregarDoServidor().then((ok) => ok && entrarNoApp());
})();
