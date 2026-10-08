from bs4 import BeautifulSoup
import pytest

from scripts.prepare_signal_report import prepare

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


def test_upstream_header_is_removed_and_new_report_date_is_used():
    source = original_report().replace('<body>', '<body><header class="site-header">Upstream title</header>')
    source = source.replace('2026年10月2日 レポート', '2026年10月5日 レポート')
    result = BeautifulSoup(prepare(source), 'html.parser')
    assert not result.select_one('.site-header')
    assert result.h1.get_text() == '2026年10月5日 レポート'


def test_unrecognized_upstream_markup_fails_instead_of_dropping_data():
    with pytest.raises(ValueError):
        prepare('<html><body>Changed upstream structure</body></html>')
