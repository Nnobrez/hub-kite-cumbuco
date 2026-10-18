/**
 * Hub Kite Cumbuco — backend em Google Apps Script + Google Sheets.
 *
 * O que faz:
 *  - GET  ?acao=catalogo  → devolve os pacotes ativos da aba "Catalogo" (o site usa no build).
 *  - POST (JSON)          → registra um pedido na aba "Reservas", gera um código e avisa por e-mail.
 *  - Menu "Hub Kite" na planilha: configurar abas, gerar resumo de comissões, testar um pedido.
 *
 * Como publicar: veja o README do repositório (seção "Backend: planilha e Apps Script").
 */

// ------------------------------------------------------------------ estrutura

const ABA = {
  CATALOGO: 'Catalogo',
  RESERVAS: 'Reservas',
  PARCEIROS: 'Parceiros',
  CONFIG: 'Config',
  RESUMO: 'Resumo'
};

const CABECALHOS = {
  Catalogo: [
    'id', 'ativo', 'ordem', 'categoria', 'nome_pt', 'nome_en', 'descricao_pt', 'descricao_en',
    'preco_a_partir', 'unidade_pt', 'unidade_en', 'parceiro_padrao', 'comissao_pct'
  ],
  Reservas: [
    'criado_em', 'id', 'status', 'idioma', 'nome', 'whatsapp', 'email', 'pacote_id', 'pacote_nome',
    'data_chegada', 'data_saida', 'pessoas', 'nivel', 'mensagem', 'origem',
    'parceiro', 'valor_total', 'comissao_pct', 'comissao_valor', 'observacoes'
  ],
  Parceiros: [
    'nome', 'tipo', 'contato', 'whatsapp', 'certificacao', 'comissao_pct',
    'status_conversa', 'cliente_b2b', 'mensalidade_b2b', 'observacoes'
  ],
  Config: ['chave', 'valor', 'descricao']
};

// Campos do catálogo que podem sair para o site (comissão e parceiro ficam só na planilha).
const CAMPOS_PUBLICOS_CATALOGO = [
  'id', 'ativo', 'ordem', 'categoria', 'nome_pt', 'nome_en', 'descricao_pt', 'descricao_en',
  'preco_a_partir', 'unidade_pt', 'unidade_en'
];

const STATUS_RESERVA = ['Novo', 'Em conversa', 'Confirmado', 'Pago', 'Concluído', 'Cancelado'];
const STATUS_QUE_GERAM_COMISSAO = ['Pago', 'Concluído'];
const TIPOS_PARCEIRO = ['Escola', 'Pousada', 'Transfer', 'Operador de downwind', 'Outro'];
const STATUS_CONVERSA = ['A contatar', 'Conversando', 'Aceitou comissão', 'Recusou', 'Cliente B2B'];
const NIVEIS = ['Nunca velejei', 'Já fiz algumas aulas', 'Velejo sozinho', 'Faço downwind',
  'Never kited', 'Had a few lessons', 'Ride independently', 'Do downwinders'];

const CONFIG_PADRAO = [
  ['EMAIL_NOTIFICACAO', '', 'E-mail que recebe aviso de cada pedido novo (vazio = sem aviso).'],
  ['NOME_MARCA', 'Hub Kite Cumbuco', 'Nome que aparece no assunto do e-mail.'],
  ['LIMITE_PEDIDOS_POR_MINUTO', '20', 'Trava contra robôs: acima disso, novos pedidos são recusados por 1 minuto.']
];

// Catálogo inicial: os mesmos pacotes de content/catalogo.json no repositório.
// Preços são valores de referência da pesquisa (out/2026). Troque pelos preços combinados com os parceiros.
const CATALOGO_INICIAL = [
  ['curso-10h', true, 1, 'aula', 'Curso de kite 10 h', '10-hour kite course',
    'Do zero à primeira velejada, com instrutor certificado. Kite, barra, prancha, trapézio, capacete e colete inclusos.',
    'From zero to your first ride with a certified instructor. Kite, bar, board, harness, helmet and vest included.',
    2000, 'por pessoa', 'per person', '', 0.12],
  ['aula-avulsa', true, 2, 'aula', 'Aula avulsa', 'Single lesson',
    'Uma hora com instrutor para revisar técnica, aprender a subir contra o vento ou o primeiro salto.',
    'One hour with an instructor to polish technique, learn to ride upwind or try your first jump.',
    200, 'por hora', 'per hour', '', 0.12],
  ['aluguel-dia', true, 3, 'aluguel', 'Aluguel de equipamento', 'Gear rental',
    'Kite, barra e prancha para quem já veleja sozinho. Tamanho do kite escolhido conforme o vento do dia.',
    "Kite, bar and board for independent riders. Kite size picked for the day's wind.",
    350, 'por dia', 'per day', '', 0.10],
  ['downwind-cauipe', true, 4, 'downwind', 'Downwind até a Lagoa do Cauípe', 'Downwinder to Cauípe Lagoon',
    'Cerca de 6 km pelo mar, a favor do vento, com guia. Volta de buggy até a vila.',
    'About 6 km along the coast with the wind, guided. Buggy ride back to the village.',
    '', 'por pessoa', 'per person', '', 0.10],
  ['transfer-aeroporto', true, 5, 'transfer', 'Transfer aeroporto ↔ Cumbuco', 'Airport ↔ Cumbuco transfer',
    'Carro com espaço para a bolsa de kite, do aeroporto de Fortaleza até a pousada.',
    'A car with room for your kite bag, from Fortaleza airport to your guesthouse.',
    '', 'por trecho', 'per trip', '', 0.10],
  ['semana-kite', true, 6, 'pacote', 'Semana de kite', 'Kite week',
    'Pousada perto da praia, curso ou aluguel e transfer, montados para as suas datas.',
    'Guesthouse near the beach, course or rental and transfer, put together for your dates.',
    '', 'por pessoa', 'per person', '', 0.10],
  ['expedicao-downwind', true, 7, 'downwind', 'Expedição downwind para Jericoacoara', 'Downwind expedition to Jericoacoara',
    'De 6 a 10 dias velejando pela costa oeste, com carro de apoio e pousadas no caminho. Para quem já veleja bem.',
    '6 to 10 days riding along the west coast with a support car and guesthouses on the way. For confident riders.',
    '', 'por pessoa', 'per person', '', 0.10]
];

// ------------------------------------------------------------------ menu e configuração

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Hub Kite')
    .addItem('Configurar planilha', 'configurarPlanilha')
    .addItem('Gerar resumo de comissões', 'gerarResumoComissoes')
    .addSeparator()
    .addItem('Testar um pedido', 'testarPedido')
    .addToUi();
}

/** Cria as abas, cabeçalhos, listas suspensas e o catálogo inicial. Pode rodar mais de uma vez. */
function configurarPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', ss.getId());

  Object.keys(CABECALHOS).forEach(function (nome) {
    const aba = ss.getSheetByName(nome) || ss.insertSheet(nome);
    const cab = CABECALHOS[nome];
    aba.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#DCE9EE');
    aba.setFrozenRows(1);
  });

  const catalogo = ss.getSheetByName(ABA.CATALOGO);
  if (catalogo.getLastRow() < 2) {
    catalogo.getRange(2, 1, CATALOGO_INICIAL.length, CATALOGO_INICIAL[0].length).setValues(CATALOGO_INICIAL);
  }
  catalogo.getRange('B2:B').setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().build()
  );
  catalogo.getRange('M2:M').setNumberFormat('0%');
  catalogo.getRange('I2:I').setNumberFormat('#,##0.00');

  const config = ss.getSheetByName(ABA.CONFIG);
  const existentes = config.getLastRow() > 1
    ? config.getRange(2, 1, config.getLastRow() - 1, 1).getValues().map(function (l) { return l[0]; })
    : [];
  CONFIG_PADRAO.forEach(function (linha) {
    if (existentes.indexOf(linha[0]) === -1) config.appendRow(linha);
  });

  const reservas = ss.getSheetByName(ABA.RESERVAS);
  reservas.getRange('C2:C').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS_RESERVA, true).setAllowInvalid(false).build()
  );
  reservas.getRange('P2:P').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getSheetByName(ABA.PARCEIROS).getRange('A2:A'), true)
      .setAllowInvalid(true).build()
  );
  reservas.getRange('A2:A').setNumberFormat('dd/mm/yyyy hh:mm');
  reservas.getRange('Q2:Q').setNumberFormat('#,##0.00');
  reservas.getRange('R2:R').setNumberFormat('0%');
  reservas.getRange('S2:S').setNumberFormat('#,##0.00');

  const parceiros = ss.getSheetByName(ABA.PARCEIROS);
  parceiros.getRange('B2:B').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TIPOS_PARCEIRO, true).build()
  );
  parceiros.getRange('E2:E').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['IKO', 'ABK', 'IKO e ABK', 'Não informada'], true).build()
  );
  parceiros.getRange('F2:F').setNumberFormat('0%');
  parceiros.getRange('G2:G').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS_CONVERSA, true).build()
  );
  parceiros.getRange('H2:H').setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().build()
  );
  parceiros.getRange('I2:I').setNumberFormat('#,##0.00');

  const padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1 && padrao.getLastRow() === 0) ss.deleteSheet(padrao);

  SpreadsheetApp.getActive().toast('Planilha configurada.', 'Hub Kite', 5);
}

function planilha_() {
  const id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function lerConfig_() {
  const aba = planilha_().getSheetByName(ABA.CONFIG);
  const config = {};
  if (!aba || aba.getLastRow() < 2) return config;
  aba.getRange(2, 1, aba.getLastRow() - 1, 2).getValues().forEach(function (linha) {
    if (linha[0]) config[String(linha[0]).trim()] = String(linha[1]).trim();
  });
  return config;
}

// ------------------------------------------------------------------ catálogo (GET)

function doGet(e) {
  const acao = (e && e.parameter && e.parameter.acao) || 'catalogo';
  if (acao === 'ping') return respostaJson_({ ok: true, hora: new Date().toISOString() });
  if (acao === 'catalogo') return respostaJson_({ ok: true, itens: lerCatalogo_() });
  return respostaJson_({ ok: false, erro: 'acao_desconhecida' });
}

function lerCatalogo_() {
  const aba = planilha_().getSheetByName(ABA.CATALOGO);
  if (!aba || aba.getLastRow() < 2) return [];
  const valores = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getValues();
  const cab = valores.shift().map(function (c) { return String(c).trim(); });
  return valores
    .map(function (linha) {
      const item = {};
      CAMPOS_PUBLICOS_CATALOGO.forEach(function (campo) {
        const i = cab.indexOf(campo);
        item[campo] = i === -1 ? '' : linha[i];
      });
      return item;
    })
    .filter(function (item) { return item.id && item.ativo === true; })
    .sort(function (a, b) { return (Number(a.ordem) || 999) - (Number(b.ordem) || 999); });
}

function idsDoCatalogo_() {
  const aba = planilha_().getSheetByName(ABA.CATALOGO);
  if (!aba || aba.getLastRow() < 2) return {};
  const mapa = {};
  aba.getRange(2, 1, aba.getLastRow() - 1, 5).getValues().forEach(function (l) {
    if (l[0]) mapa[String(l[0]).trim()] = String(l[4]).trim();
  });
  return mapa;
}

// ------------------------------------------------------------------ pedidos (POST)

function doPost(e) {
  try {
    const dados = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // Campo isca preenchido = robô. Responde "ok" sem gravar nada.
    if (dados.site) return respostaJson_({ ok: true, id: '' });

    const pedido = validarPedido_(dados);
    if (!pedido.ok) return respostaJson_({ ok: false, erro: pedido.erro });

    const trava = verificarLimites_(pedido.valor.whatsapp);
    if (trava) return respostaJson_({ ok: false, erro: trava });

    const id = gravarPedido_(pedido.valor);
    avisarPorEmail_(id, pedido.valor);
    return respostaJson_({ ok: true, id: id });
  } catch (erro) {
    console.error(erro);
    return respostaJson_({ ok: false, erro: 'erro_interno' });
  }
}

function validarPedido_(d) {
  const texto = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max); };
  const data = function (v) {
    const s = texto(v, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  };

  const pedido = {
    idioma: texto(d.idioma, 2) === 'en' ? 'en' : 'pt',
    nome: texto(d.nome, 80),
    whatsapp: texto(d.whatsapp, 25).replace(/[^\d+]/g, ''),
    email: texto(d.email, 120),
    pacote_id: texto(d.pacote_id, 60),
    data_chegada: data(d.data_chegada),
    data_saida: data(d.data_saida),
    pessoas: Math.max(1, Math.min(20, parseInt(d.pessoas, 10) || 1)),
    nivel: texto(d.nivel, 40),
    mensagem: texto(d.mensagem, 1000),
    origem: texto(d.origem, 120)
  };

  if (pedido.nome.length < 2) return { ok: false, erro: 'nome_invalido' };
  if (pedido.whatsapp.replace(/\D/g, '').length < 8) return { ok: false, erro: 'whatsapp_invalido' };
  if (pedido.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pedido.email)) pedido.email = '';
  if (pedido.data_chegada && pedido.data_saida && pedido.data_saida < pedido.data_chegada) {
    return { ok: false, erro: 'datas_invalidas' };
  }
  if (pedido.nivel && NIVEIS.indexOf(pedido.nivel) === -1) pedido.nivel = '';

  const catalogo = idsDoCatalogo_();
  if (pedido.pacote_id === 'outro') {
    pedido.pacote_nome = 'Outro / ainda não sei';
  } else if (catalogo[pedido.pacote_id]) {
    pedido.pacote_nome = catalogo[pedido.pacote_id];
  } else {
    return { ok: false, erro: 'pacote_invalido' };
  }
  return { ok: true, valor: pedido };
}

/** Bloqueia envio repetido do mesmo número em 1 minuto e excesso geral de pedidos. */
function verificarLimites_(whatsapp) {
  const cache = CacheService.getScriptCache();
  const chaveNumero = 'pedido_' + whatsapp.replace(/\D/g, '');
  if (cache.get(chaveNumero)) return 'pedido_repetido';

  const limite = parseInt(lerConfig_().LIMITE_PEDIDOS_POR_MINUTO, 10) || 20;
  const chaveMinuto = 'total_' + Utilities.formatDate(new Date(), 'America/Fortaleza', 'yyyyMMddHHmm');
  const total = parseInt(cache.get(chaveMinuto) || '0', 10);
  if (total >= limite) return 'muitos_pedidos';

  cache.put(chaveMinuto, String(total + 1), 120);
  cache.put(chaveNumero, '1', 60);
  return '';
}

function gravarPedido_(p) {
  const trava = LockService.getScriptLock();
  trava.waitLock(10000);
  try {
    const aba = planilha_().getSheetByName(ABA.RESERVAS);
    const agora = new Date();
    const id = 'R' + Utilities.formatDate(agora, 'America/Fortaleza', 'yyMMdd') + '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const linha = [
      agora, id, 'Novo', p.idioma, seguro_(p.nome), seguro_(p.whatsapp), seguro_(p.email),
      p.pacote_id, p.pacote_nome, p.data_chegada, p.data_saida, p.pessoas, seguro_(p.nivel),
      seguro_(p.mensagem), seguro_(p.origem), '', '', '', '', ''
    ];
    aba.appendRow(linha);
    const n = aba.getLastRow();
    // comissao_pct: puxa o % do parceiro escolhido; comissao_valor: valor_total × %.
    aba.getRange(n, 18).setFormulaR1C1(
      '=IF(R[0]C[-2]="","",IFERROR(VLOOKUP(R[0]C[-2],Parceiros!C1:C6,6,FALSE),""))'
    );
    aba.getRange(n, 19).setFormulaR1C1(
      '=IF(AND(ISNUMBER(R[0]C[-2]),ISNUMBER(R[0]C[-1])),R[0]C[-2]*R[0]C[-1],"")'
    );
    return id;
  } finally {
    trava.releaseLock();
  }
}

/** Evita que texto digitado no site vire fórmula na planilha (ex.: "+55...", "=IMPORTXML"). */
function seguro_(valor) {
  const s = String(valor == null ? '' : valor);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function avisarPorEmail_(id, p) {
  const config = lerConfig_();
  const destino = config.EMAIL_NOTIFICACAO;
  if (!destino) return;
  const numeroCliente = p.whatsapp.replace(/\D/g, '');
  const linhas = [
    'Novo pedido ' + id,
    '',
    'Pacote: ' + p.pacote_nome,
    'Nome: ' + p.nome,
    'WhatsApp: ' + p.whatsapp + '  →  https://wa.me/' + numeroCliente,
    'E-mail: ' + (p.email || '-'),
    'Datas: ' + (p.data_chegada || '?') + ' a ' + (p.data_saida || '?'),
    'Pessoas: ' + p.pessoas,
    'Nível: ' + (p.nivel || '-'),
    'Idioma do site: ' + p.idioma,
    'Origem: ' + (p.origem || '-'),
    '',
    'Mensagem:',
    p.mensagem || '-',
    '',
    'Planilha: ' + planilha_().getUrl()
  ];
  try {
    MailApp.sendEmail({
      to: destino,
      subject: '[' + (config.NOME_MARCA || 'Hub Kite') + '] ' + p.pacote_nome + ' — ' + p.nome,
      body: linhas.join('\n')
    });
  } catch (erro) {
    console.error('Falha ao enviar e-mail: ' + erro);
  }
}

function respostaJson_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ resumo de comissões

/**
 * Soma, por mês da chegada e por parceiro, as reservas com status "Pago" ou "Concluído".
 * Serve para cobrar a comissão de cada escola no fim do mês.
 */
function gerarResumoComissoes() {
  const ss = planilha_();
  const reservas = ss.getSheetByName(ABA.RESERVAS);
  const linhas = reservas.getLastRow() > 1
    ? reservas.getRange(2, 1, reservas.getLastRow() - 1, CABECALHOS.Reservas.length).getValues()
    : [];
  const col = function (nome) { return CABECALHOS.Reservas.indexOf(nome); };

  const grupos = {};
  linhas.forEach(function (l) {
    if (STATUS_QUE_GERAM_COMISSAO.indexOf(l[col('status')]) === -1) return;
    const base = l[col('data_chegada')] || l[col('criado_em')];
    const data = base instanceof Date ? base : new Date(String(base) + 'T12:00:00');
    const mes = isNaN(data) ? 'sem data' : Utilities.formatDate(data, 'America/Fortaleza', 'yyyy-MM');
    const parceiro = l[col('parceiro')] || '(sem parceiro)';
    const chave = mes + '|' + parceiro;
    if (!grupos[chave]) grupos[chave] = { mes: mes, parceiro: parceiro, reservas: 0, vendido: 0, comissao: 0 };
    grupos[chave].reservas += 1;
    grupos[chave].vendido += Number(l[col('valor_total')]) || 0;
    grupos[chave].comissao += Number(l[col('comissao_valor')]) || 0;
  });

  const saida = Object.keys(grupos).sort().map(function (k) {
    const g = grupos[k];
    return [g.mes, g.parceiro, g.reservas, g.vendido, g.comissao];
  });

  const aba = ss.getSheetByName(ABA.RESUMO) || ss.insertSheet(ABA.RESUMO);
  aba.clear();
  aba.getRange(1, 1, 1, 5)
    .setValues([['mes', 'parceiro', 'reservas', 'valor_vendido', 'comissao_a_receber']])
    .setFontWeight('bold').setBackground('#DCE9EE');
  aba.setFrozenRows(1);
  if (saida.length) {
    aba.getRange(2, 1, saida.length, 5).setValues(saida);
    aba.getRange(2, 4, saida.length, 2).setNumberFormat('#,##0.00');
  }
  aba.getRange(1, 7).setValue('Gerado em ' + Utilities.formatDate(new Date(), 'America/Fortaleza', 'dd/MM/yyyy HH:mm'));
  SpreadsheetApp.getActive().toast(saida.length + ' linhas no resumo.', 'Hub Kite', 5);
}

// ------------------------------------------------------------------ teste manual

/** Simula um pedido vindo do site. Rode pelo menu e confira a aba Reservas. */
function testarPedido() {
  const evento = {
    postData: {
      contents: JSON.stringify({
        nome: 'Teste do Samuel',
        whatsapp: '+55 85 99999-0000',
        pacote_id: 'curso-10h',
        data_chegada: '2026-11-10',
        data_saida: '2026-11-17',
        pessoas: 2,
        nivel: 'Nunca velejei',
        mensagem: 'Pedido de teste — pode apagar.',
        idioma: 'pt',
        origem: 'teste manual'
      })
    }
  };
  const resposta = JSON.parse(doPost(evento).getContent());
  SpreadsheetApp.getActive().toast(JSON.stringify(resposta), 'Resultado do teste', 8);
  return resposta;
}
