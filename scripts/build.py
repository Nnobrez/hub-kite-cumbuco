#!/usr/bin/env python3
"""Gera o site estático do Hub Kite Cumbuco em dist/ (português na raiz, inglês em /en/).

Uso:
    python scripts/build.py              # busca o catálogo na planilha (se configurada)
    python scripts/build.py --offline    # usa só content/catalogo.json
    python scripts/build.py --saida pasta

Variáveis de ambiente opcionais (sobrescrevem site.config.json):
    APPS_SCRIPT_URL, URL_BASE, WHATSAPP

Só usa a biblioteca padrão do Python 3.9+.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from string import Template

RAIZ = Path(__file__).resolve().parent.parent
IDIOMAS = ("pt", "en")
IDIOMA_PADRAO = "pt"
CAMPOS_PUBLICOS = (
    "id", "ativo", "ordem", "categoria",
    "nome_pt", "nome_en", "descricao_pt", "descricao_en",
    "preco_a_partir", "unidade_pt", "unidade_en",
)


# ---------------------------------------------------------------- leitura

def ler_json(caminho: Path):
    with caminho.open(encoding="utf-8") as f:
        return json.load(f)


def carregar_config(raiz: Path = RAIZ) -> dict:
    config = ler_json(raiz / "site.config.json")
    for env, chave in (("APPS_SCRIPT_URL", "apps_script_url"),
                       ("URL_BASE", "url_base"),
                       ("WHATSAPP", "whatsapp")):
        valor = os.environ.get(env, "").strip()
        if valor:
            config[chave] = valor
    config["url_base"] = config.get("url_base", "").rstrip("/")
    config["whatsapp"] = "".join(ch for ch in str(config.get("whatsapp", "")) if ch.isdigit())
    return config


def carregar_textos(raiz: Path = RAIZ) -> dict:
    return {idioma: ler_json(raiz / "content" / f"textos.{idioma}.json") for idioma in IDIOMAS}


def buscar_catalogo_remoto(url: str, tempo_limite: int = 20) -> list:
    """Lê o catálogo publicado pelo Apps Script (aba Catalogo da planilha)."""
    separador = "&" if "?" in url else "?"
    pedido = urllib.request.Request(
        f"{url}{separador}acao=catalogo",
        headers={"User-Agent": "hub-kite-cumbuco-build"},
    )
    with urllib.request.urlopen(pedido, timeout=tempo_limite) as resposta:
        dados = json.loads(resposta.read().decode("utf-8"))
    itens = dados.get("itens") if isinstance(dados, dict) else dados
    if not isinstance(itens, list) or not itens:
        raise ValueError("catálogo remoto vazio ou em formato inesperado")
    return itens


def normalizar_item(item: dict) -> dict | None:
    """Mantém só campos públicos e corrige tipos vindos da planilha."""
    limpo = {campo: item.get(campo) for campo in CAMPOS_PUBLICOS}
    if not limpo["id"] or not limpo["nome_pt"]:
        return None
    ativo = limpo["ativo"]
    if isinstance(ativo, str):
        ativo = ativo.strip().lower() in ("true", "sim", "1", "verdadeiro", "x")
    if not ativo:
        return None
    limpo["ativo"] = True
    limpo["id"] = str(limpo["id"]).strip()
    try:
        limpo["ordem"] = int(limpo["ordem"])
    except (TypeError, ValueError):
        limpo["ordem"] = 999
    preco = limpo["preco_a_partir"]
    if preco in ("", None):
        limpo["preco_a_partir"] = None
    else:
        try:
            limpo["preco_a_partir"] = float(str(preco).replace(",", "."))
        except ValueError:
            limpo["preco_a_partir"] = None
    for campo in ("nome_en", "descricao_pt", "descricao_en", "unidade_pt", "unidade_en", "categoria"):
        limpo[campo] = str(limpo[campo] or "").strip()
    if not limpo["nome_en"]:
        limpo["nome_en"] = limpo["nome_pt"]
    if not limpo["descricao_en"]:
        limpo["descricao_en"] = limpo["descricao_pt"]
    return limpo


def carregar_catalogo(config: dict, offline: bool = False, raiz: Path = RAIZ) -> tuple[list, str]:
    origem = "content/catalogo.json"
    brutos = None
    url = config.get("apps_script_url", "")
    if url and not offline:
        try:
            brutos = buscar_catalogo_remoto(url)
            origem = "planilha (Apps Script)"
        except (urllib.error.URLError, ValueError, json.JSONDecodeError, TimeoutError) as erro:
            print(f"Aviso: não consegui ler o catálogo da planilha ({erro}). Usando o arquivo local.",
                  file=sys.stderr)
    if brutos is None:
        brutos = ler_json(raiz / "content" / "catalogo.json")
    itens = [i for i in (normalizar_item(b) for b in brutos) if i]
    ids = [i["id"] for i in itens]
    repetidos = {x for x in ids if ids.count(x) > 1}
    if repetidos:
        raise ValueError(f"IDs repetidos no catálogo: {', '.join(sorted(repetidos))}")
    if not itens:
        raise ValueError("Nenhum pacote ativo no catálogo.")
    itens.sort(key=lambda i: (i["ordem"], i["nome_pt"]))
    return itens, origem


# ---------------------------------------------------------------- formatação

def esc(texto) -> str:
    return html.escape(str(texto), quote=True)


def formatar_preco(valor: float, idioma: str) -> str:
    inteiro = round(valor)
    if abs(valor - inteiro) < 0.005:
        numero = f"{inteiro:,}"
    else:
        numero = f"{valor:,.2f}"
    if idioma == "pt":
        numero = numero.replace(",", "§").replace(".", ",").replace("§", ".")
    return f"R$ {numero}"


def json_para_script(dados) -> str:
    """JSON seguro para colocar dentro de <script>."""
    return (json.dumps(dados, ensure_ascii=False)
            .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))


def link_whatsapp(numero: str, texto: str) -> str:
    return f"https://wa.me/{numero}?text={urllib.parse.quote(texto)}"


def url_pagina(config: dict, idioma: str) -> str:
    base = config["url_base"]
    return f"{base}/" if idioma == IDIOMA_PADRAO else f"{base}/{idioma}/"


# ---------------------------------------------------------------- blocos de HTML

def nivel_mes(mes: int, temporada: dict) -> str:
    if mes in temporada.get("pico", []):
        return "pico"
    if mes in temporada.get("temporada", []):
        return "temporada"
    return "fora"


def render_meses(textos: dict, temporada: dict) -> str:
    rotulos = {"pico": textos["legenda_pico"], "temporada": textos["legenda_temporada"],
               "fora": textos["legenda_fora"]}
    linhas = []
    for indice, nome in enumerate(textos["meses"], start=1):
        nivel = nivel_mes(indice, temporada)
        linhas.append(
            f'          <li class="mes mes--{nivel}">'
            f'<span class="barra" aria-hidden="true"></span>'
            f'<span class="mes-nome">{esc(nome)}</span>'
            f'<span class="sr">: {esc(rotulos[nivel])}</span></li>'
        )
    return "\n".join(linhas)


def render_pacotes(itens: list, textos: dict, idioma: str) -> str:
    blocos = []
    for item in itens:
        nome = item[f"nome_{idioma}"]
        descricao = item[f"descricao_{idioma}"]
        unidade = item[f"unidade_{idioma}"]
        if item["preco_a_partir"] is None:
            preco = f'<span class="valor valor--consulta">{esc(textos["sob_consulta"])}</span>'
        else:
            preco = (f'<span class="a-partir">{esc(textos["a_partir_de"])}</span>'
                     f'<span class="valor">{esc(formatar_preco(item["preco_a_partir"], idioma))}</span>'
                     f'<span class="unidade">{esc(unidade)}</span>')
        blocos.append(
            f'        <li class="pacote" id="pacote-{esc(item["id"])}">\n'
            f'          <div class="pacote-info"><h3>{esc(nome)}</h3><p>{esc(descricao)}</p></div>\n'
            f'          <div class="pacote-preco">{preco}</div>\n'
            f'          <button class="btn btn-secundario btn-pequeno" type="button" '
            f'data-pacote="{esc(item["id"])}" aria-label="{esc(textos["botao_pedir"])}: {esc(nome)}">'
            f'{esc(textos["botao_pedir"])}</button>\n'
            f'        </li>'
        )
    return "\n".join(blocos)


def render_opcoes_pacotes(itens: list, idioma: str) -> str:
    return "\n".join(
        f'              <option value="{esc(i["id"])}">{esc(i[f"nome_{idioma}"])}</option>' for i in itens
    )


def render_opcoes_niveis(textos: dict) -> str:
    return "\n".join(f'              <option>{esc(n)}</option>' for n in textos["niveis"])


def render_passos(textos: dict) -> str:
    return "\n".join(
        f'        <li><h3>{esc(p["titulo"])}</h3><p>{esc(p["texto"])}</p></li>' for p in textos["passos"]
    )


def render_spots(textos: dict) -> str:
    return "\n".join(
        f'        <li><h3>{esc(s["nome"])}</h3><p>{esc(s["texto"])}</p></li>' for s in textos["spots"]
    )


def render_faq(textos: dict) -> str:
    return "\n".join(
        f'        <details><summary>{esc(q["pergunta"])}</summary><p>{esc(q["resposta"])}</p></details>'
        for q in textos["faq"]
    )


def render_jsonld(config: dict, textos: dict, idioma: str) -> str:
    dados = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "name": config["marca"],
                "url": url_pagina(config, idioma),
                "inLanguage": textos["html_lang"],
            },
            {
                "@type": "FAQPage",
                "inLanguage": textos["html_lang"],
                "mainEntity": [
                    {"@type": "Question", "name": q["pergunta"],
                     "acceptedAnswer": {"@type": "Answer", "text": q["resposta"]}}
                    for q in textos["faq"]
                ],
            },
        ],
    }
    return json_para_script(dados)


def config_para_pagina(config: dict, textos: dict, itens: list, idioma: str) -> str:
    chaves = ("enviando", "botao_enviar", "erro_envio", "erro_campos", "erro_datas",
              "whatsapp_saudacao", "whatsapp_rotulos", "sucesso_botao",
              "sucesso_titulo_whatsapp", "sucesso_texto_whatsapp")
    return json_para_script({
        "idioma": idioma,
        "whatsapp": config["whatsapp"],
        "apps_script_url": config.get("apps_script_url", ""),
        "pacotes": {i["id"]: i[f"nome_{idioma}"] for i in itens} | {"outro": textos["campo_pacote_outro"]},
        "textos": {k: textos[k] for k in chaves},
    })


# ---------------------------------------------------------------- página

def render_pagina(config: dict, textos_todos: dict, itens: list, idioma: str,
                  versao: str, raiz: Path = RAIZ) -> str:
    textos = textos_todos[idioma]
    outro = textos["outro_idioma_codigo"]
    marca = config["marca"]
    # Português fica na raiz; os outros idiomas em /<idioma>/.
    prefixo = "./" if idioma == IDIOMA_PADRAO else "../"
    if idioma == IDIOMA_PADRAO:
        link_outro = f"./{outro}/"
    else:
        link_outro = "../" if outro == IDIOMA_PADRAO else f"../{outro}/"

    instagram = config.get("instagram", "").strip()
    instagram_html = (
        f'        <a href="{esc(instagram)}" target="_blank" rel="noopener">{esc(textos["rodape_instagram"])}</a>'
        if instagram else ""
    )

    valores = {
        "html_lang": esc(textos["html_lang"]),
        "titulo_pagina": esc(textos["titulo_pagina"].replace("{marca}", marca)),
        "descricao_meta": esc(textos["descricao_meta"]),
        "url_canonica": esc(url_pagina(config, idioma)),
        "url_pt": esc(url_pagina(config, "pt")),
        "url_en": esc(url_pagina(config, "en")),
        "og_locale": esc(textos["og_locale"]),
        "marca": esc(marca),
        "raiz": prefixo,
        "versao": versao,
        "jsonld": render_jsonld(config, textos, idioma),
        "link_outro_idioma": esc(link_outro),
        "whatsapp_link_hero": esc(link_whatsapp(config["whatsapp"], textos["whatsapp_hero"])),
        "meses_html": render_meses(textos, config.get("temporada", {})),
        "pacotes_html": render_pacotes(itens, textos, idioma),
        "opcoes_pacotes": render_opcoes_pacotes(itens, idioma),
        "opcoes_niveis": render_opcoes_niveis(textos),
        "passos_html": render_passos(textos),
        "spots_html": render_spots(textos),
        "faq_html": render_faq(textos),
        "instagram_html": instagram_html,
        "config_json": config_para_pagina(config, textos, itens, idioma),
        "ano": str(dt.date.today().year),
    }
    # Textos simples: todas as chaves de texto do arquivo de idioma viram variáveis.
    for chave, valor in textos.items():
        if isinstance(valor, str) and chave not in valores:
            valores[chave] = esc(valor)

    modelo = Template((raiz / "templates" / "pagina.html").read_text(encoding="utf-8"))
    return modelo.substitute(valores)


def versao_assets(raiz: Path = RAIZ) -> str:
    resumo = hashlib.sha256()
    for arquivo in sorted((raiz / "site" / "assets").rglob("*")):
        if arquivo.is_file():
            resumo.update(arquivo.read_bytes())
    return resumo.hexdigest()[:10]


def render_sitemap(config: dict) -> str:
    hoje = dt.date.today().isoformat()
    entradas = []
    for idioma in IDIOMAS:
        alternativas = "".join(
            f'\n    <xhtml:link rel="alternate" hreflang="{"pt-BR" if i == "pt" else i}" href="{esc(url_pagina(config, i))}"/>'
            for i in IDIOMAS
        )
        entradas.append(
            f"  <url>\n    <loc>{esc(url_pagina(config, idioma))}</loc>\n    <lastmod>{hoje}</lastmod>"
            f"{alternativas}\n  </url>"
        )
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
            'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(entradas) + "\n</urlset>\n")


# ---------------------------------------------------------------- build

def construir(saida: Path, offline: bool = False, raiz: Path = RAIZ) -> dict:
    config = carregar_config(raiz)
    textos = carregar_textos(raiz)
    itens, origem = carregar_catalogo(config, offline=offline, raiz=raiz)
    versao = versao_assets(raiz)

    if saida.exists():
        shutil.rmtree(saida)
    (saida / "assets").mkdir(parents=True)
    shutil.copytree(raiz / "site" / "assets", saida / "assets", dirs_exist_ok=True)

    for idioma in IDIOMAS:
        destino = saida if idioma == IDIOMA_PADRAO else saida / idioma
        destino.mkdir(parents=True, exist_ok=True)
        (destino / "index.html").write_text(
            render_pagina(config, textos, itens, idioma, versao, raiz), encoding="utf-8"
        )

    (saida / "sitemap.xml").write_text(render_sitemap(config), encoding="utf-8")
    (saida / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {config['url_base']}/sitemap.xml\n", encoding="utf-8"
    )
    (saida / ".nojekyll").write_text("", encoding="utf-8")
    dominio = config.get("dominio_proprio", "").strip()
    if dominio:
        (saida / "CNAME").write_text(dominio + "\n", encoding="utf-8")

    return {"pacotes": len(itens), "origem_catalogo": origem, "saida": str(saida)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Gera o site estático em dist/.")
    parser.add_argument("--offline", action="store_true", help="não busca o catálogo na planilha")
    parser.add_argument("--saida", default=str(RAIZ / "dist"), help="pasta de saída (padrão: dist)")
    args = parser.parse_args(argv)
    try:
        resultado = construir(Path(args.saida), offline=args.offline)
    except (ValueError, KeyError) as erro:
        print(f"Erro no build: {erro}", file=sys.stderr)
        return 1
    print(f"Site gerado em {resultado['saida']} com {resultado['pacotes']} pacotes "
          f"(catálogo: {resultado['origem_catalogo']}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
