"""Search basics for the Lab: site name, operator, breadcrumbs and honest counts.

The home page names the site and says who it is for; the structured data ties the
Lab to its operator (合同会社UGATTA) and its note account, so search engines can
tell the official site from the note profile of the same name.
"""
import json
import re

import yaml
from bs4 import BeautifulSoup

from site_pages import ROOT, rendered

LAB = "https://lab.ugatta-llc.com/"
LAB_ORG = LAB + "#organization"
UGATTA_ORG = "https://ugatta-llc.com/#organization"
NOTE = "https://note.com/hotel_dx_lab"
TOOL_PAGES = [
    "dx-diagnosis.html", "inbound-analysis.html", "dx-necessity-analysis.html",
    "supply-demand-gap-analysis.html", "tourism-pressure-analysis.html",
    "management-ai.html", "hotel-price-trends.html", "report.html",
]


def soup(path):
    return BeautifulSoup(rendered(path), "html.parser")


def graph(page):
    nodes = []
    for script in page.select('script[type="application/ld+json"]'):
        data = json.loads(script.string)
        nodes.extend(data.get("@graph", [data]))
    return nodes


def by_type(nodes, kind):
    return [node for node in nodes if node.get("@type") == kind]


def test_home_title_and_description_name_the_site_and_its_audience():
    page = soup("index.html")
    title = page.title.get_text()
    assert title.startswith("宿泊DXラボ｜") and "旅館・ホテル" in title
    assert page.find("meta", property="og:title")["content"] == title
    assert page.find("meta", attrs={"name": "twitter:title"})["content"] == title
    description = page.find("meta", attrs={"name": "description"})["content"]
    assert description.startswith("宿泊DXラボは、旅館・ホテル") and "合同会社UGATTA" in description
    assert "旅館・ホテル" in page.select_one(".home-hero__lead").get_text()


def test_home_structured_data_links_site_operator_and_note():
    nodes = graph(soup("index.html"))
    [site] = by_type(nodes, "WebSite")
    assert site["name"] == "宿泊DXラボ" and site["url"] == LAB
    assert site["publisher"] == {"@id": LAB_ORG}
    orgs = {node["@id"]: node for node in by_type(nodes, "Organization")}
    lab = orgs[LAB_ORG]
    assert lab["name"] == "宿泊DXラボ" and lab["url"] == LAB
    assert lab["parentOrganization"] == {"@id": UGATTA_ORG}
    assert NOTE in lab["sameAs"]
    assert orgs[UGATTA_ORG]["name"] == "合同会社UGATTA"
    assert orgs[UGATTA_ORG]["url"] == "https://ugatta-llc.com/"


def test_home_tool_count_matches_the_tool_registry():
    tools = yaml.safe_load((ROOT / "_data/tools.yml").read_text(encoding="utf-8"))
    samples = [tool for tool in tools if "サンプル" in tool["tag"]]
    text = soup("index.html").select_one(".tool-groups > p").get_text()
    count = int(re.search(r"公開中の(\d+)ツール", text).group(1))
    assert count == len(tools) - len(samples)
    assert samples and "サンプルレポート" in text


def test_tool_pages_have_breadcrumbs_and_name_the_lab_as_provider():
    for path in TOOL_PAGES:
        page = soup(path)
        canonical = page.find("link", rel="canonical")["href"]
        nodes = graph(page)
        [crumbs] = by_type(nodes, "BreadcrumbList")
        items = crumbs["itemListElement"]
        visible = [item.get_text(strip=True) for item in page.select("nav.breadcrumb li")]
        assert len(items) == len(visible) == 3, path
        assert items[0]["item"] == LAB and items[-1]["item"] == canonical, path
        for app in by_type(nodes, "WebApplication"):
            assert app["provider"]["@id"] == LAB_ORG, path
