from __future__ import annotations

import re
from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
SHELL_CSS = ROOT / "css" / "site-shell.css"

# Data colors carry analytical meaning. A brand change must not alter them.
EXPECTED_DATA_COLORS = {
    "--data-self": "#b8913f",
    "--data-market": "#6f8c99",
    "--data-market-band": "rgba(43, 100, 116, .1)",
    "--data-other": "#7f9aa6",
    "--data-low": "#dcecef",
    "--data-mid": "#eee8d9",
    "--data-high": "#f0d8cc",
    "--data-unavailable": "#e8edef",
    "--data-grid": "#dce4e7",
    "--data-axis": "#5a6875",
}


def public_files(*suffixes: str) -> list[Path]:
    skip = {".git", "tourism-market-signal", "docs", "tests", "node_modules"}
    return [
        path
        for suffix in suffixes
        for path in ROOT.rglob(f"*{suffix}")
        if not skip & set(path.relative_to(ROOT).parts)
    ]


def root_tokens(css: str) -> dict[str, str]:
    block = re.search(r":root\s*\{(.*?)\}", css, re.S)
    assert block
    return {name: value.strip() for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block.group(1))}


def test_zen_kaku_is_no_longer_loaded_anywhere() -> None:
    for path in public_files(".html", ".css", ".js"):
        text = path.read_text(encoding="utf-8")
        assert "Zen+Kaku" not in text and "Zen Kaku" not in text, path


NOTO_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"


def test_pages_link_web_fonts_in_head_instead_of_css_import() -> None:
    assert not re.search(r"@import\s+url", SHELL_CSS.read_text(encoding="utf-8"))
    shell_pages = [path for path in public_files(".html") if "site-shell.css" in path.read_text(encoding="utf-8")]
    assert len(shell_pages) == 19
    for path in shell_pages:
        head = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser").head
        preconnects = [link.get("href") for link in head.find_all("link", rel="preconnect")]
        assert preconnects == ["https://fonts.googleapis.com", "https://fonts.gstatic.com"], path
        assert head.find("link", rel="preconnect", href="https://fonts.gstatic.com").has_attr("crossorigin"), path

        stylesheets = [link.get("href", "") for link in head.find_all("link", rel="stylesheet")]
        fonts = [href for href in stylesheets if "fonts.googleapis.com" in href]
        dot = [href for href in fonts if "DotGothic16" in href]
        # Font CSS must be discoverable before any site stylesheet.
        assert stylesheets[: len(fonts)] == fonts, path
        assert fonts[0] == NOTO_URL, path
        has_lab_mark = bool(BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser").select(".lab-code"))
        assert len(dot) == (1 if has_lab_mark else 0), path
        for href in dot:
            assert "text=" in href and "wght" not in href and "display=swap" in href


def test_shell_tokens_do_not_override_page_font_variables() -> None:
    # site-shell.css loads on classics pages too; their mincho --serif must survive.
    tokens = root_tokens(SHELL_CSS.read_text(encoding="utf-8"))
    assert not {"--serif", "--sans", "--latin"} & tokens.keys()
    assert tokens["--lab-font-sans"].startswith('"Noto Sans JP"')


def test_data_colors_are_pinned() -> None:
    tokens = root_tokens(SHELL_CSS.read_text(encoding="utf-8"))
    for name, value in EXPECTED_DATA_COLORS.items():
        assert tokens[name] == value, name


def test_lab_code_style_never_synthesizes_bold() -> None:
    css = (ROOT / "css" / "useful.css").read_text(encoding="utf-8")
    rule = re.search(r"\.lab-code\{([^}]+)\}", css)
    assert rule
    assert "font-family:var(--lab-font-dot)" in rule.group(1)
    assert "font-weight:400" in rule.group(1)
    assert "font-synthesis:none" in rule.group(1)


def test_lab_codes_are_ascii_lab_numbers_only() -> None:
    for path in public_files(".html"):
        page = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        for node in page.select(".lab-code"):
            assert re.fullmatch(r"LAB \d{2}", node.get_text()), (path, node.get_text())


def test_home_page_labels_tool_groups_with_lab_numbers() -> None:
    page = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser")
    labels = [node.get_text() for node in page.select(".tool-group__index.lab-code")]
    assert labels == ["LAB 01", "LAB 02", "LAB 03", "LAB 04"]


def test_classics_pages_keep_their_own_typography() -> None:
    pages = list((ROOT / "classics-ai-management").rglob("*.html"))
    assert pages
    for path in pages:
        page = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        hrefs = [link.get("href", "") for link in page.find_all("link", rel="stylesheet")]
        assert not any("useful.css" in href for href in hrefs), path
        assert any("classics.css" in href for href in hrefs), path


def test_hotel_gold_only_identifies_the_selected_property() -> None:
    css = (ROOT / "css/hotel-price-trends.css").read_text(encoding="utf-8")
    gold_selectors = set()
    for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        assert not re.search(r"#(?:b8913f|c79832)|var\(--gold\)", declarations), selector
        if "var(--data-self)" in declarations:
            gold_selectors.add(selector.strip())
            assert not re.search(r"(?:^|;)color:var\(--data-self\)", declarations)
    assert gold_selectors == {
        ".hpt-profile", ".hpt-selected-line", ".hpt-selected-dot",
        ".hpt-chart-legend .selected", ".hpt-position--selected .hpt-position__bar",
        ".hpt-rating-track i", ".hpt-core-row--selected",
        ".hpt-core-row--selected .hpt-core-row__index",
        ".hpt-core-row--selected .hpt-spark-line", ".hpt-core-row--selected .hpt-spark-dot",
    }
    assert ".hpt-rating-track b{" in css
    marker = re.search(r"\.hpt-rating-track b\{([^}]+)\}", css).group(1)
    assert "background:var(--data-market)" in marker
    js = (ROOT / "js/hotel-price-trends.js").read_text(encoding="utf-8")
    assert "金色の印" not in js
    assert "金色の棒：選択施設 ／ 線の印：" in js


def test_hotel_calendar_and_legend_share_fixed_semantic_tokens() -> None:
    css = (ROOT / "css/hotel-price-trends.css").read_text(encoding="utf-8")
    for level, token in [("low", "low"), ("mid", "mid"), ("high", "high"), ("none", "unavailable")]:
        assert f".hpt-legend-{level}:before,.hpt-calendar-cell--{level}{{background:var(--data-{token})}}" in css


def test_analysis_lab_numbers_match_the_home_groups() -> None:
    for filename, number in {
        "hotel-price-trends.html": "03",
        "dx-diagnosis.html": "01",
        "management-ai.html": "04",
        "inbound-analysis.html": "02",
        "dx-necessity-analysis.html": "02",
        "supply-demand-gap-analysis.html": "02",
        "tourism-pressure-analysis.html": "02",
    }.items():
        page = BeautifulSoup((ROOT / filename).read_text(encoding="utf-8"), "html.parser")
        assert [node.get_text() for node in page.select(".page-hero .lab-code")] == [f"LAB {number}"]
        assert not re.search(r"(?:CROSS ANALYSIS|ISSUE ORGANIZER) 0[4-7]", page.get_text())


def test_caution_notes_are_labeled_without_gold_decoration() -> None:
    css = (ROOT / "css/useful.css").read_text(encoding="utf-8")
    for selector in [".survey-change-note", ".state-warning", ".trend-boundary-line"]:
        rule = re.search(re.escape(selector) + r"\{([^}]+)\}", css).group(1)
        assert "var(--lab-navy)" in rule
        assert "--gold" not in rule and "--data-self" not in rule
    for filename in ["inbound-analysis.html", "dx-necessity-analysis.html"]:
        page = BeautifulSoup((ROOT / filename).read_text(encoding="utf-8"), "html.parser")
        for note in page.select(".survey-change-note"):
            assert note.get_text().startswith("注意：")


def test_analysis_styles_use_loaded_weights_and_keep_dot_font_in_lab_labels() -> None:
    for filename in ["useful.css", "hotel-price-trends.css", "dx-diagnosis.css"]:
        css = (ROOT / "css" / filename).read_text(encoding="utf-8")
        assert not re.search(r"font(?:-weight)?:600", css)
        assert "font-size:9px" not in css
        for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
            if "font-family:var(--lab-font-dot)" in declarations:
                assert selector.strip().endswith(".lab-code")
            assert not re.search(r"(?:^|;)color:var\(--(?:data-self|gold)\)", declarations)


def test_diagnosis_gold_is_limited_to_own_score_visuals() -> None:
    css = (ROOT / "css/dx-diagnosis.css").read_text(encoding="utf-8")
    assert "var(--gold)" not in css
    assert {selector.strip() for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css)
            if "var(--data-self)" in body} == {".dx-score-ring", ".dx-radar-point"}
