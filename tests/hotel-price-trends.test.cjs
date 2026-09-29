const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/hotel-price-trends-model.js");

const snapshot = (date, rates, properties = [{hotel_no: 1, name: "A"}, {hotel_no: 2, name: "B"}, {hotel_no: 3, name: "C"}], conditions = {adults: 2, rooms: 1, nights: 1}) => ({
  snapshot_date: date, conditions, regions: [{code: "area", properties, rates}]
});
const row = (hotel_no, min_price_yen, status = "success") => ({hotel_no, stay_date: "2026-10-01", meal_type: "two_meals", min_price_yen, plan_count: 1, status});

test("summarize accepts only positive finite numeric success prices once per property", () => {
  const data = snapshot("2026-09-16", [row(1, 10000), row(1, 50000), row(2, 0), row(3, Infinity), row(4, 20000), row(2, 25000, "no_plan")]);
  const result = model.summarize(data, "area", "2026-10-01", "two_meals");
  assert.equal(result.successful, 1);
  assert.equal(result.marketMedian, 10000);
  assert.equal(result.target, 3);
  assert.equal(result.positions[1].min_price_yen, null);
});

test("non-numeric and boolean prices are never valid prices", () => {
  const result = model.summarize(snapshot("2026-09-16", [row(1, "10000"), row(2, true), row(3, NaN)]), "area", "2026-10-01", "two_meals");
  assert.equal(result.successful, 0);
  assert.equal(result.marketMedian, null);
});

test("summarize distinguishes no observation from observed but zero successful prices", () => {
  const none = model.summarize(snapshot("2026-09-16", []), "area", "2026-10-01", "two_meals");
  const zero = model.summarize(snapshot("2026-09-16", [row(1, null, "no_plan"), row(2, null, "error")]), "area", "2026-10-01", "two_meals");
  assert.deepEqual([none.observations, none.successful], [0, 0]);
  assert.deepEqual([zero.observations, zero.successful], [2, 0]);
});

test("small samples retain a reference median but suppress comparisons and ranks", () => {
  const result = model.summarize(snapshot("2026-09-16", [row(1, 10000), row(2, 30000)]), "area", "2026-10-01", "two_meals");
  assert.equal(result.marketMedian, 20000);
  assert.equal(result.comparisonReady, false);
  assert.equal(model.priceRank(result, 1), null);
});

test("price rank uses competition ranking and recognizes equal prices", () => {
  const result = model.summarize(snapshot("2026-09-16", [row(1, 30000), row(2, 30000), row(3, 20000)]), "area", "2026-10-01", "two_meals");
  assert.deepEqual(model.priceRank(result, 1), {rank: 1, total: 3, equal: 2});
  assert.deepEqual(model.priceRank(result, 3), {rank: 3, total: 3, equal: 1});
});

test("seven-day comparison requires exact date and matching conditions", () => {
  const current = snapshot("2026-09-16", [row(1, 12000), row(2, 20000), row(3, 30000)]);
  const prior = snapshot("2026-09-09", [row(1, 10000), row(2, 20000), row(3, 30000)]);
  const selection = {regionCode: "area", hotelNo: 1, stayDate: "2026-10-01", mealType: "two_meals"};
  assert.equal(model.sevenDayComparison(current, [current, prior], selection).marketChange, 0);
  assert.equal(model.sevenDayComparison(current, [snapshot("2026-09-08", prior.regions[0].rates)], selection).status, "missing_snapshot");
  assert.equal(model.sevenDayComparison(current, [snapshot("2026-09-09", prior.regions[0].rates, undefined, {adults: 1, rooms: 1, nights: 1})], selection).status, "conditions_mismatch");
});

test("property-set changes suppress market comparison but retain a same-property price change", () => {
  const current = snapshot("2026-09-16", [row(1, 12000), row(2, 20000), row(3, 30000)]);
  const prior = snapshot("2026-09-09", [row(1, 10000), row(2, 20000), row(4, 30000)], [{hotel_no: 1}, {hotel_no: 2}, {hotel_no: 4}]);
  const result = model.sevenDayComparison(current, [current, prior], {regionCode: "area", hotelNo: 1, stayDate: "2026-10-01", mealType: "two_meals"});
  assert.equal(result.status, "property_set_mismatch");
  assert.equal(result.marketChange, null);
  assert.ok(Math.abs(result.selectedChange - 20) < 0.000001);
});

test("date display inputs are calendar-safe at month and leap-year boundaries", () => {
  assert.equal(model.addDays("2026-01-01", -7), "2025-12-25");
  assert.equal(model.addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(model.signedPercent(-0.01), "0.0%");
  assert.equal(model.changeLabel(9000 / 10000 * 100 - 100), "低下");
  assert.equal(model.formatJapaneseDate("2026-09-30"), "9/30（水）");
});

test("change labels honor rounded three and ten percent boundaries", () => {
  assert.equal(model.changeLabel(3), "やや上昇");
  assert.equal(model.changeLabel(10), "上昇");
  assert.equal(model.changeLabel(-3), "やや低下");
  assert.equal(model.changeLabel(-10), "低下");
  assert.equal(model.changeLabel(2.94), "大きな変化なし");
  assert.equal(model.changeLabel(2.96), "大きな変化なし");
  assert.equal(model.changeLabel(9.96), "やや上昇");
  assert.equal(model.changeLabel(-9.96), "やや低下");
});

test("insights provide market, position, and confirmation as separate lines", () => {
  const current = model.summarize(snapshot("2026-09-16", [row(1, 12000), row(2, 20000), row(3, 30000)]), "area", "2026-10-01", "two_meals");
  const prior = model.summarize(snapshot("2026-09-09", [row(1, 10000), row(2, 18000), row(3, 28000)]), "area", "2026-10-01", "two_meals");
  const lines = model.insightLines(current, {status: "available", marketChange: 10, prior}, 1);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /7日前比/);
  assert.match(lines[1], /選択施設/);
  assert.match(lines[2], /7日前.*現在/);
  assert.doesNotMatch(lines[0], /料金確認/);
});

test("small-sample insights retain comparable prior confirmation counts", () => {
  const current = model.summarize(snapshot("2026-09-16", [row(1, 12000), row(2, 20000)]), "area", "2026-10-01", "two_meals");
  const prior = model.summarize(snapshot("2026-09-09", [row(1, 10000), row(2, 18000)]), "area", "2026-10-01", "two_meals");
  assert.match(model.insightLines(current, {status: "available", prior}, 1).join(" "), /7日前2\/3施設、現在2\/3施設/);
});

test("insights distinguish no observations, zero success, and equal price", () => {
  const noObservation = model.summarize(snapshot("2026-09-16", []), "area", "2026-10-01", "two_meals");
  const zeroSuccess = model.summarize(snapshot("2026-09-16", [row(1, null, "no_plan")]), "area", "2026-10-01", "two_meals");
  const equal = model.summarize(snapshot("2026-09-16", [row(1, 20000), row(2, 20000), row(3, 20000)]), "area", "2026-10-01", "two_meals");
  assert.match(model.insightLines(noObservation, null, 1).join(" "), /観測行/);
  assert.match(model.insightLines(zeroSuccess, null, 1).join(" "), /0\/3/);
  assert.match(model.insightLines(equal, null, 1).join(" "), /同水準/);
});

test("insights remain at most three sentences when the selected price is missing", () => {
  const properties = [1, 2, 3, 4].map((hotel_no) => ({hotel_no}));
  const prior = snapshot("2026-09-09", [row(1, 10000), row(2, 20000), row(3, 30000), row(4, null, "no_plan")], properties);
  const current = snapshot("2026-09-16", [row(1, 12000), row(2, 24000), row(3, 36000), row(4, null, "no_plan")], properties);
  const selection = {regionCode: "area", hotelNo: 4, stayDate: "2026-10-01", mealType: "two_meals"};
  const comparison = model.sevenDayComparison(current, [prior], selection);
  const lines = model.insightLines(comparison.current, comparison, 4);
  assert.equal(lines.length, 3);
  assert.equal((lines.join("").match(/。/g) || []).length, 3);
  assert.match(lines[1], /料金未確認は満室を意味しません/);
});
