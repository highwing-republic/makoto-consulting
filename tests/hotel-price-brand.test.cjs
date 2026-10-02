const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../js/hotel-price-trends-model.js');

// Exercise the private renderer without fetching data or exposing a production API.
function render(summary, comparison = {}) {
  const elements = new Map();
  const document = {querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {value: '1', addEventListener() {}});
    return elements.get(selector);
  }};
  const source = fs.readFileSync(path.join(__dirname, '../js/hotel-price-trends.js'), 'utf8');
  const instrumented = source.replace(/  init\(\);\s*\}\)\(\);\s*$/, '  window.renderKpis = renderKpis;\n})();');
  assert.notEqual(instrumented, source, 'renderer test hook must replace only the startup call');
  const context = {document, window: {HotelPriceTrendsModel: model}, Map, Intl};
  vm.runInNewContext(instrumented, context);
  context.window.renderKpis(summary, comparison);
  return [...elements.get('#hpt-kpis').innerHTML.matchAll(/<strong class="hpt-kpi__value hpt-kpi__value--(numeric|status)">([^<]+)<\/strong>/g)].map((m) => ({kind:m[1], value:m[2]}));
}
function summary(prices, observations = prices.length) {
  return {marketMedian: prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : null,
    successful:prices.length, target:3, observations, comparisonReady:prices.length>=3,
    positions:prices.map((value,i)=>({hotel_no:i+1,min_price_yen:value,price_index:100}))};
}
test('KPI numbers remain numeric while ranks and unavailable comparisons use smaller status text', () => {
  const values = render(summary([10000, 10000, 10000]), {marketChange:0,prior:{marketMedian:10000}});
  assert.deepEqual(values.map(v=>v.kind), ['numeric','numeric','numeric','numeric','status','numeric']);
  assert.equal(values[2].value, '0.0%');
  assert.equal(values[4].value, '高い方から1番目');
});
test('no observations, zero successful observations and small samples retain distinct KPI meanings', () => {
  const none = render(summary([],0));
  assert.deepEqual(none.map(v=>v.kind), Array(5).fill('status'));
  assert.equal(none.at(-1).value, '観測なし');
  const zero = render(summary([],2));
  assert.deepEqual(zero.at(-1), {kind:'numeric',value:'0/3'});
  const small = render(summary([10000]));
  assert.deepEqual(small.map(v=>v.kind), ['numeric','numeric','status','status','numeric']);
  assert.equal(small[2].value,'比較不足');
});
test('missing selected property does not style its missing price as a number', () => {
  const data=summary([10000,20000,30000]);
  data.positions=data.positions.map(row=>({...row,hotel_no:row.hotel_no+1}));
  assert.deepEqual(render(data)[1],{kind:'status',value:'料金未確認'});
});
