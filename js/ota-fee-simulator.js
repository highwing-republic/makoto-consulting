(function () {
  'use strict';

  // OTA手数料シミュレーターの画面。計算は OtaFeeModel（ota-fee-simulator-model.js）に任せ、ここは入力・描画だけを持つ。
  const model = globalThis.OtaFeeModel;
  const form = document.getElementById('ota-form');
  const result = document.getElementById('ota-result');
  const body = document.getElementById('ota-result-body');
  if (!model || !form || !result || !body) return;

  const list = document.getElementById('ota-channels');
  const revenueInput = form.elements.annualRevenue;
  const taxInput = form.elements.taxOnFee;
  const addButton = document.getElementById('ota-add');
  const shiftInput = document.getElementById('ota-shift');
  const acquisitionInput = document.getElementById('ota-acquisition');
  const columns = ['share', 'feeRate', 'extraRate', 'monthlyFixed'];
  const labels = { share: '売上の割合', feeRate: '手数料率', extraRate: 'ポイント・決済など', monthlyFixed: '月額の固定費' };
  const units = { share: '%', feeRate: '%', extraRate: '%', monthlyFixed: '円' };
  const KPI_KEY = 'hoteldxlab:kpi-calculator';
  let rows = [];
  let attempted = false;
  let calculated = false;
  let tracked = false;

  const man = (value) => '約' + (Math.round(value / 1000) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円';
  const num = (value) => Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const pct = (value) => (value === null ? '—' : num(value) + '%');
  const monthLabel = (period) => period.slice(0, 4) + '年' + Number(period.slice(5)) + '月';
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  function track(eventName) {
    if (globalThis.LabAnalytics) globalThis.LabAnalytics.track(eventName, { tool_id: 'ota-fee-simulator' });
  }

  function toRows(channels) {
    return channels.map((channel) => ({
      name: channel.name, kind: channel.kind,
      share: num(channel.share), feeRate: num(channel.feeRate), extraRate: num(channel.extraRate), monthlyFixed: num(channel.monthlyFixed)
    }));
  }

  function readInput() {
    return {
      annualRevenue: model.parseNumber(revenueInput.value),
      taxOnFee: taxInput.value === '1',
      channels: rows.map((row) => {
        const channel = { name: row.name.trim(), kind: row.kind };
        columns.forEach((key) => { channel[key] = model.parseNumber(row[key]); });
        return channel;
      })
    };
  }

  function renderRows() {
    list.innerHTML = rows.map((row, index) => {
      const cells = columns.map((key) => '<label class="ota-row__cell"><span class="ota-row__label">' + labels[key] + '</span><span class="ota-unit"><input data-key="' + key + '" type="text" inputmode="decimal" autocomplete="off" value="' + escapeHtml(row[key]) + '" aria-label="' + escapeHtml(row.name || '経路' + (index + 1)) + 'の' + labels[key] + '"><b>' + units[key] + '</b></span></label>').join('');
      const kinds = Object.keys(model.kinds).map((kind) => '<option value="' + kind + '"' + (kind === row.kind ? ' selected' : '') + '>' + model.kinds[kind] + '</option>').join('');
      return '<div class="ota-row" data-index="' + index + '">' +
        '<div class="ota-row__name"><input data-key="name" type="text" autocomplete="off" maxlength="20" value="' + escapeHtml(row.name) + '" aria-label="予約経路' + (index + 1) + 'の名前"><select data-key="kind" aria-label="予約経路' + (index + 1) + 'の種類">' + kinds + '</select></div>' +
        cells +
        '<output class="ota-row__rate" data-rate></output>' +
        '<button class="ota-row__remove" type="button" data-remove aria-label="' + escapeHtml(row.name || '予約経路' + (index + 1)) + 'を削除"' + (rows.length <= 2 ? ' disabled' : '') + '>×</button>' +
        '</div>';
    }).join('');
    addButton.disabled = rows.length >= model.MAX_CHANNELS;
    addButton.textContent = rows.length >= model.MAX_CHANNELS ? '予約経路は最大' + model.MAX_CHANNELS + 'つまでです' : '＋ 予約経路を追加（最大' + model.MAX_CHANNELS + 'つ）';
    renderInvoiceOptions();
  }

  function renderInvoiceOptions() {
    const select = document.getElementById('ota-invoice-channel');
    const current = select.value;
    select.innerHTML = rows.map((row, index) => '<option value="' + index + '">' + escapeHtml(row.name || '経路' + (index + 1)) + '</option>').join('');
    if (current && Number(current) < rows.length) select.value = current;
  }

  // 表の右端（実効の負担率）と合計は、計算ボタンを押す前から入力に合わせて更新する
  function updateLive(input) {
    const total = model.shareTotal(input.channels);
    const totalNode = document.getElementById('ota-share-total');
    totalNode.textContent = num(total) + '%';
    totalNode.parentElement.classList.toggle('is-off', Math.abs(total - 100) > 0.05);
    const revenueOk = input.annualRevenue > 0;
    const summary = revenueOk && input.channels.every((channel) => columns.every((key) => Number.isFinite(channel[key]))) ? model.summarize(input) : null;
    list.querySelectorAll('.ota-row').forEach((node, index) => {
      const channel = input.channels[index];
      let rate = null;
      if (summary) rate = summary.rows[index].effectiveRate;
      else if (Number.isFinite(channel.feeRate) && Number.isFinite(channel.extraRate)) rate = Math.round(model.variableRate(channel, input.taxOnFee) * 10) / 10;
      node.querySelector('[data-rate]').textContent = pct(rate);
    });
    document.getElementById('ota-total-rate').textContent = summary ? pct(summary.effectiveRate) : '—';
  }

  function showErrors(errors) {
    form.querySelectorAll('.ota-field-error').forEach((node) => node.remove());
    form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
    const mark = (input, message) => {
      input.setAttribute('aria-invalid', 'true');
      const note = document.createElement('small');
      note.className = 'ota-field-error';
      note.textContent = message;
      input.closest('label, .ota-row__name').appendChild(note);
    };
    if (errors.annualRevenue) mark(revenueInput, errors.annualRevenue);
    (errors.channels || []).forEach((rowErrors, index) => {
      const node = list.children[index];
      Object.keys(rowErrors).forEach((key) => mark(node.querySelector('[data-key="' + key + '"]'), rowErrors[key]));
    });
    const shareError = document.getElementById('ota-share-error');
    shareError.hidden = !errors.shareTotal;
    shareError.textContent = errors.shareTotal || '';
    const count = errors.channels ? model.errorCount(errors) : 0;
    const formError = document.getElementById('ota-form-error');
    formError.hidden = count === 0;
    formError.textContent = count ? '入力を確認してください（' + count + 'か所）。' : '';
  }

  function renderSummary(input, summary) {
    const ownCost = summary.totalCost - summary.otaCost;
    const bar = summary.rows.map((row, index) => row.share > 0 ? '<span class="' + swatch(row, index) + '" style="width:' + row.share + '%"></span>' : '').join('');
    const legend = summary.rows.map((row, index) => '<li><i class="' + swatch(row, index) + '" aria-hidden="true"></i>' + escapeHtml(row.name) + ' ' + num(row.share) + '%</li>').join('');
    const tableRows = summary.rows.map((row) => '<tr' + (row.kind === 'ota' ? '' : ' class="is-own"') + '><td>' + escapeHtml(row.name) + '</td><td>' + man(row.revenue).slice(1) + '</td><td>' + man(row.cost).slice(1) + '</td><td class="ota-col-rate">' + pct(row.effectiveRate) + '</td><td>' + man(row.net).slice(1) + '</td></tr>').join('');
    return '<div class="ota-summary"><p class="ota-summary__label">予約経路にかかっている費用（年間）</p>' +
      '<p class="ota-summary__headline">' + man(summary.totalCost) + '（売上の ' + num(summary.effectiveRate) + '%）</p>' +
      '<p>OTA経由が売上の <b>' + num(summary.otaShare) + '%</b>。OTA分の費用は <b>' + man(summary.otaCost) + '</b>、自社サイト・電話などの費用は <b>' + man(ownCost) + '</b> です。</p></div>' +
      '<div class="ota-bar" aria-hidden="true">' + bar + '</div><ul class="ota-legend">' + legend + '</ul>' +
      '<table class="ota-table-result"><caption class="visually-hidden">予約経路ごとの売上と費用（年間）</caption><thead><tr><th scope="col">予約経路</th><th scope="col">売上</th><th scope="col">費用</th><th scope="col" class="ota-col-rate">負担率</th><th scope="col">手元に残る額</th></tr></thead>' +
      '<tbody>' + tableRows + '</tbody><tfoot><tr><td>合計</td><td>' + man(input.annualRevenue).slice(1) + '</td><td>' + man(summary.totalCost).slice(1) + '</td><td class="ota-col-rate">' + pct(summary.effectiveRate) + '</td><td>' + man(input.annualRevenue - summary.totalCost).slice(1) + '</td></tr></tfoot></table>';
  }

  function swatch(row, index) {
    return row.kind === 'ota' ? 'ota-swatch-ota-' + (index % 8) : 'ota-swatch-' + row.kind;
  }

  function renderShift(input) {
    const target = document.getElementById('ota-shift-body');
    const label = document.getElementById('ota-shift-label');
    const probe = model.scenario(input, 0, 0);
    shiftInput.disabled = !probe;
    acquisitionInput.disabled = !probe;
    if (!probe) {
      label.textContent = '';
      target.innerHTML = '<p class="ota-note">種類が「自社サイト」の経路と、割合が0%より大きいOTAが1つずつあると計算できます。</p>';
      return;
    }
    shiftInput.max = String(Math.floor(probe.maxShift));
    if (Number(shiftInput.value) > Number(shiftInput.max)) shiftInput.value = shiftInput.max;
    const acquisition = model.parseNumber(acquisitionInput.value);
    const plan = model.scenario(input, Number(shiftInput.value), Number.isFinite(acquisition) ? acquisition : 0);
    label.textContent = num(plan.webShareBefore) + '% → ' + num(plan.webShareAfter) + '%';
    shiftInput.setAttribute('aria-valuetext', plan.webName + 'の割合 ' + num(plan.webShareAfter) + '%（' + num(plan.moved) + 'ポイント増）');
    if (plan.moved === 0) {
      target.innerHTML = '<p class="ota-note">つまみを右に動かすと、' + escapeHtml(plan.webName) + 'の割合を上げたときの差し引きを表示します。</p>';
      return;
    }
    const netText = plan.net >= 0 ? man(plan.net) + ' 残る' : man(-plan.net) + ' 減る';
    target.innerHTML = '<dl class="ota-cards">' +
      '<div class="ota-card"><dt>減る手数料</dt><dd>' + man(plan.feeSaving) + '/年</dd><p>OTA経由 ' + num(plan.otaShareBefore) + '% → ' + num(plan.otaShareAfter) + '%</p></div>' +
      '<div class="ota-card"><dt>増える広告費など</dt><dd>' + man(plan.acquisition) + '/年</dd><p>移った売上 ' + man(plan.movedRevenue).slice(1) + ' × ' + num(Number.isFinite(acquisition) ? acquisition : 0) + '%</p></div>' +
      '<div class="ota-card is-main' + (plan.net < 0 ? ' is-loss' : '') + '"><dt>差し引き</dt><dd>' + netText + '</dd><p>自社予約を増やす費用が、移ってきた売上の <b>' + num(plan.breakEvenRate) + '%</b> までなら得になります</p></div>' +
      '</dl><p class="ota-note">移る予約にかかっていたOTAの負担（手数料・ポイントなど）から、' + escapeHtml(plan.webName) + 'で新たにかかる決済手数料などを引いた差です。月額の固定費は割合が変わっても同じなので含めていません。</p>';
  }

  function render(input) {
    const summary = model.summarize(input);
    document.getElementById('ota-result-scope').textContent = '年間の宿泊売上 ' + man(input.annualRevenue).slice(1) + '・' + (input.taxOnFee ? '手数料は消費税込み' : '手数料は入力した率のまま');
    body.innerHTML = renderSummary(input, summary);
    renderShift(input);
  }

  function run(options) {
    const input = readInput();
    updateLive(input);
    if (!attempted) return false;
    const errors = model.validate(input);
    showErrors(errors);
    if (model.errorCount(errors)) {
      // 入力の途中で数字が合わなくなったら、古い結果は見せない
      result.hidden = true;
      if (options && options.focus) {
        const first = form.querySelector('[aria-invalid="true"]');
        (first || document.getElementById('ota-share-error')).focus();
      }
      return false;
    }
    render(input);
    result.hidden = false;
    calculated = true;
    if (!tracked) { tracked = true; track('analysis_run'); }
    return true;
  }

  function invoiceUpdate() {
    const amount = model.parseNumber(document.getElementById('ota-invoice-amount').value);
    const revenue = model.parseNumber(document.getElementById('ota-invoice-revenue').value);
    const rate = model.rateFromInvoice(amount, revenue);
    const answer = document.getElementById('ota-invoice-answer');
    const apply = document.getElementById('ota-invoice-apply');
    apply.hidden = rate === null;
    if (rate === null) {
      answer.textContent = '請求額と売上を入れると、実効の負担率を表示します。';
      return null;
    }
    const tax = taxInput.value === '1';
    answer.innerHTML = '実効の負担率は <b>' + num(rate) + '%</b> です。表に入れると、手数料率 ' + num(model.feeRateForRow(rate, tax)) + '%' + (tax ? '（消費税を戻した率）' : '') + '、ポイント・決済など 0% になります。';
    return rate;
  }

  list.addEventListener('input', (event) => {
    const node = event.target.closest('.ota-row');
    if (!node) return;
    rows[Number(node.dataset.index)][event.target.dataset.key] = event.target.value;
    if (event.target.dataset.key === 'name') renderInvoiceOptions();
    run();
  });
  list.addEventListener('change', (event) => {
    if (event.target.dataset.key !== 'kind') return;
    rows[Number(event.target.closest('.ota-row').dataset.index)].kind = event.target.value;
    run();
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button || rows.length <= 2) return;
    const index = Number(button.closest('.ota-row').dataset.index);
    rows.splice(index, 1);
    renderRows();
    run();
    const next = list.children[Math.min(index, rows.length - 1)];
    next.querySelector('[data-key="name"]').focus();
  });
  addButton.addEventListener('click', () => {
    if (rows.length >= model.MAX_CHANNELS) return;
    rows.push({ name: '', kind: 'ota', share: '0', feeRate: '0', extraRate: '0', monthlyFixed: '0' });
    renderRows();
    run();
    list.lastElementChild.querySelector('[data-key="name"]').focus();
  });

  revenueInput.addEventListener('input', () => run());
  taxInput.addEventListener('change', () => { invoiceUpdate(); run(); });
  shiftInput.addEventListener('input', () => { if (calculated) renderShift(readInput()); });
  acquisitionInput.addEventListener('input', () => { if (calculated) renderShift(readInput()); });

  ['ota-invoice-amount', 'ota-invoice-revenue'].forEach((id) => document.getElementById(id).addEventListener('input', invoiceUpdate));
  document.getElementById('ota-invoice-apply').addEventListener('click', () => {
    const rate = invoiceUpdate();
    if (rate === null) return;
    const index = Number(document.getElementById('ota-invoice-channel').value);
    rows[index].feeRate = num(model.feeRateForRow(rate, taxInput.value === '1'));
    rows[index].extraRate = '0';
    renderRows();
    run();
    document.getElementById('ota-invoice-answer').textContent = (rows[index].name || '経路' + (index + 1)) + 'の手数料率に入れました。';
    document.getElementById('ota-invoice-apply').hidden = true;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    attempted = true;
    if (run({ focus: true })) result.focus({ preventScroll: false });
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      attempted = false;
      calculated = false;
      rows = toRows(model.sample.channels);
      renderRows();
      showErrors({});
      result.hidden = true;
      body.innerHTML = '';
      shiftInput.value = String(model.sample.shift);
      acquisitionInput.value = String(model.sample.acquisitionRate);
      invoiceUpdate();
      updateLive(readInput());
    });
  });

  form.querySelector('[data-ota-sample]').addEventListener('click', () => {
    const sample = model.sample;
    revenueInput.value = num(sample.annualRevenue);
    taxInput.value = sample.taxOnFee ? '1' : '0';
    rows = toRows(sample.channels);
    renderRows();
    shiftInput.value = String(sample.shift);
    acquisitionInput.value = String(sample.acquisitionRate);
    attempted = true;
    if (run()) result.focus({ preventScroll: false });
  });

  // 宿KPI電卓で計算した月の客室売上があれば、12倍した値を入れられるようにする（数字は URL に載せない）
  function offerKpiRevenue() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(KPI_KEY) || 'null'); } catch (error) { saved = null; }
    if (!saved || !(saved.roomRevenue > 0) || !/^\d{4}-\d{2}$/.test(saved.month || '')) return;
    const annual = saved.roomRevenue * 12;
    const note = document.getElementById('ota-handoff');
    note.innerHTML = '<span>宿KPI電卓の客室売上（' + monthLabel(saved.month) + '・' + man(saved.roomRevenue).slice(1) + '）を12倍すると ' + man(annual).slice(1) + ' です。1か月×12の目安なので、年間の実績があればそちらを入れてください。</span><button class="ota-chip" type="button">この額を入れる</button>';
    note.hidden = false;
    note.querySelector('button').addEventListener('click', () => {
      revenueInput.value = num(annual);
      note.hidden = true;
      run();
      revenueInput.focus();
    });
  }

  rows = toRows(model.sample.channels);
  renderRows();
  updateLive(readInput());
  offerKpiRevenue();
})();
