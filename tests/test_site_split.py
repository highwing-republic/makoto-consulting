"""Stock and classics reading pages moved to their own subdomains (2026-10).

The Lab keeps a forwarding page at every old URL and links to neither site.
"""
from __future__ import annotations

from pathlib import Path

from bs4 import BeautifulSoup

from site_pages import is_published, is_redirect_stub, rendered

ROOT = Path(__file__).resolve().parents[1]
NEW_HOSTS = ("https://classics.ugatta-llc.com/", "https://stock.ugatta-llc.com/")
AI_ARTICLES = ("shudo", "yudo", "nangen", "nihei", "yojin")


def moved_pages() -> list[tuple[str, str]]:
    lines = (ROOT / "docs" / "moved-pages.tsv").read_text(encoding="utf-8").splitlines()[1:]
    return [tuple(line.split("\t")) for line in lines]


def test_every_moved_url_forwards_to_its_new_home() -> None:
    pages = moved_pages()
    assert len(pages) == 49
    for old, new in pages:
        assert new.startswith(NEW_HOSTS), new
        path = ROOT / old.lstrip("/")
        path = path / "index.html" if old.endswith("/") else path
        assert is_redirect_stub(path), old
        page = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        assert page.find("link", rel="canonical")["href"] == new
        assert page.find("meta", attrs={"http-equiv": "refresh"})["content"] == f"0; url={new}"


def test_moved_urls_leave_the_sitemap() -> None:
    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    for old, _ in moved_pages():
        assert f"https://lab.ugatta-llc.com{old}</loc>" not in sitemap, old
    for slug in AI_ARTICLES:
        assert f"https://lab.ugatta-llc.com/classics-ai-management/hanfeizi/{slug}/</loc>" in sitemap


def test_lab_pages_do_not_link_to_the_moved_sites() -> None:
    moved = {old for old, _ in moved_pages()}
    pages = [path for path in filter(is_published, ROOT.rglob("*.html"))
             if not {"docs", "tourism-market-signal"} & set(path.relative_to(ROOT).parts) and not is_redirect_stub(path)]
    assert pages
    for path in pages:
        page = BeautifulSoup(rendered(path), "html.parser")
        for link in page.find_all("a", href=True):
            href = link["href"].split("#")[0].split("?")[0]
            assert href not in moved, (path, href)
            assert not href.startswith(NEW_HOSTS), (path, href)


def test_ai_classics_articles_and_market_signal_stay() -> None:
    for slug in AI_ARTICLES:
        assert not is_redirect_stub(ROOT / f"classics-ai-management/hanfeizi/{slug}/index.html")
    assert not is_redirect_stub(ROOT / "classics-ai-management/index.html")
    assert (ROOT / "report.html").exists()
    tools = (ROOT / "_data" / "tools.yml").read_text(encoding="utf-8")
    assert "market-signal" in tools and "edinet-investment-radar" not in tools
