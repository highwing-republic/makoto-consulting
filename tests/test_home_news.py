import json
from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]


def test_news_section_sits_between_hero_and_tools_and_starts_hidden():
    page = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser")
    main_sections = page.select("main > section")
    assert [section.get("class", [""])[0] for section in main_sections[:3]] == [
        "home-hero",
        "home-news",
        "home-section",
    ]
    section = page.find(id="whats-new")
    assert section.has_attr("hidden")
    assert section.get("data-news-url") == "data/news.json"
    assert section.select_one("[data-news-list][aria-live='polite']")
    assert page.find("script", src="js/news.js?v=20261010")


def test_initial_news_records_are_valid_and_point_to_published_pages():
    records = json.loads((ROOT / "data" / "news.json").read_text(encoding="utf-8"))
    assert len(records) == 3
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
    css = (ROOT / "css" / "home-theme.css").read_text(encoding="utf-8")
    assert ".home-news__grid{display:grid;grid-template-columns:240px minmax(0,1fr)" in css
    assert "@media(max-width:768px)" in css
    assert ".home-news__grid{grid-template-columns:1fr" in css
    assert ".news-list__title{grid-column:1;grid-row:2" in css
