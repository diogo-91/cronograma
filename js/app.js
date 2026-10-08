(() => {
  'use strict';

  const C = Cronograma;
  const CHAVE_DADOS = 'cronograma:v1';
  const CHAVE_PREFS = 'cronograma:prefs';
  const CHAVE_RECUPERACAO = 'cronograma:v1:ilegivel';
  const TITULO_PADRAO = 'Meu cronograma';
  const VISOES = ['gantt', 'tabela'];
  const ZOOMS = ['dia', 'semana', 'mes'];
  const NUM_CORES = 8;
  const TAMANHO_MAXIMO_IMPORTACAO = 5 * 1024 * 1024;
  const LARGURA_IMPRESSAO = 960;
  const CAMPOS = ['nome', 'fase', 'responsavel', 'inicio', 'fim', 'progresso', 'notas'];
  const ICONES = {
    duplicar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    excluir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
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
  let ultimoBruto = null;

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
      return true;
    } catch {
      return false;
    }
  }

  function carregar() {
    estado.titulo = TITULO_PADRAO;
    estado.tarefas = [];
    const bruto = ler(CHAVE_DADOS);
    ultimoBruto = bruto;
    if (bruto) {
      const r = C.importarDados(bruto);
      if (r.ok) {
        estado.titulo = r.dados.titulo;
        estado.tarefas = r.dados.tarefas;
      } else {
        gravar(CHAVE_RECUPERACAO, bruto);
        avisar('O cronograma salvo neste navegador está ilegível. Uma cópia foi guardada à parte.', {
          rotulo: 'Baixar cópia',
          executar: () => baixar('cronograma-ilegivel.json', bruto, 'application/json'),
        });
      }
    }
    let prefs = {};
    try {
      prefs = JSON.parse(ler(CHAVE_PREFS)) || {};
    } catch {
      prefs = {};
    }
    if (VISOES.includes(prefs.visao)) estado.visao = prefs.visao;
    if (ZOOMS.includes(prefs.zoom)) estado.zoom = prefs.zoom;
  }

  function salvar() {
    const bruto = JSON.stringify({ versao: 1, titulo: estado.titulo, tarefas: estado.tarefas });
    const ok = gravar(CHAVE_DADOS, bruto);
    if (ok) ultimoBruto = bruto;
    const indicador = $('#salvo');
    indicador.textContent = ok ? 'Salvo neste navegador' : 'Não foi salvo: exporte um backup';
    indicador.classList.toggle('falhou', !ok);
    if (!ok) avisar('O navegador não permitiu salvar. Use Arquivo → Exportar backup para não perder os dados.');
    return ok;
  }

  function sincronizar() {
    if (ler(CHAVE_DADOS) !== ultimoBruto) carregar();
    render();
  }

  function salvarPrefs() {
    gravar(CHAVE_PREFS, JSON.stringify({ visao: estado.visao, zoom: estado.zoom }));
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
    const cartao = (rotulo, valor, classe, ...extras) =>
      el('div', { class: 'cartao' }, el('div', { class: 'cartao-rotulo' }, rotulo), el('div', { class: `cartao-valor ${classe || ''}` }, valor), ...extras);
    const periodo = r.inicio
      ? `${C.formatarData(r.inicio)} a ${C.formatarData(r.fim)} · ${r.dias} ${r.dias === 1 ? 'dia' : 'dias'} corridos`
      : 'Sem atividades';
    $('#resumo').replaceChildren(
      cartao(filtrando ? 'Progresso (filtrado)' : 'Progresso geral', `${r.progressoGeral}%`, '',
        el('div', { class: 'medidor' }, el('span', { style: { width: `${r.progressoGeral}%` } })),
        el('div', { class: 'periodo' }, periodo)),
      cartao('Atividades', String(r.total)),
      cartao('Concluídas', String(r.concluidas), 'concluida'),
      cartao('Em andamento', String(r.andamento), 'andamento'),
      cartao('Atrasadas', String(r.atrasadas), 'atrasada'),
      cartao('Não iniciadas', String(r.pendentes)),
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
          el('h2', {}, 'Seu cronograma está vazio'),
          el('p', {}, 'Cadastre as atividades com datas de início e término e acompanhe tudo no gráfico de Gantt ou em lista. Os dados ficam salvos neste navegador.'),
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
        celula('Responsável', t.responsavel, 'c-resp'),
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
    $('#f-progresso-faixa').value = valores.progresso;
    $('#dialogo-titulo').textContent = tarefa ? 'Editar atividade' : 'Nova atividade';
    $('#btn-excluir').hidden = !tarefa;
    duracaoEditada = C.duracaoDias(valores);
    mostrarErros({});
    atualizarDuracao();
    dialogo.showModal();
    if (!tarefa) form.elements.nome.focus();
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
    const salvou = salvar();
    render();
    focarTarefa(tarefa.id);
    if (!salvou) return;
    const oculta = C.filtrarTarefas([tarefa], estado.filtros, C.hojeISO()).length === 0;
    avisar(oculta ? 'Atividade salva, mas oculta pelos filtros atuais.' : 'Atividade salva.', oculta && { rotulo: 'Limpar filtros', executar: limparFiltros });
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
    const salvou = salvar();
    render();
    focarTarefa(null);
    if (!salvou) return;
    avisar(`"${removida.nome}" excluída.`, {
      rotulo: 'Desfazer',
      executar: () => {
        estado.tarefas.push(removida);
        salvar();
        render();
        focarTarefa(removida.id);
      },
    });
  }

  function duplicar(id) {
    const original = estado.tarefas.find((t) => t.id === id);
    if (!original) return;
    const copia = { ...original, id: C.novoId(), nome: `${original.nome} (cópia)`, progresso: 0 };
    estado.tarefas.push(copia);
    const salvou = salvar();
    render();
    focarTarefa(copia.id);
    if (salvou) avisar('Atividade duplicada.');
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
    const salvou = salvar();
    render();
    return salvou;
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
    const salvou = substituirTudo('Lançamento do site (exemplo)', itens.map(([nome, fase, responsavel, inicio, fim, progresso]) => ({
      id: C.novoId(), nome, fase, responsavel, inicio: C.isoDeDia(hoje + inicio), fim: C.isoDeDia(hoje + fim), progresso, notas: '',
    })));
    if (salvou) avisar('Exemplo carregado. Edite ou apague à vontade.');
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
    if (substituirTudo(r.dados.titulo, r.dados.tarefas)) avisar(`${r.dados.tarefas.length} atividades importadas.`);
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
      if (substituirTudo(TITULO_PADRAO, [])) avisar('Cronograma apagado.');
    },
  };

  $('#titulo').addEventListener('input', (ev) => {
    estado.titulo = ev.target.value;
    document.title = `${estado.titulo.trim() || TITULO_PADRAO} · Cronograma`;
    salvar();
  });
  $('#titulo').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ev.target.blur();
  });
  $('#titulo').addEventListener('blur', () => {
    if (estado.titulo.trim()) return;
    estado.titulo = TITULO_PADRAO;
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

  const menu = $('#menu');
  menu.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-acao]');
    if (!botao) return;
    menu.open = false;
    acoesMenu[botao.dataset.acao]();
  });
  document.addEventListener('click', (ev) => {
    if (menu.open && !menu.contains(ev.target)) menu.open = false;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && menu.open) menu.open = false;
  });
  $('#arquivo').addEventListener('change', importarArquivo);

  form.addEventListener('submit', salvarEditor);
  form.elements.inicio.addEventListener('change', aoMudarInicio);
  form.elements.fim.addEventListener('change', atualizarDuracao);
  $('#f-progresso-faixa').addEventListener('input', (ev) => { form.elements.progresso.value = ev.target.value; });
  form.elements.progresso.addEventListener('input', (ev) => { $('#f-progresso-faixa').value = ev.target.value; });
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

  window.addEventListener('storage', (ev) => {
    if (ev.key === CHAVE_DADOS) sincronizar();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sincronizar();
  });
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) sincronizar();
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

  carregar();
  render();
})();
