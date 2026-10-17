(function () {
  'use strict';

  // 宿のセキュリティ10問チェックの画面。並べ方は SecurityCheckModel（security-check-model.js）に任せ、ここは回答と描画だけを持つ。
  const model = globalThis.SecurityCheckModel;
  const form = document.getElementById('sec-form');
  const result = document.getElementById('sec-result');
  const body = document.getElementById('sec-result-body');
  if (!model || !form || !result || !body) return;

  const formError = document.getElementById('sec-form-error');
  let shown = false;
  let tracked = false;

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  function readAnswers() {
    const answers = {};
    model.questions.forEach((q) => {
      const checked = form.querySelector('input[name="' + q.id + '"]:checked');
      if (checked) answers[q.id] = Number(checked.value);
    });
    return answers;
  }

  function updateProgress(answers) {
    const count = model.questions.length - model.missing(answers).length;
    document.getElementById('sec-answered').textContent = String(count);
    document.getElementById('sec-progress').style.width = (count / model.questions.length * 100) + '%';
  }

  function markMissing(ids) {
    form.querySelectorAll('.sec-question').forEach((node) => node.classList.toggle('is-missing', ids.includes(node.dataset.question)));
    formError.hidden = ids.length === 0;
    formError.textContent = ids.length ? 'まだ答えていない質問が' + ids.length + 'つあります。分からないものは「できていない・わからない」を選んでください。' : '';
  }

  // 項目から続けて使えるラボのツール
  const itemLinks = {
    'ai-rule': { href: '/ai-time-estimate.html', label: '生成AIに任せる業務と浮く時間を見積もる（生成AI時短みつもり）' }
  };

  function itemLink(item) {
    const link = itemLinks[item.id];
    return link ? '<a class="sec-item-link" href="' + link.href + '">' + escapeHtml(link.label) + ' <span aria-hidden="true">→</span></a>' : '';
  }

  function todoItem(item) {
    return '<li><strong>' + escapeHtml(item.todo) + (item.partial ? '<span class="sec-tag">一部できている</span>' : '') + '</strong>' +
      '<p><b>なぜ：</b>' + escapeHtml(item.why) + '</p><p><b>費用：</b>' + escapeHtml(item.cost) + '</p>' + itemLink(item) + '</li>';
  }

  function render(evaluation) {
    const areas = evaluation.byArea.map((area) => '<li><span>' + escapeHtml(area.area) + '</span><strong>' + area.done + '/' + area.total + '</strong></li>').join('');
    let html = '<div class="sec-summary"><p class="sec-summary__label">10項目のうち</p>' +
      '<p class="sec-summary__headline">できているのは ' + evaluation.done + '項目です</p>' +
      '<p>' + (evaluation.partial ? '一部できているのが <b>' + evaluation.partial + '項目</b>。' : '') + '点数ではなく、<b>今週やること3つ</b>を先に示します。どれも費用をかけずに始められます。</p>' +
      '<ul class="sec-areas" aria-label="分野ごとの、できている項目の数">' + areas + '</ul></div>';
    if (!evaluation.thisWeek.length) {
      html += '<section class="sec-block"><h4>今週やること</h4><p class="sec-good">10項目すべてできています。年に1回、スタッフの入れ替わりや使うサービスが変わったときに見直してください。</p></section>';
    } else {
      html += '<section class="sec-block"><h4>今週やること</h4><ol class="sec-todo">' + evaluation.thisWeek.map(todoItem).join('') + '</ol></section>';
    }
    if (evaluation.later.length) {
      html += '<section class="sec-block"><h4>次に見直すこと</h4><ul class="sec-later">' +
        evaluation.later.map((item) => '<li>' + escapeHtml(item.todo) + ' <small>（' + escapeHtml(item.area) + (item.partial ? '・一部できている' : '') + '）</small>' + itemLink(item) + '</li>').join('') +
        '</ul></section>';
    }
    body.innerHTML = html;
  }

  function run(options) {
    const answers = readAnswers();
    updateProgress(answers);
    if (!shown && !(options && options.submit)) return;
    const missing = model.missing(answers);
    if (missing.length) {
      markMissing(missing);
      // 回答の途中で結果を出していた場合も、そろうまでは隠す
      result.hidden = true;
      if (options && options.submit) {
        const first = document.getElementById('sec-q-' + missing[0]);
        first.scrollIntoView({ block: 'center' });
        first.querySelector('input').focus({ preventScroll: true });
      }
      return;
    }
    markMissing([]);
    render(model.evaluate(answers));
    result.hidden = false;
    shown = true;
    if (!tracked) { tracked = true; if (globalThis.LabAnalytics) globalThis.LabAnalytics.track('analysis_run', { tool_id: 'security-check' }); }
    if (options && options.submit) result.focus({ preventScroll: false });
  }

  form.addEventListener('change', () => {
    const answers = readAnswers();
    // 未回答の印は答えたところから外す
    if (!formError.hidden) markMissing(model.missing(answers).filter((id) => document.getElementById('sec-q-' + id).classList.contains('is-missing')));
    run();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run({ submit: true });
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      shown = false;
      markMissing([]);
      result.hidden = true;
      body.innerHTML = '';
      updateProgress({});
    });
  });

  updateProgress(readAnswers());
})();
