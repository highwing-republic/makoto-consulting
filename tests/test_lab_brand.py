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


def test_shell_loads_noto_weights_and_subsets_dotgothic() -> None:
    css = SHELL_CSS.read_text(encoding="utf-8")
    imports = re.findall(r'@import url\("([^"]+)"\);', css)
    noto = [url for url in imports if "Noto+Sans+JP" in url]
    dot = [url for url in imports if "DotGothic16" in url]
    assert noto == ["https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"]
    assert len(dot) == 1
    assert "text=" in dot[0] and "wght" not in dot[0] and "display=swap" in dot[0]


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
        ".hpt-rating-track i",
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
