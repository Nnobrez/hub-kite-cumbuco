"""Testes do gerador do site. Rodar: python -m unittest discover -s tests"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))

import build  # noqa: E402


class TestFormatacao(unittest.TestCase):
    def test_preco_em_portugues_e_ingles(self):
        self.assertEqual(build.formatar_preco(2000, "pt"), "R$ 2.000")
        self.assertEqual(build.formatar_preco(2000, "en"), "R$ 2,000")
        self.assertEqual(build.formatar_preco(1234.5, "pt"), "R$ 1.234,50")

    def test_json_para_script_nao_fecha_a_tag(self):
        saida = build.json_para_script({"x": "</script><b>"})
        self.assertNotIn("</script>", saida)
        self.assertEqual(json.loads(saida), {"x": "</script><b>"})


class TestCatalogo(unittest.TestCase):
    def test_normaliza_valores_vindos_da_planilha(self):
        item = build.normalizar_item({
            "id": " curso ", "ativo": "TRUE", "ordem": "2", "nome_pt": "Curso",
            "preco_a_partir": "2000,50", "comissao_pct": 0.12, "parceiro_padrao": "Escola X",
        })
        self.assertEqual(item["id"], "curso")
        self.assertEqual(item["ordem"], 2)
        self.assertEqual(item["preco_a_partir"], 2000.5)
        self.assertEqual(item["nome_en"], "Curso")
        self.assertNotIn("comissao_pct", item)
        self.assertNotIn("parceiro_padrao", item)

    def test_ignora_inativo_e_sem_nome(self):
        self.assertIsNone(build.normalizar_item({"id": "a", "ativo": False, "nome_pt": "A"}))
        self.assertIsNone(build.normalizar_item({"id": "a", "ativo": True, "nome_pt": ""}))

    def test_preco_vazio_vira_sob_consulta(self):
        item = build.normalizar_item({"id": "a", "ativo": True, "nome_pt": "A", "preco_a_partir": ""})
        self.assertIsNone(item["preco_a_partir"])

    def test_catalogo_local_carrega_em_ordem(self):
        itens, origem = build.carregar_catalogo({"apps_script_url": ""}, offline=True)
        self.assertEqual(origem, "content/catalogo.json")
        self.assertEqual([i["ordem"] for i in itens], sorted(i["ordem"] for i in itens))


class TestBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saida = Path(cls.tmp.name) / "dist"
        cls.resultado = build.construir(cls.saida, offline=True)
        cls.pt = (cls.saida / "index.html").read_text(encoding="utf-8")
        cls.en = (cls.saida / "en" / "index.html").read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_gera_arquivos_esperados(self):
        for caminho in ("index.html", "en/index.html", "sitemap.xml", "robots.txt",
                        ".nojekyll", "assets/estilo.css", "assets/app.js", "assets/favicon.svg"):
            self.assertTrue((self.saida / caminho).exists(), caminho)

    def test_idiomas_e_links_entre_paginas(self):
        self.assertIn('<html lang="pt-BR">', self.pt)
        self.assertIn('<html lang="en">', self.en)
        self.assertIn('href="./en/"', self.pt)
        self.assertIn('href="../"', self.en)
        self.assertIn('href="../assets/estilo.css', self.en)

    def test_todos_os_pacotes_aparecem_na_lista_e_no_formulario(self):
        itens, _ = build.carregar_catalogo({"apps_script_url": ""}, offline=True)
        for item in itens:
            self.assertIn(f'data-pacote="{item["id"]}"', self.pt)
            self.assertIn(f'<option value="{item["id"]}">', self.pt)

    def test_nenhuma_variavel_sobrou_no_html(self):
        for pagina in (self.pt, self.en):
            self.assertNotRegex(pagina, r"\$\{[a-z_]+\}")

    def test_config_da_pagina_e_json_valido(self):
        inicio = self.pt.index('<script id="config-site" type="application/json">') + len(
            '<script id="config-site" type="application/json">')
        fim = self.pt.index("</script>", inicio)
        config = json.loads(self.pt[inicio:fim])
        self.assertEqual(config["idioma"], "pt")
        self.assertIn("curso-10h", config["pacotes"])
        self.assertIn("outro", config["pacotes"])

    def test_faixa_do_vento_tem_12_meses_e_pico_em_ago_set_out(self):
        self.assertEqual(self.pt.count('class="mes mes--'), 12)
        self.assertEqual(self.pt.count('class="mes mes--pico"'), 3)


if __name__ == "__main__":
    unittest.main()
