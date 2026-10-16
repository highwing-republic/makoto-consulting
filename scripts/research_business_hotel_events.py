"""ビジネスホテル版料金トレンドの「急騰日・売り切れが目立つ日」の背景になりそうな催しを、
Claude API の Web 検索で探して保存する。

料金の集計（ページの数字や文）はAIを使わず決まった規則で出す。ここで作るのは、その横に
「参考」として並べる催しの候補だけ。料金が上がった理由と断定する材料にはしない。

流れ:
  1. 最新のスナップショットから、ページと同じ規則で急騰日（代表料金の1.5倍以上）と
     売り切れが目立つ日（CORE 2施設以上で販売プランなし）を選ぶ。
     同じ都市で続く日はひとまとまりの期間にする（例: 札幌 10/30〜10/31）。
  2. まだ調べていない期間だけ、目立つ順に最大 --max-new 件を Claude に調べさせる。
     調べた結果は events.json に残し、翌日以降は使い回す（見つからなかった期間は7日後に再調査）。
  3. AIの答えは検証してから保存する。
     - 出典URLは、その回の Web 検索で実際に返ったURLに限る（それ以外は捨てる）
     - 出典の残らない候補、宿泊期間と日付が重ならない候補は捨てる
     - 料金・満室に触れた文（円、%、倍、満室など）は捨てる

出力: data/business-hotel-price-trends/events.json
環境変数 ANTHROPIC_API_KEY が無いときは何もせずに終わる（料金データの更新は止めない）。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable

import requests

try:  # python scripts/research_business_hotel_events.py でも、テストからの import でも動くように
    from scripts.update_business_hotel_prices import DATA_DIR, JST, load_cohort
except ImportError:  # pragma: no cover
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.update_business_hotel_prices import DATA_DIR, JST, load_cohort

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-sonnet-5-5"
EVENTS_FILE = "events.json"
SCHEMA_VERSION = 1

# ページ（js/business-hotel-price-trends-model.js）と同じ規則
MIN_CORE_FOR_MEDIAN = 4
REFERENCE_CORE = 3
SPIKE_RATIO = 1.5
SOLD_OUT_MIN = 2
NO_PLAN = "-"
RANK_SIZE = 5
EXCESS_MIN = 1.3  # 同じ曜日のふだんの料金より3割以上高い日

MAX_NEW_PER_RUN = 5  # 1日に新しく調べる期間の上限（費用の上限にもなる）
MAX_SEARCHES = 3  # 1期間あたりの Web 検索回数の上限
RETRY_NOT_FOUND_DAYS = 7
MAX_CANDIDATES = 3
NAME_LIMIT = 60
VENUE_LIMIT = 40
NOTE_LIMIT = 80
# 料金や客室の埋まり具合に触れた文は、AIの推測が混ざりやすいので載せない
FORBIDDEN_IN_TEXT = re.compile(r"円|％|%|倍|満室|空室|料金|価格|値上|高騰|予約")
WEEKDAYS = "月火水木金土日"


class ResearchError(Exception):
    """API が使える結果を返さなかった。"""


# --------------------------------------------------------------------------- 対象日の選び方


def _is_price(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def _quantile(values: Iterable, q: float):
    ordered = sorted(v for v in values if _is_price(v))
    if not ordered:
        return None
    position = (len(ordered) - 1) * q
    base = math.floor(position)
    rest = position - base
    upper = ordered[base + 1] if base + 1 < len(ordered) else None
    return ordered[base] + (0 if upper is None else rest * (upper - ordered[base]))


def _median(values: Iterable):
    value = _quantile(values, 0.5)
    return None if value is None else math.floor(value + 0.5)  # JavaScript の Math.round と同じ丸め


def market_days(cohort: dict, snapshot: dict, code: str) -> list[dict]:
    """ページの dailyMedians と同じ: CORE施設の料金の中央値と、販売プランなしの施設数。"""
    market = next(m for m in cohort["markets"] if m["code"] == code)
    observed = next((m for m in snapshot.get("markets", []) if m["code"] == code), None)
    if observed is None:
        return []
    rows = {h["hotel_no"]: h for h in observed["hotels"]}
    core = [rows.get(p["hotel_no"]) for p in market["properties"] if p["role"] == "core"]
    days = []
    for index, stay in enumerate(snapshot["stay_dates"]):
        prices = [row["price"][index] for row in core if row and _is_price(row["price"][index])]
        sold_out = sum(1 for row in core if row and index < len(row["meal"]) and row["meal"][index] == NO_PLAN)
        count = len(prices)
        status = "ok" if count >= MIN_CORE_FOR_MEDIAN else "reference" if count == REFERENCE_CORE else "none"
        days.append({"date": stay, "status": status, "median": None if status == "none" else _median(prices), "sold_out": sold_out})
    return days


def notable_days(cohort: dict, snapshot: dict) -> list[dict]:
    """急騰日と売り切れが目立つ日（ページの marketSummary と同じ判定）。

    調べる価値の目安として、同じ曜日のふだんの料金（その曜日の中央値）と比べた倍率 excess も付ける。
    土曜泊はいつも高いので、代表料金の1.5倍でも曜日なりの高さなら excess は小さい。
    """
    found = []
    for market in cohort["markets"]:
        days = market_days(cohort, snapshot, market["code"])
        ok = [d for d in days if d["status"] == "ok"]
        typical = _median(d["median"] for d in ok)
        by_weekday = {w: _median(d["median"] for d in ok if date.fromisoformat(d["date"]).weekday() == w) for w in range(7)}
        for day in days:
            ratio = day["median"] / typical if typical and day["median"] else None
            spike = ratio is not None and day["status"] != "none" and day["median"] >= typical * SPIKE_RATIO
            busy = day["sold_out"] >= SOLD_OUT_MIN
            if not (spike or busy):
                continue
            baseline = by_weekday[date.fromisoformat(day["date"]).weekday()]
            excess = day["median"] / baseline if baseline and day["median"] else None
            found.append({"market": market["code"], "date": day["date"], "spike": spike, "busy": busy,
                          "sold_out": day["sold_out"], "ratio": ratio, "excess": excess})
    return found


def ranked_keys(days: list[dict]) -> set[tuple[str, str]]:
    """ページのランキング（料金が跳ね上がる日・売り切れが目立つ日の上位5件）に出る日。"""
    spikes = sorted((d for d in days if d["spike"]), key=lambda d: -d["ratio"])[:RANK_SIZE]
    busy = sorted((d for d in days if d["busy"]), key=lambda d: -(d["sold_out"] + (d["ratio"] or 0) / 100))[:RANK_SIZE]
    return {(d["market"], d["date"]) for d in spikes + busy}


def periods(days: list[dict]) -> list[dict]:
    """同じ都市で続く日を1つの期間にまとめ、調べる順に並べる。

    調べるのは、ランキングに出る日・売り切れが目立つ日・同じ曜日のふだんより EXCESS_MIN 倍以上高い日を含む期間。
    順番はランキングに出る期間 → 売り切れ施設数 → 曜日なりの水準からの高さ。
    """
    ranked = ranked_keys(days)
    grouped: dict[str, list[dict]] = {}
    for day in sorted(days, key=lambda d: (d["market"], d["date"])):
        grouped.setdefault(day["market"], []).append(day)
    result = []
    for code, items in grouped.items():
        current: list[dict] = []
        for day in items:
            if current and date.fromisoformat(day["date"]) - date.fromisoformat(current[-1]["date"]) != timedelta(days=1):
                result.append(_period(code, current, ranked))
                current = []
            current.append(day)
        if current:
            result.append(_period(code, current, ranked))
    worth = [p for p in result if p["ranked"] or p["sold_out"] >= SOLD_OUT_MIN or (p["excess"] or 0) >= EXCESS_MIN]
    return sorted(worth, key=lambda p: (not p["ranked"], -p["sold_out"], -(p["excess"] or 0), p["start"], p["market"]))


def _period(code: str, days: list[dict], ranked: set) -> dict:
    return {
        "market": code,
        "start": days[0]["date"],
        "end": days[-1]["date"],
        "dates": [d["date"] for d in days],
        "kinds": [kind for kind, hit in (("busy", any(d["busy"] for d in days)), ("spike", any(d["spike"] for d in days))) if hit],
        "ranked": any((code, d["date"]) in ranked for d in days),
        "sold_out": max(d["sold_out"] for d in days),
        "ratio": max((d["ratio"] or 0) for d in days) or None,
        "excess": max((d["excess"] or 0) for d in days) or None,
    }


# --------------------------------------------------------------------------- 保存済みの結果


def load_events(data_dir: Path) -> dict:
    path = data_dir / EVENTS_FILE
    if not path.exists():
        return {"schema_version": SCHEMA_VERSION, "items": []}
    return json.loads(path.read_text(encoding="utf-8"))


def is_covered(period: dict, items: list[dict], today: date) -> bool:
    """期間のすべての宿泊日が、有効な調査結果で調べ済みか。"""
    covered: set[str] = set()
    for item in items:
        if item["market"] != period["market"]:
            continue
        researched = date.fromisoformat(item["researched_on"])
        if item["status"] == "not_found" and (today - researched).days >= RETRY_NOT_FOUND_DAYS:
            continue
        covered.update(item["dates"])
    return set(period["dates"]) <= covered


def prune(items: list[dict], today: date) -> list[dict]:
    """宿泊日がすべて過ぎた結果を落とす。今は目立たなくなった期間の結果も、また目立ったときのために残す。"""
    return [item for item in items if item["end"] >= today.isoformat()]


# --------------------------------------------------------------------------- Claude API


def build_prompt(period: dict, market: dict) -> str:
    stays = "、".join(_label(d) for d in period["dates"])
    last = date.fromisoformat(period["end"]) + timedelta(days=1)
    return f"""あなたは日本の宿泊市場の調査を手伝うリサーチャーです。
{market['prefecture']}{market['name']}市内のビジネスホテルで、次の宿泊日（チェックインする夜）に客室の売れ行きが目立っています。
宿泊日: {stays}

この期間（{_label(period['start'])}〜{_label(last.isoformat())}。宿泊の翌日の催しも含む）に、{market['name']}市内または近郊で開かれ、
遠方から人が集まる催しを Web 検索で探してください。対象の例: コンサート・ライブ、スポーツの試合や大会、マラソン、
学会・全国大会・見本市、大規模な祭り、資格試験、入試。

守ること:
- 検索結果のページで、開催日と開催地を確認できた催しだけを挙げる。確認できないものは挙げない。
- 宿泊料金・満室・予約状況については書かない（こちらで別に集計しているため）。
- 見つからなければ candidates を空にする。無理に挙げない。
- 最大{MAX_CANDIDATES}件。遠方からの来場者が多そうな順に並べる。

最後に、次の形の JSON だけを ```json ブロックで出力してください。
{{"candidates": [{{"name": "催しの名前", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "venue": "会場名", "note": "どんな催しか（40字以内）", "sources": ["検索結果のURL"]}}]}}
"""


def _label(value: str) -> str:
    day = date.fromisoformat(value)
    return f"{day.month}/{day.day}（{WEEKDAYS[day.weekday()]}）"


class ClaudeClient:
    def __init__(self, api_key: str, model: str = DEFAULT_MODEL, session=None, sleep: Callable[[float], None] = time.sleep, retries: int = 3):
        self.api_key = api_key
        self.model = model
        self.session = session or requests.Session()
        self.sleep = sleep
        self.retries = retries
        self.usage = {"input_tokens": 0, "output_tokens": 0, "web_search_requests": 0}

    def research(self, prompt: str) -> list[dict]:
        """Web検索つきで1回問い合わせ、返ってきた content ブロックをすべて返す（pause_turn は続きを取る）。"""
        messages = [{"role": "user", "content": prompt}]
        blocks: list[dict] = []
        for _ in range(3):
            body = self._post({
                "model": self.model,
                "max_tokens": 2048,
                "messages": messages,
                "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": MAX_SEARCHES,
                           "user_location": {"type": "approximate", "country": "JP", "timezone": "Asia/Tokyo"}}],
            })
            usage = body.get("usage") or {}
            self.usage["input_tokens"] += usage.get("input_tokens", 0)
            self.usage["output_tokens"] += usage.get("output_tokens", 0)
            self.usage["web_search_requests"] += (usage.get("server_tool_use") or {}).get("web_search_requests", 0)
            content = body.get("content") or []
            blocks.extend(content)
            if body.get("stop_reason") != "pause_turn":
                return blocks
            messages = [messages[0], {"role": "assistant", "content": content}]
        return blocks

    def _post(self, payload: dict) -> dict:
        headers = {"x-api-key": self.api_key, "anthropic-version": API_VERSION, "content-type": "application/json"}
        for attempt in range(self.retries + 1):
            response = self.session.post(API_URL, json=payload, headers=headers, timeout=180)
            if response.status_code == 200:
                return response.json()
            if response.status_code in (429, 500, 502, 503, 529) and attempt < self.retries:
                self.sleep(10 * 2**attempt)
                continue
            raise ResearchError(f"Claude API {response.status_code}: {response.text[:300]}")
        raise ResearchError("Claude API: retries exhausted")


# --------------------------------------------------------------------------- 答えの検証


def search_result_urls(blocks: list[dict]) -> dict[str, str]:
    """その回の Web 検索で実際に返ったURLと題名。"""
    urls = {}
    for block in blocks:
        if block.get("type") != "web_search_tool_result" or not isinstance(block.get("content"), list):
            continue
        for result in block["content"]:
            if result.get("type") == "web_search_result" and result.get("url"):
                urls[_normalize(result["url"])] = result.get("title") or ""
    return urls


def _normalize(url: str) -> str:
    return url.strip().rstrip("/")


def final_json(blocks: list[dict]) -> dict | None:
    text = "".join(block.get("text", "") for block in blocks if block.get("type") == "text")
    fenced = re.findall(r"```json\s*(\{.*?\})\s*```", text, flags=re.S)
    candidates = fenced or re.findall(r"(\{\s*\"candidates\".*\})", text, flags=re.S)
    for raw in reversed(candidates):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and isinstance(value.get("candidates"), list):
            return value
    return None


def _clean_text(value, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = re.sub(r"\s+", " ", value).strip()
    if not text or FORBIDDEN_IN_TEXT.search(text):
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _iso(value) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def validate(answer: dict | None, urls: dict[str, str], period: dict) -> list[dict]:
    """出典が検索結果にあり、宿泊期間（翌日の催しを含む）と日付が重なる候補だけを残す。"""
    if not answer:
        return []
    window_start = date.fromisoformat(period["start"])
    window_end = date.fromisoformat(period["end"]) + timedelta(days=1)
    kept = []
    for raw in answer["candidates"]:
        if not isinstance(raw, dict):
            continue
        name = _clean_text(raw.get("name"), NAME_LIMIT)
        start, end = _iso(raw.get("start")), _iso(raw.get("end") or raw.get("start"))
        if not name or not start or not end or end < start or end < window_start or start > window_end:
            continue
        sources = []
        for url in raw.get("sources") or []:
            key = _normalize(url) if isinstance(url, str) else ""
            if key in urls and key not in [s["url"] for s in sources]:
                sources.append({"url": key, "title": (urls[key] or key)[:80]})
        if not sources:
            continue
        kept.append({
            "name": name,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "venue": _clean_text(raw.get("venue"), VENUE_LIMIT),
            "note": _clean_text(raw.get("note"), NOTE_LIMIT),
            "sources": sources[:2],
        })
    return kept[:MAX_CANDIDATES]


# --------------------------------------------------------------------------- 実行


def research_period(client: ClaudeClient, period: dict, market: dict, today: date) -> dict:
    blocks = client.research(build_prompt(period, market))
    candidates = validate(final_json(blocks), search_result_urls(blocks), period)
    return {
        "market": period["market"],
        "start": period["start"],
        "end": period["end"],
        "dates": period["dates"],
        "kinds": period["kinds"],
        "researched_on": today.isoformat(),
        "status": "found" if candidates else "not_found",
        "candidates": candidates,
    }


def run(cohort: dict, snapshot: dict, events: dict, client: ClaudeClient | None, today: date, max_new: int = MAX_NEW_PER_RUN, log=print) -> dict:
    items = prune(events.get("items", []), today)
    markets = {m["code"]: m for m in cohort["markets"]}
    targets = [p for p in periods(notable_days(cohort, snapshot)) if p["end"] >= today.isoformat()]
    todo = [p for p in targets if not is_covered(p, items, today)][:max_new]
    log(f"notable periods: {len(targets)}, to research: {len(todo)}")
    for period in todo:
        if client is None:
            break
        try:
            item = research_period(client, period, markets[period["market"]], today)
        except ResearchError as error:
            log(f"skip {period['market']} {period['start']}: {error}")
            continue
        # 新しい結果と日付が重なる古い結果は置き換える
        items = [old for old in items if old["market"] != item["market"] or not set(old["dates"]) & set(item["dates"])]
        items.append(item)
        log(f"{item['market']} {item['start']}..{item['end']}: {item['status']} ({len(item['candidates'])})")
    items.sort(key=lambda item: (item["start"], item["market"]))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "snapshot_date": snapshot["snapshot_date"],
        "model": client.model if client else events.get("model"),
        "method": "Claude（Anthropic）がWeb検索で探した催しの候補。出典URLが検索結果にあるものだけを掲載。",
        "items": items,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--max-new", type=int, default=MAX_NEW_PER_RUN)
    parser.add_argument("--model", default=os.environ.get("BHT_EVENTS_MODEL") or DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true", help="対象の期間を表示するだけでAPIは呼ばない")
    args = parser.parse_args(argv)

    manifest = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    snapshot = json.loads((DATA_DIR / "snapshots" / f"{manifest['latest_snapshot']}.json").read_text(encoding="utf-8"))
    cohort = load_cohort()
    today = date.fromisoformat(snapshot["snapshot_date"])
    events = load_events(DATA_DIR)

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if args.dry_run or not api_key:
        if not api_key and not args.dry_run:
            print("ANTHROPIC_API_KEY is not set; skipping event research.")
            return 0
        for period in periods(notable_days(cohort, snapshot)):
            print(period["market"], period["start"], period["end"], period["kinds"], "ranked" if period["ranked"] else "",
                  period["sold_out"], round(period["ratio"] or 0, 2), round(period["excess"] or 0, 2),
                  "cached" if is_covered(period, events.get("items", []), today) else "new")
        return 0

    client = ClaudeClient(api_key, model=args.model)
    result = run(cohort, snapshot, events, client, today, max_new=args.max_new)
    (DATA_DIR / EVENTS_FILE).write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    cost = client.usage
    print(f"usage: input {cost['input_tokens']} / output {cost['output_tokens']} tokens, web searches {cost['web_search_requests']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
