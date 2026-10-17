(function () {
  'use strict';

  // 生成AI時短みつもりの画面。計算は AiTimeModel（ai-time-estimate-model.js）に任せ、ここは入力・描画だけを持つ。
  const model = globalThis.AiTimeModel;
  const form = document.getElementById('ait-form');
  const result = document.getElementById('ait-result');
  const body = document.getElementById('ait-result-body');
  if (!model || !form || !result || !body) return;

  const formError = document.getElementById('ait-form-error');
  const settings = document.getElementById('ait-settings');
  const taskKeys = ['count', 'minutes', 'low', 'high'];
  let attempted = false;
  let shown = false;
  let tracked = false;

  const num = (value) => Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const man = (value) => (Math.round(value / 1000) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円';
  const range = (low, high, unit) => (low === high ? num(low) : num(low) + '〜' + num(high)) + unit;
  const manRange = (low, high) => (low === high ? man(low) : man(low).replace('万円', '') + '万〜' + man(high));
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  function readInput() {
    const value = (name) => model.parseNumber(form.elements[name].value);
    return {
      tasks: model.tasks.map((task) => {
        const row = { id: task.id, enabled: form.elements['enabled:' + task.id].checked };
        taskKeys.forEach((key) => { row[key] = value(key + ':' + task.id); });
        return row;
      }),
      hourlyCost: value('hourlyCost'), seats: value('seats'), seatCost: value('seatCost')
    };
  }

  function syncRows(input) {
    input.tasks.forEach((row) => {
      const node = form.querySelector('[data-task="' + row.id + '"]');
      node.classList.toggle('is-off', !row.enabled);
      node.querySelectorAll('input[type="text"]').forEach((field) => { field.disabled = !row.enabled; });
      form.querySelectorAll('[data-rate-task="' + row.id + '"] input').forEach((field) => { field.disabled = !row.enabled; });
    });
  }

  // 入力欄の下に誤りを出す。詳細設定の中に誤りがあれば開いて見せる。
  function showErrors(errors) {
    form.querySelectorAll('.ait-field-error').forEach((node) => node.remove());
    form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
    const keys = Object.keys(errors);
    keys.forEach((key) => {
      const field = form.elements[key];
      if (!field) return;
      field.setAttribute('aria-invalid', 'true');
      const note = document.createElement('small');
      note.className = 'ait-field-error';
      note.textContent = errors[key];
      field.closest('.ait-unit').after(note);
    });
    formError.hidden = keys.length === 0;
    formError.textContent = keys.length ? '入力を確かめてください（' + keys.length + 'か所）。' : '';
    if (keys.length && keys.some((key) => form.elements[key] && settings.contains(form.elements[key]))) settings.open = true;
    return keys;
  }

  function renderSummary(estimate) {
    const cards = [
      { label: '1か月', value: range(estimate.monthly.low, estimate.monthly.high, ' 時間') },
      { label: '1年間', value: range(estimate.annual.low, estimate.annual.high, ' 時間') },
      { label: '人件費に換算', value: manRange(estimate.value.low, estimate.value.high),
        note: estimate.toolCost ? '有料プランの費用 年' + man(estimate.toolCost) + 'を引く前' : '有料プランの費用は入れていません' }
    ];
    let html = '<dl class="ait-metrics">' + cards.map((card) => '<div><dt>' + card.label + '</dt><dd>' + card.value + '</dd>' + (card.note ? '<p>' + escapeHtml(card.note) + '</p>' : '') + '</div>').join('') + '</dl>';
    if (estimate.toolCost) {
      const net = estimate.net;
      let text;
      if (net.high < 0) text = '<b>費用のほうが大きくなります</b>。無料プランで試すか、人数や使う業務を見直してください。';
      else if (net.low < 0) text = '標準の見方なら<b>年' + man(net.high) + '</b>のプラスですが、控えめに見ると年' + man(-net.low) + 'のマイナスです。';
      else text = '<b>年' + manRange(net.low, net.high) + '</b>です。';
      html += '<p class="ait-net' + (net.high < 0 ? ' is-loss' : '') + '">有料プランの費用（年' + man(estimate.toolCost) + '）を引くと、' + text + '</p>';
    }
    return html;
  }

  function renderPicks(estimate) {
    if (!estimate.firstPicks.length) return '<p class="ait-empty">浮く時間がある業務がありません。件数や時間を入れてください。</p>';
    return '<ol class="ait-picks">' + estimate.firstPicks.map((row) =>
      '<li><h5>' + escapeHtml(row.name) + '</h5><p class="ait-picks__hours">月 ' + range(Math.round(row.lowHours * 10) / 10, Math.round(row.highHours * 10) / 10, '時間') + '</p>' +
      '<p>' + escapeHtml(row.tip) + '</p><span class="ait-badge ait-badge--' + row.risk + '">' + escapeHtml(row.riskLabel) + '</span></li>').join('') + '</ol>';
  }

  function renderBreakdown(estimate) {
    const rows = estimate.rows.map((row) => '<tr><td>' + escapeHtml(row.name) + '</td><td>' + num(Math.round(row.baseHours * 10) / 10) + '</td><td>' +
      range(Math.round(row.lowHours * 10) / 10, Math.round(row.highHours * 10) / 10, '') + '</td></tr>').join('');
    return '<table class="ait-table"><thead><tr><th scope="col">業務</th><th scope="col">いまの時間（月）</th><th scope="col">浮く時間（月）</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td>合計</td><td>' + num(estimate.baseHours) + '</td><td>' + range(estimate.monthly.low, estimate.monthly.high, '') + '</td></tr></tfoot></table>' +
      '<p class="ait-note">単位は時間。業務ごとに「月の件数 × 1件の時間 × 削減率」を積み上げた見積もりです。</p>';
  }

  function run(options) {
    const input = readInput();
    syncRows(input);
    const errors = model.validate(input);
    const estimate = Object.keys(errors).length ? null : model.estimate(input);
    document.getElementById('ait-selected').textContent = String(input.tasks.filter((row) => row.enabled).length);
    document.getElementById('ait-base').textContent = estimate ? '月 ' + num(estimate.baseHours) + ' 時間' : '—';
    if (options && options.submit) attempted = true;
    if (!attempted) return;
    if (showErrors(errors).length || !estimate.selected) {
      if (estimate && !estimate.selected) { formError.hidden = false; formError.textContent = '業務を1つ以上選んでください。'; }
      result.hidden = true;
      return;
    }
    document.getElementById('ait-result-scope').textContent = '選んだ' + estimate.selected + '業務に、いま月' + num(estimate.baseHours) + '時間かかっている計算です。控えめ〜標準の2つの見方で示します。';
    body.innerHTML = renderSummary(estimate);
    document.getElementById('ait-picks').innerHTML = renderPicks(estimate);
    document.getElementById('ait-breakdown').innerHTML = renderBreakdown(estimate);
    result.hidden = false;
    shown = true;
    if (!tracked) { tracked = true; if (globalThis.LabAnalytics) globalThis.LabAnalytics.track('analysis_run', { tool_id: 'ai-time-estimate' }); }
    if (options && options.submit) result.focus({ preventScroll: false });
  }

  form.addEventListener('input', () => run());
  form.addEventListener('change', () => run());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run({ submit: true });
    if (!shown || result.hidden) {
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
    }
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      attempted = false;
      shown = false;
      showErrors({});
      result.hidden = true;
      document.getElementById('ait-handoff').hidden = true;
      run();
    });
  });

  // DXかんたん診断で人件費の目安を入れていれば、それを使う（このタブの sessionStorage から読むだけ）
  function fillFromDiagnosis() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('hoteldxlab:dx-diagnosis') || 'null'); } catch (error) { saved = null; }
    if (!saved || !(saved.hourlyCost > 0) || saved.hourlyCost === model.defaults.hourlyCost) return;
    form.elements.hourlyCost.value = String(saved.hourlyCost);
    const note = document.getElementById('ait-handoff');
    note.textContent = 'DXかんたん診断で入れた人件費の目安（1時間' + num(saved.hourlyCost) + '円）を使います。「詳細設定」で変えられます。';
    note.hidden = false;
  }

  fillFromDiagnosis();
  run();
})();
