// 分離前の cross-analysis.js がブラウザで描画した文字列・座標（golden.json、
// データ取得日 2026-10-06 の固定データ）と、分離後の cross-analysis-model.js の
// 出力が 3 ツール × 47 都道府県で一致することを確認する。
const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/cross-analysis-model.js");
const golden = require("./fixtures/cross-analysis/golden.json");

const DATA = {
  dx: require("./fixtures/cross-analysis/dx-necessity.json"),
  supply: require("./fixtures/cross-analysis/supply-demand-gap.json"),
  tourism: require("./fixtures/cross-analysis/tourism-pressure.json"),
};

function expectedTexts(type, item, dataset) {
  const texts = model.summaryTexts(type, item, dataset);
  if (type !== "supply") return texts;
  const { position, ...comparison } = model.supplyComparison(item, dataset.national);
  return { ...texts, ...comparison, "market-action-lead": model.supplyActions(item, dataset.national).lead };
}

// 画面側（cross-analysis.js）が SVG に書き出す文字・矩形・線を同じ順序で組み立てる。
function svgParts(layout) {
  const { width, height, left, right, top, bottom, xNationalPosition, yNationalPosition } = layout;
  const s = (v) => String(v);
  const texts = [];
  const rects = [];
  const lines = [];
  if (layout.isSupply) {
    rects.push(
      ["market-quadrant market-quadrant--slow-high", s(left), s(top), s(Math.max(0, xNationalPosition - left)), s(Math.max(0, yNationalPosition - top))],
      ["market-quadrant market-quadrant--growth-high", s(xNationalPosition), s(top), s(Math.max(0, width - right - xNationalPosition)), s(Math.max(0, yNationalPosition - top))],
      ["market-quadrant market-quadrant--slow-room", s(left), s(yNationalPosition), s(Math.max(0, xNationalPosition - left)), s(Math.max(0, height - bottom - yNationalPosition))],
      ["market-quadrant market-quadrant--growth-room", s(xNationalPosition), s(yNationalPosition), s(Math.max(0, width - right - xNationalPosition)), s(Math.max(0, height - bottom - yNationalPosition))],
    );
    texts.push(
      ["quadrant-label", "需要減速・高稼働", s(left + 10), s(top + 20)],
      ["quadrant-label", "需要成長・高稼働", s(xNationalPosition + 10), s(top + 20)],
      ["quadrant-label", "需要減速・稼働余力", s(left + 10), s(height - bottom - 12)],
      ["quadrant-label", "需要成長・稼働余力", s(xNationalPosition + 10), s(height - bottom - 12)],
    );
    layout.xTicks.forEach((tick) => {
      lines.push(["scatter-grid", s(tick.position), s(top), s(tick.position), s(height - bottom)]);
      texts.push(["scatter-tick", tick.label, s(tick.position), s(height - bottom + 24)]);
    });
    layout.yTicks.forEach((tick) => {
      lines.push(["scatter-grid", s(left), s(tick.position), s(width - right), s(tick.position)]);
      texts.push(["scatter-tick", tick.label, s(left - 12), s(tick.position + 4)]);
    });
    texts.push(
      ["national-label", `全国 ${layout.nationalGrowthLabel}`, s(xNationalPosition + 7), s(height - bottom + 44)],
      ["national-label", `全国 ${layout.nationalOccupancyLabel}`, s(left + 7), s(yNationalPosition - 8)],
    );
  }
  lines.push(
    ["scatter-axis", s(xNationalPosition), s(top), s(xNationalPosition), s(height - bottom)],
    ["scatter-axis", s(left), s(yNationalPosition), s(width - right), s(yNationalPosition)],
  );
  texts.push(["scatter-x-label", layout.xLabel, s(width - right), s(height - 12)], ["scatter-y-label", layout.yLabel, s(left), s(layout.isSupply ? 28 : 25)]);
  return { texts, rects, lines };
}

for (const [type, dataset] of Object.entries(DATA)) {
  const expected = golden.types[type];
  const rows = model.sortedRows(model.validateDataset(dataset));

  test(`${type}: ranking, empty state and sources match the pre-split page`, () => {
    assert.equal(rows.length + 1, expected.options);
    assert.equal(model.emptyMessage(null), expected.empty_period);
    assert.deepEqual(model.rankingRows(type, dataset).map((r) => [r.slug, String(r.rank), r.name, r.detail, r.score]), expected.ranking);
    assert.equal(Object.keys(expected.prefectures).length, 47);
  });

  if (expected.scatter) {
    test(`${type}: scatter geometry matches the pre-split page`, () => {
      const first = rows.find((r) => r.prefecture_slug === Object.keys(expected.prefectures)[0]);
      const layout = model.scatterLayout(type, first, dataset);
      assert.deepEqual(layout.points.map((p) => [`${p.name}：${p.details}`, String(p.cx), String(p.cy)]), expected.scatter.points);
      const parts = svgParts(layout);
      assert.deepEqual(parts.texts, expected.scatter.texts);
      assert.deepEqual(parts.rects, expected.scatter.rects);
      assert.deepEqual(parts.lines, expected.scatter.lines);
      if (type === "supply") assert.deepEqual(model.scatterTableRows(dataset, first).map((r) => [r.name, r.growth, r.occupancy, r.position]), expected.table);
    });
  }

  test(`${type}: every prefecture renders the same texts as before the split`, () => {
    for (const [slug, want] of Object.entries(expected.prefectures)) {
      const item = model.findRecord(dataset, slug);
      assert.ok(item, slug);
      const texts = expectedTexts(type, item, dataset);
      for (const [id, value] of Object.entries(want.ids)) assert.equal(texts[id], value, `${type}/${slug}#${id}`);
      want.status.forEach((id) => assert.ok(model.STATUS_VALUES.includes(texts[id]), `${slug}#${id}`));
      assert.deepEqual(model.factorRows(type, item).map((f) => [f.label, f.display, f.width]), want.bars, `${type}/${slug} bars`);
      if (want.scatter) {
        const layout = model.scatterLayout(type, item, dataset);
        assert.equal(layout.ariaLabel, want.scatter.aria, `${slug} aria`);
        const selected = layout.points.filter((p) => p.selected);
        assert.deepEqual(selected.map((p) => [`${p.name}：${p.details}`, String(p.cx), String(p.cy), String(p.r), layout.isSupply ? `${p.name}：${p.details}` : null]), want.scatter.selected, `${slug} selected point`);
        assert.deepEqual(selected.map((p) => [p.name, String(p.labelX), String(p.labelY)]), want.scatter.label, `${slug} label`);
        assert.ok(layout.points.filter((p) => !p.selected).every((p) => p.r === 6));
      }
      if (type === "supply") {
        assert.deepEqual(model.supplyActions(item, dataset.national).actions, want.actions, `${slug} actions`);
        assert.deepEqual(model.scatterTableRows(dataset, item).filter((r) => r.selected).map((r) => r.name), want.tableSelected);
      }
    }
  });
}

test("the model has no DOM or network dependency", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.deepEqual(Object.keys(model.configs), ["dx", "supply", "tourism"]);
  assert.deepEqual(model.resolvePrefectureSlug([{ prefecture_slug: "nagano", prefecture_code: "20" }], 20), "nagano");
});
