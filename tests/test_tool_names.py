"""Each tool goes by one name: on its own page, on the home page and in llms.txt.

The page's own name (its H1, breadcrumb and structured data) is the canonical one;
the registry, the home cards and llms.txt link to the tool with that name, so the
link text and the page agree on what the page is about. Former names stay only as
alternateName in the structured data.
"""
import json
import re

import yaml
from bs4 import BeautifulSoup

from site_pages import ROOT, rendered

LAB = "https://lab.ugatta-llc.com"


def soup(path):
    return BeautifulSoup(rendered(path), "html.parser")


def nodes(page):
    found = []
    for script in page.select('script[type="application/ld+json"]'):
        data = json.loads(script.string)
        found.extend(data.get("@graph", [data]))
    return found


def compact(text):
    return re.sub(r"\s+", "", text)


def registry():
    return yaml.safe_load((ROOT / "_data/tools.yml").read_text(encoding="utf-8"))


def test_home_cards_structured_data_and_llms_use_the_registry_name():
    home = soup("index.html")
    cards = {card["data-tool-id"]: card.h4.get_text(strip=True) for card in home.select(".analysis-card[data-tool-id]")}
    [collection] = [node for node in nodes(home) if node.get("@type") == "CollectionPage"]
    listed = {item["url"]: item["name"] for item in collection["mainEntity"]["itemListElement"]}
    llms = dict((url, name) for name, url in re.findall(r"- \[([^\]]+)\]\((https://[^)]+)\)", (ROOT / "llms.txt").read_text(encoding="utf-8")))
    for tool in registry():
        assert cards[tool["id"]] == tool["title"], tool["id"]
        assert tool["title"].startswith(listed[LAB + tool["url"]]), tool["id"]
        if LAB + tool["url"] in llms:
            assert llms[LAB + tool["url"]].startswith(tool["title"]), tool["id"]


def test_each_tool_page_names_itself_the_way_the_home_page_links_to_it():
    for tool in registry():
        if not tool["url"].endswith(".html"):
            continue
        page = soup(tool["url"].lstrip("/"))
        graph = nodes(page)
        [crumbs] = [node for node in graph if node.get("@type") == "BreadcrumbList"]
        name = crumbs["itemListElement"][-1]["name"]
        assert page.select(".breadcrumb li")[-1].get_text(strip=True) in name, tool["url"]
        for app in (node for node in graph if node.get("@type") == "WebApplication"):
            assert app["name"] == name and app.get("alternateName") != name, tool["url"]
        assert compact(tool["title"]) in compact(name), tool["url"]
        assert compact(name) in compact(page.h1.get_text()), tool["url"]


def test_shortened_titles_lead_with_the_tool_name_and_end_with_the_site_name():
    for path in ("inbound-analysis.html", "supply-demand-gap-analysis.html"):
        page = soup(path)
        title = page.title.get_text()
        name = page.select(".breadcrumb li")[-1].get_text(strip=True)
        assert title.startswith(name + "｜") and title.endswith("｜宿泊DXラボ"), path
        assert len(title) <= 32, (path, len(title))
        assert page.find("meta", property="og:title")["content"] == title, path
