const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/cronograma.js');

const HOJE = '2026-10-08';

function tarefa(campos) {
  return { id: 't', nome: 'X', fase: '', responsavel: '', inicio: HOJE, fim: HOJE, progresso: 0, notas: '', ...campos };
}

test('diaNumero rejeita datas inexistentes e formatos inválidos', () => {
  assert.ok(Number.isNaN(C.diaNumero('2026-02-30')));
  assert.ok(Number.isNaN(C.diaNumero('08/10/2026')));
  assert.ok(Number.isNaN(C.diaNumero('')));
  assert.ok(Number.isNaN(C.diaNumero(undefined)));
});

test('diaNumero e isoDeDia fazem ida e volta atravessando ano bissexto', () => {
  const d = C.diaNumero('2028-02-28');
  assert.equal(C.isoDeDia(d + 1), '2028-02-29');
  assert.equal(C.isoDeDia(d + 2), '2028-03-01');
});

test('duracaoDias conta início e fim inclusive', () => {
  assert.equal(C.duracaoDias(tarefa({ inicio: '2026-10-01', fim: '2026-10-01' })), 1);
  assert.equal(C.duracaoDias(tarefa({ inicio: '2026-12-30', fim: '2027-01-02' })), 4);
});

test('statusTarefa deriva o status do progresso e das datas', () => {
  assert.equal(C.statusTarefa(tarefa({ inicio: '2026-01-01', fim: '2026-01-02', progresso: 100 }), HOJE), 'concluida');
  assert.equal(C.statusTarefa(tarefa({ inicio: '2026-10-01', fim: '2026-10-07', progresso: 90 }), HOJE), 'atrasada');
  assert.equal(C.statusTarefa(tarefa({ inicio: '2026-10-08', fim: '2026-10-20', progresso: 0 }), HOJE), 'andamento');
  assert.equal(C.statusTarefa(tarefa({ inicio: '2026-10-01', fim: '2026-10-08', progresso: 10 }), HOJE), 'andamento');
  assert.equal(C.statusTarefa(tarefa({ inicio: '2026-10-09', fim: '2026-10-20', progresso: 0 }), HOJE), 'pendente');
});

test('validarTarefa aponta cada campo inválido', () => {
  const r = C.validarTarefa({ nome: '   ', inicio: '2026-10-10', fim: '2026-10-09', progresso: 150 });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.erros).sort(), ['fim', 'nome', 'progresso']);

  const semData = C.validarTarefa({ nome: 'A', inicio: '', fim: '2026-13-01', progresso: 0 });
  assert.deepEqual(Object.keys(semData.erros).sort(), ['fim', 'inicio']);
});

test('validarTarefa normaliza texto e progresso de uma tarefa válida', () => {
  const r = C.validarTarefa({ nome: '  Fundação ', fase: ' Obra ', responsavel: ' Ana ', inicio: '2026-10-01', fim: '2026-10-05', progresso: '42.6', notas: 'n' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.tarefa, { nome: 'Fundação', fase: 'Obra', responsavel: 'Ana', inicio: '2026-10-01', fim: '2026-10-05', progresso: 43, notas: 'n', checklist: [] });
});

test('ordenarTarefas ordena por início, depois fim, depois nome, sem alterar a entrada', () => {
  const entrada = [
    tarefa({ id: 'c', nome: 'B', inicio: '2026-10-02', fim: '2026-10-05' }),
    tarefa({ id: 'b', nome: 'A', inicio: '2026-10-02', fim: '2026-10-05' }),
    tarefa({ id: 'a', nome: 'Z', inicio: '2026-10-02', fim: '2026-10-03' }),
    tarefa({ id: 'd', nome: 'A', inicio: '2026-10-01', fim: '2026-10-09' }),
  ];
  assert.deepEqual(C.ordenarTarefas(entrada).map((t) => t.id), ['d', 'a', 'b', 'c']);
  assert.equal(entrada[0].id, 'c');
});

test('filtrarTarefas combina busca sem acento/caixa, fase e status', () => {
  const lista = [
    tarefa({ id: '1', nome: 'Reunião inicial', fase: 'Planejamento', inicio: '2026-10-01', fim: '2026-10-02', progresso: 100 }),
    tarefa({ id: '2', nome: 'Orçamento', fase: 'Planejamento', responsavel: 'João', inicio: '2026-10-01', fim: '2026-10-03' }),
    tarefa({ id: '3', nome: 'Pintura', fase: 'Execução', notas: 'reuniao com fornecedor', inicio: '2026-11-01', fim: '2026-11-03' }),
  ];
  assert.deepEqual(C.filtrarTarefas(lista, { texto: 'REUNIAO' }, HOJE).map((t) => t.id), ['1', '3']);
  assert.deepEqual(C.filtrarTarefas(lista, { texto: 'joao' }, HOJE).map((t) => t.id), ['2']);
  assert.deepEqual(C.filtrarTarefas(lista, { fase: 'Planejamento', status: 'atrasada' }, HOJE).map((t) => t.id), ['2']);
  assert.deepEqual(C.filtrarTarefas(lista, {}, HOJE).map((t) => t.id), ['1', '2', '3']);
});

test('resumo pondera o progresso geral pela duração e conta status', () => {
  const lista = [
    tarefa({ inicio: '2026-10-01', fim: '2026-10-01', progresso: 100 }),
    tarefa({ inicio: '2026-10-10', fim: '2026-10-12', progresso: 0 }),
  ];
  const r = C.resumo(lista, HOJE);
  assert.equal(r.total, 2);
  assert.equal(r.concluidas, 1);
  assert.equal(r.pendentes, 1);
  assert.equal(r.progressoGeral, 25);
  assert.equal(r.inicio, '2026-10-01');
  assert.equal(r.fim, '2026-10-12');
  assert.equal(r.dias, 12);
});

test('resumo de lista vazia não tem período', () => {
  const r = C.resumo([], HOJE);
  assert.equal(r.total, 0);
  assert.equal(r.progressoGeral, 0);
  assert.equal(r.inicio, null);
});

test('escalaGantt posiciona barras em pixels a partir do primeiro dia exibido', () => {
  const lista = [
    tarefa({ id: 'a', inicio: '2026-10-05', fim: '2026-10-06' }),
    tarefa({ id: 'b', inicio: '2026-10-10', fim: '2026-10-10' }),
  ];
  const e = C.escalaGantt(lista, 'dia', HOJE);
  const pxDia = e.pxDia;
  const deslocA = C.diaNumero('2026-10-05') - e.inicioDia;
  assert.ok(deslocA >= 1, 'há folga antes da primeira tarefa');
  assert.deepEqual(e.barras.a, { left: deslocA * pxDia, width: 2 * pxDia });
  assert.equal(e.barras.b.left - e.barras.a.left, 5 * pxDia);
  assert.equal(e.hojeLeft, (C.diaNumero(HOJE) - e.inicioDia) * pxDia);
  assert.equal(e.larguraTotal, e.totalDias * pxDia);
});

test('escalaGantt cobre os meses exibidos sem lacunas e com rótulo em português', () => {
  const lista = [tarefa({ id: 'a', inicio: '2026-10-20', fim: '2026-11-10' })];
  const e = C.escalaGantt(lista, 'semana', HOJE);
  assert.ok(e.meses.some((m) => /out/i.test(m.rotulo)));
  assert.ok(e.meses.some((m) => /nov/i.test(m.rotulo)));
  assert.equal(e.meses[0].left, 0);
  for (let i = 1; i < e.meses.length; i++) {
    assert.equal(e.meses[i].left, e.meses[i - 1].left + e.meses[i - 1].width);
  }
  const ultimo = e.meses[e.meses.length - 1];
  assert.equal(ultimo.left + ultimo.width, e.larguraTotal);
});

test('escalaGantt amplia o zoom de mês para dia', () => {
  const lista = [tarefa({ id: 'a', inicio: '2026-10-01', fim: '2026-10-31' })];
  assert.ok(C.escalaGantt(lista, 'dia', HOJE).pxDia > C.escalaGantt(lista, 'semana', HOJE).pxDia);
  assert.ok(C.escalaGantt(lista, 'semana', HOJE).pxDia > C.escalaGantt(lista, 'mes', HOJE).pxDia);
});

test('escalaGantt omite a linha de hoje quando hoje está fora do período', () => {
  const lista = [tarefa({ id: 'a', inicio: '2030-01-10', fim: '2030-01-20' })];
  assert.equal(C.escalaGantt(lista, 'dia', HOJE).hojeLeft, null);
});

test('paraCSV usa ponto e vírgula, datas brasileiras, aspas e neutraliza fórmulas', () => {
  const csv = C.paraCSV([
    tarefa({ nome: 'Compra; "urgente"', inicio: '2026-10-01', fim: '2026-10-03', progresso: 50 }),
    tarefa({ nome: '=HYPERLINK("x")', inicio: '2026-10-01', fim: '2026-10-01' }),
  ], HOJE);
  const linhas = csv.replace(/^﻿/, '').split('\r\n');
  assert.ok(csv.startsWith('﻿'), 'BOM para o Excel reconhecer UTF-8');
  assert.match(linhas[0], /^Atividade;Fase;Responsável;Início;Fim;Duração \(dias\);Progresso \(%\);Status;Notas;Checklist$/);
  assert.equal(linhas[1], '"Compra; ""urgente""";;;01/10/2026;03/10/2026;3;50;Atrasada;;');
  assert.ok(linhas[2].startsWith('"\'=HYPERLINK(""x"")"'));
});

test('importarDados aceita arquivo exportado e completa ids ausentes', () => {
  const r = C.importarDados(JSON.stringify({ titulo: 'Obra', tarefas: [{ nome: 'A', inicio: '2026-10-01', fim: '2026-10-02', progresso: 10 }] }));
  assert.equal(r.ok, true);
  assert.equal(r.dados.titulo, 'Obra');
  assert.equal(r.dados.tarefas.length, 1);
  assert.equal(typeof r.dados.tarefas[0].id, 'string');
  assert.ok(r.dados.tarefas[0].id.length > 0);
});

test('importarDados recusa JSON inválido e tarefa inválida dizendo qual', () => {
  assert.equal(C.importarDados('{').ok, false);
  assert.equal(C.importarDados('{"tarefas": 3}').ok, false);
  const r = C.importarDados(JSON.stringify({ tarefas: [{ nome: 'A', inicio: '2026-10-01', fim: '2026-10-02' }, { nome: '', inicio: 'x', fim: 'y' }] }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /2/);
});

test('importarDados gera ids distintos quando o arquivo repete id', () => {
  const r = C.importarDados(JSON.stringify({ tarefas: [
    { id: 'a', nome: 'A', inicio: '2026-10-01', fim: '2026-10-02' },
    { id: 'a', nome: 'B', inicio: '2026-10-01', fim: '2026-10-02' },
  ] }));
  assert.equal(r.ok, true);
  assert.notEqual(r.dados.tarefas[0].id, r.dados.tarefas[1].id);
});

test('indicesDeCor dá a cada fase um índice estável pela ordem alfabética', () => {
  const lista = [tarefa({ fase: 'Execução' }), tarefa({ fase: 'Análise' }), tarefa({ fase: 'Execução' }), tarefa({ fase: '' })];
  const m = C.indicesDeCor(lista);
  assert.equal(m.get('Análise'), 0);
  assert.equal(m.get('Execução'), 1);
  assert.equal(m.has(''), false);
});

test('formatarData converte ISO para dd/mm/aaaa', () => {
  assert.equal(C.formatarData('2026-01-09'), '09/01/2026');
});

test('diaNumero aceita só anos de 1900 a 2199, barrando anos intermediários da digitação', () => {
  assert.ok(Number.isNaN(C.diaNumero('0202-10-08')));
  assert.ok(Number.isNaN(C.diaNumero('1899-12-31')));
  assert.ok(Number.isNaN(C.diaNumero('2200-01-01')));
  assert.ok(Number.isFinite(C.diaNumero('1900-01-01')));
  assert.ok(Number.isFinite(C.diaNumero('2199-12-31')));
  assert.equal(C.validarTarefa({ nome: 'A', inicio: '0202-10-08', fim: '2026-10-14' }).ok, false);
});

test('resumo só mostra 100% quando todo o trabalho está concluído', () => {
  const lista = [
    tarefa({ inicio: '2026-01-01', fim: '2026-12-31', progresso: 100 }),
    tarefa({ inicio: '2027-01-01', fim: '2027-01-01', progresso: 0 }),
  ];
  assert.equal(C.resumo(lista, HOJE).progressoGeral, 99);
});

test('escalaGantt troca para escala mais grossa quando o período é longo demais', () => {
  const curta = [tarefa({ id: 'a', inicio: '2026-10-01', fim: '2027-06-30' })];
  const anos = [tarefa({ id: 'a', inicio: '2026-01-01', fim: '2030-12-31' })];
  const decadas = [tarefa({ id: 'a', inicio: '2026-01-01', fim: '2060-12-31' })];
  assert.equal(C.escalaGantt(curta, 'dia', HOJE).zoom, 'dia');
  assert.equal(C.escalaGantt(anos, 'dia', HOJE).zoom, 'semana');
  assert.equal(C.escalaGantt(decadas, 'dia', HOJE).zoom, 'mes');
  assert.equal(C.escalaGantt(decadas, 'semana', HOJE).zoom, 'mes');
  assert.equal(C.escalaGantt(anos, 'mes', HOJE).zoom, 'mes');
  assert.equal(C.escalaGantt(decadas, 'dia', HOJE).marcas.length, 0);
  assert.equal(C.zoomEfetivo(curta, 'dia'), 'dia');
  assert.equal(C.zoomEfetivo(anos, 'dia'), 'semana');
  assert.equal(C.zoomEfetivo(anos, 'semana'), 'semana');
  assert.equal(C.zoomEfetivo([], 'dia'), 'dia');
});

test('iniciais usa a primeira letra do primeiro e do último nome', () => {
  assert.equal(C.iniciais('Ana Souza'), 'AS');
  assert.equal(C.iniciais('  joão da silva  '), 'JS');
  assert.equal(C.iniciais('Bruno'), 'B');
  assert.equal(C.iniciais('élida'), 'É');
  assert.equal(C.iniciais(''), '');
});

test('validarTarefa normaliza o checklist e descarta itens vazios', () => {
  const r = C.validarTarefa({ nome: 'A', inicio: HOJE, fim: HOJE, checklist: [
    { texto: '  Comprar cimento ', feito: true },
    { texto: '   ', feito: false },
    { texto: 'Contratar pedreiro', feito: 'sim' },
    'lixo',
  ] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.tarefa.checklist, [{ texto: 'Comprar cimento', feito: true }, { texto: 'Contratar pedreiro', feito: false }]);
  assert.deepEqual(C.validarTarefa({ nome: 'A', inicio: HOJE, fim: HOJE }).tarefa.checklist, []);
});

test('validarTarefa limita checklist e notas', () => {
  const muitos = Array.from({ length: 201 }, (_, i) => ({ texto: `item ${i}`, feito: false }));
  assert.ok(C.validarTarefa({ nome: 'A', inicio: HOJE, fim: HOJE, checklist: muitos }).erros.checklist);
  assert.ok(C.validarTarefa({ nome: 'A', inicio: HOJE, fim: HOJE, notas: 'x'.repeat(20001) }).erros.notas);
});

test('notasEmTexto tira a formatação e mantém quebras e marcadores', () => {
  assert.equal(C.notasEmTexto('<b>Atenção</b>: <i>urgente</i><ul><li>um</li><li>dois &amp; três</li></ul>fim'), 'Atenção: urgente\n• um\n• dois & três\nfim');
  assert.equal(C.notasEmTexto('linha 1<br>linha 2<div>linha 3</div>'), 'linha 1\nlinha 2\nlinha 3');
  assert.equal(C.notasEmTexto('a < b e c > d'), 'a < b e c > d');
  assert.equal(C.notasEmTexto(''), '');
});

test('busca encontra texto das notas formatadas e do checklist, não as marcações', () => {
  const lista = [
    tarefa({ id: '1', notas: '<b>reunião</b> com cliente' }),
    tarefa({ id: '2', checklist: [{ texto: 'Pintar fachada', feito: false }] }),
  ];
  assert.deepEqual(C.filtrarTarefas(lista, { texto: 'reuniao com' }, HOJE).map((t) => t.id), ['1']);
  assert.deepEqual(C.filtrarTarefas(lista, { texto: 'fachada' }, HOJE).map((t) => t.id), ['2']);
  assert.deepEqual(C.filtrarTarefas(lista, { texto: '<b>' }, HOJE).map((t) => t.id), []);
});

test('resumoChecklist conta itens feitos', () => {
  assert.deepEqual(C.resumoChecklist([{ texto: 'a', feito: true }, { texto: 'b', feito: false }]), { feitos: 1, total: 2 });
  assert.deepEqual(C.resumoChecklist(undefined), { feitos: 0, total: 0 });
});

test('paraCSV exporta notas sem marcações e o checklist legível', () => {
  const csv = C.paraCSV([tarefa({ nome: 'A', notas: '<b>Olá</b>', checklist: [{ texto: 'um', feito: true }, { texto: 'dois', feito: false }] })], HOJE);
  const linha = csv.replace(/^﻿/, '').split('\r\n')[1];
  assert.ok(linha.endsWith(';Olá;[x] um | [ ] dois'), linha);
});
