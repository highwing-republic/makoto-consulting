const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/ota-fee-simulator-model.js");

const withChannels = (changes) => ({ ...model.sample, channels: model.sample.channels.map((channel, index) => ({ ...channel, ...(changes[index] || {}) })) });

test("the example inn pays 9.3% of sales to its booking channels", () => {
  const result = model.summarize(model.sample);
  assert.equal(result.totalCost, 12125000);
  assert.equal(result.effectiveRate, 9.3);
  assert.equal(result.otaShare, 60);
  assert.equal(result.otaCost, 10595000);
  assert.deepEqual(result.rows.map((row) => [row.name, row.revenue, row.cost, row.effectiveRate]), [
    ["国内OTA A", 45500000, 5915000, 13],
    ["国内OTA B", 19500000, 2535000, 13],
    ["海外OTA", 13000000, 2145000, 16.5],
    ["自社サイト", 32500000, 1530000, 4.7],
    ["電話・直接", 19500000, 0, 0]
  ]);
});

test("the consumption tax on fees can be left out when invoices are without tax", () => {
  const result = model.summarize({ ...model.sample, taxOnFee: false });
  assert.equal(result.rows[0].effectiveRate, 12);
  assert.equal(result.rows[2].effectiveRate, 15);
  assert.equal(model.variableRate(model.sample.channels[0], true), 13);
});

test("moving 10 points to the inn's own site saves the fee difference minus the new advertising", () => {
  const result = model.scenario(model.sample, 10, 5);
  assert.equal(result.movedRevenue, 13000000);
  assert.equal(result.feeSaving, 1297833);
  assert.equal(result.acquisition, 650000);
  assert.equal(result.net, 647833);
  assert.equal(result.breakEvenRate, 10);
  assert.deepEqual([result.webShareBefore, result.webShareAfter, result.otaShareBefore, result.otaShareAfter], [25, 35, 60, 50]);
  // 広告費が上限の率を超えると差し引きは赤字
  assert.ok(model.scenario(model.sample, 10, 12).net < 0);
});

test("the shift stops at the OTA share and needs an own site row", () => {
  assert.equal(model.scenario(model.sample, 80, 0).moved, 60);
  assert.equal(model.scenario(withChannels({ 3: { kind: "direct" } }), 10, 5), null);
  assert.equal(model.scenario(withChannels({ 0: { share: 0 }, 1: { share: 0 }, 2: { share: 0 }, 3: { share: 85 } }), 10, 5), null);
});

test("an invoice gives the effective rate, and the tax is taken back out for the fee column", () => {
  assert.equal(model.rateFromInvoice(152000, 1150000), 13.2);
  assert.equal(model.rateFromInvoice(1000, 0), null);
  assert.equal(model.rateFromInvoice(null, 1000), null);
  assert.equal(model.feeRateForRow(13.2, true), 12);
  assert.equal(model.feeRateForRow(13.2, false), 13.2);
});

test("validation checks every row and that the shares add up to 100%", () => {
  const ok = model.validate(model.sample);
  assert.equal(model.errorCount(ok), 0);
  const off = model.validate(withChannels({ 0: { share: 30 } }));
  assert.match(off.shareTotal, /95%/);
  const rows = model.validate({ ...withChannels({ 1: { feeRate: 60, name: " " }, 4: { monthlyFixed: Number.NaN } }), annualRevenue: null });
  assert.ok(rows.annualRevenue);
  assert.ok(rows.channels[1].feeRate && rows.channels[1].name && rows.channels[4].monthlyFixed);
  // 行に誤りがある間は合計の誤りを重ねて出さない
  assert.equal(rows.shareTotal, undefined);
  assert.equal(model.errorCount(rows), 4);
});

test("numbers typed with commas, full-width digits or units are read", () => {
  assert.equal(model.parseNumber("130,000,000"), 130000000);
  assert.equal(model.parseNumber("１２．５％"), 12.5);
  assert.equal(model.parseNumber(""), null);
  assert.ok(Number.isNaN(model.parseNumber("-3")));
  assert.equal(model.MAX_CHANNELS, 8);
});

test("the diagnosis OTA ratio rescales the table, keeping each group's proportions", () => {
  const next = model.applyOtaRatio(model.sample.channels, 80);
  assert.deepEqual(next.map((c) => c.share), [46.7, 20, 13.3, 12.5, 7.5]);
  assert.equal(Math.round(model.shareTotal(next) * 10) / 10, 100);
  assert.equal(next[0].name, "国内OTA A");
  const zeros = model.applyOtaRatio(model.sample.channels.map((c) => ({ ...c, share: 0 })), 60);
  assert.deepEqual(zeros.map((c) => c.share), [20, 20, 20, 20, 20]);
  assert.equal(model.applyOtaRatio(model.sample.channels.filter((c) => c.kind !== "ota"), 50), null);
});

test("annual revenue from the diagnosis needs rooms, ADR and occupancy", () => {
  assert.equal(model.revenueFromDiagnosis({ rooms: 30, adr: 18000, occupancy: 65 }), 128120000);
  assert.equal(model.revenueFromDiagnosis({ rooms: 30, adr: null, occupancy: 65 }), null);
  assert.equal(model.revenueFromDiagnosis(null), null);
});
