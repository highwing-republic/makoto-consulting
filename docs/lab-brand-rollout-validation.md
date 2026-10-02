# 宿泊DXラボ ブランド展開：実装・検証記録

2026-10-02。Claude Code 作成「Codex向け実装計画書_宿泊DXラボブランド統一.md」に基づく Phase 2・3。
基盤は Phase 1 の `12b6dac`（PR #12、未マージ）、その親の本番基準は `fd93b69`。

## 実装範囲

料金トレンド、地域分析4ページ、DX診断、経営AIに Noto Sans JP と LAB 番号を展開した。
見出し・注記・数値を整理し、KPIの数値と状態テキストを区別した。
金色は選択施設・選択地域・自施設スコアの線、棒、点、縁取りに使用する。
料金評価は金色の棒が選択施設、青灰色の線が比較対象の中央値となり、凡例も一致する。
カレンダー4色と Phase 1 の `--data-*` 定義は変更していない。

分析計算、JSONデータ、ロゴ画像、古典ページの固有CSS、外部レポート生成物は変更していない。
経営AIの入力段階番号01〜03はNotoのまま。DotGothic16はLAB番号だけに使用する。
共通CSSの変更時には、全8利用ページのキャッシュURLを同時更新した。

## 変更の分割と適用順

| 順序 | ブランチ | 変更 |
|---|---|---|
| 前提 | `feat/lab-brand-foundation` | 既存PR #12 |
| 1 | `feat/lab-brand-hotel-price` | 料金トレンド、KPI、評価の凡例、データ色固定テスト |
| 2 | `feat/lab-brand-regional-core` | 共通の分析CSS、インバウンド・省人化DXのLAB番号、キャッシュURL |
| 3 | `feat/lab-brand-regional-maps` | 需給・宿泊集中度のLAB番号、地域指標の状態表示 |
| 4 | `feat/lab-brand-diagnosis` | DX診断のサイズ・装飾・スコア表現 |
| 5 | `feat/lab-brand-management` | 経営AI、全体の回帰テスト、検証記録 |

各ブランチは直前のブランチを土台にする。共通CSSは全分析ページに適用されるため、順序2は他ページのサイズにも作用する。HTMLの実質的なページ改修は2ページ、他のHTML差分はキャッシュ更新のみ。
マージ後に後続PRのベースを `main` に付け替え、差分を確認してから順に適用する。

## 検証結果

- `python -m pytest tests -q`：70件成功。
- `node --test tests/*.test.cjs`：22件成功。
- 全 `js/*.js` の `node --check`：成功。
- 変更したCSS3ファイルを tinycss2 で構文検証：エラー0件。
- `git diff --check`：成功。
- この静的サイトには専用のlintコマンド・TypeScript設定がないため、JS/CSS構文検証と既存テストで確認。
- Phase 1 の画面を基準として12ページ×1440/768/390pxを比較。改修前後ともページ全体の横はみ出し0件、コンソールエラー0件。
- ブラウザー受け入れ確認：27シナリオ（9シナリオ×3幅）、共通外枠の全19ページを検証。コンソールエラー0件。
- NotoとLAB用DotGothic16の読込み、古典ページの見出しの明朝維持を確認。

ブラウザーで確認した操作：料金の地域・施設・宿泊日・食事条件の切替とURL反映、長野市の少数標本と上諏訪温泉の多施設データ、地域分析の長野県→東京都切替、散布図のキーボード選択、DX診断の不正入力時のフォーカス・16問の回答・結果・グラフタブ・リセット、経営AIのテーマ・施設情報・質問入力から回答生成。
分析結果画面でも3幅のスクリーンショットを取得した。表・グラフの必要な横スクロールは維持している。

ブラウザー検証の再実行（PlaywrightとChromeが必要）：

```powershell
python tests/browser_brand_regression.py "$env:TEMP/lab-brand-browser-results"
```

解析用アクセスを本番GA4へ送らないため、検証時のみGoogleの計測リクエストを無応答の成功レスポンスに置き換える。
画面画像・検証JSONはリポジトリ外の `%TEMP%/makoto-brand-qa/` に保存。試作HTML・画像はコミットしない。

## 今回の対象外（計画書 Phase 4）

- スマホKPIの2列化、カレンダーなどの表示密度変更。
- 料金KPIの先頭カード変更。
- Google Fontsの `@import` をHTML側のlink/preconnectへ移すこと。
- UPDATED・BETAへのドット書体展開。

## Claude Code クロスレビューへのHandoff

### Goal
ブランド展開の表示と回帰確認をクロスレビューし、各PRを順番にマージ可能か判断する。

### Current State
実装とローカル検証は完了。Phase 1を含めた本番マージは未実施。共有作業ツリーの変更は保持している。

### Relevant Files
`css/useful.css`、`css/hotel-price-trends.css`、`css/dx-diagnosis.css`、対象HTML8ページ、`js/hotel-price-trends.js`、`js/inbound-analysis.js`、`js/cross-analysis.js`、`tests/test_lab_brand.py`、`tests/hotel-price-brand.test.cjs`、`tests/browser_brand_regression.py`。

### Problem
共通CSSの波及、状態テキストの可読性、金色の意味と凡例、長い見出しの折り返し、PR間の依存順序を独立した視点で確認する。

### Constraints
既存の計算・JSON・古典の固有スタイル・ロゴを変更しない。データ色のトークン値を変更しない。Phase 4のUX改善を混ぜない。共有作業ツリーをreset/stashしない。

### Expected Output
重大度付きの指摘、再現条件・対象ファイル、マージ可否。指摘があればCodexが修正する。

### Acceptance Criteria
自動テストとブラウザー検証が成功し、意味色・KPI・LAB番号に矛盾がないこと。古典の明朝が維持され、意図しない横はみ出し・計算結果の変更がないこと。
