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

  const SEGUNDA_REFERENCIA = 4;
  const MAX_FERIADOS = 500;
  const MAX_TAREFAS_LINHA_BASE = 5000;
  const cacheFeriados = new WeakMap();

  function normalizarCalendario(calendario) {
    const porData = new Map();
    for (const f of Array.isArray(calendario?.feriados) ? calendario.feriados : []) {
      if (!f || typeof f !== 'object' || Number.isNaN(diaNumero(f.data)) || porData.has(f.data)) continue;
      porData.set(f.data, { data: f.data, nome: texto(f.nome).slice(0, 80) });
    }
    const feriados = [...porData.values()].sort((a, b) => comparar(a.data, b.data)).slice(0, MAX_FERIADOS);
    return { diasUteis: calendario?.diasUteis === true, feriados };
  }

  function diasDeFeriado(calendario) {
    if (!cacheFeriados.has(calendario)) {
      const dias = (calendario.feriados || []).map((f) => diaNumero(f.data)).filter((d) => Number.isFinite(d) && !ehFimDeSemana(d));
      cacheFeriados.set(calendario, { conjunto: new Set(dias), ordenados: [...new Set(dias)].sort((a, b) => a - b) });
    }
    return cacheFeriados.get(calendario);
  }

  function ehFimDeSemana(dia) {
    const semana = diaDaSemana(dia);
    return semana === 0 || semana === 6;
  }

  function usaDiasUteis(calendario) {
    return Boolean(calendario && calendario.diasUteis);
  }

  function diaUtil(dia, calendario) {
    return !usaDiasUteis(calendario) || (!ehFimDeSemana(dia) && !diasDeFeriado(calendario).conjunto.has(dia));
  }

  function ehDiaUtil(iso, calendario) {
    return diaUtil(diaNumero(iso), calendario);
  }

  function diaUtilMaisProximo(dia, calendario, sentido) {
    let atual = dia;
    for (let i = 0; i < 1000 && !diaUtil(atual, calendario); i++) atual += sentido;
    return atual;
  }

  function somarDiasUteis(dia, quantidade, calendario) {
    if (!usaDiasUteis(calendario)) return dia + quantidade;
    const sentido = quantidade < 0 ? -1 : 1;
    let atual = dia;
    for (let i = 0; i < Math.abs(quantidade); i++) atual = diaUtilMaisProximo(atual + sentido, calendario, sentido);
    return atual;
  }

  function contarDiasUteis(inicio, fim, calendario) {
    if (!usaDiasUteis(calendario)) return fim - inicio + 1;
    return indiceUtil(fim + 1, calendario) - indiceUtil(inicio, calendario);
  }

  function indiceUtil(dia, calendario) {
    if (!usaDiasUteis(calendario)) return dia;
    const deslocamento = dia - SEGUNDA_REFERENCIA;
    const semanas = Math.floor(deslocamento / 7);
    const resto = deslocamento - semanas * 7;
    const feriadosAntes = diasDeFeriado(calendario).ordenados.filter((f) => f < dia).length;
    return semanas * 5 + Math.min(resto, 5) - feriadosAntes;
  }

  function duracaoNoCalendario(tarefa, calendario) {
    return contarDiasUteis(diaNumero(tarefa.inicio), diaNumero(tarefa.fim), calendario);
  }

  function normalizarLinhaBase(linha) {
    if (!linha || typeof linha !== 'object' || Number.isNaN(diaNumero(linha.data)) || !Array.isArray(linha.tarefas)) return null;
    const porId = new Map();
    for (const t of linha.tarefas) {
      if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 100 || porId.has(t.id)) continue;
      const inicio = diaNumero(t.inicio);
      const fim = diaNumero(t.fim);
      if (Number.isNaN(inicio) || Number.isNaN(fim) || fim < inicio) continue;
      porId.set(t.id, { id: t.id, inicio: t.inicio, fim: t.fim });
    }
    return { data: linha.data, tarefas: [...porId.values()].slice(0, MAX_TAREFAS_LINHA_BASE) };
  }

  function criarLinhaBase(tarefas, hoje) {
    return { data: hoje, tarefas: tarefas.map((t) => ({ id: t.id, inicio: t.inicio, fim: t.fim })) };
  }

  function desvioLinhaBase(tarefa, linhaBase, calendario) {
    const planejada = linhaBase?.tarefas.find((t) => t.id === tarefa.id);
    if (!planejada) return null;
    return indiceUtil(diaNumero(tarefa.fim) + 1, calendario) - indiceUtil(diaNumero(planejada.fim) + 1, calendario);
  }

  function cargaPorResponsavel(tarefas, calendario) {
    const ocupacao = new Map();
    let primeiro = Infinity;
    let ultimo = -Infinity;
    for (const t of tarefas) {
      if (t.tipo === 'marco') continue;
      const dias = ocupacao.get(t.responsavel) || new Map();
      ocupacao.set(t.responsavel, dias);
      for (let dia = diaNumero(t.inicio); dia <= diaNumero(t.fim); dia++) {
        if (!diaUtil(dia, calendario)) continue;
        if (!dias.has(dia)) dias.set(dia, []);
        dias.get(dia).push(t.id);
      }
      primeiro = Math.min(primeiro, diaNumero(t.inicio));
      ultimo = Math.max(ultimo, diaNumero(t.fim));
    }
    if (!ocupacao.size) return { semanas: [], pessoas: [] };
    const segunda = primeiro - ((diaDaSemana(primeiro) + 6) % 7);
    const semanas = [];
    for (let inicio = segunda; inicio <= ultimo; inicio += 7) semanas.push({ inicio: isoDeDia(inicio), fim: isoDeDia(inicio + 6) });
    const nomes = [...ocupacao.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'pt-BR'));
    const pessoas = nomes.map((nome) => {
      const dias = ocupacao.get(nome);
      const celulas = semanas.map((_, i) => {
        let pico = 0;
        const ids = new Set();
        for (let dia = segunda + i * 7; dia < segunda + i * 7 + 7; dia++) {
          const doDia = dias.get(dia) || [];
          pico = Math.max(pico, doDia.length);
          for (const id of doDia) ids.add(id);
        }
        return { pico, tarefas: [...ids] };
      });
      return { nome, celulas };
    });
    return { semanas, pessoas };
  }

  function posicionarEm(tarefa, inicio, calendario) {
    if (tarefa.tipo === 'marco') return comDatas(tarefa, inicio, inicio);
    if (!usaDiasUteis(calendario)) return comDatas(tarefa, inicio, inicio + duracaoDias(tarefa) - 1);
    const duracao = Math.max(1, duracaoNoCalendario(tarefa, calendario));
    return comDatas(tarefa, inicio, somarDiasUteis(inicio, duracao - 1, calendario));
  }

  function deslocarTarefa(tarefa, dias, calendario) {
    if (!usaDiasUteis(calendario)) return comDatas(tarefa, diaNumero(tarefa.inicio) + dias, diaNumero(tarefa.fim) + dias);
    const inicio = diaUtilMaisProximo(diaNumero(tarefa.inicio) + dias, calendario, dias < 0 ? -1 : 1);
    return posicionarEm(tarefa, inicio, calendario);
  }

  function redimensionarTarefa(tarefa, lado, dias, calendario) {
    if (tarefa.tipo === 'marco') return deslocarTarefa(tarefa, dias, calendario);
    const inicio = diaNumero(tarefa.inicio);
    const fim = diaNumero(tarefa.fim);
    const sentido = dias < 0 ? -1 : 1;
    if (lado === 'inicio') return comDatas(tarefa, Math.min(diaUtilMaisProximo(inicio + dias, calendario, sentido), fim), fim);
    return comDatas(tarefa, inicio, Math.max(diaUtilMaisProximo(fim + dias, calendario, sentido), inicio));
  }

  function feriadosNacionais(ano) {
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mesPascoa = Math.floor((h + l - 7 * m + 114) / 31);
    const diaPascoa = ((h + l - 7 * m + 114) % 31) + 1;
    const pascoa = Date.UTC(ano, mesPascoa - 1, diaPascoa) / MS_DIA;
    const fixo = (mes, dia) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    return [
      { data: fixo(1, 1), nome: 'Confraternização Universal' },
      { data: isoDeDia(pascoa - 2), nome: 'Sexta-feira Santa' },
      { data: fixo(4, 21), nome: 'Tiradentes' },
      { data: fixo(5, 1), nome: 'Dia do Trabalho' },
      { data: fixo(9, 7), nome: 'Independência do Brasil' },
      { data: fixo(10, 12), nome: 'Nossa Senhora Aparecida' },
      { data: fixo(11, 2), nome: 'Finados' },
      { data: fixo(11, 15), nome: 'Proclamação da República' },
      { data: fixo(11, 20), nome: 'Dia Nacional de Zumbi e da Consciência Negra' },
      { data: fixo(12, 25), nome: 'Natal' },
    ].sort((x, y) => comparar(x.data, y.data));
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

  function ordemTopologica(tarefas) {
    const ids = new Set(tarefas.map((t) => t.id));
    const pendentes = new Map(tarefas.map((t) => [t.id, (t.dependencias || []).filter((d) => ids.has(d.id)).length]));
    const seguintes = new Map();
    for (const t of tarefas) for (const d of t.dependencias || []) if (ids.has(d.id)) seguintes.set(d.id, [...(seguintes.get(d.id) || []), t.id]);
    const fila = tarefas.filter((t) => pendentes.get(t.id) === 0).map((t) => t.id);
    const ordem = [];
    while (fila.length) {
      const id = fila.shift();
      ordem.push(id);
      for (const s of seguintes.get(id) || []) {
        pendentes.set(s, pendentes.get(s) - 1);
        if (pendentes.get(s) === 0) fila.push(s);
      }
    }
    return ordem.length === tarefas.length ? { ordem, seguintes } : null;
  }

  function reagendar(tarefas, calendario) {
    const topo = ordemTopologica(tarefas);
    if (!topo) return { tarefas, movidas: [] };
    const porId = new Map(tarefas.map((t) => [t.id, t]));
    const movidas = [];
    for (const id of topo.ordem) {
      const t = porId.get(id);
      const preds = (t.dependencias || []).filter((d) => porId.has(d.id));
      if (!preds.length) continue;
      const maisCedo = Math.max(...preds.map((d) => {
        const depoisDoFim = diaUtilMaisProximo(diaNumero(porId.get(d.id).fim) + 1, calendario, 1);
        return somarDiasUteis(depoisDoFim, d.folga, calendario);
      }));
      if (diaNumero(t.inicio) >= maisCedo) continue;
      const movida = posicionarEm(t, maisCedo, calendario);
      if (movida === t) continue;
      porId.set(id, movida);
      movidas.push(id);
    }
    return { tarefas: tarefas.map((t) => porId.get(t.id)), movidas };
  }

  function caminhoCritico(tarefas, calendario) {
    const topo = ordemTopologica(tarefas);
    if (!topo || !tarefas.length) return new Set();
    const porId = new Map(tarefas.map((t) => [t.id, t]));
    const comeco = new Map();
    const termino = new Map();
    for (const t of tarefas) {
      const inicio = indiceUtil(diaUtilMaisProximo(diaNumero(t.inicio), calendario, 1), calendario);
      const fim = indiceUtil(diaUtilMaisProximo(diaNumero(t.fim), calendario, -1), calendario);
      comeco.set(t.id, inicio);
      termino.set(t.id, Math.max(fim, inicio));
    }
    const fimDoProjeto = Math.max(...termino.values());
    const limite = new Map();
    for (const id of [...topo.ordem].reverse()) {
      let ultimoFim = fimDoProjeto;
      for (const s of topo.seguintes.get(id) || []) {
        const folga = porId.get(s).dependencias.find((d) => d.id === id).folga;
        const ultimoInicioDoSeguinte = limite.get(s) - (termino.get(s) - comeco.get(s));
        ultimoFim = Math.min(ultimoFim, ultimoInicioDoSeguinte - 1 - folga);
      }
      limite.set(id, ultimoFim);
    }
    return new Set(tarefas.filter((t) => limite.get(t.id) - termino.get(t.id) <= 0).map((t) => t.id));
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

  function visaoGeral(empresas, hoje) {
    const tarefas = empresas.flatMap((e) => e.tarefas.map((t) => ({ ...t, id: `${e.id}:${t.id}`, empresa: e.id })));
    const atrasadas = empresas
      .flatMap((empresa) => empresa.tarefas.filter((t) => statusTarefa(t, hoje) === 'atrasada').map((t) => ({ empresa, tarefa: t })))
      .sort((a, b) => comparar(a.tarefa.fim, b.tarefa.fim) || a.empresa.nome.localeCompare(b.empresa.nome, 'pt-BR'));
    return {
      resumo: resumo(tarefas, hoje),
      empresas: empresas.map((e) => ({ id: e.id, nome: e.nome, resumo: resumo(e.tarefas, hoje) })),
      atrasadas,
      tarefas,
    };
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

  function paraCSV(tarefas, hoje, calendario) {
    const cabecalho = ['Atividade', 'Fase', 'Responsável', 'Início', 'Fim', usaDiasUteis(calendario) ? 'Duração (dias úteis)' : 'Duração (dias)', 'Progresso (%)', 'Status', 'Notas', 'Checklist', 'Tipo'];
    const linhas = tarefas.map((t) => [
      t.nome,
      t.fase,
      t.responsavel,
      formatarData(t.inicio),
      formatarData(t.fim),
      duracaoNoCalendario(t, calendario),
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
    return {
      ok: true,
      dados: {
        titulo: texto(bruto.titulo) || 'Meu cronograma',
        tarefas,
        calendario: bruto.calendario === undefined ? null : normalizarCalendario(bruto.calendario),
        linhaBase: normalizarLinhaBase(bruto.linhaBase),
      },
    };
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
    caminhoCritico,
    normalizarCalendario,
    ehDiaUtil,
    duracaoNoCalendario,
    normalizarLinhaBase,
    criarLinhaBase,
    desvioLinhaBase,
    cargaPorResponsavel,
    feriadosNacionais,
    redimensionarTarefa,
    progressoPelaPosicao,
    criarHistorico,
    agruparPorFase,
    moverTarefa,
    moverFase,
    filtrarTarefas,
    resumo,
    visaoGeral,
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
