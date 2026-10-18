/* Hub Kite Cumbuco — comportamento da página
   - Botões "Pedir este pacote" preenchem o formulário.
   - O formulário registra o pedido na planilha (Apps Script) e abre o WhatsApp
     com a mensagem pronta. Se o registro falhar, o WhatsApp continua disponível. */
(function () {
  'use strict';

  const cfgEl = document.getElementById('config-site');
  if (!cfgEl) return;
  const cfg = JSON.parse(cfgEl.textContent);
  const t = cfg.textos;

  const form = document.getElementById('form-reserva');
  const campoPacote = document.getElementById('f-pacote');
  const campoNome = document.getElementById('f-nome');
  const campoWhats = document.getElementById('f-whatsapp');
  const campoChegada = document.getElementById('f-chegada');
  const campoSaida = document.getElementById('f-saida');
  const erroEl = document.getElementById('form-erro');
  const btnEnviar = document.getElementById('btn-enviar');
  const sucesso = document.getElementById('sucesso');

  const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TEMPO_LIMITE_MS = 10000;

  /* ---------- Botões de pacote ---------- */

  document.querySelectorAll('[data-pacote]').forEach(function (botao) {
    botao.addEventListener('click', function () {
      campoPacote.value = botao.getAttribute('data-pacote');
      const secao = document.getElementById('reserva');
      secao.scrollIntoView({ behavior: reduzMovimento ? 'auto' : 'smooth', block: 'start' });
      window.setTimeout(function () { campoNome.focus({ preventScroll: true }); }, reduzMovimento ? 0 : 450);
    });
  });

  /* ---------- Datas ---------- */

  function hojeISO() {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mes + '-' + dia;
  }

  campoChegada.min = hojeISO();
  campoSaida.min = hojeISO();
  campoChegada.addEventListener('change', function () {
    if (campoChegada.value) campoSaida.min = campoChegada.value;
  });

  function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(cfg.idioma === 'pt' ? 'pt-BR' : 'en-GB');
  }

  /* ---------- Origem do visitante (para saber qual canal traz pedido) ---------- */

  function origemVisita() {
    const p = new URLSearchParams(window.location.search);
    const partes = ['utm_source', 'utm_medium', 'utm_campaign']
      .map(function (k) { return p.get(k); })
      .filter(Boolean);
    if (partes.length) return partes.join(' / ');
    try {
      if (document.referrer) return new URL(document.referrer).hostname;
    } catch (e) { /* referrer inválido: ignora */ }
    return 'direto';
  }

  /* ---------- Mensagem de WhatsApp ---------- */

  function mensagemWhatsApp(dados, codigo) {
    const r = t.whatsapp_rotulos;
    const linhas = [t.whatsapp_saudacao, ''];
    if (codigo) linhas.push(r.codigo + ': ' + codigo);
    linhas.push(r.pacote + ': ' + (cfg.pacotes[dados.pacote_id] || dados.pacote_id));
    if (dados.data_chegada || dados.data_saida) {
      linhas.push(r.datas + ': ' + [formatarData(dados.data_chegada), formatarData(dados.data_saida)].filter(Boolean).join(' – '));
    }
    linhas.push(r.pessoas + ': ' + dados.pessoas);
    if (dados.nivel) linhas.push(r.nivel + ': ' + dados.nivel);
    linhas.push(r.nome + ': ' + dados.nome);
    if (dados.mensagem) linhas.push(r.mensagem + ': ' + dados.mensagem);
    return linhas.join('\n');
  }

  function linkWhatsApp(texto) {
    return 'https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent(texto);
  }

  /* ---------- Validação ---------- */

  function marcarInvalido(campo, invalido) {
    if (invalido) campo.setAttribute('aria-invalid', 'true');
    else campo.removeAttribute('aria-invalid');
  }

  function mostrarErro(texto, link) {
    erroEl.textContent = texto;
    if (link) {
      erroEl.appendChild(document.createTextNode(' '));
      const a = document.createElement('a');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = t.sucesso_botao;
      erroEl.appendChild(a);
    }
    erroEl.hidden = false;
  }

  function limparErro() {
    erroEl.hidden = true;
    erroEl.textContent = '';
  }

  function validar(dados) {
    const nomeOk = dados.nome.length >= 2;
    const whatsOk = dados.whatsapp.replace(/\D/g, '').length >= 8;
    const pacoteOk = Boolean(dados.pacote_id);
    marcarInvalido(campoNome, !nomeOk);
    marcarInvalido(campoWhats, !whatsOk);
    marcarInvalido(campoPacote, !pacoteOk);
    if (!nomeOk || !whatsOk || !pacoteOk) {
      mostrarErro(t.erro_campos);
      (!nomeOk ? campoNome : !whatsOk ? campoWhats : campoPacote).focus();
      return false;
    }
    const datasOk = !(dados.data_chegada && dados.data_saida && dados.data_saida < dados.data_chegada);
    marcarInvalido(campoSaida, !datasOk);
    if (!datasOk) {
      mostrarErro(t.erro_datas);
      campoSaida.focus();
      return false;
    }
    return true;
  }

  /* ---------- Envio ---------- */

  function lerFormulario() {
    const f = new FormData(form);
    const valor = function (k) { return String(f.get(k) || '').trim(); };
    return {
      nome: valor('nome'),
      whatsapp: valor('whatsapp'),
      email: valor('email'),
      pacote_id: valor('pacote_id'),
      data_chegada: valor('data_chegada'),
      data_saida: valor('data_saida'),
      pessoas: Math.max(1, Math.min(20, parseInt(valor('pessoas'), 10) || 1)),
      nivel: valor('nivel'),
      mensagem: valor('mensagem'),
      site: valor('site'),
      idioma: cfg.idioma,
      origem: origemVisita()
    };
  }

  async function registrarPedido(dados) {
    if (!cfg.apps_script_url) return null;
    const controle = new AbortController();
    const timer = window.setTimeout(function () { controle.abort(); }, TEMPO_LIMITE_MS);
    try {
      // Corpo em text/plain evita a pré-checagem de CORS do Apps Script.
      const resposta = await fetch(cfg.apps_script_url, {
        method: 'POST',
        body: JSON.stringify(dados),
        signal: controle.signal
      });
      const json = await resposta.json();
      if (!json.ok) throw new Error(json.erro || 'falha');
      return json.id;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function mostrarSucesso(dados, codigo) {
    const link = linkWhatsApp(mensagemWhatsApp(dados, codigo));
    document.getElementById('sucesso-whatsapp').href = link;
    if (codigo) {
      document.getElementById('sucesso-codigo').textContent = codigo;
    } else {
      document.getElementById('sucesso-titulo').textContent = t.sucesso_titulo_whatsapp;
      document.getElementById('sucesso-texto').textContent = t.sucesso_texto_whatsapp;
    }
    form.hidden = true;
    sucesso.hidden = false;
    sucesso.focus();
  }

  form.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    limparErro();
    const dados = lerFormulario();

    // Campo isca preenchido = robô. Não registra nada.
    if (dados.site) return;
    if (!validar(dados)) return;

    btnEnviar.disabled = true;
    btnEnviar.textContent = t.enviando;
    try {
      const codigo = await registrarPedido(dados);
      mostrarSucesso(dados, codigo);
    } catch (erro) {
      mostrarErro(t.erro_envio, linkWhatsApp(mensagemWhatsApp(dados, null)));
    } finally {
      btnEnviar.disabled = false;
      btnEnviar.textContent = t.botao_enviar;
    }
  });
})();
