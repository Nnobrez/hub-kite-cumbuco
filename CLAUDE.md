# Contexto para o Claude

Projeto paralelo do Samuel (Fortaleza): site de reservas de kite no Cumbuco que gera receita por comissão das escolas parceiras, com um serviço B2B (site + reservas para escolas e pousadas) ao lado.

Plano e pesquisa: https://claude.ai/code/artifact/c49bc9fa-38e1-4da9-823f-ddc6fa678286

## Decisões tomadas (18/10/2026)

- Modelo: B2B + hub de reservas. Comissão de 10–12% sobre aula, aluguel e downwind (hipótese a validar com as escolas).
- Idiomas: português (raiz) e inglês (`/en/`). Espanhol entra em 2027.
- Tempo: até 5 h por semana. Orçamento: até R$ 500 até janeiro/2027, sem anúncios.
- Stack: site estático + Google Apps Script + Google Sheets. Nada de framework, banco ou servidor pago.
- Recorte: Cumbuco, Lagoa do Cauípe e Tabuba primeiro.

## Regras do código

- Tudo em português do Brasil: nomes de variáveis, funções, comentários e textos.
- `scripts/build.py` usa só a biblioteca padrão do Python 3.9+. Não adicionar dependências.
- Textos do site ficam em `content/textos.*.json`, nunca escritos direto no HTML ou no JS.
- Toda chave nova de texto precisa existir nos dois idiomas.
- Preços e pacotes vêm da aba **Catalogo** da planilha; `content/catalogo.json` é só o fallback.
- Comissão e parceiro nunca saem para o site (ver `CAMPOS_PUBLICOS` no build e `CAMPOS_PUBLICOS_CATALOGO` no Apps Script).
- O site precisa funcionar sem o Apps Script: o WhatsApp é sempre a saída de emergência.
- Fonte Archivo é servida de `site/assets/fontes/` (sem Google Fonts).
- Página leve: sem bibliotecas JS externas.

## Comandos

```bash
python scripts/build.py --offline
python -m http.server 8000 -d dist
python -m unittest discover -s tests
node --test tests/*.test.mjs
```

Rode os dois conjuntos de testes antes de qualquer commit. O workflow `publicar.yml` também roda os testes e bloqueia a publicação se falharem.

## Próximos passos prováveis

- Trocar preços de referência pelos combinados com as escolas.
- Página por pacote (melhor para busca de cauda longa) quando houver tráfego.
- Versão em espanhol.
- Guia de spots e surf na Taíba para a entressafra (fev–jun 2027).
