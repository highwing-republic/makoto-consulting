"""Apply the Lab presentation to a freshly synced report; preserve its data."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
STYLE = '<link rel="stylesheet" href="../css/report-signal.css?v=20261003compact1">'
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


if __name__ == '__main__':
    path = ROOT / 'tourism-market-signal/index.html'
    original = path.read_text(encoding='utf-8')
    prepared = prepare(original)
    if prepared != original:
        path.write_text(prepared, encoding='utf-8')
