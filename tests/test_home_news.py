import json
from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]


def test_news_section_sits_between_tools_and_about_and_starts_hidden():
    page = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser")
    assert [section.get("id") for section in page.select("main > section")] == [
        None, "analysis-tools", "whats-new", "about-lab",
    ]
    section = page.find(id="whats-new")
    assert section.has_attr("hidden")
    assert section.get("data-news-url") == "data/news.json?v=20261017c"
    assert section.select_one("[data-news-scroll][role='region'][tabindex='-1']")
    assert section.select_one("[data-news-list][aria-live='polite']")
    assert section.select_one("[data-news-scroll-hint][hidden]")
    assert page.find("script", src="js/news.js?v=20261016")
    assert page.find("link", href="css/home.css?v=20261016dot")
    assert not page.find("link", href=lambda value: value and "home-theme.css" in value)


def test_initial_news_records_are_valid_and_point_to_published_pages():
    records = json.loads((ROOT / "data" / "news.json").read_text(encoding="utf-8"))
    assert len(records) == 9
    assert len({record["id"] for record in records}) == len(records)
    assert {record["category"] for record in records} <= {"new", "update", "note"}
    assert records == sorted(records, key=lambda record: record["date"], reverse=True)
    for record in records:
        assert record["date"].count("-") == 2
        if record["url"].startswith("/"):
            path = record["url"].lstrip("/")
            target = ROOT / path
            if record["url"].endswith("/"):
                target /= "index.html"
            assert target.exists(), record


def test_news_styles_include_desktop_and_768px_mobile_layouts():
    assert not (ROOT / "css" / "home-theme.css").exists()  # merged into home.css
    css = (ROOT / "css" / "home.css").read_text(encoding="utf-8")
    assert ".news-list__category--new{background:#ffe2c5;color:#a63d00;font-weight:700}" in css
    assert ".news-list__category--update{background:#d8e3ee;color:#284767;font-weight:700}" in css
    assert ".home-news__grid{display:grid;grid-template-columns:220px minmax(0,1fr)" in css
    assert ".news-list-scroll{--news-row-height:68px;max-block-size:calc(var(--news-row-height)*5 + 1px);overflow-y:auto" in css
    assert ".news-list-scroll:focus-visible" in css
    assert "@media(max-width:768px)" in css
    assert ".home-news__grid{grid-template-columns:1fr" in css
    assert ".news-list__title{grid-column:1;grid-row:2" in css
