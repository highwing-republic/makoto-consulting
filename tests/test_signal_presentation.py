from pathlib import Path

from bs4 import BeautifulSoup
import pytest

from scripts.prepare_signal_report import EMBEDDED_ONLY, NOINDEX, prepare, prepare_tree, set_robots

def original_report():
    return '''<!doctype html><html><head><title>Daily report</title>
<link rel="stylesheet" href="assets/style.css">
<script src="assets/embed.js" defer></script></head><body><main>
<section class="hero"><p class="report-date">2026年10月2日 レポート</p>
<h1>Promotional heading</h1><p>Closing prices, not live prices.</p>
<div class="quality"><span>50 / 50</span><span>Updated 08:18</span></div></section>
<aside class="data-notice" aria-label="Data dates"><p>Reference only.</p>
<details><summary>Dates</summary><table><tr><td>2026-10-01</td></tr></table></details></aside>
<section><div class="wind-grid"><article>Short -33 / Medium -58 / Long -20</article></div></section>
<section><div class="driver-grid"><p>Index +2.67%</p></div></section>
<section><div class="signal-grid"><a href="reports/9722-t.html">9722: 3,000.00</a></div></section>
<table class="ranking-table"><tr><td>1</td><td>9722</td><td>90.5</td></tr></table>
</main></body></html>'''


def test_sync_keeps_data_and_disclosures_and_is_repeatable():
    source = original_report()
    result = prepare(source)
    assert prepare(result) == result
    before = BeautifulSoup(source, 'html.parser')
    after = BeautifulSoup(result, 'html.parser')
    for selector in ['.quality', '.data-notice', '.wind-grid', '.driver-grid', '.signal-grid', '.ranking-table']:
        assert str(before.select_one(selector)) == str(after.select_one(selector)), selector
    assert before.select_one('.report-date').get_text() == after.h1.get_text()
    assert after.select_one('.report-method .data-notice')
    assert not after.select_one('.report-method').has_attr('open')
    assert after.head.title == before.head.title
    assert after.find_all('script') == before.find_all('script')
    styles = [link['href'] for link in after.select('link[rel="stylesheet"]')]
    assert any(href.startswith('../css/report-signal.css?') for href in styles)
    assert any('family=Noto+Sans+JP' in href for href in styles)
    assert 'assets/style.css' not in styles


def test_upstream_header_is_removed_and_new_report_date_is_used():
    source = original_report().replace('<body>', '<body><header class="site-header">Upstream title</header>')
    source = source.replace('2026年10月2日 レポート', '2026年10月5日 レポート')
    result = BeautifulSoup(prepare(source), 'html.parser')
    assert not result.select_one('.site-header')
    assert result.h1.get_text() == '2026年10月5日 レポート'


def test_unrecognized_upstream_markup_fails_instead_of_dropping_data():
    with pytest.raises(ValueError):
        prepare('<html><body>Changed upstream structure</body></html>')


def robots(html):
    return [tag['content'] for tag in BeautifulSoup(html, 'html.parser').select('meta[name="robots"]')]


def stock_page():
    return '<!doctype html><html><head><meta charset="utf-8"><title>9722 | Signal</title></head><body><h1>9722</h1></body></html>'


def test_robots_tag_is_added_once_and_replaces_upstream_values():
    once = set_robots(stock_page(), NOINDEX)
    assert robots(once) == ['noindex']
    assert set_robots(once, NOINDEX) == once
    upstream = stock_page().replace('<title>', '<meta name="robots" content="index,follow"><title>')
    assert robots(set_robots(upstream, NOINDEX)) == ['noindex']


def test_robots_tag_needs_a_head():
    with pytest.raises(ValueError):
        set_robots('<p>no head</p>', NOINDEX)


def test_sync_keeps_daily_report_embeddable_and_stock_pages_out_of_search(tmp_path):
    (tmp_path / 'reports/2026-10-15').mkdir(parents=True)
    (tmp_path / 'index.html').write_text(original_report(), encoding='utf-8')
    (tmp_path / 'reports/2026-10-15/index.html').write_text(stock_page(), encoding='utf-8')
    (tmp_path / 'reports/2026-10-15/9722-t.html').write_text(stock_page(), encoding='utf-8')
    prepare_tree(tmp_path)
    first = {path: path.read_text(encoding='utf-8') for path in tmp_path.rglob('*.html')}
    prepare_tree(tmp_path)
    assert {path: path.read_text(encoding='utf-8') for path in tmp_path.rglob('*.html')} == first
    index = first[tmp_path / 'index.html']
    assert robots(index) == [EMBEDDED_ONLY]
    assert 'class="report-summary"' in index
    for name in ['reports/2026-10-15/index.html', 'reports/2026-10-15/9722-t.html']:
        assert robots(first[tmp_path / name]) == ['noindex'], name


def test_synced_report_is_not_listed_in_the_sitemap():
    sitemap = (Path(__file__).resolve().parents[1] / 'sitemap.xml').read_text(encoding='utf-8')
    assert '/tourism-market-signal/' not in sitemap
