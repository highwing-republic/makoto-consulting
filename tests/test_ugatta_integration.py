from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LEGACY_EDINET = {
    "edinet-investment-radar/index.html",
    "edinet-investment-radar/stock.html",
}
LAB_CONFIG = "gtag('config','G-QS9HSHCY33')"
UGATTA_CONFIG = "gtag('config','GT-M3S9S5D7')"
UGATTA_LINK = '<a href="https://ugatta-llc.com/">合同会社UGATTA</a>'


def tracked_public_html() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "*.html"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return [path for path in result.stdout.splitlines() if not path.startswith("docs/")]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_all_public_pages_send_to_both_google_tags_once() -> None:
    pages = [path for path in tracked_public_html() if path not in LEGACY_EDINET]
    assert len(pages) == 19
    for path in pages:
        content = read(path)
        assert content.count(LAB_CONFIG) == 1, path
        assert content.count(UGATTA_CONFIG) == 1, path
        assert content.count("googletagmanager.com/gtag/js?id=G-QS9HSHCY33") == 1, path


def test_shared_footer_links_back_to_ugatta() -> None:
    shell = read("js/site-shell.js")
    assert shell.count(UGATTA_LINK) == 1
    assert 'target="_blank"' not in shell.split(UGATTA_LINK)[0][-100:]
    assert "utm_" not in UGATTA_LINK


def test_fallback_footers_link_back_to_ugatta() -> None:
    fallback_pages = []
    for path in tracked_public_html():
        content = read(path)
        if "運営：" not in content:
            continue
        fallback_pages.append(path)
        assert "運営：合同会社UGATTA</small>" not in content, path
        assert UGATTA_LINK in content, path
    assert len(fallback_pages) == 16


def test_ugatta_link_has_visible_link_styling() -> None:
    stylesheet = read("css/site-shell.css")
    assert ".site-footer small > a" in stylesheet
    rule = re.search(r"\.site-footer small > a\s*\{([^}]+)\}", stylesheet)
    assert rule
    assert "text-decoration: underline" in rule.group(1)


def test_site_shell_cache_busters_are_consistent() -> None:
    shell_pages = []
    js_versions = set()
    css_versions = set()
    for path in tracked_public_html():
        content = read(path)
        if "site-shell.js?v=" not in content:
            continue
        shell_pages.append(path)
        js_match = re.search(r"site-shell\.js\?v=([0-9a-z]+)", content)
        css_match = re.search(r"site-shell\.css\?v=([0-9a-z]+)", content)
        assert js_match, path
        assert css_match, path
        js_versions.add(js_match.group(1))
        css_versions.add(css_match.group(1))
    assert len(shell_pages) == 21
    assert js_versions == {"20261002c"}
    assert css_versions == {"20261002c"}
