from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]


def soup(name):
    return BeautifulSoup((ROOT / name).read_text(encoding="utf-8"), "html.parser")


def test_home_leads_with_lab_positioning_and_three_published_tools():
    page = soup("index.html")
    assert "宿泊・観光の経営を" in page.find("h1").get_text(" ", strip=True)
    assert "データとAIでもう少しわかりやすく" in page.find("h1").get_text(" ", strip=True)
    assert len(page.select("#analysis-tools .analysis-card")) == 3
    assert page.find(id="lab-notes") and len(page.select("#lab-notes .note-card")) == 3
    assert page.find(id="about-lab")
    assert not page.find(id="flow") and not page.find(id="use-cases")
    directory = page.find("a", string=lambda value: value and "すべての分析・ツール" in value)
    assert directory and directory["href"] == "/useful.html"


def test_tool_directory_describes_scope_input_result_and_conditions_for_all_seven():
    page = soup("useful.html")
    cards = page.select(".tool-directory-card")
    assert len(cards) == 7
    for card in cards:
        labels = {item.get_text(strip=True) for item in card.select(".tool-meta dt")}
        assert labels == {"対象", "入力", "結果", "条件"}
    research = page.find(id="tourism-market-signal")
    assert research and "research" in research.get("class", [])[-1]
    assert page.find(id="regional-tools")


def test_external_diagnosis_is_disclosed_and_has_a_persistent_alternative_link():
    page = soup("dx-diagnosis.html")
    notice = page.select_one(".external-tool-notice")
    assert notice and "外部ツール" in notice.get_text()
    alternative = notice.find("a", target="_blank")
    assert alternative and alternative["href"].startswith("https://ugatta-dx-diagnosis.")
    frame = page.find("iframe")
    assert frame and frame.get("loading") == "lazy" and frame.get("title")


def test_analysis_pages_hide_initial_error_and_offer_copy_print_and_rich_noscript():
    for name in (
        "inbound-analysis.html",
        "dx-necessity-analysis.html",
        "supply-demand-gap-analysis.html",
        "tourism-pressure-analysis.html",
    ):
        page = soup(name)
        error = page.find(id="data-error")
        assert error is not None and error.has_attr("hidden") and not error.get_text(strip=True)
        assert page.find(id="data-loading")
        assert len(page.find("noscript").get_text(" ", strip=True)) > 35
        assert page.select_one(".scope-badge")
        assert page.select_one("[data-copy-result]")
        assert page.select_one("[data-print-result]")


def test_management_tool_is_identified_as_rules_based_and_exposes_version():
    page = soup("management-ai.html")
    assert "宿泊経営の課題整理（β）" in page.title.string
    assert "ルールベース" in page.get_text()
    assert "生成AIではありません" in page.get_text()
    assert page.find(id="answer-rule-version")


def test_analytics_adapter_uses_allowlisted_non_free_text_fields():
    script = (ROOT / "js" / "site.js").read_text(encoding="utf-8")
    for event in (
        "goal_select", "tool_open", "analysis_run", "analysis_result_view",
        "result_export", "consultation_click", "tool_error",
    ):
        assert event in script
    for forbidden in ("link_url", "link_text", "page_location", "location.href"):
        assert forbidden not in script
    for allowed in ("goal_id", "tool_id", "prefecture_code", "dataset_version", "export_type", "error_code", "source_page"):
        assert allowed in script


def test_recommended_regional_tool_names_are_visible_with_legacy_context():
    expected = {
        "dx-necessity-analysis.html": ("地域の省人化", "旧「宿泊DX必要度分析」"),
        "supply-demand-gap-analysis.html": ("需給参考指標", "旧「宿泊市場需給ギャップ分析」"),
        "tourism-pressure-analysis.html": ("宿泊集中度", "旧「観光負荷・観光依存度分析」"),
    }
    for name, (current, legacy) in expected.items():
        page = soup(name)
        body = page.get_text(" ", strip=True)
        assert current in body and legacy in body
