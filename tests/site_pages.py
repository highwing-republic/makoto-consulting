"""Read pages the way GitHub Pages publishes them.

Pages that start with Jekyll front matter are rendered with Liquid at build
time: they pull the shared header and footer from _includes/, and the tool
pages fill the standard blocks (overview, sources, related tools) from their
front matter and from _data/tools.yml. Tests that check that markup read the
page through ``rendered`` so they see the same HTML visitors receive.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml
from liquid import DictLoader, Environment

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = re.compile(r"\{%\s*include\s+([\w.-]+)\s*%\}")
FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.S)


def _quote_includes(text: str) -> str:
    """Jekyll accepts ``{% include name.html %}``; Liquid proper wants the name quoted."""
    return INCLUDE.sub(lambda match: "{% include '" + match.group(1) + "' %}", text)


@lru_cache(maxsize=1)
def site_data() -> dict:
    data = {}
    for path in sorted((ROOT / "_data").glob("*.yml")):
        data[path.stem] = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data


@lru_cache(maxsize=1)
def liquid_env() -> Environment:
    includes = {path.name: _quote_includes(path.read_text(encoding="utf-8")) for path in (ROOT / "_includes").iterdir() if path.is_file()}
    return Environment(loader=DictLoader(includes), autoescape=False)


def is_published(path: Path) -> bool:
    """Jekyll skips directories and files whose names start with _ or ."""
    return not any(part.startswith(("_", ".")) for part in path.relative_to(ROOT).parts)


def rendered(path: Path | str) -> str:
    path = ROOT / path
    text = path.read_text(encoding="utf-8")
    if not FRONT_MATTER.match(text):
        return text
    match = FRONT_MATTER.match(text)
    page = yaml.safe_load(match.group(1)) or {}
    body = _quote_includes(text[match.end():])
    return liquid_env().from_string(body).render(page=page, site={"data": site_data()})
