"""/llms.txt: the AI-facing summary of the lab must list every public tool and only real pages."""
from __future__ import annotations

import re

import yaml

from site_pages import ROOT

SITE = "https://lab.ugatta-llc.com"


def text() -> str:
    return (ROOT / "llms.txt").read_text(encoding="utf-8")


def local_file(url: str):
    path = url.removeprefix(SITE).split("?")[0].lstrip("/")
    return ROOT / (path + "index.html" if path == "" or path.endswith("/") else path)


def test_llms_txt_follows_the_llms_txt_shape() -> None:
    body = text()
    lines = body.splitlines()
    assert lines[0] == "# 宿泊DXラボ"
    assert next(line for line in lines[1:] if line.strip()).startswith("> ")
    assert [line for line in lines if line.startswith("## ")][-1] == "## Optional"
    assert "合同会社UGATTA" in body and "https://forms.gle/yjinqFdntoXhTmgk7" in body
    assert "架空" in body


def test_llms_txt_lists_every_tool_in_the_catalog() -> None:
    body = text()
    for tool in yaml.safe_load((ROOT / "_data/tools.yml").read_text(encoding="utf-8")):
        assert f"]({SITE}{tool['url']})" in body, tool["id"]


def test_llms_txt_links_only_to_public_pages() -> None:
    links = re.findall(r"\]\((https://lab\.ugatta-llc\.com[^)]*)\)", text())
    assert links
    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    for url in links:
        assert local_file(url).exists(), url
        if not url.endswith("sitemap.xml"):
            assert f"<loc>{url}</loc>" in sitemap, url
    assert "hotel-before" not in text()
