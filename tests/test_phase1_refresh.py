from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]


def soup(name):
    return BeautifulSoup((ROOT / name).read_text(encoding="utf-8"), "html.parser")


def test_lab_notes_link_is_kept_out_of_headers_and_small_at_page_bottom():
    pages = []
    for path in ROOT.rglob("*.html"):
        relative = path.relative_to(ROOT)
        if {"docs", "edinet-investment-radar", "tourism-market-signal"} & set(relative.parts):
            continue
        pages.append(path)
    assert pages
    for path in pages:
        page = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        assert not page.select('header a[href="/classics-ai-management/"]'), path
        footer_links = page.select('footer a[href="/classics-ai-management/"]')
        assert len(footer_links) == 1, path
        assert "footer-note-link" in footer_links[0].get("class", []), path


def test_every_html_page_loads_the_canonical_site_shell():
    pages = [path for path in ROOT.rglob("*.html") if not {".git", "tourism-market-signal"} & set(path.parts)]
    assert len(pages) == 19
    for path in pages:
        page = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        assert page.find("link", href="/css/site-shell.css?v=20261002c"), path
        assert page.find("script", src="/js/site-shell.js?v=20261002c"), path

    for name in (
        "report.html",
        "edinet-investment-radar/watch/index.html",
        "edinet-investment-radar/watch/stock.html",
    ):
        assert soup(name).find("script", src="/js/site.js?v=20261002-shell"), name

    shell = (ROOT / "js" / "site-shell.js").read_text(encoding="utf-8")
    for href in (
        "/#facility-tools",
        "/#regional-tools",
        "/#market-tools",
        "/#ai-tools",
        "/#about-lab",
        "https://forms.gle/yjinqFdntoXhTmgk7",
        "/classics-ai-management/",
    ):
        assert href in shell
    assert "body > header:not(.top)" in shell
    assert "pageFooter.matches('.shell.footer')" in shell


def test_home_is_concise_and_groups_all_tools_by_purpose():
    page = soup("index.html")
    assert "宿泊・観光の経営を" in page.find("h1").get_text("", strip=True)
    assert "データとAIでもう少しわかりやすく" in page.find("h1").get_text("", strip=True)
    assert len(page.select("#analysis-tools .analysis-card")) == 9
    assert len(page.select("#analysis-tools .tool-group")) == 4
    assert not page.find(id="lab-notes")
    assert page.find(id="about-lab")
    assert not page.find(id="flow") and not page.find(id="use-cases")
    assert [heading.get_text(strip=True) for heading in page.select(".tool-group__heading h3")] == [
        "施設を診断する", "地域を分析する", "市場を見る", "AIと考える"
    ]
    assert page.select_one('a[href="#analysis-tools"]')
    assert page.select_one('a[href="/management-ai.html"]')
    assert page.select_one('a[href="/hotel-price-trends.html"]')
    market = page.find(id="market-tools").find_parent("section")
    assert market.select_one('a[href="/edinet-investment-radar/watch/"]')


def test_home_is_only_tool_directory_and_legacy_page_is_removed():
    assert not (ROOT / "useful.html").exists()
    home = soup("index.html")
    assert len(home.select("#analysis-tools .analysis-card")) == 9
    assert home.select_one('a[href="/report.html"]')

    report = soup("report.html")
    assert report.find("link", rel="canonical")["href"] == "https://lab.ugatta-llc.com/report.html"
    assert report.find("meta", attrs={"name": "robots"})["content"].startswith("index,follow")
    frame = report.find("iframe", src=lambda value: value and value.startswith("/tourism-market-signal/index.html"))
    assert frame and frame.get("scrolling") == "no" and frame.has_attr("data-report-frame")
    assert report.find("script", src="/js/report-embed.js?v=20261002a")
    assert not report.select_one(".external-link")
    assert "外部レポートを開く" not in report.get_text(" ", strip=True)

    embed_script = (ROOT / "js" / "report-embed.js").read_text(encoding="utf-8")
    assert "event.origin !== reportOrigin" in embed_script
    assert "event.source !== frame.contentWindow" in embed_script
    assert "frame.style.height" in embed_script

    for path in ROOT.rglob("*.html"):
        relative = path.relative_to(ROOT)
        if "docs" not in relative.parts:
            assert "useful.html" not in path.read_text(encoding="utf-8"), path
    assert "useful.html" not in (ROOT / "sitemap.xml").read_text(encoding="utf-8")


def test_edinet_radar_top_is_indexable_and_listed_while_detail_stays_noindex():
    top = soup("edinet-investment-radar/watch/index.html")
    assert top.find("meta", attrs={"name": "robots"})["content"] == "index,follow"
    assert top.find("link", rel="canonical")["href"] == "https://lab.ugatta-llc.com/edinet-investment-radar/watch/"
    assert top.select_one('a.lab-back[href="/#market-tools"]')
    detail = soup("edinet-investment-radar/watch/stock.html")
    assert "noindex" in detail.find("meta", attrs={"name": "robots"})["content"]
    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    assert "https://lab.ugatta-llc.com/edinet-investment-radar/watch/</loc>" in sitemap
    assert "edinet-investment-radar/watch/stock.html" not in sitemap


def test_hotel_price_trends_has_controls_disclosures_and_rakuten_credit():
    page = soup("hotel-price-trends.html")
    assert "宿泊料金トレンド" in page.title.string
    for control_id in ("hpt-region", "hpt-hotel", "hpt-stay-date", "hpt-meal"):
        assert page.find(id=control_id)
    body = page.get_text(" ", strip=True)
    assert "大人2名・1室・1泊" in body
    assert "満室とは判定しません" in body
    assert "長野県10地域・30施設" in body
    for section_id in ("hpt-profile", "hpt-ratings", "hpt-rating-history", "hpt-review"):
        assert page.find(id=section_id)
    assert "楽天参考最安料金" in body
    credit = page.find("a", href="https://developers.rakuten.com/")
    assert credit and credit.get_text(strip=True) == "Supported by Rakuten Developers"
    assert page.find("script", src="js/hotel-price-trends-model.js?v=20260929a")
    assert page.find("script", src="js/hotel-price-trends.js?v=20260929a")


def test_hotel_price_trends_script_keeps_browser_history_available():
    script = (ROOT / "js" / "hotel-price-trends.js").read_text(encoding="utf-8")
    assert "window.history.replaceState" in script
    assert "let history" not in script
    assert "snapshotHistory" in script
    assert 'getJson(`${DATA_ROOT}profiles.json`)' in script
    assert "HotelPriceTrendsModel" in script
    assert "makeProfileInsights" not in script
    assert "latest_review_excerpt" in script


def test_diagnosis_is_native_and_does_not_contact_the_external_app():
    page = soup("dx-diagnosis.html")
    assert page.select_one("#dx-diagnosis-app")
    scripts = [script.get("src") for script in page.find_all("script", src=True)]
    assert scripts.index("js/dx-diagnosis-model.js?v=20261002a") < scripts.index("js/dx-diagnosis.js?v=20261002a")
    assert page.find("iframe") is None
    assert "chatgpt.site" not in page.decode()
    assert page.select_one(".external-tool-notice") is None
    contact_url = "https://forms.gle/yjinqFdntoXhTmgk7"
    for name in ("js/dx-diagnosis-model.js", "js/dx-diagnosis.js"):
        script = (ROOT / name).read_text(encoding="utf-8")
        assert "fetch(" not in script
        assert "XMLHttpRequest" not in script
        assert "http://" not in script
        # The consultation link is the only URL allowed; it is a link target, not a request.
        assert "https://" not in script.replace(contact_url, "")

    ui = (ROOT / "js" / "dx-diagnosis.js").read_text(encoding="utf-8")
    # Analytics go through the lab allowlist with allowed events and no diagnosis values.
    assert "window.gtag" not in ui
    assert 'window.LabAnalytics.track(eventName, { tool_id: "dx-diagnosis" })' in ui
    for event in ("analysis_run", "analysis_result_view", "consultation_click"):
        assert f'track("{event}")' in ui
    assert "dx_total_score" not in ui and "dx_top_priority" not in ui
    # Validation errors mark the field and move focus to the first invalid input.
    assert ui.count('invalidAttr("') == 6
    assert "app.querySelector('[aria-invalid=\"true\"]')" in ui
    assert f'const CONTACT_URL = "{contact_url}"' in ui


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
        "supply-demand-gap-analysis.html": ("宿泊市場の成長・稼働ポジション", "供給不足率、将来需要、投資効果を示すものではありません"),
        "tourism-pressure-analysis.html": ("宿泊集中度", "旧「観光負荷・観光依存度分析」"),
    }
    for name, (current, legacy) in expected.items():
        page = soup(name)
        body = page.get_text(" ", strip=True)
        assert current in body and legacy in body


def test_supply_position_page_prioritizes_interpretation_over_composite_score():
    page = soup("supply-demand-gap-analysis.html")
    body = page.get_text(" ", strip=True)
    assert "宿泊市場の成長・稼働ポジション" in page.title.string
    assert page.find(id="growth-difference")
    assert page.find(id="occupancy-difference")
    assert page.find(id="scatter-summary")
    assert page.find(id="scatter-table-body")
    assert page.find(id="market-actions")
    assert "追加調査優先度" in body
    assert "供給不足の確率や程度ではありません" in body
    assert "需給ひっ迫 参考スコア" not in body
    assert page.find("script", src="js/cross-analysis.js?v=20260914a")


def test_supply_chart_has_four_named_quadrants_and_fixed_size_points():
    script = (ROOT / "js" / "cross-analysis.js").read_text(encoding="utf-8")
    for label in (
        "需要成長・高稼働型",
        "需要成長・稼働余力型",
        "需要減速・高稼働型",
        "需要減速・稼働余力型",
    ):
        assert label in script
    assert "const radius = selected ? 10 : 6" in script
    assert "Math.sqrt((r.lodging_establishments" not in script
    assert "scatter-table-body" in script
