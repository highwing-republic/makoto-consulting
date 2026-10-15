const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/business-hotel-price-trends-model.js");

// 1市場・CORE 5施設＋BACKUP 1施設の小さな比較施設群
const cohort = {
  cohort_version: "bh-v1",
  cross_city_brand: "東横イン",
  markets: [
    {
      code: "sapporo",
      name: "札幌",
      prefecture: "北海道",
      properties: [
        {hotel_no: 1, name: "A", brand: "東横イン", role: "core"},
        {hotel_no: 2, name: "B", brand: "X", role: "core"},
        {hotel_no: 3, name: "C", brand: "Y", role: "core"},
        {hotel_no: 4, name: "D", brand: "Z", role: "core"},
        {hotel_no: 5, name: "E", brand: "W", role: "core"},
        {hotel_no: 9, name: "Backup", brand: "V", role: "backup"},
      ],
    },
  ],
};

// 2026-10-16（金）から14泊。平日8,000円、金土10,000円、10/24（土）だけ20,000円。
function snapshot(date, {shift = 0, version = "bh-v1", start = "2026-10-16"} = {}) {
  const dates = Array.from({length: 14}, (_, i) => model.addDays(start, i));
  const price = (d, offset) => {
    const day = model.weekdayIndex(d);
    const base = d === "2026-10-24" ? 20000 : day === 5 || day === 6 ? 10000 : 8000;
    return base + offset * 100 + shift;
  };
  return {
    snapshot_date: date,
    cohort_version: version,
    stay_dates: dates,
    markets: [
      {
        code: "sapporo",
        hotels: [
          {hotel_no: 1, price: dates.map((d) => price(d, 0)), meal: "B".repeat(14)},
          {hotel_no: 2, price: dates.map((d) => price(d, 1)), meal: "R".repeat(14)},
          {hotel_no: 3, price: dates.map((d) => price(d, 2)), meal: "R".repeat(14)},
          // D: 2泊は販売プランなし
          {hotel_no: 4, price: dates.map((d, i) => (i < 2 ? null : price(d, 3))), meal: "--" + "R".repeat(12)},
          // E: 最初の2泊は取得エラー → 先頭2泊はCOREが3施設（参考値）
          {hotel_no: 5, price: dates.map((d, i) => (i < 2 ? null : price(d, 4))), meal: "??" + "T".repeat(12)},
          {hotel_no: 9, price: dates.map(() => 1), meal: "R".repeat(14)},
        ],
      },
    ],
  };
}

test("CORE施設だけで宿泊日ごとの中央値を出し、3施設は参考値にする", () => {
  const view = model.marketView(cohort, snapshot("2026-10-16"), "sapporo");
  assert.equal(view.core.length, 5);
  assert.equal(view.backup.length, 1);
  const days = model.dailyMedians(view);
  assert.equal(days[0].status, "reference");
  assert.equal(days[0].count, 3);
  assert.equal(days[2].status, "ok");
  assert.equal(days[2].median, 8200); // 日曜: 8000,8100,8200,8300,8400
  assert.equal(days[2].min, 8000);
  assert.equal(days[2].max, 8400);
});

test("市場の代表料金・値動き・週末差・急騰日", () => {
  const summary = model.marketSummary(model.marketView(cohort, snapshot("2026-10-16"), "sapporo"));
  assert.equal(summary.validNights, 12);
  assert.equal(summary.typical, 8200);
  assert.deepEqual(summary.spikes.map((day) => day.date), ["2026-10-24"]);
  assert.ok(summary.volatility > 0);
  // 中央値を出せる金土は10/23（10,200円）と10/24（20,200円）。中央値15,200円 ÷ 日〜木8,200円
  assert.equal(Math.round(summary.weekendPremium * 10) / 10, 85.4);
  const saturday = summary.weekdays.find((day) => day.label === "土");
  assert.equal(saturday.nights, 1); // 10/17は参考値なので曜日別には入れない
  assert.equal(model.calendarClass(summary.days[8], summary.typical), "spike");
  assert.equal(model.calendarClass(summary.days[2], summary.typical), "mid");
  assert.equal(summary.days[0].status, "reference"); // 参考値の日も色分けし、画面では参考と明示する
  assert.equal(model.calendarClass(summary.days[0], summary.typical), "high");
  assert.equal(model.calendarClass({status: "none"}, summary.typical), "none");
});

test("期間を絞ると先頭からその泊数だけを使う", () => {
  const view = model.marketView(cohort, snapshot("2026-10-16"), "sapporo", {nights: 7});
  assert.equal(view.dates.length, 7);
  assert.equal(model.marketSummary(view).spikes.length, 0);
});

test("施設ごとの集計と、もっとも多い食事区分", () => {
  const view = model.marketView(cohort, snapshot("2026-10-16"), "sapporo");
  const d = model.hotelSummary(view.core[3]);
  assert.equal(d.noPlanNights, 2);
  assert.equal(d.pricedNights, 12);
  assert.equal(d.leadingMeal.label, "素泊まり");
  const a = model.hotelSummary(view.core[0]);
  assert.equal(a.leadingMeal.code, "B");
  assert.equal(a.leadingMeal.share, 100);
});

test("都市横断の比較は各市場のCOREにある指定ブランドを使う", () => {
  const rows = model.crossCityBrand(cohort, snapshot("2026-10-16"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hotel.name, "A");
  assert.equal(rows[0].hotel.median, 8000);
});

test("7日変化: ちょうど7日前・同じ比較施設群のときだけ比べる", () => {
  const latest = snapshot("2026-10-16", {shift: 400});
  const before = snapshot("2026-10-09");
  const result = model.weeklyChange(cohort, latest, before, "sapporo");
  assert.equal(result.status, "ok");
  assert.equal(result.direction, "up");
  assert.ok(result.change > 3 && result.change < 6);

  assert.equal(model.weeklyChange(cohort, latest, snapshot("2026-10-10"), "sapporo").status, "insufficient");
  assert.equal(model.weeklyChange(cohort, latest, snapshot("2026-10-09", {version: "bh-v0"}), "sapporo").status, "insufficient");
  assert.equal(model.weeklyChange(cohort, latest, null, "sapporo").status, "insufficient");
});

test("7日変化: 共通宿泊日が10泊未満の施設は使わない", () => {
  const latest = snapshot("2026-10-16", {start: "2026-10-16"});
  const before = snapshot("2026-10-09", {start: "2026-10-09"}); // 共通は10/16〜10/22の7泊だけ
  const result = model.weeklyChange(cohort, latest, before, "sapporo");
  assert.equal(result.status, "insufficient");
});

test("表示用の書式", () => {
  assert.equal(model.formatYen(8200), "8,200円");
  assert.equal(model.formatYen(null), "—");
  assert.equal(model.formatPercent(4.04), "+4.0%");
  assert.equal(model.formatPercent(-0.04), "0.0%");
  assert.equal(model.formatPercent(NaN), "—");
  assert.equal(model.formatDate("2026-10-24"), "10/24（土）");
});
