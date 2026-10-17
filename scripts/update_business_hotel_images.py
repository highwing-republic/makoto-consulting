"""ビジネスホテル版料金トレンドの施設写真の URL を楽天トラベル施設情報APIから取得する。

楽天トラベルの規約に合わせ、画像そのものは保存・複製・加工しない。保存するのは楽天の画像サーバーの
URL だけで、ページは楽天のサーバーから直接表示し、写真から楽天トラベルの施設ページへリンクする。

毎朝の料金取得のあとに動くが、施設ごとに月1回だけ取得し直す（その月にまだ確認していない施設と、
比較施設群に新しく入った施設だけを検索する）。取得に失敗した施設は前回の値を残し、翌朝にもう一度試す。
写真が取れなくても料金の公開は止めない。

出力:
  data/business-hotel-price-trends/images.json
    hotels: {施設番号: {"image": {"url", "thumbnail_url"} または null, "checked_on": "YYYY-MM-DD"}}

環境変数 RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY が必要（料金取得と同じ）。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import update_business_hotel_prices as bh

ENDPOINT = "https://openapi.rakuten.co.jp/engine/api/Travel/HotelDetailSearch/20260731"
IMAGES_FILE = bh.DATA_DIR / "images.json"
SCHEMA_VERSION = 1
# 楽天トラベルの施設写真はこのホストから配信される。それ以外の URL は使わない。
IMAGE_HOSTS = ("img.travel.rakuten.co.jp", "trvimg.r10s.jp")


def image_url(value) -> str | None:
    url = str(value or "").strip()
    if not url:
        return None
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in IMAGE_HOSTS or len(url) > 500:
        return None
    return url


def parse_image(payload: dict, hotel_no: int) -> dict | None:
    """施設情報の応答から {"url", "thumbnail_url"} を作る。写真がなければ None。"""
    for entry in payload.get("hotels") or []:
        for part in bh._hotel_parts(entry):
            basic = part.get("hotelBasicInfo") if isinstance(part, dict) else None
            if not isinstance(basic, dict) or int(basic.get("hotelNo") or 0) != hotel_no:
                continue
            url, thumbnail = image_url(basic.get("hotelImageUrl")), image_url(basic.get("hotelThumbnailUrl"))
            return {"url": url, "thumbnail_url": thumbnail} if url or thumbnail else None
    return None


def load_images(path: Path = IMAGES_FILE) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}
    return data.get("hotels") or {}


def needs_check(entry: dict | None, today: date) -> bool:
    """その月にまだ確認していない施設だけ取得し直す。"""
    checked = (entry or {}).get("checked_on") or ""
    return checked[:7] != today.isoformat()[:7]


def update_images(client: bh.RakutenClient, cohort: dict, previous: dict, today: date, log=print) -> tuple[dict, dict]:
    """{施設番号: 記録} と件数の概要を返す。比較施設群から外れた施設は落とす。"""
    hotels: dict[str, dict] = {}
    counts = {"checked": 0, "with_photo": 0, "no_photo": 0, "errors": 0, "kept": 0}
    for market in cohort["markets"]:
        for prop in market["properties"]:
            key = str(prop["hotel_no"])
            entry = previous.get(key)
            if not needs_check(entry, today):
                hotels[key] = entry
                counts["kept"] += 1
                continue
            try:
                payload = client.search({"hotelNo": prop["hotel_no"], "formatVersion": 2, "responseType": "large"}, endpoint=ENDPOINT)
            except bh.AuthError:
                raise
            except bh.ApiError as exc:
                log(f"{prop['name']}（{key}）: 取得できませんでした（{exc}）")
                counts["errors"] += 1
                if entry:
                    hotels[key] = entry
                continue
            image = parse_image(payload, prop["hotel_no"])
            hotels[key] = {"image": image, "checked_on": today.isoformat()}
            counts["checked"] += 1
            counts["with_photo" if image else "no_photo"] += 1
    return dict(sorted(hotels.items(), key=lambda item: int(item[0]))), counts


def write_images(hotels: dict, generated_at: datetime, path: Path = IMAGES_FILE) -> None:
    data = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "source": {"name": "楽天トラベル施設情報API", "url": "https://webservice.rakuten.co.jp/documentation/hotel-detail-search"},
        "credit": "写真：楽天トラベル",
        "hotels": hotels,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", help="取得日（YYYY-MM-DD、既定は日本時間の今日）")
    args = parser.parse_args(argv)

    application_id = os.environ.get("RAKUTEN_APPLICATION_ID", "").strip()
    access_key = os.environ.get("RAKUTEN_ACCESS_KEY", "").strip()
    if not application_id or not access_key:
        print("RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY を環境変数に設定してください。", file=sys.stderr)
        return 2

    cohort = bh.load_cohort()
    today = date.fromisoformat(args.date) if args.date else datetime.now(bh.JST).date()
    previous = load_images()
    client = bh.RakutenClient(application_id, access_key, referer=os.environ.get("RAKUTEN_REFERER", "").strip() or bh.DEFAULT_REFERER)
    try:
        hotels, counts = update_images(client, cohort, previous, today)
    except bh.AuthError as exc:
        print(f"楽天APIの認証に失敗したため写真の取得を中断しました（{exc}）。", file=sys.stderr)
        return 2
    print(f"施設写真: 確認 {counts['checked']}施設（写真あり {counts['with_photo']}・なし {counts['no_photo']}）/ 今月確認済み {counts['kept']} / 取得エラー {counts['errors']}")
    if counts["checked"] == 0 and hotels == previous:
        return 0
    write_images(hotels, datetime.now(bh.JST))
    print(f"保存: {IMAGES_FILE.relative_to(bh.ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
