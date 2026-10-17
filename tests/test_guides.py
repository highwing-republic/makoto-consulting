"""解説ページ（/guide/）: 検索に出す基本情報、ツールとの双方向の導線、診断・料金ツールとの記述の一致。"""
import json
import re
from pathlib import Path

import yaml
from bs4 import BeautifulSoup

from site_pages import ROOT, rendered

LAB = "https://lab.ugatta-llc.com"
LAB_ORG = LAB + "/#organization"
TOOL_PAGES = [
    "dx-diagnosis.html", "inbound-analysis.html",
    "management-ai.html", "hotel-price-trends.html", "report.html",
    "kpi-calculator.html", "ota-fee-simulator.html", "security-check.html", "ai-time-estimate.html",
]


def guides():
    return yaml.safe_load((ROOT / "_data" / "guides.yml").read_text(encoding="utf-8"))


def page_path(url):
    return ROOT / url.lstrip("/") / "index.html"


def soup(path):
    return BeautifulSoup(rendered(path), "html.parser")


def graph(page):
    nodes = []
    for script in page.select('script[type="application/ld+json"]'):
        data = json.loads(script.string)
        nodes.extend(data.get("@graph", [data]))
    return nodes


def guide_page(guide_id):
    guide = next(item for item in guides() if item["id"] == guide_id)
    return soup(page_path(guide["url"]))


def test_each_guide_is_a_published_article_with_search_basics():
    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
    ids = [guide["id"] for guide in guides()]
    assert ids == ["shukuhaku-dx", "operations-improvement", "market-data"]
    for guide in guides():
        url = LAB + guide["url"]
        path = page_path(guide["url"])
        assert path.exists(), path
        page = soup(path)
        title = page.title.get_text()
        assert len(title) <= 32 and title.endswith("｜宿泊DXラボ"), title
        assert page.find("meta", property="og:title")["content"] == title
        assert page.find("meta", property="og:type")["content"] == "article"
        assert page.find("link", rel="canonical")["href"] == url
        assert page.find("meta", property="og:url")["content"] == url
        assert "noindex" not in page.find("meta", attrs={"name": "robots"})["content"]
        assert 60 <= len(page.find("meta", attrs={"name": "description"})["content"]) <= 130
        assert len(page.find_all("h1")) == 1

        nodes = graph(page)
        article = next(node for node in nodes if node["@type"] == "Article")
        assert article["mainEntityOfPage"] == url and article["url"] == url
        assert article["author"]["@id"] == LAB_ORG and article["publisher"]["@id"] == LAB_ORG
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", article["datePublished"])
        assert article["dateModified"] >= article["datePublished"]
        assert page.select_one(".guide-meta time")["datetime"] == article["datePublished"]
        crumbs = next(node for node in nodes if node["@type"] == "BreadcrumbList")["itemListElement"]
        assert crumbs[0]["item"] == LAB + "/" and crumbs[-1]["item"] == url
        assert crumbs[-1]["name"] == page.select_one('.breadcrumb [aria-current="page"]').get_text()

        assert f"<loc>{url}</loc>" in sitemap, url
        assert f"]({url})" in llms, url


def test_guide_table_of_contents_matches_its_headings():
    for guide in guides():
        page = soup(page_path(guide["url"]))
        toc = [link["href"].lstrip("#") for link in page.select(".guide-toc a")]
        headings = [heading["id"] for heading in page.select(".guide-body h2")]
        assert toc == headings, guide["id"]


def test_guide_links_point_to_real_pages():
    for guide in guides():
        page = soup(page_path(guide["url"]))
        for link in page.select("main a[href^='/']"):
            href = link["href"].split("#")[0].split("?")[0]
            if not href:
                continue
            target = ROOT / href.lstrip("/")
            assert (target / "index.html" if href.endswith("/") else target).exists(), (guide["id"], href)


def test_each_tool_page_links_to_at_most_one_guide_and_every_guide_is_reachable():
    registry = {guide["id"]: guide for guide in guides()}
    linked = set()
    for name in TOOL_PAGES:
        cards = soup(name).select(".tool-related__guides .tool-related__card")
        assert len(cards) <= 1, name
        for card in cards:
            guide = registry[card["data-tool-id"].removeprefix("guide-")]
            assert card["href"] == guide["url"] and card.select_one(".tag").get_text() == "解説"
            assert card.select_one("strong").get_text() == guide["title"]
            linked.add(guide["id"])

    home = soup("index.html")
    home_links = [link["href"] for link in home.select('a[href^="/guide/"]')]
    assert home_links == ["/guide/shukuhaku-dx/"]
    assert home.select_one('#about-lab a[href="/guide/shukuhaku-dx/"]')
    linked.add("shukuhaku-dx")
    assert linked == set(registry)

    # Each guide sends readers on to the other two guides.
    for guide in guides():
        cards = soup(page_path(guide["url"])).select(".tool-related__guides .tool-related__card")
        assert {card["href"] for card in cards} == {other["url"] for other in guides() if other["id"] != guide["id"]}


def diagnosis_questions():
    model = (ROOT / "js" / "dx-diagnosis-model.js").read_text(encoding="utf-8")
    questions = {}
    for category, question in re.findall(r'category: "([^"]+)", question: "([^"]+)"', model):
        questions.setdefault(category, []).append(question)
    return questions


def test_operations_guide_follows_the_diagnosis_categories_and_questions():
    questions = diagnosis_questions()
    assert len(questions) == 8 and all(len(items) == 2 for items in questions.values())
    page = guide_page("operations-improvement")
    blocks = page.select("section[data-category]")
    assert [block["data-category"] for block in blocks] == list(questions)
    for block in blocks:
        category = block["data-category"]
        assert block.find("h2").get_text().split(" ", 1)[1].startswith(category)
        labels = [dt.get_text() for dt in block.select(".guide-check dt")]
        assert labels == ["よくある手作業", "改善の方向", "確認する数字", "診断で対応する質問"]
        asked = [item.get_text() for item in block.select(".guide-check > div:last-child li")]
        assert asked == questions[category], category


def test_market_guide_states_the_price_position_threshold_the_tool_uses():
    model = (ROOT / "js" / "hotel-price-trends-model.js").read_text(encoding="utf-8")
    assert 'index >= 110 ? "中央値より高い" : index <= 90 ? "中央値より低い"' in model
    text = guide_page("market-data").select_one("#prices").find_parent("section").get_text()
    assert "中央値と比べて、10%以上高い・低いか" in text
    # The 7-day thresholds are checked against changeLabel in tests/guides.test.cjs.
    assert guide_page("market-data").select_one(".guide-trend-table")


def test_shukuhaku_dx_guide_uses_the_home_page_definition():
    home = soup("index.html").select_one("#about-lab .about-lab__body p").get_text()
    definition = home.split("。", 1)[0] + "。"
    assert definition.startswith("宿泊DXとは、")
    body = guide_page("shukuhaku-dx").select_one("#what").find_parent("section").get_text()
    assert definition in body
