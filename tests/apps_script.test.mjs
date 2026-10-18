// Testes do backend (apps-script/Codigo.gs) rodando no Node com uma planilha falsa em memória.
// Rodar: node --test tests/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const codigo = readFileSync(new URL('../apps-script/Codigo.gs', import.meta.url), 'utf8');

// ---------------------------------------------------------------- dublês do Apps Script

function criarAba(nome) {
  const linhas = [];
  return {
    nome,
    linhas,
    getLastRow: () => linhas.length,
    getLastColumn: () => linhas.reduce((m, l) => Math.max(m, l.length), 0),
    appendRow: (l) => { linhas.push([...l]); },
    getRange(a, b, nr = 1, nc = 1) {
      if (typeof a === 'string') return rangeNulo();
      return {
        getValues: () => Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => (linhas[a - 1 + i] || [])[b - 1 + j] ?? '')),
        setValues: (v) => {
          v.forEach((l, i) => {
            linhas[a - 1 + i] = linhas[a - 1 + i] || [];
            l.forEach((x, j) => { linhas[a - 1 + i][b - 1 + j] = x; });
          });
          return this;
        },
        setFormulaR1C1: () => {},
        setValue: () => {},
        setFontWeight() { return this; },
        setBackground() { return this; },
        setNumberFormat() { return this; }
      };
    }
  };
}

function rangeNulo() {
  const r = { setDataValidation: () => r, setNumberFormat: () => r };
  return r;
}

function montarAmbiente() {
  const abas = {};
  const planilha = {
    getSheetByName: (n) => abas[n] || null,
    insertSheet: (n) => (abas[n] = criarAba(n)),
    getId: () => 'planilha-teste',
    getUrl: () => 'https://docs.google.com/planilha-teste'
  };
  const cache = new Map();
  const emails = [];
  const ctx = {
    console: { error: () => {}, log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => planilha, openById: () => planilha },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    CacheService: {
      getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (d, _tz, fmt) => fmt
        .replace('yyyy', d.getFullYear())
        .replace('yy', String(d.getFullYear()).slice(2))
        .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
        .replace('dd', String(d.getDate()).padStart(2, '0'))
        .replace('HH', String(d.getHours()).padStart(2, '0'))
        .replace('mm', String(d.getMinutes()).padStart(2, '0'))
    },
    MailApp: { sendEmail: (m) => emails.push(m) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (texto) => ({ getContent: () => texto, setMimeType() { return this; } })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  // const de nível superior não vira propriedade do contexto; expõe o que os testes usam.
  vm.runInContext('globalThis.CABECALHOS = CABECALHOS; globalThis.CATALOGO_INICIAL = CATALOGO_INICIAL;', ctx);

  // Abas mínimas, como configurarPlanilha() deixaria.
  const catalogo = planilha.insertSheet('Catalogo');
  catalogo.appendRow(ctx.CABECALHOS.Catalogo);
  ctx.CATALOGO_INICIAL.forEach((l) => catalogo.appendRow(l));
  catalogo.appendRow(['inativo', false, 99, 'aula', 'Pacote desligado', '', '', '', 1, '', '', '', 0.1]);
  planilha.insertSheet('Reservas').appendRow(ctx.CABECALHOS.Reservas);
  const config = planilha.insertSheet('Config');
  config.appendRow(ctx.CABECALHOS.Config);
  config.appendRow(['EMAIL_NOTIFICACAO', 'samuel@example.com', '']);
  config.appendRow(['LIMITE_PEDIDOS_POR_MINUTO', '20', '']);
  planilha.insertSheet('Parceiros').appendRow(ctx.CABECALHOS.Parceiros);

  return { ctx, abas, emails, cache };
}

function post(ctx, dados) {
  return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(dados) } }).getContent());
}

const pedidoValido = {
  nome: 'Ana Souza',
  whatsapp: '+55 85 98888-7777',
  pacote_id: 'curso-10h',
  data_chegada: '2026-11-10',
  data_saida: '2026-11-17',
  pessoas: 2,
  nivel: 'Nunca velejei',
  mensagem: 'Primeira vez',
  idioma: 'pt',
  origem: 'instagram'
};

let amb;
beforeEach(() => { amb = montarAmbiente(); });

// ---------------------------------------------------------------- testes

test('catálogo devolve só pacotes ativos, em ordem e sem dados internos', () => {
  const r = JSON.parse(amb.ctx.doGet({ parameter: { acao: 'catalogo' } }).getContent());
  assert.equal(r.ok, true);
  assert.equal(r.itens.length, 7);
  assert.equal(r.itens[0].id, 'curso-10h');
  assert.ok(!r.itens.some((i) => i.id === 'inativo'));
  assert.ok(!('comissao_pct' in r.itens[0]));
  assert.ok(!('parceiro_padrao' in r.itens[0]));
});

test('pedido válido é gravado como Novo, com código e aviso por e-mail', () => {
  const r = post(amb.ctx, pedidoValido);
  assert.equal(r.ok, true);
  assert.match(r.id, /^R\d{6}-[A-Z0-9]{4}$/);
  const linhas = amb.abas.Reservas.linhas;
  assert.equal(linhas.length, 2);
  const [, id, status, idioma, nome, whatsapp, , pacoteId, pacoteNome] = linhas[1];
  assert.equal(id, r.id);
  assert.equal(status, 'Novo');
  assert.equal(idioma, 'pt');
  assert.equal(nome, 'Ana Souza');
  assert.equal(whatsapp, "'+5585988887777", 'número com + não pode virar fórmula');
  assert.equal(pacoteId, 'curso-10h');
  assert.equal(pacoteNome, 'Curso de kite 10 h');
  assert.equal(amb.emails.length, 1);
  assert.match(amb.emails[0].body, /wa\.me\/5585988887777/);
});

test('texto que parece fórmula é neutralizado', () => {
  post(amb.ctx, { ...pedidoValido, nome: '=IMPORTXML("http://x")' });
  assert.equal(amb.abas.Reservas.linhas[1][4], '\'=IMPORTXML("http://x")');
});

test('pacote inexistente é recusado', () => {
  const r = post(amb.ctx, { ...pedidoValido, pacote_id: 'nao-existe' });
  assert.deepEqual(r, { ok: false, erro: 'pacote_invalido' });
  assert.equal(amb.abas.Reservas.linhas.length, 1);
});

test('pacote "outro" é aceito', () => {
  const r = post(amb.ctx, { ...pedidoValido, pacote_id: 'outro' });
  assert.equal(r.ok, true);
  assert.equal(amb.abas.Reservas.linhas[1][8], 'Outro / ainda não sei');
});

test('campo isca preenchido não grava nada', () => {
  const r = post(amb.ctx, { ...pedidoValido, site: 'http://spam' });
  assert.deepEqual(r, { ok: true, id: '' });
  assert.equal(amb.abas.Reservas.linhas.length, 1);
});

test('mesmo número em menos de 1 minuto é bloqueado', () => {
  assert.equal(post(amb.ctx, pedidoValido).ok, true);
  assert.deepEqual(post(amb.ctx, pedidoValido), { ok: false, erro: 'pedido_repetido' });
});

test('dados inválidos são recusados', () => {
  assert.equal(post(amb.ctx, { ...pedidoValido, nome: 'A' }).erro, 'nome_invalido');
  assert.equal(post(amb.ctx, { ...pedidoValido, whatsapp: '123' }).erro, 'whatsapp_invalido');
  assert.equal(
    post(amb.ctx, { ...pedidoValido, whatsapp: '85 97777-1111', data_saida: '2026-11-01' }).erro,
    'datas_invalidas'
  );
});

test('nível fora da lista é descartado e pessoas fica entre 1 e 20', () => {
  post(amb.ctx, { ...pedidoValido, nivel: 'hacker', pessoas: 500 });
  const linha = amb.abas.Reservas.linhas[1];
  assert.equal(linha[12], '');
  assert.equal(linha[11], 20);
});
