# Hub Kite Cumbuco

Site de reservas de kite no Cumbuco (CE): curso, aluguel, downwind e transfer com escolas parceiras. O visitante escolhe o pacote, o pedido cai numa planilha do Google e a conversa segue no WhatsApp.

Este é o MVP do plano em [Site Kite & Lifestyle Ceará — Pesquisa e Plano](https://claude.ai/code/artifact/c49bc9fa-38e1-4da9-823f-ddc6fa678286): hub de reservas + serviço B2B, português e inglês, até 5 h por semana e até R$ 500 de custo até janeiro/2027.

## Como funciona

```
Visitante ──▶ Site estático (GitHub Pages, PT e EN)
                 │  formulário
                 ▼
            Apps Script (Web App) ──▶ Planilha: aba Reservas  +  e-mail de aviso
                 │
                 ▼
            Botão "Continuar no WhatsApp" com o pedido já escrito

Planilha (aba Catalogo) ──▶ build diário do site (preços e pacotes atualizados)
```

- **Custo:** zero além do domínio (opcional). GitHub Pages, Apps Script e Sheets são gratuitos.
- **Sem backend configurado** o site já funciona: o formulário só gera a mensagem de WhatsApp.
- **Se o registro na planilha falhar**, o visitante ainda recebe o botão do WhatsApp com a mensagem pronta.

## Estrutura

| Pasta / arquivo | O que tem |
| --- | --- |
| `site.config.json` | Marca, WhatsApp, URL do site, URL do Apps Script, meses da temporada |
| `content/catalogo.json` | Pacotes usados quando a planilha não está configurada |
| `content/textos.pt.json`, `content/textos.en.json` | Todos os textos do site |
| `templates/pagina.html` | Modelo da página (o build gera PT na raiz e EN em `/en/`) |
| `site/assets/` | CSS, JavaScript, ícone e a fonte Archivo (servida pelo próprio site) |
| `scripts/build.py` | Gera o site em `dist/` (só biblioteca padrão do Python) |
| `apps-script/` | Backend: `Codigo.gs` e `appsscript.json` |
| `tests/` | Testes do build (Python) e do backend (Node, com planilha falsa) |
| `.github/workflows/publicar.yml` | Testa, gera e publica no GitHub Pages a cada push e todo dia às 06:00 |

## Colocar no ar (uma noite)

### 1. Planilha e Apps Script

1. Crie uma planilha no Google Sheets, por exemplo **Hub Kite — Operação**.
2. Abra **Extensões → Apps Script**.
3. Apague o conteúdo de `Código.gs` e cole o arquivo `apps-script/Codigo.gs`.
4. Em **Configurações do projeto** (engrenagem), marque **Mostrar arquivo de manifesto "appsscript.json"** e cole o conteúdo de `apps-script/appsscript.json`.
5. Salve, escolha a função `configurarPlanilha` e clique em **Executar**. Autorize o acesso.
   - A planilha ganha as abas **Catalogo, Reservas, Parceiros e Config** e o menu **Hub Kite**.
6. Na aba **Config**, preencha `EMAIL_NOTIFICACAO` com o e-mail que deve receber cada pedido.
7. Clique em **Implantar → Nova implantação → App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
8. Copie a URL que termina em `/exec`. Teste no navegador: `URL?acao=catalogo` deve mostrar os pacotes em JSON.
9. Pelo menu **Hub Kite → Testar um pedido**, confira se uma linha aparece na aba Reservas e se o e-mail chega.

> Depois de mudar o código, use **Implantar → Gerenciar implantações → Editar → Nova versão**. Assim a URL `/exec` continua a mesma.

### 2. Configurar o site

Edite `site.config.json`:

| Campo | Exemplo |
| --- | --- |
| `marca` | Nome que vai aparecer no site |
| `whatsapp` | `5585912345678` (DDI + DDD + número, só dígitos) |
| `url_base` | `https://seu-usuario.github.io/hub-kite-cumbuco` |
| `apps_script_url` | A URL `/exec` do passo anterior |
| `instagram` | URL completa do perfil (vazio = não aparece) |
| `dominio_proprio` | `kitecumbuco.com.br` (vazio = endereço do GitHub) |

Em vez de editar o arquivo, você pode criar **variáveis do repositório** em *Settings → Secrets and variables → Actions → Variables*: `APPS_SCRIPT_URL`, `WHATSAPP` e `URL_BASE`. Elas têm prioridade sobre o arquivo.

### 3. Publicar no GitHub Pages

1. No repositório: *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
2. Faça um push na branch `main` (ou vá em *Actions → Publicar site → Run workflow*).
3. O endereço aparece no resumo da execução e em *Settings → Pages*.

### 4. Domínio próprio (opcional)

1. Registre o domínio (`.com.br` no Registro.br).
2. Preencha `dominio_proprio` e `url_base` em `site.config.json`.
3. No DNS, aponte o domínio para o GitHub Pages conforme a [documentação do GitHub](https://docs.github.com/pt/pages/configuring-a-custom-domain-for-your-github-pages-site).

## Rotina do dia a dia

| Quando | O quê | Onde |
| --- | --- | --- |
| Chega um pedido | Responder no WhatsApp (o e-mail traz o link direto) e mudar o status | Aba **Reservas**, coluna `status` |
| Fechou com a escola | Preencher `parceiro` e `valor_total`; a comissão é calculada sozinha | Aba **Reservas** |
| Preço mudou | Editar o pacote; o site atualiza todo dia às 06:00 | Aba **Catalogo** |
| Quer atualizar agora | *Actions → Publicar site → Run workflow* | GitHub |
| Fim do mês | **Hub Kite → Gerar resumo de comissões** e cobrar cada escola | Aba **Resumo** |
| Novo parceiro | Cadastrar nome, certificação e % de comissão | Aba **Parceiros** |

Status de reserva: `Novo → Em conversa → Confirmado → Pago → Concluído` (ou `Cancelado`). Só `Pago` e `Concluído` entram no resumo de comissões.

A coluna `origem` mostra de onde veio o visitante. Use links com `?utm_source=instagram&utm_medium=bio` nas redes e nos parceiros para saber qual canal traz pedido.

## Antes de divulgar

- [ ] Trocar os preços de referência (pesquisa de out/2026) pelos valores combinados com as escolas
- [ ] Trocar o WhatsApp de exemplo (`5585999999999`)
- [ ] Definir a marca e revisar os textos em `content/`
- [ ] Confirmar a política de remarcação por falta de vento de cada parceiro
- [ ] Listar só parceiros com certificação IKO ou ABK (o site promete isso)
- [ ] Fazer um pedido de teste pelo site publicado, no celular

## Rodar no seu computador

```bash
python scripts/build.py --offline          # gera dist/ com content/catalogo.json
python -m http.server 8000 -d dist         # abra http://localhost:8000
python -m unittest discover -s tests       # testes do build
node --test tests/*.test.mjs               # testes do Apps Script (Node 20+)
```

Sem `--offline`, o build tenta ler o catálogo da planilha (`apps_script_url`) e usa o arquivo local se não conseguir.

## Reaproveitar para clientes B2B

O mesmo motor serve para o site de uma escola ou pousada: copie o repositório, troque `site.config.json`, os textos e o catálogo, e crie uma planilha só dela com o mesmo `Codigo.gs`. Cada cliente fica com o próprio site, planilha e e-mail de aviso.

## Limites conhecidos

- O Apps Script envia uma quantidade limitada de e-mails por dia em contas Gmail comuns; se passar disso, os pedidos continuam sendo gravados, só o aviso deixa de chegar.
- O GitHub desativa agendamentos de repositórios sem atividade por 60 dias. Se o site parar de atualizar os preços sozinho, rode o workflow manualmente.
- O site não recebe pagamento: o pagamento é combinado no WhatsApp (Pix ou link de cartão).
