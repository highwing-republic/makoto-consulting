// 解説「宿泊市場データの使い方」の7日トレンドの判定表が、宿泊料金トレンドの changeLabel と一致することを確かめる。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const model = require("../js/hotel-price-trends-model.js");

const html = fs.readFileSync(path.join(__dirname, "..", "guide", "market-data", "index.html"), "utf8");
const table = html.match(/<table class="guide-trend-table">([\s\S]*?)<\/table>/)[1];
const rows = [...table.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map((match) => [match[1], match[2]]);

// 「＋3%以上、＋10%未満」のような表記を、下限・上限と端を含むかに直す。
function interval(text) {
  const range = {low: -Infinity, lowIn: false, high: Infinity, highIn: false};
  for (const [, sign, digits, kind] of text.matchAll(/([＋−])(\d+)%(以上|より大きく|未満|以下)/g)) {
    const value = (sign === "−" ? -1 : 1) * Number(digits);
    if (kind === "以上") Object.assign(range, {low: value, lowIn: true});
    if (kind === "より大きく") Object.assign(range, {low: value, lowIn: false});
    if (kind === "未満") Object.assign(range, {high: value, highIn: false});
    if (kind === "以下") Object.assign(range, {high: value, highIn: true});
  }
  return range;
}

test("the guide's 7-day table covers every label once", () => {
  assert.deepEqual(rows.map(([, label]) => label).sort(), ["上昇", "低下", "大きな変化なし", "やや上昇", "やや低下"].sort());
});

test("each row of the guide's 7-day table matches changeLabel at its edges", () => {
  for (const [text, label] of rows) {
    const {low, lowIn, high, highIn} = interval(text);
    const probes = [];
    if (Number.isFinite(low)) probes.push(lowIn ? low : low + 0.1);
    if (Number.isFinite(high)) probes.push(highIn ? high : high - 0.1);
    if (!Number.isFinite(low)) probes.push(high - 20);
    if (!Number.isFinite(high)) probes.push(low + 20);
    assert.ok(probes.length >= 2, text);
    for (const value of probes) assert.equal(model.changeLabel(value), label, `${text} at ${value}`);
    // Just past each edge, the tool must already give another label.
    if (Number.isFinite(low)) assert.notEqual(model.changeLabel(lowIn ? low - 0.1 : low), label, `${text} below ${low}`);
    if (Number.isFinite(high)) assert.notEqual(model.changeLabel(highIn ? high + 0.1 : high), label, `${text} above ${high}`);
  }
});
