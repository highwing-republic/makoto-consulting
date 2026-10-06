"""Optional browser acceptance check: python tests/browser_brand_regression.py OUTPUT_DIR.

Requires Playwright and installed Chrome. Output stays outside the repository.
Analytics requests are stubbed so acceptance checks do not generate real visits.
"""
import functools
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main(destination):
    destination.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    manifest = json.loads((ROOT / 'data/hotel-price-trends/manifest.json').read_text(encoding='utf-8'))
    snapshot = json.loads((ROOT / 'data/hotel-price-trends' / manifest['snapshots'][0]['file']).read_text(encoding='utf-8'))
    region = next(item for item in snapshot['regions'] if item['code'] == 'noboribetsu-onsen')
    stay_date = min(row['stay_date'] for row in region['rates'])
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(reduced_motion='reduce')
        context.route('**/googletagmanager.com/**', lambda r: r.fulfill(status=200, body=''))
        context.route('**/google-analytics.com/**', lambda r: r.fulfill(status=204))
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        def visit(name):
            page.goto(base + name, wait_until='networkidle')
            page.evaluate('document.fonts.ready')

        def capture(name, width):
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), (name, width)
            page.screenshot(path=str(destination / f'{name}-{width}.png'), full_page=True)
            results.append({'scenario': name, 'width': width, 'overflow': False})

        for width in (1440, 768, 390):
            page.set_viewport_size({'width': width, 'height': 1000})
            visit(f'hotel-price-trends.html?region=noboribetsu-onsen&hotel_no=30109&stay_date={stay_date}&meal_type=two_meals')
            assert page.locator('#hpt-dashboard').is_visible()
            assert page.locator('#hpt-region').input_value() == 'noboribetsu-onsen'
            assert page.locator('#hpt-hotel').input_value() == '30109'
            # A shared stay_date opens the price detail with that date selected.
            assert page.locator('#hpt-detail-price').evaluate('(e)=>e.open')
            assert page.locator('#hpt-stay-date').input_value() == stay_date
            assert page.locator('#hpt-meal').input_value() == 'two_meals'
            assert page.locator('#hpt-market-trend').is_visible()
            assert page.locator('#hpt-core-list .hpt-core-row').count() == 5
            assert page.locator('#hpt-core-list .hpt-core-row--selected').count() == 1
            assert page.locator('#hpt-calendar .hpt-calendar-cell').count() > 0
            assert page.locator('#hpt-review').count() == 0
            assert page.locator('.hpt-market-band').count() == 0
            # Legacy Nagano regions stay in the data but are not offered in the UI.
            options = page.locator('#hpt-region option').evaluate_all('(es)=>es.map(e=>e.value)')
            assert 'nagano-city' not in options and 'kamisuwa-onsen' not in options
            assert page.locator('#hpt-market-chips [data-region]').count() == len(options)
            page.locator('#hpt-detail-ratings summary').click()
            for selector, prop, expected in [
                ('.hpt-selected-line', 'stroke', 'rgb(184, 145, 63)'),
                ('.hpt-market-line', 'stroke', 'rgb(111, 140, 153)'),
                ('.hpt-rating-track i', 'backgroundColor', 'rgb(184, 145, 63)'),
                ('.hpt-rating-track b', 'backgroundColor', 'rgb(111, 140, 153)'),
            ]:
                if page.locator(selector).count():
                    assert page.locator(selector).first.evaluate('(e,p)=>getComputedStyle(e)[p]', prop) == expected
            for node in page.locator('.hpt-kpi__value--status').all():
                assert float(node.evaluate('(e)=>getComputedStyle(e).fontSize').replace('px','')) <= 20
            capture('hotel-phase1-market', width)
            page.locator('#hpt-market-chips [data-region]').last.click()
            assert page.locator('#hpt-region').input_value() == options[-1]
            for meal in ('breakfast', 'room_only'):
                page.select_option('#hpt-meal', meal)
                assert f'meal_type={meal}' in page.url
            capture('hotel-market-switch', width)
            visit('hotel-price-trends.html?region=kamisuwa-onsen&hotel_no=28001&meal_type=two_meals')
            assert page.locator('#hpt-region').input_value() == options[0]
            assert 'stay_date=' not in page.url

            for name in ('inbound-analysis', 'dx-necessity-analysis', 'supply-demand-gap-analysis', 'tourism-pressure-analysis'):
                visit(name + '.html?pref=nagano')
                assert page.locator('#selected-area-name').inner_text() == '長野県'
                assert page.locator('#analysis-dashboard').is_visible()
                page.select_option('#prefecture-select', label='東京都')
                assert page.locator('#selected-area-name').inner_text() == '東京都'
                assert 'pref=tokyo' in page.url
                if name == 'supply-demand-gap-analysis':
                    point = page.locator('.scatter-point').first
                    point.focus()
                    point.press('Enter')
                    assert page.locator('.scatter-point.is-selected').count() == 1
                capture(name, width)

            visit('dx-diagnosis.html')
            page.locator('input[name=rooms]').fill('0')
            page.locator('#dx-facility-form button[type=submit]').click()
            assert page.locator('input[name=rooms]').get_attribute('aria-invalid') == 'true'
            assert page.locator('input[name=rooms]').evaluate('(e)=>document.activeElement===e')
            page.locator('input[name=rooms]').fill('30')
            page.locator('#dx-facility-form button[type=submit]').click()
            assert page.locator('.dx-question').count() == 16
            assert page.locator('#dx-step-heading').evaluate('(e)=>document.activeElement===e')
            page.locator('.dx-options label').first.click()
            assert page.locator('.dx-options input').first.is_checked()
            capture('diagnosis-questions', width)
            page.locator('#dx-question-form button[type=submit]').click()
            assert page.locator('.dx-score-ring strong').inner_text().isdigit()
            page.locator('#dx-tab-radar').click()
            assert page.locator('#dx-panel-radar').is_visible()
            page.locator('#dx-tab-radar').press('ArrowLeft')
            assert page.locator('#dx-panel-bars').is_visible()
            capture('diagnosis-results', width)
            page.locator('[data-reset]').first.click()
            assert page.locator('#dx-facility-form').is_visible()

            visit('management-ai.html?pref=nagano')
            page.locator('input[name=topic][value=sales]').locator('..').click()
            page.select_option('#management-prefecture', label='長野県')
            page.locator('.management-optional summary').click()
            page.locator('#facility-rooms').fill('30')
            page.locator('#facility-employees').fill('12')
            page.locator('#facility-occupancy').fill('62')
            page.locator('#management-question').fill('フロント業務を効率化したい')
            page.locator('#management-ai-form button[type=submit]').click()
            assert page.locator('#management-result').is_visible()
            assert page.locator('#answer-status').inner_text()
            assert 'Noto Sans JP' in page.locator('.management-step__number').first.evaluate('(e)=>getComputedStyle(e).fontFamily')
            assert page.locator('#answer-status').evaluate('(e)=>getComputedStyle(e).fontWeight') == '400'
            capture('management-answer', width)

        # All 19 shell consumers, including classic readers and EDINET pages.
        pages = [f for f in ROOT.rglob('*.html') if not {'.git', 'docs', 'tourism-market-signal'} & set(f.relative_to(ROOT).parts)]
        assert len(pages) == 19
        page.set_viewport_size({'width': 1440, 'height': 1000})
        for file in pages:
            visit(file.relative_to(ROOT).as_posix())
            assert page.locator('.site-header').is_visible()
            assert page.locator('footer a[href="https://ugatta-llc.com/"]').count()
            if 'classics-ai-management' in file.parts:
                family = page.locator('h1').evaluate('(e)=>getComputedStyle(e).fontFamily')
                assert 'Mincho' in family and 'Noto Sans JP' not in family, (file, family)
            for code in page.locator('.lab-code').all():
                assert code.evaluate('(e)=>getComputedStyle(e).fontWeight') == '400'
                assert 'DotGothic16' in code.evaluate('(e)=>getComputedStyle(e).fontFamily')
        assert not errors, errors
        results.append({'all_shell_pages': len(pages), 'console_errors': errors})
        browser.close()
    server.shutdown()
    (destination / 'acceptance.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'scenarios': len(results)-1, 'all_shell_pages':19, 'console_errors':errors}))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
