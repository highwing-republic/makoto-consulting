import json
import math
from copy import deepcopy
from datetime import date
from pathlib import Path

import pytest
from openpyxl import Workbook

from scripts.update_inbound_data import PREFECTURES, extract_nationality_table, validate_dataset


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "inbound" / "latest.json"


def load_data():
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def walk_values(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from walk_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_values(child)
    else:
        yield value


def test_json_schema():
    data = load_data()
    assert set(data) == {"metadata", "national", "prefectures"}
    assert data["metadata"]["release_type"] == "第2次速報"
    assert data["metadata"]["unit"] == "人泊"
    assert {"foreign_guest_nights", "nationality", "monthly"} <= set(data["national"])


def test_all_prefectures_exist():
    data = load_data()
    assert set(data["prefectures"]) == set(PREFECTURES)
    assert len(data["prefectures"]) == 47


def test_national_data_exists():
    national = load_data()["national"]
    assert isinstance(national["foreign_guest_nights"], int)
    assert national["foreign_guest_nights"] > 0
    assert len(national["monthly"]) >= 6


def test_no_negative_values():
    data = load_data()
    for record in [data["national"], *data["prefectures"].values()]:
        assert record["foreign_guest_nights"] >= 0
        assert all(value >= 0 for value in record["nationality"].values())
        assert all(item["foreign_guest_nights"] >= 0 for item in record["monthly"])


def test_nationality_data_exists():
    data = load_data()
    assert len(data["national"]["nationality"]) >= 10
    assert all(len(record["nationality"]) >= 10 for record in data["prefectures"].values())


def test_latest_month_valid():
    metadata = load_data()["metadata"]
    assert 2007 <= metadata["year"] <= date.today().year + 1
    assert 1 <= metadata["month"] <= 12


def test_no_nan():
    for value in walk_values(load_data()):
        if isinstance(value, float):
            assert math.isfinite(value)


def test_excel_table_parser_uses_headers_and_prefecture_labels():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "参考第1表(6月)"
    sheet.append(["施設所在地(47区分)、国籍（出身地）別外国人延べ宿泊者数"])
    sheet.append(["（客室数20室以上の施設）"])
    sheet.append([])
    sheet.append(["施設所在地（47区分）", "外国人延べ宿泊者数", "国籍（出身地）"])
    countries = ["韓国", "中国", "香港", "台湾", "米国", "カナダ", "英国", "ドイツ", "フランス", "その他"]
    sheet.append([None, None, *countries])
    sheet.append([])
    sheet.append(["令和8年6月", 47000, *([1000] * len(countries))])
    for index, prefecture in enumerate(PREFECTURES, 1):
        sheet.append([f"　{index:02d}{prefecture}", 1000, *([10] * len(countries))])

    parsed = extract_nationality_table(workbook)
    assert parsed["survey_scope"] == "客室数20室以上の施設"
    assert parsed["national"]["foreign_guest_nights"] == 47000
    assert parsed["prefectures"]["長野県"]["nationality"]["台湾"] == 10


def test_validation_rejects_first_preliminary_data():
    data = deepcopy(load_data())
    data["metadata"]["release_type"] = "第1次速報"
    with pytest.raises(ValueError, match="第2次速報以外"):
        validate_dataset(data)


def test_validation_rejects_missing_prefecture():
    data = deepcopy(load_data())
    data["prefectures"].pop("沖縄県")
    with pytest.raises(ValueError, match="47都道府県"):
        validate_dataset(data)
