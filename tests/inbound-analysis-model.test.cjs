// 分離前の inbound-analysis.js がブラウザで描画した文字列・座標（golden.json、
// 2026-09-30 更新の固定データ）と、分離後の inbound-analysis-model.js の出力が
// 全国＋47都道府県（＋不正な ?pref= 2件）で一致することを確認する。
const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/inbound-analysis-model.js");
const golden = require("./fixtures/inbound/golden.json");
const dataset = model.validateDataset(require("./fixtures/inbound/latest.json"));

const s = (v) => String(v);
// ブラウザは style.width のパーセント値を有効数字6桁で返す。
const cssPercent = (width) => `${Number(parseFloat(width).toPrecision(6))}%`;

// 画面側（inbound-analysis.js）が SVG に書き出す要素を同じ順序で組み立てる。
function svgParts(layout) {
  const rects = [];
  const texts = [];
  const lines = [];
  layout.grid.forEach((line) => {
    lines.push([s(line.x1), s(line.y), s(line.x2), s(line.y), "trend-grid-line"]);
    texts.push([s(line.labelX), s(line.labelY), "trend-axis-label", "end", line.label]);
  });
  layout.bars.forEach((bar) => {
    rects.push([s(bar.x), s(bar.y), s(bar.width), s(bar.height), "trend-bar", bar.title]);
    texts.push([s(bar.axisX), s(bar.axisY), "trend-axis-label", "middle", bar.axisLabel]);
    if (bar.boundary) {
      lines.push([s(bar.boundary.x), s(bar.boundary.y1), s(bar.boundary.x), s(bar.boundary.y2), "trend-boundary-line"]);
      texts.push([s(bar.boundary.labelX), s(bar.boundary.labelY), "trend-boundary-label", null, bar.boundary.label]);
    }
  });
  return { rects, texts, lines };
}

test("the ?pref= parameter resolves exactly as before", () => {
  assert.equal(model.resolveArea(null), "全国");
  assert.equal(model.resolveArea("13"), "東京都");
  assert.equal(model.resolveArea("nagano"), "長野県");
  assert.equal(model.resolveArea("bogus"), null);
  assert.equal(model.areaSlug("全国"), null);
  assert.equal(model.areaSlug("長野県"), "nagano");
  assert.deepEqual([model.areaCode("全国"), model.areaCode("東京都"), model.areaCode("沖縄県")], ["00", "13", "47"]);
});

test("an unknown prefecture keeps the dashboard hidden with the same message", () => {
  const want = golden.areas.bogus;
  assert.equal(want.hidden, true);
  assert.equal(want.select, "");
  assert.equal(model.emptyMessage(), want.ids["analysis-period"]);
  assert.deepEqual(model.selectorOptions(dataset, null).map((o) => o.value), want.options);
  assert.deepEqual(model.sourceEntries(dataset.metadata).map((e) => e.text), [
    "観光庁「宿泊旅行統計調査」↗", want.source["source-period"], want.source["source-unit"], want.source["source-scope"],
  ]);
  assert.equal(model.sourceUpdated(dataset.metadata), want.source["source-updated"]);
});

test("every area renders the same texts, bars and tables as before the split", () => {
  const areas = Object.entries(golden.areas).filter(([key, want]) => !want.hidden);
  assert.equal(areas.length, 49);
  for (const [key, want] of areas) {
    const area = model.resolveArea(key === "全国" ? null : key);
    assert.equal(area, want.select, key);
    const record = model.areaRecord(dataset, area);
    const markets = model.marketRows(record, dataset.national);
    const kpis = model.kpiTexts(area, record, markets, dataset.national);
    const texts = { ...model.headerTexts(dataset), ...kpis.texts };
    for (const [id, value] of Object.entries(want.ids)) assert.equal(texts[id], value, `${key}#${id}`);
    assert.deepEqual(Object.keys(kpis.status).filter((id) => kpis.status[id]), want.status, `${key} status`);
    assert.deepEqual(model.selectorOptions(dataset, area).map((o) => o.value), want.options, `${key} options`);

    const layout = model.trendLayout(area, record.monthly);
    assert.equal(layout.ariaLabel, want.trend.aria, `${key} trend aria`);
    assert.equal(layout.viewBox, want.trend.viewBox);
    const parts = svgParts(layout);
    assert.deepEqual(parts.rects, want.trend.rects, `${key} bars`);
    assert.deepEqual(parts.texts, want.trend.texts, `${key} trend labels`);
    assert.deepEqual(parts.lines, want.trend.lines, `${key} trend lines`);
    assert.deepEqual(layout.bars.map((bar) => [bar.valueLabel, bar.valueText]), want.values, `${key} values`);

    assert.deepEqual(model.rankingRows(markets).map((r) => [r.rank, r.name, r.value, cssPercent(r.width)]), want.ranking, `${key} ranking`);
    assert.deepEqual(model.candidates(markets).map((c) => [c.number, c.name, c.score, c.reason]), want.candidates, `${key} candidates`);
    assert.deepEqual(model.comparisonRows(markets).map((row) => [
      ...row.cells.map((cell, index) => [index === 0 ? "TH" : "TD", index === 0 ? "row" : null, cell[0], cell[1], null]),
      ["TD", null, "地域特化度", row.specialization, row.specializationClass],
    ]), want.comparison, `${key} comparison`);
    assert.deepEqual(model.insightTexts(area, markets), want.insight, `${key} insight`);
  }
});

test("empty monthly data and empty markets fall back to the original messages", () => {
  assert.deepEqual(model.trendLayout("長野県", []), { empty: "月次データを表示できません。" });
  assert.deepEqual(model.insightTexts("長野県", []), ["国・地域別データを確認できません。"]);
  assert.deepEqual(model.specializationClass(1.5), "specialization specialization--high");
  assert.deepEqual([model.formatCompact(12345678), model.formatCompact(123456), model.formatCompact(12345), model.formatCompact(999)], ["1.2千万", "12万", "1.2万", "999"]);
});
