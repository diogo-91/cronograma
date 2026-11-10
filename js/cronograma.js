const Cronograma = (() => {
  'use strict';

  const MS_DIA = 86400000;
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const PX_POR_DIA = { dia: 36, semana: 14, mes: 5 };
  const FOLGA_DIAS = { dia: 2, semana: 7, mes: 15 };
  const MAX_NOTAS = 20000;
  const MAX_ITENS_CHECKLIST = 200;
  const MAX_TEXTO_ITEM = 300;
  const MAX_DEPENDENCIAS = 50;
  const MAX_FOLGA = 365;
  const MAX_DIAS_ZOOM = { dia: 1100, semana: 7300 };
  const ANO_MINIMO = 1900;
  const ANO_MAXIMO = 2199;
  const ROTULO_STATUS = {
    pendente: 'Não iniciada',
    andamento: 'Em andamento',
    atrasada: 'Atrasada',
    concluida: 'Concluída',
  };

  function diaNumero(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === 'string' ? iso : '');
    if (!m) return NaN;
    const ano = Number(m[1]);
    const mes = Number(m[2]) - 1;
    const dia = Number(m[3]);
    if (ano < ANO_MINIMO || ano > ANO_MAXIMO) return NaN;
    const data = new Date(Date.UTC(ano, mes, dia));
    if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes || data.getUTCDate() !== dia) return NaN;
    return data.getTime() / MS_DIA;
  }

  function isoDeDia(n) {
    return new Date(n * MS_DIA).toISOString().slice(0, 10);
  }

  function hojeISO() {
    const d = new Date();
    const dois = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  }

  function formatarData(iso) {
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  function diaDaSemana(n) {
    return (((n + 4) % 7) + 7) % 7;
  }

  function duracaoDias(tarefa) {
    return diaNumero(tarefa.fim) - diaNumero(tarefa.inicio) + 1;
  }

  function statusTarefa(tarefa, hoje) {
    if (tarefa.progresso >= 100) return 'concluida';
    const h = diaNumero(hoje);
    if (diaNumero(tarefa.fim) < h) return 'atrasada';
    if (diaNumero(tarefa.inicio) <= h) return 'andamento';
    return 'pendente';
  }

  const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

  function notasEmTexto(notas) {
    if (!notas) return '';
    return notas
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(p|div)\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
      .replace(/<\/?(b|strong|i|em|u|ul|ol|span)\b[^>]*>/gi, '')
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, nome) => ENTIDADES[nome])
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function resumoChecklist(itens = []) {
    return { feitos: itens.filter((i) => i.feito).length, total: itens.length };
  }

  function texto(valor) {
    return valor == null ? '' : String(valor).trim();
  }

  function validarTarefa(dados) {
    const tarefa = {
      nome: texto(dados.nome),
      fase: texto(dados.fase),
      responsavel: texto(dados.responsavel),
      inicio: texto(dados.inicio),
      fim: texto(dados.fim),
      progresso: dados.progresso === '' || dados.progresso == null ? 0 : Number(dados.progresso),
      notas: texto(dados.notas),
      checklist: (Array.isArray(dados.checklist) ? dados.checklist : [])
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({ texto: texto(item.texto).slice(0, MAX_TEXTO_ITEM), feito: item.feito === true }))
        .filter((item) => item.texto),
      tipo: dados.tipo === 'marco' ? 'marco' : 'tarefa',
      ordem: Number.isFinite(dados.ordem) ? dados.ordem : null,
      dependencias: normalizarDependencias(dados.dependencias),
    };
    if (tarefa.tipo === 'marco') tarefa.fim = tarefa.inicio;
    const erros = {};
    if (tarefa.notas.length > MAX_NOTAS) erros.notas = 'As notas estão longas demais.';
    if (tarefa.checklist.length > MAX_ITENS_CHECKLIST) erros.checklist = `O checklist pode ter até ${MAX_ITENS_CHECKLIST} itens.`;
    if (!tarefa.nome) erros.nome = 'Informe o nome da atividade.';
    const inicio = diaNumero(tarefa.inicio);
    const fim = diaNumero(tarefa.fim);
    if (Number.isNaN(inicio)) erros.inicio = 'Informe uma data de início válida.';
    if (Number.isNaN(fim)) erros.fim = 'Informe uma data de término válida.';
    else if (fim < inicio) erros.fim = 'O término não pode ser antes do início.';
    if (!Number.isFinite(tarefa.progresso) || tarefa.progresso < 0 || tarefa.progresso > 100) {
      erros.progresso = 'O progresso deve ficar entre 0 e 100.';
    } else {
      tarefa.progresso = Math.round(tarefa.progresso);
    }
    return { ok: Object.keys(erros).length === 0, erros, tarefa };
  }

  function comparar(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function comDatas(tarefa, inicio, fim) {
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return tarefa;
    const novoInicio = isoDeDia(inicio);
    const novoFim = isoDeDia(fim);
    if (Number.isNaN(diaNumero(novoInicio)) || Number.isNaN(diaNumero(novoFim))) return tarefa;
    return { ...tarefa, inicio: novoInicio, fim: novoFim };
  }

  function deslocarTarefa(tarefa, dias) {
    return comDatas(tarefa, diaNumero(tarefa.inicio) + dias, diaNumero(tarefa.fim) + dias);
  }

  function redimensionarTarefa(tarefa, lado, dias) {
    if (tarefa.tipo === 'marco') return deslocarTarefa(tarefa, dias);
    const inicio = diaNumero(tarefa.inicio);
    const fim = diaNumero(tarefa.fim);
    return lado === 'inicio' ? comDatas(tarefa, Math.min(inicio + dias, fim), fim) : comDatas(tarefa, inicio, Math.max(fim + dias, inicio));
  }

  function progressoPelaPosicao(posicao, largura) {
    const bruto = (posicao / largura) * 100;
    return Math.min(100, Math.max(0, Math.round(bruto / 5) * 5));
  }

  function criarHistorico(limite) {
    let anteriores = [];
    let posteriores = [];
    return {
      registrar(estado) {
        anteriores = [...anteriores, estado].slice(-limite);
        posteriores = [];
      },
      desfazer(atual) {
        if (!anteriores.length) return null;
        posteriores = [...posteriores, atual];
        return anteriores.pop();
      },
      refazer(atual) {
        if (!posteriores.length) return null;
        anteriores = [...anteriores, atual].slice(-limite);
        return posteriores.pop();
      },
      disponivel: () => ({ desfazer: anteriores.length > 0, refazer: posteriores.length > 0 }),
      limpar() {
        anteriores = [];
        posteriores = [];
      },
    };
  }

  function normalizarDependencias(lista) {
    const vistos = new Set();
    const saida = [];
    for (const d of Array.isArray(lista) ? lista : []) {
      if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id || vistos.has(d.id)) continue;
      vistos.add(d.id);
      const folga = Math.round(Number(d.folga) || 0);
      saida.push({ id: d.id.slice(0, 64), folga: Math.max(-MAX_FOLGA, Math.min(MAX_FOLGA, folga)) });
    }
    return saida.slice(0, MAX_DEPENDENCIAS);
  }

  function encontrarCiclo(tarefas) {
    const porId = new Map(tarefas.map((t) => [t.id, t]));
    const situacao = new Map();
    const caminho = [];
    const visitar = (id) => {
      situacao.set(id, 'visitando');
      caminho.push(id);
      for (const d of porId.get(id).dependencias || []) {
        if (!porId.has(d.id)) continue;
        if (situacao.get(d.id) === 'visitando') return [...caminho.slice(caminho.indexOf(d.id)), d.id];
        if (!situacao.has(d.id)) {
          const ciclo = visitar(d.id);
          if (ciclo) return ciclo;
        }
      }
      situacao.set(id, 'feito');
      caminho.pop();
      return null;
    };
    for (const t of tarefas) {
      if (situacao.has(t.id)) continue;
      const ciclo = visitar(t.id);
      if (ciclo) return ciclo.map((id) => porId.get(id).nome);
    }
    return null;
  }

  function sucessoresDe(tarefas, id) {
    const seguintes = new Map();
    for (const t of tarefas) {
      for (const d of t.dependencias || []) {
        if (!seguintes.has(d.id)) seguintes.set(d.id, []);
        seguintes.get(d.id).push(t.id);
      }
    }
    const achados = new Set();
    const fila = [...(seguintes.get(id) || [])];
    while (fila.length) {
      const atual = fila.shift();
      if (achados.has(atual) || atual === id) continue;
      achados.add(atual);
      fila.push(...(seguintes.get(atual) || []));
    }
    return achados;
  }

  function reagendar(tarefas) {
    const porId = new Map(tarefas.map((t) => [t.id, t]));
    const pendentes = new Map(tarefas.map((t) => [t.id, (t.dependencias || []).filter((d) => porId.has(d.id)).length]));
    const seguintes = new Map();
    for (const t of tarefas) for (const d of t.dependencias || []) if (porId.has(d.id)) seguintes.set(d.id, [...(seguintes.get(d.id) || []), t.id]);
    const fila = tarefas.filter((t) => pendentes.get(t.id) === 0).map((t) => t.id);
    const movidas = [];
    let processadas = 0;
    while (fila.length) {
      const id = fila.shift();
      processadas += 1;
      const t = porId.get(id);
      const preds = (t.dependencias || []).filter((d) => porId.has(d.id));
      if (preds.length) {
        const maisCedo = Math.max(...preds.map((d) => diaNumero(porId.get(d.id).fim) + 1 + d.folga));
        const inicio = diaNumero(t.inicio);
        if (inicio < maisCedo) {
          const movida = deslocarTarefa(t, maisCedo - inicio);
          if (movida !== t) {
            porId.set(id, movida);
            movidas.push(id);
          }
        }
      }
      for (const s of seguintes.get(id) || []) {
        pendentes.set(s, pendentes.get(s) - 1);
        if (pendentes.get(s) === 0) fila.push(s);
      }
    }
    if (processadas < tarefas.length) return { tarefas, movidas: [] };
    return { tarefas: tarefas.map((t) => porId.get(t.id)), movidas };
  }

  function compararPorData(a, b) {
    return comparar(a.inicio, b.inicio) || comparar(a.fim, b.fim) || a.nome.localeCompare(b.nome, 'pt-BR');
  }

  function ordenarTarefas(tarefas) {
    const temOrdem = (t) => Number.isFinite(t.ordem);
    return [...tarefas].sort(
      (a, b) => temOrdem(b) - temOrdem(a) || (temOrdem(a) ? a.ordem - b.ordem : 0) || compararPorData(a, b),
    );
  }

  function ordenarPorData(tarefas) {
    return [...tarefas].sort(compararPorData).map((t, i) => ({ ...t, ordem: i }));
  }

  function agruparPorFase(tarefas, hoje) {
    const porFase = new Map();
    for (const t of ordenarTarefas(tarefas)) {
      if (!porFase.has(t.fase)) porFase.set(t.fase, []);
      porFase.get(t.fase).push(t);
    }
    return [...porFase].map(([fase, lista]) => {
      const r = resumo(lista, hoje);
      return { fase, tarefas: lista, inicio: r.inicio, fim: r.fim, progresso: r.progressoGeral, total: r.total, concluidas: r.concluidas, atrasadas: r.atrasadas };
    });
  }

  function achatar(grupos) {
    return grupos.flatMap((g) => g.tarefas).map((t, i) => ({ ...t, ordem: i }));
  }

  function moverTarefa(tarefas, id, fase, antesDeId) {
    const item = tarefas.find((t) => t.id === id);
    if (!item) return tarefas;
    const ordemDasFases = agruparPorFase(tarefas).map((g) => g.fase);
    const grupos = agruparPorFase(tarefas.filter((t) => t.id !== id)).map((g) => ({ fase: g.fase, tarefas: [...g.tarefas] }));
    let grupo = grupos.find((g) => g.fase === fase);
    if (!grupo) {
      grupo = { fase, tarefas: [] };
      const original = ordemDasFases.indexOf(fase);
      const posicao = original < 0 ? grupos.length : grupos.filter((g) => ordemDasFases.indexOf(g.fase) < original).length;
      grupos.splice(posicao, 0, grupo);
    }
    const posicao = antesDeId ? grupo.tarefas.findIndex((t) => t.id === antesDeId) : -1;
    grupo.tarefas.splice(posicao < 0 ? grupo.tarefas.length : posicao, 0, { ...item, fase });
    return achatar(grupos);
  }

  function moverFase(tarefas, fase, antesDeFase) {
    const grupos = agruparPorFase(tarefas);
    const indice = grupos.findIndex((g) => g.fase === fase);
    if (indice < 0) return tarefas;
    const [grupo] = grupos.splice(indice, 1);
    const posicao = antesDeFase === null ? -1 : grupos.findIndex((g) => g.fase === antesDeFase);
    grupos.splice(posicao < 0 ? grupos.length : posicao, 0, grupo);
    return achatar(grupos);
  }

  function normalizar(valor) {
    return valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  }

  function filtrarTarefas(tarefas, { texto: busca = '', fase = '', status = '' }, hoje) {
    const termo = normalizar(busca);
    return tarefas.filter(
      (t) =>
        (!fase || t.fase === fase) &&
        (!status || statusTarefa(t, hoje) === status) &&
        (!termo || normalizar([t.nome, t.fase, t.responsavel, notasEmTexto(t.notas), ...(t.checklist || []).map((i) => i.texto)].join(' ')).includes(termo)),
    );
  }

  function resumo(tarefas, hoje) {
    const r = { total: tarefas.length, concluidas: 0, andamento: 0, atrasadas: 0, pendentes: 0, progressoGeral: 0, inicio: null, fim: null, dias: 0 };
    if (tarefas.length === 0) return r;
    const chave = { concluida: 'concluidas', andamento: 'andamento', atrasada: 'atrasadas', pendente: 'pendentes' };
    let pesoTotal = 0;
    let feito = 0;
    for (const t of tarefas) {
      r[chave[statusTarefa(t, hoje)]] += 1;
      const peso = duracaoDias(t);
      pesoTotal += peso;
      feito += peso * t.progresso;
      if (!r.inicio || t.inicio < r.inicio) r.inicio = t.inicio;
      if (!r.fim || t.fim > r.fim) r.fim = t.fim;
    }
    r.progressoGeral = Math.floor(feito / pesoTotal);
    r.dias = diaNumero(r.fim) - diaNumero(r.inicio) + 1;
    return r;
  }

  function zoomEfetivo(tarefas, zoomPedido) {
    if (!tarefas.length) return zoomPedido;
    const dias = Math.max(...tarefas.map((t) => diaNumero(t.fim))) - Math.min(...tarefas.map((t) => diaNumero(t.inicio))) + 1;
    let zoom = zoomPedido;
    if (zoom === 'dia' && dias > MAX_DIAS_ZOOM.dia) zoom = 'semana';
    if (zoom === 'semana' && dias > MAX_DIAS_ZOOM.semana) zoom = 'mes';
    return zoom;
  }

  function escalaGantt(tarefas, zoomPedido, hoje) {
    const h = diaNumero(hoje);
    let inicioDia = tarefas.length ? Math.min(...tarefas.map((t) => diaNumero(t.inicio))) : h;
    let fimDia = tarefas.length ? Math.max(...tarefas.map((t) => diaNumero(t.fim))) : h;
    const zoom = zoomEfetivo(tarefas, zoomPedido);
    const pxDia = PX_POR_DIA[zoom];
    const folga = FOLGA_DIAS[zoom];
    inicioDia -= folga;
    fimDia += folga;
    if (zoom === 'semana') {
      inicioDia -= (diaDaSemana(inicioDia) + 6) % 7;
      fimDia += (7 - diaDaSemana(fimDia)) % 7;
    }
    if (zoom === 'mes') {
      inicioDia = diaNumero(isoDeDia(inicioDia).slice(0, 8) + '01');
      const [ano, mes] = isoDeDia(fimDia).split('-').map(Number);
      fimDia = Date.UTC(ano, mes, 0) / MS_DIA;
    }
    const totalDias = fimDia - inicioDia + 1;
    const posicao = (dia) => (dia - inicioDia) * pxDia;

    const meses = [];
    for (let dia = inicioDia; dia <= fimDia; ) {
      const [ano, mes] = isoDeDia(dia).split('-').map(Number);
      const ultimo = Math.min(Date.UTC(ano, mes, 0) / MS_DIA, fimDia);
      meses.push({ rotulo: `${MESES[mes - 1]} ${ano}`, left: posicao(dia), width: (ultimo - dia + 1) * pxDia });
      dia = ultimo + 1;
    }

    const marcas = [];
    if (zoom === 'dia') {
      for (let dia = inicioDia; dia <= fimDia; dia++) {
        const semana = diaDaSemana(dia);
        marcas.push({ rotulo: String(Number(isoDeDia(dia).slice(8))), left: posicao(dia), width: pxDia, fimDeSemana: semana === 0 || semana === 6 });
      }
    } else if (zoom === 'semana') {
      for (let dia = inicioDia; dia <= fimDia; dia += 7) {
        marcas.push({ rotulo: formatarData(isoDeDia(dia)).slice(0, 5), left: posicao(dia), width: 7 * pxDia, fimDeSemana: false });
      }
    }

    const barras = {};
    for (const t of tarefas) {
      barras[t.id] = { left: posicao(diaNumero(t.inicio)), width: duracaoDias(t) * pxDia };
    }

    return {
      zoom,
      pxDia,
      inicioDia,
      totalDias,
      larguraTotal: totalDias * pxDia,
      meses,
      marcas,
      barras,
      hojeLeft: h >= inicioDia && h <= fimDia ? posicao(h) : null,
    };
  }

  function campoCSV(valor) {
    let s = valor == null ? '' : String(valor);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function paraCSV(tarefas, hoje) {
    const cabecalho = ['Atividade', 'Fase', 'Responsável', 'Início', 'Fim', 'Duração (dias)', 'Progresso (%)', 'Status', 'Notas', 'Checklist', 'Tipo'];
    const linhas = tarefas.map((t) => [
      t.nome,
      t.fase,
      t.responsavel,
      formatarData(t.inicio),
      formatarData(t.fim),
      duracaoDias(t),
      t.progresso,
      ROTULO_STATUS[statusTarefa(t, hoje)],
      notasEmTexto(t.notas),
      (t.checklist || []).map((i) => `[${i.feito ? 'x' : ' '}] ${i.texto}`).join(' | '),
      t.tipo === 'marco' ? 'Marco' : 'Atividade',
    ]);
    return '﻿' + [cabecalho, ...linhas].map((l) => l.map(campoCSV).join(';')).join('\r\n');
  }

  function novoId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function importarDados(conteudo) {
    let bruto;
    try {
      bruto = JSON.parse(conteudo);
    } catch {
      return { ok: false, erro: 'O arquivo não é um JSON válido.' };
    }
    if (!bruto || !Array.isArray(bruto.tarefas)) {
      return { ok: false, erro: 'O arquivo não contém uma lista de tarefas.' };
    }
    const ids = new Set();
    const tarefas = [];
    for (let i = 0; i < bruto.tarefas.length; i++) {
      const item = bruto.tarefas[i] && typeof bruto.tarefas[i] === 'object' ? bruto.tarefas[i] : {};
      const r = validarTarefa(item);
      if (!r.ok) return { ok: false, erro: `Tarefa ${i + 1}: ${Object.values(r.erros)[0]}` };
      const id = typeof item.id === 'string' && item.id && !ids.has(item.id) ? item.id : novoId();
      ids.add(id);
      tarefas.push({ id, ...r.tarefa });
    }
    for (const t of tarefas) t.dependencias = t.dependencias.filter((d) => d.id !== t.id && ids.has(d.id));
    const ciclo = encontrarCiclo(tarefas);
    if (ciclo) return { ok: false, erro: `As dependências formam um ciclo: ${ciclo.join(' → ')}.` };
    return { ok: true, dados: { titulo: texto(bruto.titulo) || 'Meu cronograma', tarefas } };
  }

  function iniciais(nome) {
    const partes = nome.trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '';
    const letras = partes.length > 1 ? [partes[0], partes[partes.length - 1]] : [partes[0]];
    return letras.map((p) => p[0].toLocaleUpperCase('pt-BR')).join('');
  }

  function indicesDeCor(tarefas) {
    const fases = [...new Set(tarefas.map((t) => t.fase).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return new Map(fases.map((fase, i) => [fase, i]));
  }

  return {
    ROTULO_STATUS,
    diaNumero,
    isoDeDia,
    hojeISO,
    formatarData,
    duracaoDias,
    statusTarefa,
    validarTarefa,
    ordenarTarefas,
    ordenarPorData,
    deslocarTarefa,
    sucessoresDe,
    reagendar,
    redimensionarTarefa,
    progressoPelaPosicao,
    criarHistorico,
    agruparPorFase,
    moverTarefa,
    moverFase,
    filtrarTarefas,
    resumo,
    zoomEfetivo,
    escalaGantt,
    paraCSV,
    novoId,
    importarDados,
    indicesDeCor,
    iniciais,
    notasEmTexto,
    resumoChecklist,
  };
})();

if (typeof module === 'object' && module.exports) module.exports = Cronograma;
