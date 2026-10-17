(function () {
  'use strict';

  // 宿KPI電卓の画面。計算は KpiCalculatorModel（kpi-calculator-model.js）に任せ、ここは入力・描画だけを持つ。
  const model = globalThis.KpiCalculatorModel;
  const form = document.getElementById('kpi-form');
  const result = document.getElementById('kpi-result');
  const body = document.getElementById('kpi-result-body');
  if (!model || !form || !result || !body) return;

  const fields = ['rooms', 'days', 'soldRooms', 'roomRevenue', 'guests', 'capacity', 'totalRevenue', 'closedRoomNights', 'lySoldRooms', 'lyRoomRevenue', 'lyDays', 'fixedCost', 'variableCostPerRoom'];
  const monthInput = form.elements.month;
  const daysInput = form.elements.days;
  const formError = document.getElementById('kpi-form-error');
  let dataset = null;
  let calculated = false;
  let tracked = false;
  let daysEdited = false;
  let target = '';

  const yen = (value) => '¥' + Math.round(value).toLocaleString('ja-JP');
  const man = (value) => (Math.round(value / 1000) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円';
  const num = (value) => Number(value).toLocaleString('ja-JP');
  const signed = (value, unit) => (value > 0 ? '+' : value < 0 ? '−' : '±') + Math.abs(value).toLocaleString('ja-JP') + unit;
  const monthLabel = (period) => period.slice(0, 4) + '年' + Number(period.slice(5)) + '月';
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  function track(eventName) {
    if (globalThis.LabAnalytics) globalThis.LabAnalytics.track(eventName, { tool_id: 'kpi-calculator' });
  }

  function previousMonth() {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function readInput() {
    const input = { month: monthInput.value, prefCode: form.elements.prefCode.value, facilityType: form.elements.facilityType.value, mealsIncluded: form.elements.mealsIncluded.checked };
    fields.forEach((name) => { input[name] = model.parseNumber(form.elements[name].value); });
    return input;
  }

  function showErrors(errors) {
    ['month'].concat(fields).forEach((name) => {
      const input = form.elements[name];
      const id = 'kpi-error-' + name;
      const old = document.getElementById(id);
      if (old) old.remove();
      const hint = input.getAttribute('aria-describedby').split(' ').filter((item) => item !== id).join(' ');
      input.setAttribute('aria-describedby', hint);
      input.removeAttribute('aria-invalid');
      if (!errors[name]) return;
      const message = document.createElement('small');
      message.className = 'kpi-field-error';
      message.id = id;
      message.textContent = errors[name];
      input.closest('.kpi-field').appendChild(message);
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', hint + ' ' + id);
    });
    const count = Object.keys(errors).length;
    formError.hidden = count === 0;
    formError.textContent = count ? '入力を確認してください（' + count + 'か所）。' : '';
  }

  function card(label, value, formula, extra) {
    return '<div class="kpi-card' + (extra && extra.main ? ' is-main' : '') + (extra && extra.muted ? ' is-muted' : '') + '"><dt>' + label + '</dt><dd>' + value + '</dd><p>' + formula + '</p></div>';
  }

  function unitValue(value, unit) {
    return escapeHtml(value) + '<small>' + unit + '</small>';
  }

  function renderCards(input, kpi) {
    const meals = input.mealsIncluded ? '（食事込み）' : '';
    const cards = [
      card('客室稼働率（OCC）', unitValue(kpi.occupancy, '%'), '販売客室数 ÷ 販売できる室数<br><span class="kpi-formula">' + num(input.soldRooms) + ' ÷ ' + num(kpi.availableRooms) + '室</span>', { main: true }),
      card('平均客室単価（ADR）' + meals, yen(kpi.adr), '客室売上 ÷ 販売客室数', { main: true }),
      card('RevPAR' + meals, yen(kpi.revpar), '客室売上 ÷ 販売できる室数<br>（ADR × 客室稼働率）', { main: true })
    ];
    cards.push(kpi.guestsPerRoom !== null
      ? card('1室あたり人数', unitValue(kpi.guestsPerRoom, '人'), '宿泊人数 ÷ 販売客室数')
      : card('1室あたり人数', '—', '宿泊人数を入れると表示します', { muted: true }));
    cards.push(kpi.revenuePerGuest !== null
      ? card('1人あたり客室単価' + meals, yen(kpi.revenuePerGuest), input.mealsIncluded ? '客室売上 ÷ 宿泊人数。1泊2食の1名料金と比べやすい数字です' : '客室売上 ÷ 宿泊人数')
      : card('1人あたり客室単価', '—', '宿泊人数を入れると表示します', { muted: true }));
    cards.push(kpi.bedOccupancy !== null
      ? card('定員稼働率', unitValue(kpi.bedOccupancy, '%'), '宿泊人数 ÷（定員 × 営業日数）')
      : card('定員稼働率', '—', '宿泊人数と定員を入れると表示します', { muted: true }));
    cards.push(kpi.trevpar !== null
      ? card('TRevPAR', yen(kpi.trevpar), '総売上 ÷ 販売できる室数')
      : card('TRevPAR', '—', '総売上を入れると表示します', { muted: true }));
    return '<dl class="kpi-cards">' + cards.join('') + '</dl>';
  }

  function renderBenchmark(input, kpi) {
    if (!dataset) return '<p class="kpi-note">地域の統計を読み込めなかったため、比較は表示していません。計算結果には影響しません。</p>';
    const bench = model.benchmark(dataset, input.month, input.prefCode, input.facilityType);
    const gap = model.compare(kpi.occupancy, bench);
    if (!bench || !gap) return '';
    const direction = gap.gap > 0 ? '高い' : gap.gap < 0 ? '低い' : '同じ';
    const headline = gap.gap === 0
      ? gap.label + 'と同じ稼働率です'
      : gap.label + 'より ' + Math.abs(gap.gap) + 'ポイント' + direction + '稼働率です';
    const type = bench.facilityLabel;
    const allTypes = type ? '（全施設）' : '';
    const values = [];
    if (bench.prefectureType !== null) values.push(escapeHtml(bench.prefectureName) + 'の' + type + ' <b>' + bench.prefectureType.toFixed(1) + '%</b>');
    if (bench.nationalType !== null) values.push('全国の' + type + ' <b>' + bench.nationalType.toFixed(1) + '%</b>');
    if (bench.prefecture !== null) values.push(escapeHtml(bench.prefectureName) + allTypes + ' <b>' + bench.prefecture.toFixed(1) + '%</b>');
    if (bench.national !== null) values.push('全国' + allTypes + ' <b>' + bench.national.toFixed(1) + '%</b>');
    const notes = [];
    if (!type) notes.push('統計は旅館・ホテル・簡易宿所などすべての施設の平均です。施設タイプを選ぶと、同じタイプの稼働率と比べられます。');
    else if (!gap.byType) notes.push('この月の' + type + 'の値がまだないため、すべての施設の平均と比べています。');
    else if (bench.prefectureType !== null) notes.push('都道府県ごとのタイプ別の値は集計の対象施設が少なく、月によって大きく振れることがあります。');
    else if (input.prefCode) notes.push(escapeHtml(bench.prefectureName) + 'の' + type + 'の値は公表されていないため、全国の' + type + 'と比べています。');
    if (!bench.exact) notes.unshift(monthLabel(input.month) + 'の統計はまだ公表されていないため、公表済みの同じ月（' + monthLabel(bench.period) + '）と比べています。');
    if (bench.basis === 'before') notes.push('2025年12月までの集計基準の値です。');
    return '<div class="kpi-bench"><p class="kpi-bench__label">地域の統計と比べると（' + monthLabel(bench.period) + '）</p>' +
      '<p class="kpi-bench__headline">' + escapeHtml(headline) + '</p>' +
      '<p>観光庁「宿泊旅行統計調査」の客室稼働率：' + values.join('、') + '。あなたの宿は <b>' + kpi.occupancy + '%</b>。</p>' +
      notes.map((note) => '<p class="kpi-bench__note">' + note + '</p>').join('') + '</div>';
  }

  function renderYearOverYear(input) {
    const yoy = model.yearOverYear(input);
    if (!yoy) return '<p class="kpi-note">「前年同月と比べる」に前年の販売客室数と客室売上を入れると、稼働率・ADR・RevPARの前年比を表示します。</p>';
    const pct = (value) => signed(value, '%');
    const rows = [
      ['客室稼働率', yoy.occupancy.last + '%', yoy.occupancy.now + '%', signed(yoy.occupancy.diff, 'ポイント'), yoy.occupancy.diff],
      ['平均客室単価（ADR）', yen(yoy.adr.last), yen(yoy.adr.now), pct(yoy.adr.change), yoy.adr.change],
      ['RevPAR', yen(yoy.revpar.last), yen(yoy.revpar.now), pct(yoy.revpar.change), yoy.revpar.change],
      ['客室売上', man(yoy.roomRevenue.last), man(yoy.roomRevenue.now), pct(yoy.roomRevenue.change), yoy.roomRevenue.change],
      ['販売客室数', num(yoy.soldRooms.last) + '室', num(yoy.soldRooms.now) + '室', pct(yoy.soldRooms.change), yoy.soldRooms.change]
    ].map((row) => '<tr' + (row[0] === 'RevPAR' ? ' class="is-main"' : '') + '><th scope="row">' + row[0] + '</th><td>' + row[1] + '</td><td>' + row[2] + '</td><td class="' + (row[4] > 0 ? 'is-up' : row[4] < 0 ? 'is-down' : '') + '">' + row[3] + '</td></tr>').join('');
    const names = { occupancy: '稼働率', adr: '単価' };
    const change = yoy.revpar.change;
    let summary;
    if (!yoy.driver) summary = 'RevPARは前年とほぼ同じです。';
    else {
      const d = yoy.driver;
      const other = d.key === 'occupancy' ? 'adr' : 'occupancy';
      summary = 'RevPARは前年より<b>' + Math.abs(change) + '%' + (change > 0 ? '上がりました' : '下がりました') + '</b>。' +
        (d.both ? names.occupancy + 'と単価がどちらも' + (d.up ? '上がり' : '下がり') + '、変化が大きいのは' + names[d.key] + 'です。'
          : '主に' + names[d.key] + 'の' + (d.up ? '上昇' : '低下') + 'によるもので、' + names[other] + 'は' + (d.up ? '下がって' : '上がって') + 'います。');
    }
    const notes = ['前年の販売できる室数は、今の客室数 × ' + num(yoy.availableRooms / input.rooms) + '日（' + num(yoy.availableRooms) + '室）で計算しています。'];
    if (input.closedRoomNights) notes.push('使えなかった客室は今年の分だけ引いています。');
    return '<section class="kpi-block"><h4>前年同月と比べると（' + monthLabel(yoy.period) + '）</h4>' +
      '<p class="kpi-lead">' + summary + '</p>' +
      '<table class="kpi-yoy"><thead><tr><th scope="col">指標</th><th scope="col">前年</th><th scope="col">今年</th><th scope="col">前年比</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      notes.map((note) => '<p class="kpi-note">' + note + '</p>').join('') + '</section>';
  }

  function renderBreakEven(input, kpi) {
    const be = kpi.breakEven;
    if (!be) {
      return '<section class="kpi-block"><h4>損益分岐の稼働率</h4><p class="kpi-note">「利益の目安も見る」に月の固定費を入れると、固定費をまかなうのに必要な稼働率を表示します。</p></section>';
    }
    if (be.rooms === null) {
      return '<section class="kpi-block"><h4>損益分岐の稼働率</h4><div class="kpi-callout kpi-callout--warn">1室売れるごとにかかる費用が平均客室単価以上のため、売れるほど赤字が増える計算です。入力を確認してください。</div></section>';
    }
    const profit = be.monthlyProfit >= 0
      ? '今月は固定費を引いて約 <b>' + man(be.monthlyProfit) + '</b> 残る計算です。'
      : '今月は固定費に約 <b>' + man(-be.monthlyProfit) + '</b> 届いていない計算です。';
    return '<section class="kpi-block"><h4>損益分岐の稼働率</h4>' +
      '<div class="kpi-breakeven"><div><span>損益分岐の稼働率</span><strong>' + (be.reachable ? be.occupancy + '%' : '100%超') + '</strong></div>' +
      '<div><span>必要な販売客室数</span><strong>' + num(be.rooms) + '室</strong></div>' +
      '<div><span>1室売れたときに残る額</span><strong>' + yen(be.marginPerRoom) + '</strong></div></div>' +
      '<p class="kpi-note">月の固定費 ÷（ADR − 1室売れるごとにかかる費用）で計算しています。' + profit + (be.reachable ? '' : ' 今の単価では、全室売れても固定費に届きません。') + '</p></section>';
  }

  function renderLevers(input, kpi) {
    const occ = kpi.levers.occupancy;
    const adr = kpi.levers.adr;
    const hasCost = occ.margin !== null;
    const occText = occ.extraRooms === 0
      ? 'すでに満室に近く、これ以上は増やせません。'
      : '月に約' + num(occ.extraRooms) + '室多く売る計算です' + (occ.capped ? '（満室までの分）' : '') + '。' + (hasCost ? '1室ごとの費用を引いて手元に残るのは <b>+' + man(occ.margin) + '</b>。' : '');
    return '<section class="kpi-block"><h4>どちらの打ち手が効くか</h4><p class="kpi-lead">今の数字のまま、1か月あたりの客室売上がどれだけ変わるかの比較です。</p>' +
      '<div class="kpi-levers">' +
        '<article><h5>客室稼働率を' + occ.step + 'ポイント上げる</h5><strong>売上 +' + man(occ.revenue) + '</strong><p>' + occText + '</p></article>' +
        '<article><h5>平均客室単価を' + num(adr.step) + '円上げる</h5><strong>売上 +' + man(adr.revenue) + '</strong><p>同じ室数を' + num(adr.step) + '円高く売る計算です。上げた分はそのまま手元に残ります（<b>+' + man(adr.margin) + '</b>）。</p></article>' +
      '</div>' +
      '<p class="kpi-note">' + (hasCost ? '単価を上げた分はそのまま残り、稼働率を上げた分は1室ごとの費用（清掃・リネンなど）がかかります。' : '「1室売れるごとにかかる費用」を入れると、手元に残る額でも比べられます。') + '</p></section>';
  }

  function reverseText(input) {
    const reverse = model.reverse(input, model.parseNumber(target));
    if (!reverse) return '目標の客室売上を入れると、必要な販売客室数と単価を表示します。';
    return '今の単価のままなら <b>' + num(reverse.rooms) + '室</b>（客室稼働率 ' + reverse.occupancy + '%）' +
      (reverse.reachable ? '' : '。販売できる室数を超えるため、単価も上げる必要があります') +
      '。今の販売客室数のままなら、平均客室単価 <b>' + yen(reverse.adr) + '</b> が必要です。';
  }

  function renderReverse(input) {
    return '<section class="kpi-block"><h4>目標から逆算する</h4><div class="kpi-reverse">' +
      '<label class="kpi-field"><span>目標の客室売上（月）</span><span class="kpi-unit"><input id="kpi-target" type="text" inputmode="numeric" autocomplete="off" value="' + escapeHtml(target) + '"><b>円</b></span></label>' +
      '<p class="kpi-callout" id="kpi-reverse-answer" aria-live="polite">' + reverseText(input) + '</p></div></section>';
  }

  function render(input, kpi) {
    const scope = [monthInput.value ? monthLabel(monthInput.value) : '', input.prefCode ? form.elements.prefCode.selectedOptions[0].textContent : '', input.facilityType ? form.elements.facilityType.selectedOptions[0].textContent : '', num(input.rooms) + '室'].filter(Boolean).join('・');
    document.getElementById('kpi-result-scope').textContent = scope;
    body.innerHTML = renderCards(input, kpi) + renderBenchmark(input, kpi) + renderYearOverYear(input) + renderBreakEven(input, kpi) + renderLevers(input, kpi) + renderReverse(input);
    const targetInput = document.getElementById('kpi-target');
    targetInput.addEventListener('input', () => {
      target = targetInput.value;
      document.getElementById('kpi-reverse-answer').innerHTML = reverseText(input);
    });
  }

  function run(options) {
    const input = readInput();
    const errors = model.validate(input);
    if (!monthInput.value) errors.month = '対象の月を選んでください。';
    showErrors(errors);
    if (Object.keys(errors).length) {
      // 入力の途中で数字が合わなくなったら、古い結果は見せない
      result.hidden = true;
      if (options && options.focus) form.elements[['month'].concat(fields).find((name) => errors[name])].focus();
      return false;
    }
    render(input, model.calculate(input));
    result.hidden = false;
    remember(input);
    calculated = true;
    if (!tracked) { tracked = true; track('analysis_run'); }
    return true;
  }

  // OTA手数料シミュレーターで年間売上の目安に使えるよう、月と客室売上だけをこのタブの中に残す（URL には載せない）
  function remember(input) {
    try {
      sessionStorage.setItem('hoteldxlab:kpi-calculator', JSON.stringify({ month: input.month, roomRevenue: input.roomRevenue }));
    } catch (error) { /* 保存できない環境では引き継がないだけ */ }
  }

  // DXかんたん診断で入れた客室数を、空欄のときだけ入れる（このタブの sessionStorage から読むだけ）
  function fillFromDiagnosis() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('hoteldxlab:dx-diagnosis') || 'null'); } catch (error) { saved = null; }
    const roomsInput = form.elements.rooms;
    if (!saved || !(saved.rooms > 0) || roomsInput.value) return;
    roomsInput.value = num(saved.rooms);
    const note = document.getElementById('kpi-handoff');
    note.textContent = 'DXかんたん診断で入れた客室数（' + num(saved.rooms) + '室）を入れました。販売客室数と客室売上は、PMSや月報の実績を入れてください。';
    note.hidden = false;
  }

  function setDaysFromMonth() {
    const days = model.daysInMonth(monthInput.value);
    if (days && !daysEdited) daysInput.value = String(days);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (run({ focus: true })) result.focus({ preventScroll: false });
  });

  form.addEventListener('input', (event) => {
    if (event.target === daysInput) daysEdited = daysInput.value !== '';
    if (event.target === monthInput) setDaysFromMonth();
    if (calculated) run();
  });
  form.addEventListener('change', (event) => {
    if (event.target === monthInput) setDaysFromMonth();
    if (calculated) run();
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      daysEdited = false;
      calculated = false;
      target = '';
      monthInput.value = previousMonth();
      setDaysFromMonth();
      showErrors({});
      result.hidden = true;
      body.innerHTML = '';
      document.getElementById('kpi-handoff').hidden = true;
    });
  });

  form.querySelector('[data-kpi-sample]').addEventListener('click', () => {
    const sample = model.sample;
    monthInput.value = sample.month;
    document.getElementById('kpi-handoff').hidden = true;
    form.elements.prefCode.value = sample.prefCode;
    form.elements.facilityType.value = sample.facilityType;
    form.elements.mealsIncluded.checked = sample.mealsIncluded;
    fields.forEach((name) => { form.elements[name].value = sample[name] === null ? '' : num(sample[name]); });
    // 例の営業日数はその月の日数と同じなので、月を変えたら日数もついてくるようにする
    daysEdited = sample.days !== model.daysInMonth(sample.month);
    document.getElementById('kpi-more').open = true;
    document.getElementById('kpi-lastyear').open = true;
    document.getElementById('kpi-cost').open = true;
    target = '12,000,000';
    if (run()) result.focus({ preventScroll: false });
  });

  monthInput.value = previousMonth();
  setDaysFromMonth();
  fillFromDiagnosis();

  fetch('data/analysis/lodging-monthly.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((data) => {
      dataset = data;
      if (!data && globalThis.LabAnalytics) globalThis.LabAnalytics.track('tool_error', { tool_id: 'kpi-calculator', error_code: 'data_fetch' });
      if (calculated) run();
    });
})();
