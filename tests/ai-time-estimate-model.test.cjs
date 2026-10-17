const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/ai-time-estimate-model.js");

const withTask = (input, id, patch) => ({ ...input, tasks: input.tasks.map((row) => (row.id === id ? { ...row, ...patch } : row)) });

test("ten tasks, each with a tip and a risk label, rates within the cap", () => {
  assert.equal(model.tasks.length, 10);
  assert.ok(model.tasks.every((t) => t.tip && model.riskLabel[t.risk] && t.low <= t.high && t.high <= model.MAX_RATE));
  assert.deepEqual(model.tasks.filter((t) => t.risk === "high").map((t) => t.id), ["foreign-mail", "allergy"]);
});

test("the sample inn saves 12 to 19.5 hours a month", () => {
  const result = model.estimate(model.sampleInput());
  assert.equal(result.selected, 10);
  assert.equal(result.baseHours, 37.8);
  assert.deepEqual(result.monthly, { low: 12, high: 19.5 });
  assert.deepEqual(result.annual, { low: 145, high: 234 });
  assert.deepEqual(result.value, { low: 202440, high: 327040 });
  assert.equal(result.toolCost, 72000);
  assert.deepEqual(result.net, { low: 130440, high: 255040 });
});

test("first picks weigh saved time by risk, keeping list order on ties", () => {
  const result = model.estimate(model.sampleInput());
  // 口コミ 3h×0.8=2.4、外国語 4.8h×0.5=2.4、紹介文 2.67h×0.8=2.13
  assert.deepEqual(result.firstPicks.map((row) => row.id), ["review", "foreign-mail", "plan-copy"]);
  const fewer = withTask(model.sampleInput(), "foreign-mail", { enabled: false });
  assert.deepEqual(model.estimate(fewer).firstPicks.map((row) => row.id), ["review", "plan-copy", "manual"]);
});

test("unchecked tasks and zero-hour tasks drop out", () => {
  const input = { ...model.sampleInput(), tasks: model.sampleInput().tasks.map((row) => ({ ...row, enabled: row.id === "minutes" || row.id === "faq" })) };
  const zero = withTask(input, "faq", { count: 0 });
  const result = model.estimate(zero);
  assert.equal(result.selected, 2);
  assert.deepEqual(result.monthly, { low: 1.2, high: 2 });
  assert.deepEqual(result.firstPicks.map((row) => row.id), ["minutes"]);
  const none = model.estimate({ ...input, tasks: input.tasks.map((row) => ({ ...row, enabled: false })) });
  assert.equal(none.selected, 0);
  assert.deepEqual(none.firstPicks, []);
});

test("validation is per field and skips unchecked tasks", () => {
  assert.deepEqual(model.validate(model.sampleInput()), {});
  let input = withTask(model.sampleInput(), "review", { count: NaN, high: 20 });
  input = withTask(input, "sns", { minutes: 601 });
  input = withTask(input, "manual", { enabled: false, count: null });
  input = { ...input, seats: 1.5, hourlyCost: null };
  assert.deepEqual(Object.keys(model.validate(input)).sort(), ["count:review", "high:review", "hourlyCost", "minutes:sns", "seats"]);
  assert.match(model.validate(withTask(model.sampleInput(), "faq", { low: 95 }))["low:faq"], /90%/);
});

test("numbers typed in full width or with units are read", () => {
  assert.equal(model.parseNumber("１，４００円"), 1400);
  assert.equal(model.parseNumber("60件"), 60);
  assert.equal(model.parseNumber("12.5"), 12.5);
  assert.equal(model.parseNumber(""), null);
  assert.ok(Number.isNaN(model.parseNumber("-3")));
});

test("the page lists the same ten tasks in the same order", () => {
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "ai-time-estimate.html"), "utf8");
  const ids = [...html.matchAll(/data-task="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, model.tasks.map((t) => t.id));
  model.tasks.forEach((t) => {
    assert.ok(html.includes('<span class="ait-task__name">' + t.name + "</span>"), t.id);
    ["count", "minutes", "low", "high"].forEach((key) => {
      const field = html.match(new RegExp('name="' + key + ":" + t.id + '"[^>]*value="([^"]+)"'));
      assert.ok(field, key + ":" + t.id);
      assert.equal(Number(field[1]), t[key], key + ":" + t.id);
    });
  });
});
