import json
from pathlib import Path
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'classics-ai-management'


def test_reader_preserves_all_fifteen_passages_and_sources():
    data = json.loads((BASE / 'data/sunzi/01_shikei.json').read_text(encoding='utf-8'))
    page = BeautifulSoup((BASE / 'sunzi/shikei/index.html').read_text(encoding='utf-8'), 'html.parser')
    assert len(data) == 15
    assert [p['id'] for p in page.select('.passage')] == [p['id'] for p in data]
    assert [a['href'] for a in page.select('#contents a')] == ['#' + p['id'] for p in data]
    for item in data:
        section = page.find(id=item['id'])
        for field in ('original', 'kundoku', 'modern_ja', 'commentary'):
            assert section.select_one(f'[data-field="{field}"]').get_text() == item[field]
        assert section.select_one('.source-citation a')['href'] == item['source']['reference']
    assert '乱るれば之を取り' in data[11]['kundoku']


def test_reader_routes_assets_and_anchor_targets_exist():
    for path in [BASE / 'sunzi/index.html', BASE / 'sunzi/shikei/index.html']:
        page = BeautifulSoup(path.read_text(encoding='utf-8'), 'html.parser')
        ids = [tag['id'] for tag in page.select('[id]')]
        assert len(ids) == len(set(ids))
        for tag in page.select('a[href], link[href], script[src]'):
            url = urlsplit(tag.get('href', tag.get('src')))
            if url.scheme or url.netloc:
                continue
            if not url.path:
                assert not url.fragment or url.fragment in ids
                continue
            target = ROOT / url.path.lstrip('/')
            if target.is_dir():
                target /= 'index.html'
            assert target.is_file(), url.path
    hub = BeautifulSoup((BASE / 'index.html').read_text(encoding='utf-8'), 'html.parser')
    assert hub.select_one('a[href="/classics-ai-management/sunzi/shikei/"]')
