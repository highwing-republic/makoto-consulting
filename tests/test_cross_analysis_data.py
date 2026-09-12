import json
import math
import subprocess
from pathlib import Path

from bs4 import BeautifulSoup

from scripts.update_cross_analysis_data import (
    PREFECTURE_BY_CODE,
    calculate_ranking,
    classify_supply_market,
    classify_tourism_region,
    percentile_rank,
    weighted_score,
)


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "analysis"
FILES = (
    "prefecture-statistics.json",
    "dx-necessity.json",
    "supply-demand-gap.json",
    "tourism-pressure.json",
)
PAGES = (
    "dx-necessity-analysis.html",
    "supply-demand-gap-analysis.html",
    "tourism-pressure-analysis.html",
)


def load(name):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def walk(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)
    else:
        yield value


def test_all_datasets_have_exactly_47_prefectures():
    for name in FILES:
        data = load(name)
        assert set(data["prefectures"]) == set(PREFECTURE_BY_CODE)
        assert len({item["prefecture_slug"] for item in data["prefectures"].values()}) == 47


def test_public_values_and_scores_are_valid():
    for name in FILES:
        data = load(name)
        for value in walk(data):
            if isinstance(value, float):
                assert math.isfinite(value)
        for item in data["prefectures"].values():
            assert item["population"] > 0
            assert item["total_guest_nights"] >= 0
            assert item["lodging_establishments"] >= 0
            assert 0 <= item["occupancy_rate"] <= 100
            for key in ("score", "pressure_score", "dependency_score"):
                if key in item:
                    assert 0 <= item[key] <= 100


def test_representative_prefectures_are_not_placeholders():
    data = load("prefecture-statistics.json")["prefectures"]
    for code in ("01", "13", "20", "26", "46", "47"):
        item = data[code]
        assert item["total_guest_nights"] > 0
        assert item["population"] > 100_000
        assert item["lodging_employees"] > 0


def test_percentile_rank_handles_ties():
    assert percentile_rank({"a": 10, "b": 20, "c": 20, "d": 40}) == {
        "a": 0.0, "b": 50.0, "c": 50.0, "d": 100.0
    }


def test_ranking_and_missing_value_handling():
    assert calculate_ranking({"a": 80, "b": 80, "c": 40}) == {
        "a": 1, "b": 1, "c": 3
    }
    assert weighted_score([(50, 0.5), (None, 0.5)]) is None


def test_four_quadrant_classification():
    assert classify_supply_market(2, 2, 1, 1) == "需給ひっ迫候補"
    assert classify_supply_market(2, 0, 1, 1) == "需要成長・供給余力型"
    assert classify_supply_market(0, 2, 1, 1) == "高稼働・成熟型"
    assert classify_supply_market(0, 0, 1, 1) == "需給軟調型"
    assert classify_tourism_region(70, 70) == "観光重要度・負荷ともに高い地域"
    assert classify_tourism_region(30, 70) == "観光産業比重型"
    assert classify_tourism_region(70, 30) == "来訪集中型"
    assert classify_tourism_region(30, 30) == "分散型"


def test_pages_start_with_loading_only_and_keep_noscript():
    for page in PAGES:
        source = (ROOT / page).read_text(encoding="utf-8")
        soup = BeautifulSoup(source, "html.parser")
        assert soup.find(id="data-loading") and not soup.find(id="data-loading").has_attr("hidden")
        assert soup.find(id="data-error").has_attr("hidden")
        assert not soup.find(id="data-error").get_text(strip=True)
        assert soup.find(id="analysis-dashboard").has_attr("hidden")
        assert soup.find("noscript")
        assert "サンプルデータ" not in source


def test_home_and_directory_list_tools_in_order():
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    assert all(label in home for label in ("旅館・ホテル", "インバウンド宿泊者分析", "観光株シグナル"))
    assert 'id="analysis-tools"' in home
    source = (ROOT / "useful.html").read_text(encoding="utf-8")
    positions = [source.index(f'>{number:02d}<') for number in range(1, 7)]
    assert positions == sorted(positions)


def test_pref_query_resolution_and_reload_contract():
    script = (
        "require('./js/cross-analysis.js');"
        "const rows=[{prefecture_slug:'tokyo'},{prefecture_slug:'nagano'}];"
        "const r=globalThis.CrossAnalysisUtils.resolvePrefectureSlug;"
        "console.log(JSON.stringify([r(rows,'nagano'),r(rows,'abc'),r(rows,null),r(rows,r(rows,'nagano'))]));"
    )
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True, text=True
    )
    assert json.loads(result.stdout) == ["nagano", "", "", "nagano"]


def test_responsive_layout_and_existing_tools_regression():
    css = (ROOT / "css" / "useful.css").read_text(encoding="utf-8")
    home_css = (ROOT / "css" / "home.css").read_text(encoding="utf-8")
    assert "@media(max-width:900px)" in css
    assert "@media(max-width:620px)" in css
    assert "repeat(auto-fit,minmax(min(100%,300px),1fr))" in home_css
    assert (ROOT / "dx-diagnosis.html").exists()
    assert (ROOT / "inbound-analysis.html").exists()
    assert 'id="tourism-market-signal"' in (ROOT / "useful.html").read_text(encoding="utf-8")


def test_source_metadata_has_official_ids_and_periods():
    sources = load("prefecture-statistics.json")["metadata"]["sources"]
    assert sources["lodging"]["statistics_code"] == "00601020"
    assert sources["population"]["statistics_code"] == "00200524"
    assert sources["economic_census"]["stats_data_id"] == "0004040078"
    assert sources["economic_census"]["stat_inf_id"] == "000040389322"
    assert sources["lodging"]["release_type"] == "第2次速報"
