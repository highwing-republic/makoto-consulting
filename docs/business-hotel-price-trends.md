# ビジネスホテル版 料金トレンド（データ取得）

既存の「宿泊料金トレンド」（温泉地9市場・大人2名、PCから14時台に取得）とは切り離した仕組み。

## 観測条件

- 比較施設群: `data/business-hotel-price-trends/cohort.json`（`bh-v2`、2026-10-17から）
  - 10市場（札幌・仙台・名古屋・広島・福岡・金沢・那覇・鹿児島・熊本・岡山）
  - 各市場 CORE 5施設＋BACKUP 3〜4施設、計81施設。集計は CORE のみ。BACKUP は観測だけして日次の穴埋めには使わない。
  - 都市横断の比較軸はダイワロイネット（札幌以外の9市場の CORE にある。札幌すすきのは2027年1月まで改装工事のため外している）。
  - `bh-v1`（2026-10-16の1日だけ）は全市場の CORE に東横インを入れていたが、楽天では販売プランなしの日が多く（60泊中14〜59泊、自社サイト中心の販売のため）、`bh-v2` で全市場とも BACKUP に移した。福岡は西鉄イン（33泊なし）も BACKUP に移した。
- 条件: 大人1名・1室・1泊。施設ごとに「最安プラン（食事条件は問わない）」の1泊目料金と、そのプランの食事区分。
- 宿泊日: 取得日当日から60泊分。
- 取得元: 楽天トラベル空室検索API（`openapi.rakuten.co.jp`、applicationId＋accessKey）。
  - 新しい楽天APIは、アプリに登録した「アプリケーションURL」と同じ `Referer` が無いと 403 を返す（`REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING` / `HTTP_REFERRER_NOT_ALLOWED`）。既定は `https://ugatta-llc.com/`。変えるときは環境変数 `RAKUTEN_REFERER`。

## 取得の流れ

市場×宿泊日ごとに、市場の全施設をまとめてプラン単位・安い順で30件検索し、出てきた施設はその最初のプランを最安値とする。出なかった施設だけ施設ごとに検索し直し、それでも出なければ「販売プランなし（`-`）」。満室とは判定しない。API エラーは `?`。

1日あたり約3,000リクエスト（市場によって変わる）、1.1秒間隔で約1時間。

## 保存形式

`snapshots/YYYY-MM-DD.json`（取得日ごと）

```json
{
  "snapshot_date": "2026-10-16",
  "cohort_version": "bh-v1",
  "stay_dates": ["2026-10-16", "...60泊分"],
  "markets": [{"code": "sapporo", "hotels": [{"hotel_no": 153500, "price": [8200, null, ...], "meal": "RB-?..."}]}]
}
```

`meal` は宿泊日ごとの1文字: `R` 素泊まり / `B` 朝食付き / `D` 夕食付き / `T` 朝夕食付き / `-` 販売プランなし / `?` 取得エラー。

## 動かし方

GitHub Actions `Update business hotel price trends` が毎日 06:10（日本時間）に実行し、スナップショットを main にコミットする。

リポジトリの Settings → Secrets and variables → Actions に次の2つを登録する。

- `RAKUTEN_APPLICATION_ID`
- `RAKUTEN_ACCESS_KEY`

手元で試す場合:

```bash
export RAKUTEN_APPLICATION_ID=... RAKUTEN_ACCESS_KEY=...
python scripts/update_business_hotel_prices.py --probe 53225        # 応答の形を確認
python scripts/update_business_hotel_prices.py --market sapporo --horizon 3   # 一部だけ試す（保存しない）
python scripts/update_business_hotel_prices.py --dry-run             # 全件取得して保存しない
```

取得エラーが2割を超えた日は保存しない（終了コード1）。認証エラーは即中断（終了コード2）。

## 比較施設群の入れ替え

閉館・長期休館などで CORE を入れ替えるときは、`cohort_version` を上げて（例: `bh-v2`）`effective_from` を更新する。異なるバージョンのデータは比較しない。

## 催しの候補（AI調べ・参考）

料金の集計・ページの数字と文はAIを使わず、決まった規則で出す。そのうえで、急騰日と売り切れが目立つ日について、
背景になりそうな催し（コンサート、スポーツ、マラソン、学会・見本市など）を Claude API の Web 検索で探し、
`data/business-hotel-price-trends/events.json` に保存してページに「AI調べ・参考」として並べる。

- 実行: GitHub Actions `Research business hotel events`。料金の取得が成功したあとに自動で動く（手動実行も可）。
  ここが失敗しても料金データには影響しない。
- 必要なシークレット: `ANTHROPIC_API_KEY`（未登録なら何もせずに終わる）。モデルは既定で `claude-sonnet-5-5`。
  変えるときはスクリプトの `--model` か環境変数 `BHT_EVENTS_MODEL` を使う。
- 対象: ページと同じ判定の急騰日・売り切れが目立つ日のうち、ランキング上位5件に出る日、売り切れが目立つ日、
  同じ曜日のふだんの料金より3割以上高い日。同じ都市で続く日は1つの期間にまとめる（土曜泊がいつも高いだけの日は調べない）。
- 費用の上限: 1日に新しく調べるのは最大5期間、1期間あたりWeb検索は最大3回。調べた結果は使い回し、
  「見つからず」は7日後に調べ直す。宿泊日が過ぎた結果は消す。実行ログに使ったトークン数と検索回数を出す。
- 検証: 出典URLはその回の検索で実際に返ったURLに限る。出典の残らない候補、宿泊期間（翌日を含む）と日付が重ならない候補、
  料金・満室・予約に触れた文は捨てる。ページでは、いま表示している期間の急騰日・売り切れ日に重なる結果だけを出す。

手元で対象の期間だけ確かめる:

```bash
python scripts/research_business_hotel_events.py --dry-run
ANTHROPIC_API_KEY=... python scripts/research_business_hotel_events.py --max-new 1
```
