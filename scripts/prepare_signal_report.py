"""Apply the Lab presentation to a freshly synced report; preserve its data.

The synced pages also get a robots meta tag. The daily report is read through the
iframe on /report.html, so its own URL stays out of search results while its
content can still count for the embedding page (noindex, indexifembedded). The
per-day and per-stock pages under reports/ are research notes on individual
listed companies, outside the Lab's subject, so they are kept out of search.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'tourism-market-signal'
EMBEDDED_ONLY = 'noindex, indexifembedded'
NOINDEX = 'noindex'
ROBOTS = re.compile(r'<meta\s+name="robots"[^>]*>', re.I)
STYLE = '<link rel="stylesheet" href="../css/report-signal.css?v=20261006compact1">'
FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&amp;display=swap">'


def prepare(html: str) -> str:
    if 'class="report-summary"' in html:
        return html
    hero = re.search(r'<section class="hero">(.*?)</section>', html, re.S)
    notice = re.search(r'<aside class="data-notice".*?</aside>', html, re.S)
    if not hero or not notice:
        raise ValueError('Report structure changed: expected hero and data notice')
    date = re.search(r'<p class="report-date">(.*?)</p>', hero[1], re.S)
    quality = re.search(r'<div class="quality">.*?</div>', hero[1], re.S)
    description = re.search(r'<p>(.*?)</p>', hero[1], re.S)
    if not date or not quality or not description:
        raise ValueError('Report structure changed: expected date, quality and description')
    summary = ('<section class="report-summary">\n'
               f'  <h1>{date[1]}</h1>\n  {quality[0]}\n</section>')
    details = ('<details class="report-method">\n'
               '  <summary>データの日時・集計方法・利用上の注意</summary>\n'
               f'  {description[0]}\n{notice[0]}\n</details>')
    html = html.replace(hero[0], summary).replace(notice[0], details)
    html = re.sub(r'\s*<header class="site-header">.*?</header>', '', html, count=1, flags=re.S)
    html, count = re.subn(r'<link rel="stylesheet" href="assets/style\.css[^\"]*">', STYLE, html, count=1)
    if count != 1:
        raise ValueError('Report structure changed: expected report stylesheet')
    if 'fonts.googleapis.com/css2?family=Noto+Sans+JP' not in html:
        html = html.replace('</head>', f'  {FONT}\n</head>', 1)
    return html


def set_robots(html: str, content: str) -> str:
    """Set one robots meta tag in <head>, replacing any the upstream page carries."""
    tag = f'<meta name="robots" content="{content}">'
    if ROBOTS.search(html):
        return ROBOTS.sub(tag, html, count=1)
    if '</head>' not in html:
        raise ValueError('Report structure changed: expected </head>')
    return html.replace('</head>', f'  {tag}\n</head>', 1)


def rewrite(path: Path, change) -> None:
    original = path.read_text(encoding='utf-8')
    changed = change(original)
    if changed != original:
        path.write_text(changed, encoding='utf-8')


def prepare_tree(root: Path = REPORT) -> None:
    rewrite(root / 'index.html', lambda html: set_robots(prepare(html), EMBEDDED_ONLY))
    for path in sorted((root / 'reports').rglob('*.html')):
        rewrite(path, lambda html: set_robots(html, NOINDEX))


if __name__ == '__main__':
    prepare_tree()
