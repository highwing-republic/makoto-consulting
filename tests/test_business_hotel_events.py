"""ビジネスホテル版料金トレンドの「AIによる催しの候補」。

Claude API には接続せず、Messages API の応答の形をした偽の応答で確かめる。
"""
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest

from scripts import research_business_hotel_events as ev
from scripts import update_business_hotel_prices as bh

ROOT = Path(__file__).resolve().parents[1]
COHORT = bh.load_cohort()
CODE = COHORT["markets"][0]["code"]
CORE = [p["hotel_no"] for p in COHORT["markets"][0]["properties"] if p["role"] == "core"]


def snapshot(rows, start="2026-10-19", snapshot_date="2026-10-17"):
    """rows: 宿泊日ごとの CORE 5施設の (料金 or None, 食事コード)。"""
    stays = [date.fromordinal(date.fromisoformat(start).toordinal() + i).isoformat() for i in range(len(rows))]
    hotels = [{"hotel_no": no, "price": [row[i][0] for row in rows], "meal": "".join(row[i][1] for row in rows)} for i, no in enumerate(CORE)]
    return {"snapshot_date": snapshot_date, "stay_dates": stays, "markets": [{"code": CODE, "hotels": hotels}]}


def normal(price=10000):
    return [(price, "R")] * 5


def sold_out(price=30000, count=2):
    return [(None, "-")] * count + [(price, "R")] * (5 - count)


# 2026-10-19(月) から28泊。10/23(金) は2施設が売り切れ、10/29(木)〜10/30(金) は料金が3倍
ROWS = [normal() for _ in range(28)]
ROWS[4] = sold_out()
ROWS[10] = normal(30000)
ROWS[11] = normal(30000)


def search_block(*urls):
    return {"type": "web_search_tool_result", "tool_use_id": "srv1",
            "content": [{"type": "web_search_result", "url": url, "title": f"title {i}", "encrypted_content": "x"} for i, url in enumerate(urls)]}


def answer_block(candidates):
    return {"type": "text", "text": "調べました。\n```json\n" + json.dumps({"candidates": candidates}, ensure_ascii=False) + "\n```"}


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, bodies):
        self.bodies = list(bodies)
        self.calls = []

    def post(self, url, json, headers, timeout):
        self.calls.append((json, headers))
        status, body = self.bodies.pop(0)
        return FakeResponse(status, body)


# ---------------------------------------------------------------- 対象の選び方


def test_notable_days_follow_the_page_rules_and_group_into_periods():
    found = ev.periods(ev.notable_days(COHORT, snapshot(ROWS)))
    by_start = {p["start"]: p for p in found if p["market"] == CODE}
    # 売り切れた日は残る施設の料金も高く、急騰日にも当たる
    assert by_start["2026-10-23"]["kinds"] == ["busy", "spike"] and by_start["2026-10-23"]["sold_out"] == 2
    assert by_start["2026-10-29"]["dates"] == ["2026-10-29", "2026-10-30"]
    assert by_start["2026-10-29"]["kinds"] == ["spike"] and by_start["2026-10-29"]["ratio"] == pytest.approx(3.0)


def test_ordinary_saturday_premium_is_not_researched():
    # 土曜泊がいつも代表料金の1.6倍: ページでは急騰日だが、曜日なりの高さなので調べない
    rows = [normal(16000) if (date(2026, 10, 19).toordinal() + i) % 7 == date(2026, 10, 24).toordinal() % 7 else normal() for i in range(28)]
    days = ev.notable_days(COHORT, snapshot(rows))
    assert days and all(day["spike"] and day["excess"] == pytest.approx(1.0) for day in days)
    # ランキング上位5件に入る日は調べるが、それ以外の曜日なりの日は調べない
    researched = ev.periods(days)
    assert all(p["ranked"] for p in researched)


@pytest.mark.skipif(shutil.which("node") is None, reason="node が必要")
def test_python_selection_matches_the_page_model_on_real_data():
    manifest = json.loads((bh.DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    script = f"""
require({json.dumps(str(ROOT / 'js' / 'business-hotel-price-trends-model.js'))});
const M = globalThis.BusinessHotelPriceModel;
const fs = require('fs');
const cohort = JSON.parse(fs.readFileSync({json.dumps(str(bh.DATA_DIR / 'cohort.json'))}));
const snap = JSON.parse(fs.readFileSync({json.dumps(str(bh.DATA_DIR / 'snapshots' / (manifest['latest_snapshot'] + '.json')))}));
const out = [];
for (const m of cohort.markets) {{
  const s = M.marketSummary(M.marketView(cohort, snap, m.code));
  s.spikes.forEach((d) => out.push([m.code, d.date, 'spike']));
  s.busy.forEach((d) => out.push([m.code, d.date, 'busy']));
}}
console.log(JSON.stringify(out));
"""
    expected = {tuple(row) for row in json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)}
    snap = json.loads((bh.DATA_DIR / "snapshots" / f"{manifest['latest_snapshot']}.json").read_text(encoding="utf-8"))
    actual = set()
    for day in ev.notable_days(COHORT, snap):
        if day["spike"]:
            actual.add((day["market"], day["date"], "spike"))
        if day["busy"]:
            actual.add((day["market"], day["date"], "busy"))
    assert actual == expected


# ---------------------------------------------------------------- 答えの検証


PERIOD = {"market": CODE, "start": "2026-10-30", "end": "2026-10-31", "dates": ["2026-10-30", "2026-10-31"], "kinds": ["spike"]}


def test_only_candidates_backed_by_returned_search_results_survive():
    blocks = [
        search_block("https://example.jp/live/", "https://example.jp/marathon"),
        answer_block([
            {"name": "ドームツアー", "start": "2026-10-30", "end": "2026-11-01", "venue": "ドーム", "note": "3日間の公演", "sources": ["https://example.jp/live"]},
            {"name": "でっちあげ", "start": "2026-10-31", "end": "2026-10-31", "venue": "会場", "note": "", "sources": ["https://made-up.example/"]},
            {"name": "前の週の大会", "start": "2026-10-20", "end": "2026-10-21", "venue": "会場", "note": "", "sources": ["https://example.jp/marathon"]},
            {"name": "翌日のマラソン", "start": "2026-11-01", "end": "2026-11-01", "venue": "市内", "note": "市民マラソン", "sources": ["https://example.jp/marathon"]},
        ]),
    ]
    kept = ev.validate(ev.final_json(blocks), ev.search_result_urls(blocks), PERIOD)
    assert [c["name"] for c in kept] == ["ドームツアー", "翌日のマラソン"]
    assert kept[0]["sources"] == [{"url": "https://example.jp/live", "title": "title 0"}]


def test_text_about_prices_or_occupancy_is_dropped():
    blocks = [search_block("https://example.jp/a"), answer_block([
        {"name": "学会", "start": "2026-10-30", "end": "2026-10-30", "venue": "国際会議場", "note": "ホテルが満室になる見込み", "sources": ["https://example.jp/a"]},
        {"name": "料金が3倍になる祭り", "start": "2026-10-30", "end": "2026-10-30", "venue": "市内", "note": "", "sources": ["https://example.jp/a"]},
    ])]
    kept = ev.validate(ev.final_json(blocks), ev.search_result_urls(blocks), PERIOD)
    assert kept == [{"name": "学会", "start": "2026-10-30", "end": "2026-10-30", "venue": "国際会議場", "note": None,
                     "sources": [{"url": "https://example.jp/a", "title": "title 0"}]}]


def test_unparseable_answers_mean_not_found():
    assert ev.final_json([{"type": "text", "text": "見つかりませんでした"}]) is None
    assert ev.validate(None, {}, PERIOD) == []


# ---------------------------------------------------------------- 実行と保存


def test_run_researches_new_periods_once_and_reuses_results():
    reply = {"stop_reason": "end_turn", "usage": {"input_tokens": 1000, "output_tokens": 200, "server_tool_use": {"web_search_requests": 2}},
             "content": [search_block("https://example.jp/x"), answer_block([{"name": "見本市", "start": "2026-10-23", "end": "2026-10-24", "venue": "展示場", "note": "業界の見本市", "sources": ["https://example.jp/x"]}])]}
    empty = {"stop_reason": "end_turn", "usage": {}, "content": [answer_block([])]}
    session = FakeSession([(200, reply), (200, empty)])
    client = ev.ClaudeClient("key", session=session, sleep=lambda _: None)
    snap = snapshot(ROWS)
    first = ev.run(COHORT, snap, {"items": []}, client, date(2026, 10, 17), log=lambda _: None)
    assert [(i["start"], i["status"]) for i in first["items"]] == [("2026-10-23", "found"), ("2026-10-29", "not_found")]
    assert first["items"][0]["candidates"][0]["name"] == "見本市"
    assert client.usage == {"input_tokens": 1000, "output_tokens": 200, "web_search_requests": 2}
    payload, headers = session.calls[0]
    assert headers["x-api-key"] == "key" and payload["tools"][0]["type"] == "web_search_20250305"
    assert payload["tools"][0]["max_uses"] == ev.MAX_SEARCHES
    assert "10/23（金）" in payload["messages"][0]["content"]

    # 翌日は同じ期間を調べ直さない
    second = ev.run(COHORT, snap, first, client, date(2026, 10, 18), log=lambda _: None)
    assert len(session.calls) == 2 and second["items"] == first["items"]
    # 「見つからず」は7日たったら調べ直す。宿泊日が過ぎた結果は消える
    session.bodies.append((200, empty))
    later = ev.run(COHORT, snap, first, client, date(2026, 10, 24), log=lambda _: None)
    assert len(session.calls) == 3
    assert [(i["start"], i["researched_on"]) for i in later["items"]] == [("2026-10-29", "2026-10-24")]


def test_pause_turn_is_continued_and_api_errors_skip_the_period():
    paused = {"stop_reason": "pause_turn", "usage": {}, "content": [search_block("https://example.jp/y")]}
    done = {"stop_reason": "end_turn", "usage": {}, "content": [answer_block([{"name": "大会", "start": "2026-10-23", "end": "2026-10-23", "venue": "体育館", "note": "", "sources": ["https://example.jp/y"]}])]}
    session = FakeSession([(200, paused), (200, done), (400, {"error": {"message": "bad"}})])
    client = ev.ClaudeClient("key", session=session, sleep=lambda _: None)
    result = ev.run(COHORT, snapshot(ROWS), {"items": []}, client, date(2026, 10, 17), log=lambda _: None)
    assert [(i["start"], i["status"]) for i in result["items"]] == [("2026-10-23", "found")]
    assert session.calls[1][0]["messages"][1]["role"] == "assistant"


def test_main_skips_without_an_api_key(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert ev.main([]) == 0
    assert "skipping" in capsys.readouterr().out


def test_saved_events_file_is_well_formed_when_present():
    path = bh.DATA_DIR / ev.EVENTS_FILE
    if not path.exists():
        pytest.skip("まだ調査結果がない")
    data = json.loads(path.read_text(encoding="utf-8"))
    codes = {m["code"] for m in COHORT["markets"]}
    for item in data["items"]:
        assert item["market"] in codes and item["status"] in ("found", "not_found")
        assert (item["status"] == "found") == bool(item["candidates"])
        for candidate in item["candidates"]:
            assert candidate["sources"] and all(s["url"].startswith("http") for s in candidate["sources"])
            assert not ev.FORBIDDEN_IN_TEXT.search(candidate["name"] + (candidate["note"] or "") + (candidate["venue"] or ""))


def test_page_labels_event_candidates_as_ai_reference():
    from bs4 import BeautifulSoup
    from site_pages import rendered

    page = BeautifulSoup(rendered("business-hotel-price-trends.html"), "html.parser")
    box = page.select_one("#bht-events")
    assert box is not None and box.has_attr("hidden")  # 調査結果が無ければ出さない
    assert "AI調べ・参考" in box.get_text()
    assert "料金が上がった理由と確かめたものではありません" in box.get_text()
    assert page.select_one("#bht-market-events") is not None
    assert "催しの候補は、料金の集計とは別に" in page.select_one(".bht-method").get_text()
