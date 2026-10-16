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
    assert classify_supply_market(2, 2, 1, 1) == "需要成長・高稼働型"
    assert classify_supply_market(2, 0, 1, 1) == "需要成長・稼働余力型"
    assert classify_supply_market(0, 2, 1, 1) == "需要減速・高稼働型"
    assert classify_supply_market(0, 0, 1, 1) == "需要減速・稼働余力型"
    assert classify_supply_market(1, 1, 1, 1) == "需要成長・高稼働型"
    assert classify_tourism_region(70, 70) == "観光重要度・負荷ともに高い地域"
    assert classify_tourism_region(30, 70) == "観光産業比重型"
    assert classify_tourism_region(70, 30) == "来訪集中型"
    assert classify_tourism_region(30, 30) == "分散型"


def test_supply_market_types_match_national_boundaries_for_all_prefectures():
    data = load("supply-demand-gap.json")
    national = data["national"]
    allowed = {
        "需要成長・高稼働型",
        "需要成長・稼働余力型",
        "需要減速・高稼働型",
        "需要減速・稼働余力型",
    }
    for item in data["prefectures"].values():
        expected = classify_supply_market(
            item["demand_growth_rate"],
            item["occupancy_rate"],
            national["demand_growth_rate"],
            national["occupancy_rate"],
        )
        assert item["market_type"] == expected
        assert item["market_type"] in allowed
        assert 1 <= item["rank"] <= 47
        assert all(0 <= value <= 100 for value in item["percentiles"].values())


def test_supply_score_is_explicitly_not_a_shortage_measure():
    scoring = load("supply-demand-gap.json")["metadata"]["scoring"]
    assert scoring["display_name"] == "追加調査優先度"
    assert scoring["basis"] == "prefecture_percentile"
    assert scoring["is_supply_shortage_measure"] is False
    assert sum(scoring["weights"].values()) == 1


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


def test_home_lists_tools_in_order():
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    assert all(label in home for label in ("旅館・ホテル", "インバウンド宿泊者分析", "観光株シグナル"))
    assert 'id="analysis-tools"' in home
    tool_ids = [
        "dx-diagnosis", "inbound", "supply-demand",
        "tourism-pressure", "market-signal", "hotel-price-trends",
        "management-issue-organizer",
    ]
    # The featured cards above the purpose groups repeat four of these tools,
    # so the order is checked inside the "目的から選ぶ" block.
    groups = home[home.index('class="tool-groups"'):]
    positions = [groups.index(f'data-tool-id="{tool_id}"') for tool_id in tool_ids]
    assert positions == sorted(positions)


def test_pref_query_resolution_and_reload_contract():
    script = (
        "require('./js/cross-analysis-model.js');"
        "const rows=[{prefecture_slug:'tokyo'},{prefecture_slug:'nagano'}];"
        "const r=globalThis.CrossAnalysisModel.resolvePrefectureSlug;"
        "console.log(JSON.stringify([r(rows,'nagano'),r(rows,'abc'),r(rows,null),r(rows,r(rows,'nagano'))]));"
    )
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True, text=True
    )
    assert json.loads(result.stdout) == ["nagano", "", "", "nagano"]


def test_supply_position_and_difference_helpers_cover_boundaries():
    script = (
        "require('./js/cross-analysis-model.js');"
        "const u=globalThis.CrossAnalysisModel;"
        "console.log(JSON.stringify(["
        "u.classifySupplyPosition(2,2,1,1),"
        "u.classifySupplyPosition(2,0,1,1),"
        "u.classifySupplyPosition(0,2,1,1),"
        "u.classifySupplyPosition(0,0,1,1),"
        "u.classifySupplyPosition(1,1,1,1),"
        "u.differenceLabel(.051,-.025,'growth'),"
        "u.differenceLabel(60.5,61.1,'occupancy'),"
        "u.relativePositionLabel(6.5),"
        "u.relativePositionLabel(73.9)"
        "]));"
    )
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True,
        text=True, encoding="utf-8"
    )
    values = json.loads(result.stdout)
    assert values[:5] == [
        "需要成長・高稼働型",
        "需要成長・稼働余力型",
        "需要減速・高稼働型",
        "需要減速・稼働余力型",
        "需要成長・高稼働型",
    ]
    assert values[5]["comparison"] == "全国より高い"
    assert values[6]["comparison"] == "全国より低い"
    assert values[7] == "6.5百分位（下位約6.5%）"
    assert values[8] == "73.9百分位（上位約26.1%）"


def test_responsive_layout_and_existing_tools_regression():
    css = (ROOT / "css" / "useful.css").read_text(encoding="utf-8")
    home_css = (ROOT / "css" / "home.css").read_text(encoding="utf-8")
    assert "@media(max-width:900px)" in css
    assert "@media(max-width:620px)" in css
    assert ".analysis-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))" in home_css
    assert "@media(max-width:620px)" in home_css
    assert ".tool-cards,.analysis-grid{grid-template-columns:1fr}" in home_css
    assert (ROOT / "dx-diagnosis.html").exists()
    assert (ROOT / "inbound-analysis.html").exists()
    report = (ROOT / "report.html").read_text(encoding="utf-8")
    assert 'src="/tourism-market-signal/index.html' in report
    assert "github.io" not in report


def test_source_metadata_has_official_ids_and_periods():
    sources = load("prefecture-statistics.json")["metadata"]["sources"]
    assert sources["lodging"]["statistics_code"] == "00601020"
    assert sources["population"]["statistics_code"] == "00200524"
    assert sources["economic_census"]["stats_data_id"] == "0004040078"
    assert sources["economic_census"]["stat_inf_id"] == "000040389322"
    assert sources["lodging"]["release_type"] == "第2次速報"


def test_monthly_lodging_keeps_each_month_and_marks_the_basis_change():
    from scripts.update_cross_analysis_data import build_monthly_lodging, validate_monthly_lodging

    def record(total, foreign, occupancy):
        return {"total_guest_nights": total, "foreign_guest_nights": foreign, "used_rooms": 1, "occupancy_rate": occupancy}

    months = []
    for index in range(24):
        year, month = divmod(2024 * 12 + 7 + index, 12)
        months.append({
            "period": f"{year:04d}-{month + 1:02d}",
            "source_url": f"https://example.invalid/{index}.xlsx",
            "national": record(1000 + index, 100, 50.0),
            "prefectures": {code: record(100 + index, 10 if code != "15" else None, 40.5) for code in PREFECTURE_BY_CODE},
        })
    source = {
        "source_name": "観光庁「宿泊旅行統計調査」",
        "statistics_code": "00601020",
        "release_type": "第2次速報",
        "published_date": "2026-09-30",
        "source_url": "https://example.invalid/",
        "retrieved_at": "2026-10-16",
    }
    dataset = build_monthly_lodging(months, source)
    validate_monthly_lodging(dataset)

    assert dataset["periods"][0] == "2024-08" and dataset["periods"][-1] == "2026-07"
    assert dataset["basis"].count("before") == 17 and dataset["basis"].count("after") == 7
    assert dataset["basis"][dataset["periods"].index("2026-01")] == "after"
    assert dataset["national"]["total_guest_nights"][3] == 1003
    assert dataset["national"]["domestic_guest_nights"][3] == 903
    tokyo = dataset["prefectures"]["13"]
    assert tokyo["prefecture_slug"] == "tokyo" and tokyo["occupancy_rate"][0] == 40.5
    # 外国人が欠けている月は差し引きを作らない
    assert set(dataset["prefectures"]["15"]["domestic_guest_nights"]) == {None}
    assert dataset["metadata"]["basis_change_period"] == "2026-01"


def test_retired_dx_necessity_page_forwards_to_the_management_tool():
    # 地域の省人化・DX検討指標は 2026-10 に公開を終了した。データ（dx-necessity.json）は
    # 宿泊経営の課題整理が使うので残し、旧 URL は都道府県を引き継いで「人手不足・DX」へ送る。
    source = (ROOT / "dx-necessity-analysis.html").read_text(encoding="utf-8")
    page = BeautifulSoup(source, "html.parser")
    assert page.find("meta", attrs={"name": "robots"})["content"] == "noindex,follow"
    assert page.find("link", rel="canonical")["href"] == "https://lab.ugatta-llc.com/management-ai.html"
    assert page.find("meta", attrs={"http-equiv": "refresh"})["content"] == "0; url=/management-ai.html?topic=dx"
    assert 'get("pref")' in source and '"?topic=dx"' in source and "location.replace(\"/management-ai.html\"" in source
    assert (DATA_DIR / "dx-necessity.json").exists()
    for listing in ("sitemap.xml", "llms.txt", "_data/tools.yml", "index.html"):
        assert "dx-necessity-analysis" not in (ROOT / listing).read_text(encoding="utf-8"), listing
    linking = [path for path in ROOT.rglob("*.html") if path.name != "dx-necessity-analysis.html"
               and not {".git", "tourism-market-signal"} & set(path.relative_to(ROOT).parts)
               and "dx-necessity-analysis" in path.read_text(encoding="utf-8")]
    assert linking == []
    assert "dx-necessity-analysis" not in (ROOT / "js/dx-diagnosis.js").read_text(encoding="utf-8")
    assert "dx-necessity-analysis" not in (ROOT / "js/management-ai-rules.js").read_text(encoding="utf-8")
