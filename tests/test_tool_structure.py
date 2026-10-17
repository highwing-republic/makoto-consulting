"""Phase 3: ツール台帳（_data/tools.yml）と標準ブロックの構造を確認する。"""
import re
from pathlib import Path

import yaml
from bs4 import BeautifulSoup

from site_pages import rendered

ROOT = Path(__file__).resolve().parents[1]
FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.S)
ENGLISH_EYEBROW = re.compile(r"^[A-Z][A-Z0-9 ]*$")


def tools():
    return yaml.safe_load((ROOT / "_data" / "tools.yml").read_text(encoding="utf-8"))


def front_matter(path):
    match = FRONT_MATTER.match(path.read_text(encoding="utf-8"))
    return yaml.safe_load(match.group(1)) or {} if match else {}


def converted_pages():
    return sorted(path for path in ROOT.glob("*.html") if "tool" in front_matter(path))


def test_registry_matches_the_home_page_cards():
    registry = tools()
    ids = [tool["id"] for tool in registry]
    assert len(ids) == len(set(ids))
    home = BeautifulSoup(rendered(ROOT / "index.html"), "html.parser")
    cards = {card["data-tool-id"]: card["href"] for card in home.select(".analysis-card[data-tool-id]")}
    assert set(ids) == set(cards)
    for tool in registry:
        assert tool["url"] == cards[tool["id"]], tool["id"]
        assert tool["group"] in {"facility", "regional", "market", "experimental"}
        assert tool["title"] and tool["tag"] and tool["summary"]
        if tool["url"].endswith(".html"):
            assert (ROOT / tool["url"].lstrip("/")).exists(), tool["url"]


def test_converted_pages_use_the_three_standard_blocks():
    pages = converted_pages()
    assert [path.name for path in pages] == [
        "ai-time-estimate.html",
        "business-hotel-price-trends.html",
        "dx-diagnosis.html",
        "hotel-price-trends.html",
        "inbound-analysis.html",
        "kpi-calculator.html",
        "management-ai.html",
        "ota-fee-simulator.html",
        "report.html",
        "security-check.html",
    ]
    registry = {tool["id"]: tool for tool in tools()}
    for path in pages:
        page = front_matter(path)
        source = path.read_text(encoding="utf-8")
        assert page["tool"] in registry, path
        assert page["tool_purpose"] and len(page["tool_scope"]) == 3, path
        assert [item["label"] for item in page["tool_scope"]] == ["対象", "データ", "条件"], path
        assert page["tool_notes"] and page["tool_related"], path
        for related in page["tool_related"]:
            assert related in registry and related != page["tool"], (path, related)
        for include in ("tool-overview", "tool-sources", "tool-related"):
            assert source.count("{%% include %s.html %%}" % include) == 1, (path, include)
        assert 'css/tool-standard.css' in source, path
        assert 'class="analysis-source"' not in source, path

        html = BeautifulSoup(rendered(path), "html.parser")
        assert "{%" not in str(html)
        hero = html.select_one(".page-hero")
        overview = html.select_one(".tool-overview")
        assert hero and overview and hero.find_next_sibling("section") is overview, path
        assert overview.find("h2").get_text() == "この分析でわかること"
        assert len(overview.select(".tool-overview__scope dt")) == 3
        sources = html.select_one(".tool-sources")
        assert sources.find("h2").get_text() == "出典・更新日・注意事項"
        assert sources.find(id="source-list")
        assert bool(sources.find(id="source-updated")) == bool(page.get("tool_updated")), path
        assert len(sources.select(".tool-sources__notes li")) == len(page["tool_notes"])
        related = html.select_one(".tool-related")
        # Tool cards first; an explainer card (tool_guides) sits in its own row below.
        cards = related.select(".tool-related__grid:not(.tool-related__guides) .tool-related__card")
        assert [card["data-tool-id"] for card in cards] == page["tool_related"]
        for card in cards:
            tool = registry[card["data-tool-id"]]
            assert card["href"] == tool["url"]
            assert card.select_one("strong").get_text() == tool["title"]
            assert card.has_attr("data-pref-link") == bool(tool.get("pref"))
        assert related.find("a", href="/#analysis-tools")
        # The standard blocks replace the English section labels and the hand-written link rows.
        for eyebrow in html.select(".eyebrow"):
            assert not ENGLISH_EYEBROW.match(eyebrow.get_text(strip=True)), (path, eyebrow)
        assert not html.select(".next-action-panel a.button"), path
        main = html.find("main")
        assert main.find_all("section", recursive=False)[-1] is related or main.select_one(".tool-related") is related


PAGE_SCRIPTS = {
    "inbound-analysis.html": ("inbound-analysis", "InboundAnalysisModel"),
    "business-hotel-price-trends.html": ("business-hotel-price-trends", "BusinessHotelPriceModel"),
    "kpi-calculator.html": ("kpi-calculator", "KpiCalculatorModel"),
    "ota-fee-simulator.html": ("ota-fee-simulator", "OtaFeeModel"),
    "security-check.html": ("security-check", "SecurityCheckModel"),
    "ai-time-estimate.html": ("ai-time-estimate", "AiTimeModel"),
}


def test_tool_pages_load_a_pure_model_before_the_view():
    for name, (script, global_name) in PAGE_SCRIPTS.items():
        html = BeautifulSoup(rendered(ROOT / name), "html.parser")
        scripts = [tag["src"] for tag in html.find_all("script", src=True)]
        model = next(index for index, src in enumerate(scripts) if src.startswith(f"js/{script}-model.js"))
        view = next(index for index, src in enumerate(scripts) if src.startswith(f"js/{script}.js"))
        assert model < view, name
        view_source = (ROOT / "js" / f"{script}.js").read_text(encoding="utf-8")
        model_source = (ROOT / "js" / f"{script}-model.js").read_text(encoding="utf-8")
        body = model_source.split("'use strict';", 1)[1]
        assert "document" not in body and "fetch(" not in body and "window" not in body, script
        assert f"globalThis.{global_name}" in view_source, script
