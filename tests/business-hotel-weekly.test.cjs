const test = require("node:test");
const assert = require("node:assert/strict");
const {build, load} = require("../scripts/build_business_hotel_weekly.cjs");

test("週次データパック: 保存済みデータから全セクションを出し、欠けた値の文字が混ざらない", () => {
  const text = build(load());
  for (const heading of ["## 今週のポイント", "## 全国サマリ", "## 10都市の比較", "## 7日前との比較", "## 来週・再来週の注目日", "## ランキング Top5", "## 急騰・売り切れの日に重なる催し", "## 記事にするときの注意"]) {
    assert.ok(text.includes(heading), heading);
  }
  assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/);
  assert.match(text, /Supported by Rakuten Developers/);
  // 10都市の比較表は10行
  const rows = text.split("## 10都市の比較")[1].split("##")[0].split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| 都市"));
  assert.equal(rows.length, 10);
});
