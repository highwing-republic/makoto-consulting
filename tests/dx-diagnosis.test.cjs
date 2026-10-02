const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/dx-diagnosis-model.js");

test("diagnosis data preserves the source structure", () => {
  assert.equal(model.categories.length, 8);
  assert.equal(model.questions.length, 16);
  model.categories.forEach((category) => assert.equal(model.questions.filter((question) => question.category === category).length, 2));
  model.questions.forEach((question) => assert.equal(question.options.length, 3));
  assert.equal(model.solutions.length, 9);
  assert.deepEqual(new Set(model.solutions.map((solution) => solution.category)), new Set(model.categories));
});

test("case A matches the original default diagnosis", () => {
  const result = model.buildResult(model.defaultAnswers(), { ...model.initialFacility });
  assert.deepEqual(result.scores, { "経営": 63, "予約・販売": 63, "会計": 60, "業務": 58, "勤怠・シフト": 60, "システム": 60, "集客": 63, "データ活用": 60 });
  assert.equal(result.total, 61);
  assert.deepEqual(result.findings.map((finding) => finding.category), ["業務", "会計", "勤怠・シフト"]);
  assert.deepEqual(result.matchedSolutions.map((solution) => solution.name), ["清掃管理デジタル化", "PMS・会計連携", "クラウド勤怠・シフト管理"]);
  assert.deepEqual([result.monthlyHours, result.annualHours, result.annualValue, result.revpar], [39, 468, 655200, 11700]);
  assert.equal(Math.round(result.annualValue / 10000), 66);
  assert.equal(result.comment, "DX総合スコアは61点です。最優先は「業務」です。まずは「紙・口頭で行っている業務を3つ書き出す」から始めてください。現在の参考RevPARは約11,700円です。システム導入を急ぐより、手作業の多い場所から順に改善するのがおすすめです。");
});

test("case B applies the high OTA deduction", () => {
  const answers = Object.fromEntries(model.questions.map((question) => [question.id, 0]));
  const result = model.buildResult(answers, { name: "", rooms: 10, adr: 10000, occupancy: 50, otaRatio: 85, employees: 5, hourlyCost: 1400 });
  assert.deepEqual(result.scores, { "経営": 20, "予約・販売": 8, "会計": 18, "業務": 18, "勤怠・シフト": 20, "システム": 18, "集客": 20, "データ活用": 18 });
  assert.equal(result.total, 18);
  assert.deepEqual(result.findings.map((finding) => finding.category), ["予約・販売", "会計", "業務"]);
  assert.deepEqual(result.matchedSolutions.map((solution) => solution.name), ["サイトコントローラー連携見直し", "自社予約導線改善", "PMS・会計連携", "清掃管理デジタル化"]);
  assert.deepEqual([result.monthlyHours, result.annualValue, result.revpar], [42, 705600, 5000]);
  assert.equal(Math.round(result.annualValue / 10000), 71);
});

test("case C replaces the third finding with OTA sales", () => {
  const lowCategories = new Set(["経営", "会計", "業務"]);
  const answers = Object.fromEntries(model.questions.map((question) => [question.id, lowCategories.has(question.category) ? 0 : 2]));
  const result = model.buildResult(answers, { ...model.initialFacility, otaRatio: 72 });
  assert.deepEqual(result.scores, { "経営": 20, "予約・販売": 94, "会計": 18, "業務": 18, "勤怠・シフト": 100, "システム": 100, "集客": 100, "データ活用": 100 });
  assert.equal(result.total, 69);
  assert.deepEqual(result.findings.map((finding) => finding.category), ["会計", "業務", "予約・販売"]);
  assert.equal(result.findings[2].score, 94);
  assert.equal(result.findings[2].text, "OTA比率が72%と高めです。手数料負担と自社予約導線を一度確認する価値があります。");
});

test("facility validation rejects out-of-range and non-numeric values", () => {
  assert.ok(model.validateFacility({ ...model.initialFacility, rooms: 0 }).rooms);
  assert.ok(model.validateFacility({ ...model.initialFacility, occupancy: 101 }).occupancy);
  assert.ok(model.validateFacility({ ...model.initialFacility, adr: -1 }).adr);
  assert.ok(model.validateFacility({ ...model.initialFacility, hourlyCost: Number.NaN }).hourlyCost);
  assert.deepEqual(model.validateFacility({ ...model.initialFacility }), {});
});

test("missing answers use the documented category fallback", () => {
  const result = model.calculateScores({}, { ...model.initialFacility });
  assert.equal(result.scores["経営"], 50);
  assert.equal(result.scores["予約・販売"], 50);
});
