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
  const CAMPOS = ['nome', 'fase', 'responsavel', 'inicio', 'fim', 'progresso'];
  const TAGS_DAS_NOTAS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P']);
  const TAGS_DESCARTADAS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'NOSCRIPT']);
  const PARECE_HTML = /<\/?(b|strong|i|em|u|ul|ol|li|br|div|p)\b/i;
  const ICONES = {
    duplicar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    alca: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>',
    remover: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    checklist: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
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
    recolhidas: new Set(),
    calendario: C.normalizarCalendario(),
    critico: false,
  };
  let feriadosEditados = [];
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
  let checklistEditado = [];
  let dependenciasEditadas = [];
  let observadorSetas = null;
  let recolhidasPorEmpresa = {};
  const historico = C.criarHistorico(50);
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

  function comOrdem(tarefas) {
    return tarefas.every((t) => Number.isFinite(t.ordem)) ? tarefas : C.ordenarTarefas(tarefas).map((t, i) => ({ ...t, ordem: i }));
  }

  function aplicarDocumento(doc) {
    revisao = doc.revisao;
    estado.titulo = doc.titulo;
    estado.tarefas = comOrdem(doc.tarefas);
    estado.calendario = C.normalizarCalendario(doc.calendario);
    historico.limpar();
  }

  function fotografia() {
    return structuredClone({ tarefas: estado.tarefas, calendario: estado.calendario });
  }

  function registrarHistorico() {
    historico.registrar(fotografia());
  }

  function voltarNoHistorico(direcao) {
    const restaurado = direcao === 'desfazer' ? historico.desfazer(fotografia()) : historico.refazer(fotografia());
    if (!restaurado) return;
    estado.tarefas = restaurado.tarefas;
    estado.calendario = restaurado.calendario;
    salvar();
    render();
    avisar(direcao === 'desfazer' ? 'Alteração desfeita.' : 'Alteração refeita.');
  }

  function reagendarSeguintes() {
    const { tarefas, movidas } = C.reagendar(estado.tarefas, estado.calendario);
    estado.tarefas = tarefas;
    return movidas;
  }

  function textoReagendadas(quantidade) {
    return `${quantidade} ${quantidade === 1 ? 'atividade seguinte foi reagendada' : 'atividades seguintes foram reagendadas'} por causa das dependências.`;
  }

  function aplicarAlteracaoTarefa(nova) {
    const indice = estado.tarefas.findIndex((t) => t.id === nova.id);
    if (indice < 0) return;
    registrarHistorico();
    estado.tarefas[indice] = nova;
    const reagendadas = reagendarSeguintes().filter((id) => id !== nova.id).length;
    salvar().then((ok) => ok && reagendadas && avisar(textoReagendadas(reagendadas), { rotulo: 'Desfazer', executar: () => voltarNoHistorico('desfazer') }));
    render();
  }

  function rotuloDuracao(tarefa) {
    const corridos = C.duracaoDias(tarefa);
    if (!estado.calendario.diasUteis) return `${corridos} ${corridos === 1 ? 'dia' : 'dias'}`;
    const uteis = C.duracaoNoCalendario(tarefa, estado.calendario);
    return `${uteis} ${uteis === 1 ? 'dia útil' : 'dias úteis'}`;
  }

  function abrirCalendario() {
    $('#f-dias-uteis').checked = estado.calendario.diasUteis;
    feriadosEditados = estado.calendario.feriados.map((f) => ({ ...f }));
    const ano = Number(C.hojeISO().slice(0, 4));
    $('#f-ano-feriados').replaceChildren(...[ano, ano + 1, ano + 2].map((a) => el('option', { value: String(a) }, String(a))));
    $('#f-feriado-data').value = '';
    $('#f-feriado-nome').value = '';
    $('#e-feriado').textContent = '';
    renderFeriados();
    $('#dialogo-calendario').showModal();
  }

  function renderFeriados() {
    feriadosEditados = C.normalizarCalendario({ feriados: feriadosEditados }).feriados;
    $('#f-feriados-total').textContent = feriadosEditados.length ? `${feriadosEditados.length} ${feriadosEditados.length === 1 ? 'feriado' : 'feriados'}` : 'nenhum';
    $('#f-feriados').replaceChildren(...feriadosEditados.map((f, i) => el('li', { class: 'item-checklist item-feriado' },
      el('span', { class: 'feriado-data' }, `${C.formatarData(f.data)} · ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${f.data}T12:00:00Z`).getUTCDay()]}`),
      el('span', { class: 'feriado-nome' }, f.nome || 'Feriado'),
      el('button', {
        type: 'button',
        class: 'btn-icone',
        title: 'Remover feriado',
        'aria-label': `Remover feriado de ${C.formatarData(f.data)}`,
        onclick: () => {
          feriadosEditados.splice(i, 1);
          renderFeriados();
        },
      }, icone('remover')))));
  }

  function salvarCalendario(evento) {
    evento.preventDefault();
    const novo = C.normalizarCalendario({ diasUteis: $('#f-dias-uteis').checked, feriados: feriadosEditados });
    $('#dialogo-calendario').close();
    if (JSON.stringify(novo) === JSON.stringify(estado.calendario)) return;
    registrarHistorico();
    estado.calendario = novo;
    const reagendadas = reagendarSeguintes().length;
    salvar().then((ok) => ok && avisar(
      reagendadas ? `Calendário salvo. ${textoReagendadas(reagendadas)}` : 'Calendário salvo.',
      { rotulo: 'Desfazer', executar: () => voltarNoHistorico('desfazer') },
    ));
    render();
  }

  function nomeDa(id) {
    return estado.tarefas.find((t) => t.id === id)?.nome || '';
  }

  function renderDependenciasEditor(focar) {
    const proibidas = estado.editando ? C.sucessoresDe(estado.tarefas, estado.editando) : new Set();
    const candidatas = C.ordenarTarefas(estado.tarefas).filter((t) => t.id !== estado.editando && !proibidas.has(t.id));
    const lista = $('#f-dependencias');
    lista.replaceChildren(...dependenciasEditadas.map((dep, i) => {
      const escolhidasPorOutras = new Set(dependenciasEditadas.filter((_, j) => j !== i).map((d) => d.id));
      const opcoes = candidatas.filter((t) => !escolhidasPorOutras.has(t.id));
      const porFase = C.agruparPorFase(opcoes);
      const opcao = (t) => el('option', { value: t.id, selected: t.id === dep.id }, t.nome);
      return el('li', { class: 'item-checklist item-dependencia' },
        el('select', {
          class: 'campo',
          'aria-label': `Atividade anterior ${i + 1}`,
          onchange: (ev) => {
            dep.id = ev.target.value;
            renderDependenciasEditor();
          },
        }, ...(porFase.length > 1 || porFase[0]?.fase
          ? porFase.map((g) => el('optgroup', { label: g.fase || 'Sem fase' }, ...g.tarefas.map(opcao)))
          : opcoes.map(opcao))),
        el('label', { class: 'folga' },
          el('span', {}, 'folga'),
          el('input', {
            type: 'number',
            class: 'campo',
            value: String(dep.folga),
            step: '1',
            min: '-365',
            max: '365',
            inputmode: 'numeric',
            title: 'Dias entre o fim da anterior e o início desta (negativo sobrepõe)',
            'aria-label': `Dias de folga depois de ${nomeDa(dep.id)}`,
            oninput: (ev) => {
              dep.folga = Math.round(Number(ev.target.value) || 0);
            },
          }),
          el('span', {}, 'dias')),
        el('button', {
          type: 'button',
          class: 'btn-icone',
          title: 'Remover dependência',
          'aria-label': `Remover dependência de ${nomeDa(dep.id)}`,
          onclick: () => {
            dependenciasEditadas.splice(i, 1);
            renderDependenciasEditor();
          },
        }, icone('remover')));
    }));
    const escolhidas = new Set(dependenciasEditadas.map((d) => d.id));
    $('#btn-dependencia').disabled = !candidatas.some((t) => !escolhidas.has(t.id));
    if (focar != null) lista.querySelectorAll('select')[focar]?.focus();
  }

  function desenharSetas(grade, criticas) {
    grade.querySelector('.g-setas')?.remove();
    const caixa = grade.getBoundingClientRect();
    const barras = new Map([...grade.querySelectorAll('[data-barra]')].map((b) => [b.dataset.barra, b.getBoundingClientRect()]));
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'g-setas');
    svg.setAttribute('width', String(grade.scrollWidth));
    svg.setAttribute('height', String(grade.scrollHeight));
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(svgNs, 'defs');
    const marcador = document.createElementNS(svgNs, 'marker');
    for (const [k, v] of Object.entries({ id: 'ponta-seta', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto' })) marcador.setAttribute(k, v);
    const ponta = document.createElementNS(svgNs, 'path');
    ponta.setAttribute('d', 'M0 0L8 4L0 8z');
    ponta.setAttribute('class', 'g-seta-ponta');
    marcador.append(ponta);
    const marcadorCritico = marcador.cloneNode(true);
    marcadorCritico.setAttribute('id', 'ponta-seta-critica');
    marcadorCritico.firstChild.setAttribute('class', 'g-seta-ponta critica');
    defs.append(marcador, marcadorCritico);
    svg.append(defs);
    for (const t of estado.tarefas) {
      const b = barras.get(t.id);
      if (!b) continue;
      for (const d of t.dependencias || []) {
        const a = barras.get(d.id);
        if (!a) continue;
        const x1 = a.right - caixa.left;
        const y1 = a.top + a.height / 2 - caixa.top;
        const x2 = b.left - caixa.left;
        const y2 = b.top + b.height / 2 - caixa.top;
        const desce = y2 > y1;
        const rota = x2 - x1 >= 14
          ? `M${x1} ${y1}H${x1 + 5}V${y2}H${x2 - 1}`
          : `M${x1} ${y1}H${x1 + 5}V${desce ? b.top - caixa.top - 6 : b.bottom - caixa.top + 6}H${x2 - 10}V${y2}H${x2 - 1}`;
        const caminho = document.createElementNS(svgNs, 'path');
        caminho.setAttribute('d', rota);
        const critica = criticas.has(t.id) && criticas.has(d.id);
        caminho.setAttribute('class', critica ? 'g-seta critica' : 'g-seta');
        caminho.setAttribute('marker-end', critica ? 'url(#ponta-seta-critica)' : 'url(#ponta-seta)');
        caminho.setAttribute('data-de', d.id);
        caminho.setAttribute('data-para', t.id);
        svg.append(caminho);
      }
    }
    grade.append(svg);
  }

  function moverBarraPeloTeclado(ev, tarefa) {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    const dias = ev.key === 'ArrowRight' ? 1 : -1;
    const nova = ev.shiftKey ? C.redimensionarTarefa(tarefa, 'fim', dias, estado.calendario) : C.deslocarTarefa(tarefa, dias, estado.calendario);
    if (nova === tarefa) return;
    aplicarAlteracaoTarefa(nova);
    [...document.querySelectorAll('[data-barra]')].find((b) => b.dataset.barra === tarefa.id)?.focus();
  }

  function iniciarArrasteBarra(ev, tarefa, pxDia) {
    if (ev.button !== 0) return;
    const barra = ev.currentTarget;
    const marco = tarefa.tipo === 'marco';
    const modo = marco ? 'mover' : ev.target.dataset.lado || 'mover';
    const rotulo = barra.querySelector('.g-rotulo');
    const caixa = barra.getBoundingClientRect();
    const leftOriginal = parseFloat(barra.style.left);
    const inicioX = ev.clientX;
    const inicioY = ev.clientY;
    const toque = ev.pointerType === 'touch';
    let ativo = !toque;
    let movido = false;
    let resultado = null;
    let espera = null;
    if (toque) {
      espera = setTimeout(() => {
        ativo = true;
        barra.classList.add('arrastando-barra');
        navigator.vibrate?.(10);
      }, 350);
    } else {
      ev.preventDefault();
      barra.classList.add('arrastando-barra');
    }
    try {
      barra.setPointerCapture(ev.pointerId);
    } catch {}
    const bloquearRolagem = (e) => {
      if (ativo) e.preventDefault();
    };
    const mover = (e) => {
      const dx = e.clientX - inicioX;
      if (!ativo) {
        if (Math.abs(dx) > 8 || Math.abs(e.clientY - inicioY) > 8) encerrar(false);
        return;
      }
      if (!movido && Math.abs(dx) < 4) return;
      movido = true;
      if (modo === 'progresso') {
        const progresso = C.progressoPelaPosicao(e.clientX - caixa.left, caixa.width);
        barra.querySelector('.g-progresso').style.setProperty('width', `${progresso}%`);
        barra.querySelector('.g-puxador-progresso').style.setProperty('left', `${progresso}%`);
        rotulo.textContent = `${progresso}%`;
        resultado = { ...tarefa, progresso };
        return;
      }
      const dias = Math.round(dx / pxDia);
      resultado = modo === 'mover' ? C.deslocarTarefa(tarefa, dias, estado.calendario) : C.redimensionarTarefa(tarefa, modo, dias, estado.calendario);
      const deslocamento = (C.diaNumero(resultado.inicio) - C.diaNumero(tarefa.inicio)) * pxDia;
      barra.style.setProperty('left', `${leftOriginal + deslocamento}px`);
      if (!marco) barra.style.setProperty('width', `${C.duracaoDias(resultado) * pxDia}px`);
      rotulo.textContent = marco ? dataCurta(resultado.inicio) : `${dataCurta(resultado.inicio)} – ${dataCurta(resultado.fim)}`;
    };
    function encerrar(aplicar) {
      clearTimeout(espera);
      barra.removeEventListener('pointermove', mover);
      barra.removeEventListener('pointerup', aoSoltar);
      barra.removeEventListener('pointercancel', aoCancelar);
      document.removeEventListener('touchmove', bloquearRolagem);
      barra.classList.remove('arrastando-barra');
      if (!movido) return;
      const mudou = resultado && (resultado.inicio !== tarefa.inicio || resultado.fim !== tarefa.fim || resultado.progresso !== tarefa.progresso);
      if (aplicar && mudou) aplicarAlteracaoTarefa(resultado);
      else render();
    }
    const aoSoltar = () => encerrar(true);
    const aoCancelar = () => encerrar(false);
    barra.addEventListener('pointermove', mover);
    barra.addEventListener('pointerup', aoSoltar);
    barra.addEventListener('pointercancel', aoCancelar);
    document.addEventListener('touchmove', bloquearRolagem, { passive: false });
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
    estado.recolhidas = new Set(recolhidasPorEmpresa[id] || []);
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
    estado.critico = prefs.critico === true;
    if (typeof prefs.empresa === 'string') empresaPreferida = prefs.empresa;
    if (prefs.recolhidas && typeof prefs.recolhidas === 'object') recolhidasPorEmpresa = prefs.recolhidas;
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
    const corpo = JSON.stringify({ revisaoBase: revisao, idGravacao, titulo: estado.titulo, tarefas: estado.tarefas, calendario: estado.calendario });
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
    if (empresaAtual) recolhidasPorEmpresa[empresaAtual] = [...estado.recolhidas];
    gravar(CHAVE_PREFS, JSON.stringify({ visao: estado.visao, zoom: estado.zoom, critico: estado.critico, empresa: empresaAtual, recolhidas: recolhidasPorEmpresa }));
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
    const { desfazer, refazer } = historico.disponivel();
    $('#btn-desfazer').disabled = !desfazer;
    $('#btn-refazer').disabled = !refazer;
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
    else if (estado.visao === 'gantt') renderGantt(visiveis, cores, hoje, !filtrando);
    else renderTabela(visiveis, cores, hoje, !filtrando);
  }

  function renderResumo(r, filtrando) {
    const indicador = (rotulo, valor, tipo) =>
      el('div', { class: `cartao kpi kpi-${tipo}` },
        el('span', { class: 'kpi-icone' }, icone(tipo)),
        el('div', { class: 'cartao-rotulo' }, rotulo),
        el('div', { class: 'cartao-valor' }, String(valor)));
    const periodo = r.inicio
      ? [el('span', {}, `${C.formatarData(r.inicio)} a ${C.formatarData(r.fim)}`), ' · ', el('span', {}, `${r.dias} ${r.dias === 1 ? 'dia' : 'dias'} corridos`), ...(estado.calendario.diasUteis && r.inicio ? [' · ', el('span', {}, rotuloDuracao({ inicio: r.inicio, fim: r.fim }))] : [])]
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

  function agrupamento(lista, hoje) {
    return lista.some((t) => t.fase) ? C.agruparPorFase(lista, hoje) : null;
  }

  function botaoRecolher(fase, rotulo, recolhida) {
    return el('button', {
      type: 'button',
      class: 'recolher',
      'aria-expanded': String(!recolhida),
      'aria-label': `${recolhida ? 'Expandir' : 'Recolher'} ${rotulo}`,
      title: recolhida ? 'Expandir' : 'Recolher',
      onclick: () => alternarGrupo(fase),
    }, icone('seta'));
  }

  function alternarGrupo(fase) {
    if (estado.recolhidas.has(fase)) estado.recolhidas.delete(fase);
    else estado.recolhidas.add(fase);
    salvarPrefs();
    render();
    [...document.querySelectorAll('[data-arrastavel="fase"]')]
      .find((linha) => linha.dataset.fase === fase && linha.offsetParent)
      ?.querySelector('.recolher')
      ?.focus();
  }

  function alca(tipo, valor, rotulo) {
    return el('button', {
      type: 'button',
      class: 'alca',
      'aria-label': `Mover ${tipo === 'fase' ? 'a fase' : ''} ${rotulo}. Use as setas para cima e para baixo.`,
      title: 'Arraste para reordenar (ou use as setas do teclado)',
      'data-alca': tipo,
      'data-valor': valor,
      onpointerdown: (ev) => iniciarArraste(ev, tipo, valor),
      onkeydown: (ev) => moverPeloTeclado(ev, tipo, valor),
    }, icone('alca'));
  }

  function focarAlca(tipo, valor) {
    [...document.querySelectorAll(`[data-alca="${tipo}"]`)].find((b) => b.dataset.valor === valor && b.offsetParent)?.focus();
  }

  function aplicarNovaOrdem(novas, tipo, valor) {
    const antes = C.ordenarTarefas(estado.tarefas).map((t) => `${t.id}:${t.fase}`).join('|');
    const depois = C.ordenarTarefas(novas).map((t) => `${t.id}:${t.fase}`).join('|');
    if (antes === depois) return;
    registrarHistorico();
    estado.tarefas = novas;
    salvar();
    render();
    focarAlca(tipo, valor);
  }

  function moverPeloTeclado(ev, tipo, valor) {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    const subir = ev.key === 'ArrowUp';
    const grupos = C.agruparPorFase(estado.tarefas);
    if (tipo === 'fase') {
      const i = grupos.findIndex((g) => g.fase === valor);
      if (subir && i > 0) aplicarNovaOrdem(C.moverFase(estado.tarefas, valor, grupos[i - 1].fase), tipo, valor);
      if (!subir && i < grupos.length - 1) aplicarNovaOrdem(C.moverFase(estado.tarefas, valor, grupos[i + 2]?.fase ?? null), tipo, valor);
      return;
    }
    const gi = grupos.findIndex((g) => g.tarefas.some((t) => t.id === valor));
    const grupo = grupos[gi];
    const i = grupo.tarefas.findIndex((t) => t.id === valor);
    let destino = null;
    if (subir && i > 0) destino = [grupo.fase, grupo.tarefas[i - 1].id];
    else if (subir && gi > 0) destino = [grupos[gi - 1].fase, null];
    else if (!subir && i < grupo.tarefas.length - 1) destino = [grupo.fase, grupo.tarefas[i + 2]?.id ?? null];
    else if (!subir && gi < grupos.length - 1) destino = [grupos[gi + 1].fase, grupos[gi + 1].tarefas[0].id];
    if (destino) aplicarNovaOrdem(C.moverTarefa(estado.tarefas, valor, destino[0], destino[1]), tipo, valor);
  }

  function destinoDaSoltura(tipo, candidatos, indice) {
    const depois = candidatos[indice];
    const antes = candidatos[indice - 1];
    if (tipo === 'fase') return [depois ? depois.dataset.fase : null];
    if (depois?.dataset.arrastavel === 'tarefa') return [depois.dataset.fase, depois.dataset.id];
    if (antes) return [antes.dataset.fase, null];
    const primeira = C.agruparPorFase(estado.tarefas).find((g) => g.fase === depois.dataset.fase)?.tarefas[0];
    return [depois.dataset.fase, primeira ? primeira.id : null];
  }

  function iniciarArraste(ev, tipo, valor) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const alvo = ev.currentTarget;
    alvo.setPointerCapture(ev.pointerId);
    const raiz = estado.visao === 'gantt' ? caixaGantt : $('#vista-tabela');
    const candidatos = [...raiz.querySelectorAll(tipo === 'fase' ? '[data-arrastavel="fase"]' : '[data-arrastavel]')];
    const origem = alvo.closest('[data-arrastavel]');
    const indicador = el('div', { class: 'indicador-soltar' });
    document.body.append(indicador);
    origem.classList.add('arrastando');
    let indice = null;

    const mover = (e) => {
      const caixa = raiz.getBoundingClientRect();
      if (e.clientY < caixa.top + 40) raiz.scrollTop -= 12;
      if (e.clientY > caixa.bottom - 40) raiz.scrollTop += 12;
      if (e.clientY < 60) window.scrollBy(0, -12);
      if (e.clientY > innerHeight - 60) window.scrollBy(0, 12);
      indice = candidatos.findIndex((linha) => {
        const r = linha.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (indice < 0) indice = candidatos.length;
      const referencia = candidatos[Math.min(indice, candidatos.length - 1)].getBoundingClientRect();
      const topo = indice < candidatos.length ? referencia.top : referencia.bottom;
      indicador.style.setProperty('top', `${topo - 1}px`);
      indicador.style.setProperty('left', `${caixa.left}px`);
      indicador.style.setProperty('width', `${caixa.width}px`);
    };
    const encerrar = (aplicar) => {
      alvo.removeEventListener('pointermove', mover);
      indicador.remove();
      origem.classList.remove('arrastando');
      if (!aplicar || indice === null) return;
      const [fase, referencia] = destinoDaSoltura(tipo, candidatos, indice);
      const novas = tipo === 'fase' ? C.moverFase(estado.tarefas, valor, fase) : C.moverTarefa(estado.tarefas, valor, fase, referencia === valor ? null : referencia);
      aplicarNovaOrdem(novas, tipo, valor);
    };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerup', () => encerrar(true), { once: true });
    alvo.addEventListener('pointercancel', () => encerrar(false), { once: true });
  }

  function renderGantt(lista, cores, hoje, podeArrastar) {
    const e = C.escalaGantt(lista, estado.zoom, hoje);
    const criticas = estado.critico ? C.caminhoCritico(estado.tarefas, estado.calendario) : new Set();
    $('#btn-critico').setAttribute('aria-pressed', String(estado.critico));
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
    for (const f of estado.calendario.diasUteis ? estado.calendario.feriados : []) {
      const dia = C.diaNumero(f.data) - e.inicioDia;
      if (dia >= 0 && dia < e.totalDias) fundo.append(el('div', { class: 'g-fds g-feriado', title: f.nome || 'Feriado', style: { left: px(dia * e.pxDia), width: px(e.pxDia) } }));
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

    const posicaoDe = (inicio, fim) => ({
      left: px((C.diaNumero(inicio) - e.inicioDia) * e.pxDia),
      width: px((C.diaNumero(fim) - C.diaNumero(inicio) + 1) * e.pxDia),
    });

    const linhaTarefa = (t) => {
      const status = C.statusTarefa(t, hoje);
      const barra = e.barras[t.id];
      const marco = t.tipo === 'marco';
      const periodo = marco ? C.formatarData(t.inicio) : `${C.formatarData(t.inicio)} a ${C.formatarData(t.fim)}`;
      const situacao = marco ? (t.progresso >= 100 ? 'concluído' : 'pendente') : `${t.progresso}% concluído`;
      const descricao = `${marco ? 'Marco ' : ''}${t.nome}: ${periodo}, ${situacao}, ${C.ROTULO_STATUS[status]}`;
      const datas = marco ? `${dataCurta(t.inicio)} · marco` : `${dataCurta(t.inicio)} – ${dataCurta(t.fim)}`;
      const desenho = marco
        ? el('button', {
            type: 'button',
            class: `g-marco ${status}${criticas.has(t.id) ? ' critica' : ''}`,
            style: { left: px(barra.left + e.pxDia / 2) },
            title: `${descricao}. Arraste para mudar a data.`,
            'aria-label': `${descricao}. Setas para os lados mudam a data.`,
            'data-barra': t.id,
            onclick: () => abrirEditor(t.id),
            onpointerdown: (ev) => iniciarArrasteBarra(ev, t, e.pxDia),
            onkeydown: (ev) => moverBarraPeloTeclado(ev, t),
          },
          el('span', { class: 'g-losango' }),
          el('span', { class: 'g-rotulo' }, status === 'atrasada' ? `${dataCurta(t.inicio)} · atrasado` : dataCurta(t.inicio)))
        : el('button', {
            type: 'button',
            class: `g-barra ${status}${criticas.has(t.id) ? ' critica' : ''}`,
            style: { left: px(barra.left), width: px(barra.width) },
            title: `${descricao}. Arraste para mover; puxe as pontas para mudar as datas.`,
            'aria-label': `${descricao}. Setas para os lados movem 1 dia; com Shift, mudam o término.`,
            'data-barra': t.id,
            onclick: () => abrirEditor(t.id),
            onpointerdown: (ev) => iniciarArrasteBarra(ev, t, e.pxDia),
            onkeydown: (ev) => moverBarraPeloTeclado(ev, t),
          },
          el('span', { class: 'g-progresso', style: { width: `${t.progresso}%` } }),
          barra.width >= 24 && el('span', { class: 'g-puxador inicio', 'data-lado': 'inicio', title: 'Puxe para mudar o início' }),
          barra.width >= 24 && el('span', { class: 'g-puxador fim', 'data-lado': 'fim', title: 'Puxe para mudar o término' }),
          barra.width >= 24 && el('span', { class: 'g-puxador-progresso', 'data-lado': 'progresso', title: 'Puxe para mudar o progresso', style: { left: `${t.progresso}%` } }),
          el('span', { class: 'g-rotulo' }, status === 'atrasada' ? `${t.progresso}% · atrasada` : `${t.progresso}%`));
      return el('div', { class: 'g-linha', style: { '--cor': corDa(t, cores) }, 'data-arrastavel': 'tarefa', 'data-id': t.id, 'data-fase': t.fase },
        el('div', { class: 'g-nome' },
          podeArrastar && alca('tarefa', t.id, t.nome),
          el('button', { type: 'button', class: 'g-nome-abrir', title: t.nome, 'data-id': t.id, onclick: () => abrirEditor(t.id) },
            el('span', { class: 'g-nome-texto' }, t.nome),
            el('span', { class: 'g-nome-datas' }, `${datas}${textoChecklist(t)}`))),
        el('div', { class: 'g-trilho' }, desenho));
    };

    const linhaGrupo = (g) => {
      const recolhida = estado.recolhidas.has(g.fase);
      const rotulo = g.fase || 'Sem fase';
      const cor = g.fase ? corDa({ fase: g.fase }, cores) : 'var(--fase-sem)';
      const contagem = `${g.total} ${g.total === 1 ? 'atividade' : 'atividades'}`;
      return el('div', { class: `g-linha g-grupo${recolhida ? ' recolhida' : ''}`, style: { '--cor': cor }, 'data-arrastavel': 'fase', 'data-fase': g.fase },
        el('div', { class: 'g-nome g-nome-grupo' },
          podeArrastar && alca('fase', g.fase, rotulo),
          botaoRecolher(g.fase, rotulo, recolhida),
          el('span', { class: 'g-grupo-texto' },
            el('span', { class: 'g-grupo-nome' }, rotulo),
            el('span', { class: 'g-nome-datas' }, `${contagem} · ${dataCurta(g.inicio)} – ${dataCurta(g.fim)}`))),
        el('div', { class: 'g-trilho' },
          el('div', {
            class: 'g-resumo',
            style: posicaoDe(g.inicio, g.fim),
            title: `${rotulo}: ${C.formatarData(g.inicio)} a ${C.formatarData(g.fim)}, ${g.progresso}% concluído`,
          },
          el('span', { class: 'g-resumo-progresso', style: { width: `${g.progresso}%` } }),
          el('span', { class: 'g-rotulo' }, `${g.progresso}%`))));
    };

    const grupos = agrupamento(lista, hoje);
    const linhas = grupos
      ? grupos.flatMap((g) => [linhaGrupo(g), ...(estado.recolhidas.has(g.fase) ? [] : g.tarefas.map(linhaTarefa))])
      : lista.map(linhaTarefa);

    const { scrollLeft, scrollTop } = caixaGantt;
    caixaGantt.replaceChildren(
      el('div', { class: 'g-grade', style: { '--largura': px(e.larguraTotal) } },
        el('div', { class: 'g-cabecalho' }, el('div', { class: 'g-canto' }, 'Atividade'), escala),
        fundo,
        ...linhas),
    );
    const grade = caixaGantt.querySelector('.g-grade');
    desenharSetas(grade, criticas);
    observadorSetas?.disconnect();
    observadorSetas = new ResizeObserver(() => desenharSetas(grade, criticas));
    observadorSetas.observe(grade);
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

  function renderTabela(lista, cores, hoje, podeArrastar) {
    const criticas = estado.critico ? C.caminhoCritico(estado.tarefas, estado.calendario) : new Set();
    const celula = (rotulo, valor, classe) => el('td', { 'data-rotulo': rotulo, class: valor ? classe : `${classe} vazio-celula` }, valor || '—');
    const linhaTarefa = (t) => {
      const status = C.statusTarefa(t, hoje);
      const marco = t.tipo === 'marco';
      const critica = criticas.has(t.id);
      return el('tr', { class: 'linha-tarefa', style: { '--cor': corDa(t, cores) }, 'data-arrastavel': 'tarefa', 'data-id': t.id, 'data-fase': t.fase },
        el('td', { class: 'c-nome' },
          el('div', { class: 'nome-linha' },
            podeArrastar && alca('tarefa', t.id, t.nome),
            el('button', { type: 'button', class: 'nome-link', 'data-id': t.id, onclick: () => abrirEditor(t.id) },
              el('span', { class: marco ? 'ponto losango' : 'ponto' }), el('span', {}, t.nome))),
          t.notas && el('div', { class: 'notas' }, C.notasEmTexto(t.notas)),
          resumoChecklistEl(t),
          (t.dependencias || []).length > 0 && el('div', { class: 'dependencias-resumo' },
            `depois de: ${t.dependencias.map((d) => nomeDa(d.id)).filter(Boolean).join(', ')}`)),
        celula('Fase', t.fase, 'c-fase'),
        el('td', { 'data-rotulo': 'Responsável', class: t.responsavel ? 'c-resp' : 'c-resp vazio-celula' },
          t.responsavel
            ? el('span', { class: 'pessoa' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, C.iniciais(t.responsavel)), el('span', {}, t.responsavel))
            : '—'),
        celula(marco ? 'Data' : 'Início', C.formatarData(t.inicio), 'data c-inicio'),
        marco ? el('td', { class: 'data c-fim vazio-celula' }, '—') : celula('Término', C.formatarData(t.fim), 'data c-fim'),
        celula('Duração', marco ? 'Marco' : rotuloDuracao(t), 'num c-dur'),
        el('td', { class: 'c-progresso' },
          marco
            ? el('span', { class: 'marco-situacao' }, t.progresso >= 100 ? 'Marco concluído' : 'Marco pendente')
            : el('div', { class: 'progresso-celula' }, el('div', { class: 'medidor' }, el('span', { style: { width: `${t.progresso}%` } })), el('b', {}, `${t.progresso}%`))),
        el('td', { class: 'c-status' }, el('span', { class: `selo ${status}` }, C.ROTULO_STATUS[status]), critica && el('span', { class: 'selo critica' }, 'Crítica')),
        el('td', { class: 'c-acoes' },
          el('div', { class: 'acoes-linha' },
            el('button', { type: 'button', class: 'btn-icone', title: 'Duplicar', 'aria-label': `Duplicar ${t.nome}`, onclick: () => duplicar(t.id) }, icone('duplicar')),
            el('button', { type: 'button', class: 'btn-icone perigo', title: 'Excluir', 'aria-label': `Excluir ${t.nome}`, onclick: () => excluir(t.id) }, icone('excluir')))));
    };
    const linhaGrupo = (g) => {
      const recolhida = estado.recolhidas.has(g.fase);
      const rotulo = g.fase || 'Sem fase';
      const cor = g.fase ? corDa({ fase: g.fase }, cores) : 'var(--fase-sem)';
      return el('tr', { class: `linha-grupo${recolhida ? ' recolhida' : ''}`, style: { '--cor': cor }, 'data-arrastavel': 'fase', 'data-fase': g.fase },
        el('td', { colspan: '9' },
          el('div', { class: 'grupo-cabecalho' },
            podeArrastar && alca('fase', g.fase, rotulo),
            botaoRecolher(g.fase, rotulo, recolhida),
            el('span', { class: 'ponto' }),
            el('span', { class: 'grupo-nome' }, rotulo),
            el('span', { class: 'grupo-detalhe' }, `${g.total} ${g.total === 1 ? 'atividade' : 'atividades'} · ${C.formatarData(g.inicio)} a ${C.formatarData(g.fim)}`),
            el('span', { class: 'grupo-progresso' }, el('span', { class: 'medidor' }, el('span', { style: { width: `${g.progresso}%` } })), `${g.progresso}%`))));
    };
    const grupos = agrupamento(lista, hoje);
    const linhas = grupos
      ? grupos.flatMap((g) => [linhaGrupo(g), ...(estado.recolhidas.has(g.fase) ? [] : g.tarefas.map(linhaTarefa))])
      : lista.map(linhaTarefa);
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
      checklist: [],
    };
    estado.editando = tarefa ? tarefa.id : null;
    for (const campo of CAMPOS) form.elements[campo].value = valores[campo];
    $('#f-marco').checked = valores.tipo === 'marco';
    $('#f-marco-feito').checked = valores.progresso >= 100;
    aplicarTipoNoEditor();
    notasParaEditor(valores.notas || '');
    checklistEditado = (valores.checklist || []).map((item) => ({ ...item }));
    dependenciasEditadas = (valores.dependencias || []).map((d) => ({ ...d }));
    renderDependenciasEditor();
    renderChecklistEditor();
    atualizarFaixa(valores.progresso);
    $('#dialogo-titulo').textContent = tarefa ? 'Editar atividade' : 'Nova atividade';
    $('#btn-excluir').hidden = !tarefa;
    duracaoEditada = C.duracaoDias(valores);
    mostrarErros({});
    atualizarDuracao();
    dialogo.showModal();
    if (!tarefa) form.elements.nome.focus();
  }

  function aplicarTipoNoEditor() {
    const marco = $('#f-marco').checked;
    $('#grupo-fim').hidden = marco;
    $('#f-duracao').hidden = marco;
    $('#grupo-progresso').hidden = marco;
    $('#grupo-marco-feito').hidden = !marco;
    $('#rotulo-inicio').textContent = marco ? 'Data *' : 'Início *';
    if (marco) limparErro('fim');
  }

  function atualizarFaixa(valor) {
    const faixa = $('#f-progresso-faixa');
    faixa.value = valor;
    faixa.style.setProperty('--v', `${faixa.value}%`);
  }

  function elementoDoCampo(campo) {
    return form.elements[campo] || document.getElementById(`f-${campo}`);
  }

  function limparErro(campo) {
    const p = form.querySelector(`[data-erro="${campo}"]`);
    if (!p) return;
    p.textContent = '';
    elementoDoCampo(campo).setAttribute('aria-invalid', 'false');
  }

  function mostrarErros(erros) {
    for (const p of form.querySelectorAll('[data-erro]')) {
      const campo = p.dataset.erro;
      p.textContent = erros[campo] || '';
      elementoDoCampo(campo).setAttribute('aria-invalid', String(Boolean(erros[campo])));
    }
  }

  function copiarFormatacaoPermitida(origem, destino) {
    for (const no of origem.childNodes) {
      if (no.nodeType === Node.TEXT_NODE) {
        destino.append(no.textContent);
      } else if (no.nodeType === Node.ELEMENT_NODE && !TAGS_DESCARTADAS.has(no.tagName)) {
        const alvo = TAGS_DAS_NOTAS.has(no.tagName) ? document.createElement(no.tagName.toLowerCase()) : destino;
        copiarFormatacaoPermitida(no, alvo);
        if (alvo !== destino) destino.append(alvo);
      }
    }
  }

  function notasParaEditor(notas) {
    const area = $('#f-notas');
    area.replaceChildren();
    if (PARECE_HTML.test(notas)) {
      const inerte = document.createElement('template');
      inerte.innerHTML = notas.replace(/<(\/?[a-z][a-z0-9]*)\b[^>]*>/gi, '<$1>');
      copiarFormatacaoPermitida(inerte.content, area);
      return;
    }
    notas.split('\n').forEach((linha, i) => {
      if (i) area.append(document.createElement('br'));
      area.append(linha);
    });
  }

  function notasDoEditor() {
    const limpo = document.createElement('div');
    copiarFormatacaoPermitida($('#f-notas'), limpo);
    return C.notasEmTexto(limpo.innerHTML) ? limpo.innerHTML : '';
  }

  function textoChecklist(tarefa) {
    const { feitos, total } = C.resumoChecklist(tarefa.checklist);
    return total ? ` · ✓ ${feitos}/${total}` : '';
  }

  function resumoChecklistEl(tarefa) {
    const { feitos, total } = C.resumoChecklist(tarefa.checklist);
    if (!total) return null;
    return el('div', { class: `checklist-resumo${feitos === total ? ' completo' : ''}`, title: 'Itens do checklist concluídos' },
      icone('checklist'), `${feitos}/${total} itens`);
  }

  function atualizarResumoChecklist() {
    const { feitos, total } = C.resumoChecklist(checklistEditado.filter((i) => i.texto.trim()));
    $('#f-checklist-resumo').textContent = total ? `${feitos} de ${total} concluídos` : '';
  }

  function renderChecklistEditor(focar) {
    const lista = $('#f-checklist');
    lista.replaceChildren(...checklistEditado.map((item, i) => el('li', { class: 'item-checklist' },
      el('input', {
        type: 'checkbox',
        checked: item.feito,
        'aria-label': `Concluído: item ${i + 1}`,
        onchange: (ev) => {
          item.feito = ev.target.checked;
          atualizarResumoChecklist();
        },
      }),
      el('input', {
        type: 'text',
        class: 'campo',
        value: item.texto,
        maxlength: '300',
        placeholder: 'Descreva o item',
        'aria-label': `Item ${i + 1} do checklist`,
        oninput: (ev) => {
          item.texto = ev.target.value;
          atualizarResumoChecklist();
        },
        onkeydown: (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            checklistEditado.splice(i + 1, 0, { texto: '', feito: false });
            renderChecklistEditor(i + 1);
          } else if (ev.key === 'Backspace' && !item.texto) {
            ev.preventDefault();
            checklistEditado.splice(i, 1);
            renderChecklistEditor(Math.max(0, i - 1));
          }
        },
      }),
      el('button', {
        type: 'button',
        class: 'btn-icone',
        title: 'Remover item',
        'aria-label': `Remover item ${i + 1}`,
        onclick: () => {
          checklistEditado.splice(i, 1);
          renderChecklistEditor(Math.min(i, checklistEditado.length - 1));
        },
      }, icone('remover')))));
    if (focar != null && focar >= 0) lista.querySelectorAll('input[type=text]')[focar]?.focus();
    atualizarResumoChecklist();
  }

  function atualizarDuracao() {
    const inicio = C.diaNumero(form.elements.inicio.value);
    const fim = C.diaNumero(form.elements.fim.value);
    const dias = fim - inicio + 1;
    const uteis = estado.calendario.diasUteis && dias >= 1 ? ` (${rotuloDuracao({ inicio: form.elements.inicio.value, fim: form.elements.fim.value })})` : '';
    $('#f-duracao').textContent = dias >= 1 ? `Duração: ${dias} ${dias === 1 ? 'dia' : 'dias'} corridos${uteis}` : '';
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
    const marco = $('#f-marco').checked;
    const existente = estado.tarefas.find((t) => t.id === estado.editando);
    const proximaOrdem = Math.max(-1, ...estado.tarefas.map((t) => t.ordem).filter(Number.isFinite)) + 1;
    const dados = { ...Object.fromEntries(new FormData(form)), notas: notasDoEditor(), checklist: checklistEditado, dependencias: dependenciasEditadas };
    const r = C.validarTarefa({
      ...dados,
      tipo: marco ? 'marco' : 'tarefa',
      progresso: marco ? ($('#f-marco-feito').checked ? 100 : 0) : dados.progresso,
      ordem: existente ? existente.ordem : proximaOrdem,
    });
    if (form.elements.progresso.validity.badInput) r.erros.progresso = 'Digite um número de 0 a 100.';
    mostrarErros(r.erros);
    if (Object.keys(r.erros).length) {
      form.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    registrarHistorico();
    const indice = estado.tarefas.findIndex((t) => t.id === estado.editando);
    const tarefa = { id: indice >= 0 ? estado.editando : C.novoId(), ...r.tarefa };
    if (indice >= 0) estado.tarefas[indice] = tarefa;
    else estado.tarefas.push(tarefa);
    const movidas = reagendarSeguintes();
    const propriaAjustada = movidas.includes(tarefa.id);
    const reagendadas = movidas.length - (propriaAjustada ? 1 : 0);
    dialogo.close();
    const gravacao = salvar();
    render();
    focarTarefa(tarefa.id);
    const oculta = C.filtrarTarefas([tarefa], estado.filtros, C.hojeISO()).length === 0;
    gravacao.then((ok) => {
      if (!ok) return;
      const ajustes = [
        propriaAjustada && 'As datas dela foram ajustadas para depois das atividades das quais depende.',
        reagendadas && textoReagendadas(reagendadas),
      ].filter(Boolean);
      if (ajustes.length) avisar(`Atividade salva. ${ajustes.join(' ')}`, { rotulo: 'Desfazer', executar: () => voltarNoHistorico('desfazer') });
      else avisar(oculta ? 'Atividade salva, mas oculta pelos filtros atuais.' : 'Atividade salva.', oculta && { rotulo: 'Limpar filtros', executar: limparFiltros });
    });
  }

  function focarTarefa(id) {
    const alvo = [...document.querySelectorAll('button[data-id]')].find((e) => e.dataset.id === id && e.offsetParent);
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
    registrarHistorico();
    const [removida] = estado.tarefas.splice(indice, 1);
    estado.tarefas = estado.tarefas.map((t) => (t.dependencias || []).some((d) => d.id === id)
      ? { ...t, dependencias: t.dependencias.filter((d) => d.id !== id) }
      : t);
    const gravacao = salvar();
    render();
    focarTarefa(null);
    gravacao.then((ok) => {
      if (!ok) return;
      avisar(`"${removida.nome}" excluída.`, {
        rotulo: 'Desfazer',
        executar: () => {
          voltarNoHistorico('desfazer');
          focarTarefa(removida.id);
        },
      });
    });
  }

  function duplicar(id) {
    const original = estado.tarefas.find((t) => t.id === id);
    if (!original) return;
    registrarHistorico();
    const copia = {
      ...original,
      id: C.novoId(),
      nome: `${original.nome} (cópia)`,
      progresso: 0,
      ordem: (Number.isFinite(original.ordem) ? original.ordem : estado.tarefas.length) + 0.5,
      checklist: (original.checklist || []).map((item) => ({ ...item, feito: false })),
    };
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
    registrarHistorico();
    estado.titulo = titulo;
    estado.tarefas = comOrdem(tarefas);
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
      ['Publicação no ar', 'Lançamento', 'Diego', 25, 25, 0, 'marco'],
      ['Divulgação', 'Lançamento', 'Ana', 26, 33, 0],
    ];
    const depende = {
      'Cronograma e orçamento': [['Levantamento de requisitos', 0]],
      Wireframes: [['Cronograma e orçamento', -2]],
      'Aprovação do conteúdo': [['Cronograma e orçamento', -1]],
      'Identidade visual': [['Aprovação do conteúdo', -3]],
      'Back-end e integrações': [['Aprovação do conteúdo', 0]],
      'Front-end': [['Wireframes', 1]],
      'Testes e ajustes': [['Front-end', 0], ['Back-end e integrações', -1]],
      'Publicação no ar': [['Testes e ajustes', 0]],
      Divulgação: [['Publicação no ar', 0]],
    };
    const ids = Object.fromEntries(itens.map(([nome]) => [nome, C.novoId()]));
    const detalhes = {
      Wireframes: {
        notas: '<b>Referência:</b> manual da marca e site atual.<ul><li>Priorizar a versão para celular</li><li>Validar com o cliente na sexta</li></ul>',
        checklist: [
          { texto: 'Página inicial', feito: true },
          { texto: 'Página de serviços', feito: true },
          { texto: 'Formulário de contato', feito: false },
        ],
      },
    };
    substituirTudo(estado.titulo, itens.map(([nome, fase, responsavel, inicio, fim, progresso, tipo = 'tarefa'], ordem) => ({
      id: ids[nome], nome, fase, responsavel, inicio: C.isoDeDia(hoje + inicio), fim: C.isoDeDia(hoje + fim), progresso, tipo, ordem,
      dependencias: (depende[nome] || []).map(([anterior, folga]) => ({ id: ids[anterior], folga })),
      notas: detalhes[nome]?.notas || '', checklist: detalhes[nome]?.checklist || [],
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
    'exportar-csv': () => baixar(`${nomeArquivo()}.csv`, C.paraCSV(C.ordenarTarefas(estado.tarefas), C.hojeISO(), estado.calendario), 'text/csv;charset=utf-8'),
    imprimir: () => window.print(),
    exemplo: carregarExemplo,
    'apagar-tudo': () => {
      if (!estado.tarefas.length || !confirm(`Apagar as ${estado.tarefas.length} atividades deste cronograma? Essa ação não pode ser desfeita.`)) return;
      substituirTudo(estado.titulo, []).then((ok) => ok && avisar('Atividades apagadas.'));
    },
    calendario: abrirCalendario,
    'ordenar-data': () => {
      if (!estado.tarefas.length) return;
      registrarHistorico();
      estado.tarefas = C.ordenarPorData(estado.tarefas);
      salvar().then((ok) => ok && avisar('Atividades ordenadas por data de início.', {
        rotulo: 'Desfazer',
        executar: () => voltarNoHistorico('desfazer'),
      }));
      render();
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

  $('#btn-desfazer').addEventListener('click', () => voltarNoHistorico('desfazer'));
  $('#btn-refazer').addEventListener('click', () => voltarNoHistorico('refazer'));
  document.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || document.body.dataset.tela !== 'app' || dialogo.open) return;
    const alvo = ev.target;
    if (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) return;
    const tecla = ev.key.toLowerCase();
    if (tecla === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      voltarNoHistorico('desfazer');
    } else if ((tecla === 'z' && ev.shiftKey) || tecla === 'y') {
      ev.preventDefault();
      voltarNoHistorico('refazer');
    }
  });
  form.addEventListener('submit', salvarEditor);
  $('#f-marco').addEventListener('change', aplicarTipoNoEditor);
  $('#btn-critico').addEventListener('click', () => {
    estado.critico = !estado.critico;
    salvarPrefs();
    render();
  });
  $('#form-calendario').addEventListener('submit', salvarCalendario);
  for (const b of document.querySelectorAll('[data-fechar-calendario]')) b.addEventListener('click', () => $('#dialogo-calendario').close());
  $('#btn-feriado').addEventListener('click', () => {
    const data = $('#f-feriado-data').value;
    if (Number.isNaN(C.diaNumero(data))) {
      $('#e-feriado').textContent = 'Escolha a data do feriado.';
      return;
    }
    $('#e-feriado').textContent = '';
    feriadosEditados.push({ data, nome: $('#f-feriado-nome').value });
    $('#f-feriado-data').value = '';
    $('#f-feriado-nome').value = '';
    renderFeriados();
  });
  $('#btn-feriados-nacionais').addEventListener('click', () => {
    feriadosEditados.push(...C.feriadosNacionais(Number($('#f-ano-feriados').value)));
    renderFeriados();
  });
  $('#btn-dependencia').addEventListener('click', () => {
    const proibidas = estado.editando ? C.sucessoresDe(estado.tarefas, estado.editando) : new Set();
    const escolhidas = new Set(dependenciasEditadas.map((d) => d.id));
    const livre = C.ordenarTarefas(estado.tarefas).find((t) => t.id !== estado.editando && !proibidas.has(t.id) && !escolhidas.has(t.id));
    if (!livre) return;
    dependenciasEditadas.push({ id: livre.id, folga: 0 });
    renderDependenciasEditor(dependenciasEditadas.length - 1);
  });
  document.execCommand('styleWithCSS', false, false);
  for (const botao of document.querySelectorAll('[data-comando]')) {
    botao.addEventListener('mousedown', (ev) => ev.preventDefault());
    botao.addEventListener('click', () => {
      $('#f-notas').focus();
      document.execCommand(botao.dataset.comando, false, null);
    });
  }
  $('#f-notas').addEventListener('paste', (ev) => {
    ev.preventDefault();
    document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
  });
  $('#f-notas').addEventListener('drop', (ev) => ev.preventDefault());
  $('#f-notas').addEventListener('input', () => limparErro('notas'));
  $('#btn-item-checklist').addEventListener('click', () => {
    checklistEditado.push({ texto: '', feito: false });
    renderChecklistEditor(checklistEditado.length - 1);
    limparErro('checklist');
  });
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
