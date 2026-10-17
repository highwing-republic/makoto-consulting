const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/kpi-calculator-model.js");

// 統計の具体値は data/ の週次更新で変わるため、ここでは小さな固定データを使う。
const dataset = {
  periods: ["2025-07", "2025-08", "2026-07"],
  basis: ["before", "before", "after"],
  national: { occupancy_rate: [62.1, 66.0, 61.0], occupancy_rate_by_type: { ryokan: [null, null, 40.2], city_hotel: [null, null, 71.9] } },
  prefectures: {
    "20": { prefecture_name: "長野県", occupancy_rate: [44.0, 52.3, 43.3], occupancy_rate_by_type: { ryokan: [null, null, 34.0], city_hotel: [null, null, null] } },
    "47": { prefecture_name: "沖縄県", occupancy_rate: [70.2, null, 68.8] }
  }
};

test("the sample inn gives the core KPIs with their formulas", () => {
  const result = model.calculate(model.sample);
  assert.equal(result.availableRooms, 930);
  assert.equal(result.occupancy, 65.1);
  assert.equal(result.adr, 18000);
  assert.equal(result.revpar, 11710);
  assert.equal(result.guestsPerRoom, 2);
  assert.equal(result.revenuePerGuest, 9000);
  assert.equal(result.bedOccupancy, 43.4);
  assert.equal(result.trevpar, 14624);
  assert.deepEqual(result.breakEven, { reachable: true, rooms: 452, occupancy: 48.6, marginPerRoom: 15500, monthlyProfit: 2377500 });
});

test("raising the price keeps every yen, raising occupancy pays the per-room cost", () => {
  const { levers } = model.calculate(model.sample);
  assert.deepEqual(levers.occupancy, { step: 5, extraRooms: 47, revenue: 837000, margin: 720750, capped: false });
  assert.deepEqual(levers.adr, { step: 1000, revenue: 605000, margin: 605000 });
  const noCost = model.calculate({ ...model.sample, variableCostPerRoom: null, fixedCost: null });
  assert.equal(noCost.levers.occupancy.margin, null);
  assert.equal(noCost.breakEven, null);
});

test("occupancy gains stop at a full house", () => {
  const nearlyFull = { ...model.sample, soldRooms: 920, roomRevenue: 920 * 18000 };
  const { occupancy } = model.calculate(nearlyFull).levers;
  assert.equal(occupancy.extraRooms, 10);
  assert.equal(occupancy.capped, true);
});

test("rooms taken out of sale shrink the rooms available", () => {
  const result = model.calculate({ ...model.sample, closedRoomNights: 30 });
  assert.equal(result.availableRooms, 900);
  assert.equal(result.occupancy, 67.2);
  assert.equal(result.revpar, 12100);
});

test("break-even says when the fixed cost cannot be covered", () => {
  const thin = model.calculate({ ...model.sample, fixedCost: 20000000 });
  assert.equal(thin.breakEven.reachable, false);
  assert.equal(thin.breakEven.rooms, 1291);
  const loss = model.calculate({ ...model.sample, variableCostPerRoom: 18000 });
  assert.equal(loss.breakEven.rooms, null);
  assert.equal(loss.breakEven.reachable, false);
});

test("reverse calculation from a monthly target", () => {
  assert.deepEqual(model.reverse(model.sample, 12000000), { rooms: 667, occupancy: 71.7, reachable: true, adr: 19900 });
  assert.equal(model.reverse(model.sample, 20000000).reachable, false);
  assert.equal(model.reverse(model.sample, null), null);
});

test("benchmark uses the same month, or the latest same calendar month when not yet published", () => {
  assert.deepEqual(model.benchmark(dataset, "2026-07", "20"), {
    period: "2026-07", exact: true, basis: "after", prefectureName: "長野県", prefecture: 43.3, national: 61.0,
    facilityType: null, facilityLabel: null, prefectureType: null, nationalType: null
  });
  const later = model.benchmark(dataset, "2027-08", "20");
  assert.equal(later.period, "2025-08");
  assert.equal(later.exact, false);
  assert.equal(later.basis, "before");
  assert.equal(model.benchmark(dataset, "2026-09", "20"), null);
  assert.deepEqual(model.compare(65.1, model.benchmark(dataset, "2026-07", "20")), { reference: 43.3, label: "長野県", byType: false, gap: 21.8 });
  // 都道府県を選ばない、または県の値が欠けているときは全国と比べる
  assert.deepEqual(model.compare(65.1, model.benchmark(dataset, "2026-07", "")), { reference: 61.0, label: "全国", byType: false, gap: 4.1 });
  assert.deepEqual(model.compare(60, model.benchmark(dataset, "2025-08", "47")), { reference: 66.0, label: "全国", byType: false, gap: -6 });
  assert.equal(model.benchmark(null, "2026-07", "20"), null);
});

test("a facility type compares with the same type in the prefecture, then nationwide, then all types", () => {
  const ryokan = model.benchmark(dataset, "2026-07", "20", "ryokan");
  assert.equal(ryokan.facilityLabel, "旅館");
  assert.equal(ryokan.prefectureType, 34.0);
  assert.equal(ryokan.nationalType, 40.2);
  assert.deepEqual(model.compare(65.1, ryokan), { reference: 34.0, label: "長野県の旅館", byType: true, gap: 31.1 });
  // 県のそのタイプが「-」のときは全国のそのタイプ
  assert.deepEqual(model.compare(65.1, model.benchmark(dataset, "2026-07", "20", "city_hotel")), { reference: 71.9, label: "全国のシティホテル", byType: true, gap: -6.8 });
  assert.deepEqual(model.compare(65.1, model.benchmark(dataset, "2026-07", "", "ryokan")), { reference: 40.2, label: "全国の旅館", byType: true, gap: 24.9 });
  // タイプ別の値がまだない月・データは全施設の値で比べる
  assert.deepEqual(model.compare(50, model.benchmark(dataset, "2025-08", "20", "ryokan")), { reference: 52.3, label: "長野県", byType: false, gap: -2.3 });
  assert.equal(model.benchmark(dataset, "2026-07", "20", "unknown").facilityType, null);
  assert.equal(model.sample.facilityType, "ryokan");
});

test("numbers typed with commas, full-width digits or units are read", () => {
  assert.equal(model.parseNumber("10,890,000"), 10890000);
  assert.equal(model.parseNumber("１２３４５"), 12345);
  assert.equal(model.parseNumber(" 30室 "), 30);
  assert.equal(model.parseNumber(""), null);
  assert.ok(Number.isNaN(model.parseNumber("abc")));
  assert.equal(model.daysInMonth("2026-02"), 28);
  assert.equal(model.daysInMonth("2028-02"), 29);
});

test("validation catches impossible combinations", () => {
  assert.deepEqual(model.validate(model.sample), {});
  const errors = model.validate({ ...model.sample, month: "2026-02", days: 30, soldRooms: 1000, guests: 10 });
  assert.match(errors.days, /1〜28日/);
  assert.equal(errors.soldRooms, undefined);
  const oversold = model.validate({ ...model.sample, soldRooms: 931 });
  assert.match(oversold.soldRooms, /930室/);
  assert.match(model.validate({ ...model.sample, guests: 600 }).guests, /販売客室数より少なく/);
  assert.match(model.validate({ ...model.sample, capacity: 30 }).capacity, /定員×営業日数/);
  assert.match(model.validate({ ...model.sample, totalRevenue: 100 }).totalRevenue, /客室売上以上/);
  assert.ok(model.validate({ ...model.sample, rooms: null }).rooms);
  assert.ok(model.validate({ ...model.sample, roomRevenue: Number.NaN }).roomRevenue);
});
