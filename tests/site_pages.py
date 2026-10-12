"""Read pages the way GitHub Pages publishes them.

Pages that start with Jekyll front matter pull the shared header and footer
from _includes/ at build time. Tests that check that markup read the page
through ``rendered`` so they see the same HTML visitors receive.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = re.compile(r"\{%\s*include\s+([\w.-]+)\s*%\}")
FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n", re.S)


def is_published(path: Path) -> bool:
    """Jekyll skips directories and files whose names start with _ or ."""
    return not any(part.startswith(("_", ".")) for part in path.relative_to(ROOT).parts)


def rendered(path: Path | str) -> str:
    path = ROOT / path
    text = path.read_text(encoding="utf-8")
    if not FRONT_MATTER.match(text):
        return text
    text = FRONT_MATTER.sub("", text, count=1)
    return INCLUDE.sub(lambda match: (ROOT / "_includes" / match.group(1)).read_text(encoding="utf-8").rstrip("\n"), text)
