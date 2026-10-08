const Cronograma = (() => {
  'use strict';

  const MS_DIA = 86400000;
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const PX_POR_DIA = { dia: 36, semana: 14, mes: 5 };
  const FOLGA_DIAS = { dia: 2, semana: 7, mes: 15 };
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
    };
    const erros = {};
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

  function ordenarTarefas(tarefas) {
    return [...tarefas].sort(
      (a, b) => comparar(a.inicio, b.inicio) || comparar(a.fim, b.fim) || a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }

  function normalizar(valor) {
    return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function filtrarTarefas(tarefas, { texto: busca = '', fase = '', status = '' }, hoje) {
    const termo = normalizar(busca);
    return tarefas.filter(
      (t) =>
        (!fase || t.fase === fase) &&
        (!status || statusTarefa(t, hoje) === status) &&
        (!termo || normalizar([t.nome, t.fase, t.responsavel, t.notas].join(' ')).includes(termo)),
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
    r.progressoGeral = Math.round(feito / pesoTotal);
    r.dias = diaNumero(r.fim) - diaNumero(r.inicio) + 1;
    return r;
  }

  function escalaGantt(tarefas, zoom, hoje) {
    const pxDia = PX_POR_DIA[zoom];
    const folga = FOLGA_DIAS[zoom];
    const h = diaNumero(hoje);
    let inicioDia = tarefas.length ? Math.min(...tarefas.map((t) => diaNumero(t.inicio))) : h;
    let fimDia = tarefas.length ? Math.max(...tarefas.map((t) => diaNumero(t.fim))) : h;
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
    const cabecalho = ['Atividade', 'Fase', 'Responsável', 'Início', 'Fim', 'Duração (dias)', 'Progresso (%)', 'Status', 'Notas'];
    const linhas = tarefas.map((t) => [
      t.nome,
      t.fase,
      t.responsavel,
      formatarData(t.inicio),
      formatarData(t.fim),
      duracaoDias(t),
      t.progresso,
      ROTULO_STATUS[statusTarefa(t, hoje)],
      t.notas,
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
    return { ok: true, dados: { titulo: texto(bruto.titulo) || 'Meu cronograma', tarefas } };
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
    filtrarTarefas,
    resumo,
    escalaGantt,
    paraCSV,
    novoId,
    importarDados,
    indicesDeCor,
  };
})();

if (typeof module === 'object' && module.exports) module.exports = Cronograma;
