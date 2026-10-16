(function () {
  "use strict";

  const model = window.DxDiagnosisModel;
  const app = document.getElementById("dx-diagnosis-app");
  if (!model || !app) return;

  let step = 1;
  let page = 0;
  let facility = Object.assign({}, model.initialFacility);
  // 初期選択はしない。未回答のまま進もうとしたら、その質問へ案内する。
  let answers = {};
  let missing = [];
  // 任意項目（ADR・客室稼働率・人件費）を利用者が変えたか。変えていなければ結果に「標準値」と示す。
  let touched = {};
  let result = null;
  let errors = {};

  const formatNumber = function (value) { return Number(value).toLocaleString("ja-JP"); };
  const escapeHtml = function (value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  };
  const stepNames = ["16の質問", "施設の規模", "診断結果"];
  const CONTACT_URL = "https://forms.gle/yjinqFdntoXhTmgk7";

  function track(eventName) {
    if (window.LabAnalytics) window.LabAnalytics.track(eventName, { tool_id: "dx-diagnosis" });
  }

  function stepper() {
    return '<div class="dx-stepper" role="group" aria-label="診断の進み具合"><ol>' + stepNames.map(function (name, index) {
      const number = index + 1;
      const state = number === step ? "is-current" : number < step ? "is-complete" : "";
      return '<li class="' + state + '"' + (number === step ? ' aria-current="step"' : "") + '><span>0' + number + '</span><strong>' + name + '</strong></li>';
    }).join("") + '</ol><div class="dx-progress" aria-hidden="true"><span style="width:' + (step / 3 * 100) + '%"></span></div></div>';
  }

  function errorText(field) {
    return errors[field] ? '<p class="dx-field-error" id="error-' + field + '">' + escapeHtml(errors[field]) + '</p>' : "";
  }

  function invalidAttr(field) {
    return errors[field] ? ' aria-invalid="true"' : "";
  }

  function fieldDescribedBy(field, hintId) {
    return [hintId, errors[field] ? "error-" + field : ""].filter(Boolean).join(" ");
  }

  function rangeField(name, id, label, hint, value, wide) {
    return '<div class="dx-field dx-range-field' + (wide ? " dx-field--wide" : "") + '"><label for="' + id + '"><span>' + label + '</span><output id="' + id + '-output" for="' + id + '">' + value + '%</output></label><input id="' + id + '" name="' + name + '" type="range" min="0" max="100" step="1" value="' + value + '"' + invalidAttr(name) + ' aria-describedby="' + fieldDescribedBy(name, "hint-" + name) + '"><small id="hint-' + name + '">' + hint + '</small>' + errorText(name) + '</div>';
  }

  function renderFacility() {
    const optionalOpen = errors.adr || errors.occupancy || errors.hourlyCost;
    app.innerHTML = stepper() + '<section class="dx-panel dx-facility" aria-labelledby="dx-step-heading">' +
      '<div class="dx-panel-heading"><h3 id="dx-step-heading" tabindex="-1">あと少しです。施設の規模を教えてください</h3><p>作業時間の目安とOTA比率の確認に使います。おおよその数字で大丈夫です。</p></div>' +
      '<p class="dx-privacy-note"><strong>このページ内で完結します</strong>入力内容はこのブラウザの中だけで計算し、送信・保存しません。</p>' +
      '<form id="dx-facility-form" novalidate><div class="dx-form-grid">' +
      '<label class="dx-field"><span>客室数</span><span class="dx-input-unit"><input name="rooms" type="number" inputmode="numeric" min="1" max="1000" step="1" required value="' + facility.rooms + '"' + invalidAttr("rooms") + ' aria-describedby="' + fieldDescribedBy("rooms", "hint-rooms") + '"><b>室</b></span><small id="hint-rooms">販売している客室のおおよその数</small>' + errorText("rooms") + '</label>' +
      '<label class="dx-field"><span>従業員数</span><span class="dx-input-unit"><input name="employees" type="number" inputmode="numeric" min="1" max="5000" step="1" required value="' + facility.employees + '"' + invalidAttr("employees") + ' aria-describedby="' + fieldDescribedBy("employees", "hint-employees") + '"><b>人</b></span><small id="hint-employees">正社員・パートを合わせた目安</small>' + errorText("employees") + '</label>' +
      rangeField("otaRatio", "dx-ota-ratio", "OTA比率", "じゃらん・楽天・Booking.comなどを経由した予約の割合", facility.otaRatio, true) +
      '</div><details class="dx-details"' + (optionalOpen ? " open" : "") + '><summary>施設名・売上指標・人件費も入れる（任意）</summary><div class="dx-form-grid">' +
      '<label class="dx-field dx-field--wide"><span>施設名</span><input name="name" type="text" maxlength="80" autocomplete="organization" value="' + escapeHtml(facility.name) + '"><small>結果の見出しに表示します</small></label>' +
      '<label class="dx-field"><span>平均客室単価（ADR）</span><span class="dx-input-unit"><input name="adr" type="number" inputmode="numeric" min="0" max="500000" step="100" required value="' + facility.adr + '"' + invalidAttr("adr") + ' aria-describedby="' + fieldDescribedBy("adr", "hint-adr") + '"><b>円</b></span><small id="hint-adr">客室売上 ÷ 販売した客室数。参考RevPARの計算に使います</small>' + errorText("adr") + '</label>' +
      rangeField("occupancy", "dx-occupancy", "客室稼働率", "参考RevPARは ADR × 客室稼働率", facility.occupancy) +
      '<label class="dx-field"><span>人件費の目安（1時間）</span><span class="dx-input-unit"><input name="hourlyCost" type="number" inputmode="numeric" min="500" max="10000" step="100" required value="' + facility.hourlyCost + '"' + invalidAttr("hourlyCost") + ' aria-describedby="' + fieldDescribedBy("hourlyCost", "hint-hourly") + '"><b>円</b></span><small id="hint-hourly">改善できそうな作業時間の人件費換算に使います</small>' + errorText("hourlyCost") + '</label>' +
      '</div></details>' +
      '<div class="dx-actions"><button class="button button--outline" type="button" data-back>質問に戻る</button><button class="button" type="submit">診断結果を見る <span aria-hidden="true">→</span></button></div></form></section>';

    const form = document.getElementById("dx-facility-form");
    ["occupancy", "otaRatio"].forEach(function (name) {
      form.elements[name].addEventListener("input", updateLiveMetrics);
    });
    ["adr", "occupancy", "hourlyCost"].forEach(function (name) {
      form.elements[name].addEventListener("input", function () { touched[name] = true; });
    });
    form.querySelector("[data-back]").addEventListener("click", function () {
      facility = readFacility(form);
      errors = {};
      page = model.categories.length - 1;
      goToStep(1);
    });
    form.addEventListener("submit", submitFacility);
  }

  function readFacility(form) {
    return {
      name: form.elements.name.value.trim(),
      rooms: Number(form.elements.rooms.value),
      adr: Number(form.elements.adr.value),
      occupancy: Number(form.elements.occupancy.value),
      otaRatio: Number(form.elements.otaRatio.value),
      employees: Number(form.elements.employees.value),
      hourlyCost: Number(form.elements.hourlyCost.value)
    };
  }

  function updateLiveMetrics(event) {
    const form = event.currentTarget.form || document.getElementById("dx-facility-form");
    const current = readFacility(form);
    document.getElementById("dx-occupancy-output").textContent = current.occupancy + "%";
    document.getElementById("dx-ota-ratio-output").textContent = current.otaRatio + "%";
  }

  function submitFacility(event) {
    event.preventDefault();
    facility = readFacility(event.currentTarget);
    errors = model.validateFacility(facility);
    if (Object.keys(errors).length) {
      renderFacility();
      const firstInvalid = app.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    result = model.buildResult(answers, facility);
    track("analysis_result_view");
    goToStep(3);
  }

  function answeredCount() {
    return model.questions.filter(function (question) { return answers[question.id] !== undefined; }).length;
  }

  function progressSegments() {
    return '<div class="dx-segments" aria-hidden="true">' + model.questions.map(function (question) {
      const current = question.category === model.categories[page];
      return '<span class="' + [answers[question.id] !== undefined ? "is-answered" : "", current ? "is-current" : ""].join(" ").trim() + '"></span>';
    }).join("") + '</div>';
  }

  function renderQuestions() {
    const category = model.categories[page];
    const last = page === model.categories.length - 1;
    const questions = model.questions.filter(function (question) { return question.category === category; });
    const firstNumber = model.questions.indexOf(questions[0]) + 1;
    app.innerHTML = stepper() + '<section class="dx-panel dx-questions" aria-labelledby="dx-step-heading">' +
      '<div class="dx-question-head"><div class="dx-panel-heading"><p class="dx-category-count">カテゴリ ' + (page + 1) + ' / ' + model.categories.length + '</p><h3 id="dx-step-heading" tabindex="-1">' + category + '</h3></div>' +
      '<p class="dx-answered" aria-live="polite" aria-atomic="true"><b id="dx-answered-count">' + answeredCount() + '</b> / ' + model.questions.length + ' 問 回答済み</p></div>' +
      progressSegments() +
      '<p class="dx-question-lead">今の施設に一番近いものを選んでください。迷ったときは、だいたい当てはまる方で大丈夫です。</p>' +
      '<form id="dx-question-form" novalidate><div class="dx-question-list">' + questions.map(function (question, index) {
        const isMissing = missing.indexOf(question.id) > -1;
        return '<fieldset class="dx-question' + (isMissing ? " is-missing" : "") + '" id="q-' + question.id + '"' + (isMissing ? ' aria-describedby="missing-' + question.id + '"' : "") + '><legend><span>Q' + (firstNumber + index) + '</span>' + escapeHtml(question.question) + '</legend>' +
          (isMissing ? '<p class="dx-field-error" id="missing-' + question.id + '">この質問にまだ回答していません。</p>' : "") +
          '<div class="dx-options">' + question.options.map(function (option, optionIndex) {
          const id = "answer-" + question.id + "-" + optionIndex;
          return '<label for="' + id + '"><input id="' + id + '" type="radio" name="' + question.id + '" value="' + optionIndex + '"' + (answers[question.id] === optionIndex ? " checked" : "") + '><span>' + escapeHtml(option.label) + '</span></label>';
        }).join("") + '</div></fieldset>';
      }).join("") + '</div><div class="dx-actions">' +
      (page > 0 ? '<button class="button button--outline" type="button" data-back>前のカテゴリへ</button>' : '<span></span>') +
      '<button class="button" type="submit">' + (last ? '施設の規模の入力へ' : '次のカテゴリへ（' + model.categories[page + 1] + '）') + ' <span aria-hidden="true">→</span></button></div></form></section>';

    const form = document.getElementById("dx-question-form");
    form.addEventListener("change", function (event) {
      if (!event.target.matches('input[type="radio"]')) return;
      answers[event.target.name] = Number(event.target.value);
      document.getElementById("dx-answered-count").textContent = answeredCount();
      const segments = app.querySelector(".dx-segments");
      segments.outerHTML = progressSegments();
      const fieldset = event.target.closest(".dx-question");
      if (fieldset.classList.contains("is-missing")) {
        missing = missing.filter(function (id) { return id !== event.target.name; });
        fieldset.classList.remove("is-missing");
        fieldset.removeAttribute("aria-describedby");
        const note = fieldset.querySelector(".dx-field-error");
        if (note) note.remove();
      }
    });
    const back = form.querySelector("[data-back]");
    if (back) back.addEventListener("click", function () { missing = []; page -= 1; goToStep(1); });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      missing = questions.filter(function (question) { return answers[question.id] === undefined; }).map(function (question) { return question.id; });
      if (missing.length) {
        renderQuestions();
        const target = document.getElementById("q-" + missing[0]);
        target.scrollIntoView({ block: "center" });
        target.querySelector("input").focus({ preventScroll: true });
        return;
      }
      if (!last) { page += 1; goToStep(1); return; }
      // 16問すべてに回答したら1回だけ計測する（回答内容は送らない）。
      track("analysis_run");
      goToStep(2);
    });
  }

  // 優先課題カードから試せるラボ内のツール。カテゴリごとに1つ。
  const relatedTools = {
    "経営": { label: "宿泊経営の課題整理（β）で論点を整理する", href: "/management-ai.html" },
    "予約・販売": { label: "予約エンジンデモで自社予約の流れを見る", href: "/demo/booking/" },
    "会計": { label: "宿泊経営の課題整理（β）で論点を整理する", href: "/management-ai.html" },
    "業務": { label: "簡易PMSデモで客室ステータスの共有を試す", href: "/demo/mini-pms/" },
    "勤怠・シフト": { label: "宿泊経営の課題整理（β）で地域の人手不足を見る", href: "/management-ai.html?topic=dx" },
    "システム": { label: "簡易PMSデモで予約から部屋割りまでを試す", href: "/demo/mini-pms/" },
    "集客": { label: "予約エンジンデモで自社予約の流れを見る", href: "/demo/booking/" },
    "データ活用": { label: "宿泊料金トレンドで地域の相場を見る", href: "/hotel-price-trends.html" }
  };

  function revparNote() {
    const defaults = [];
    if (!touched.adr) defaults.push(["ADR", "¥" + formatNumber(facility.adr)]);
    if (!touched.occupancy) defaults.push(["客室稼働率", facility.occupancy + "%"]);
    if (!defaults.length) return "";
    return '<p class="dx-summary-note">参考RevPARは、入力されていない' + defaults.map(function (item) { return item[0]; }).join("・") + 'を標準値（' + defaults.map(function (item) { return item[1]; }).join("・") + '）として計算しています。「施設の規模」の任意項目で変更できます。</p>';
  }

  function summaryPanel() {
    const top = result.findings[0];
    return '<section class="dx-summary" aria-labelledby="dx-summary-heading">' +
      '<div class="dx-score-ring" style="--score:' + result.total + '"><div><strong>' + result.total + '</strong><span>/ 100</span></div></div>' +
      '<div class="dx-summary-body"><h4 id="dx-summary-heading">DX総合スコア</h4>' +
      '<div class="dx-score-scale"><span>これから</span><span>整備中</span><span>定着・活用</span><i class="dx-scale-marker" style="left:' + result.total + '%" aria-hidden="true"></i></div>' +
      '<div class="dx-top-priority"><p><span class="dx-top-badge">最優先</span><strong>' + top.category + '</strong></p><p class="dx-top-action">まずやること：<b>' + escapeHtml(top.action) + '</b></p></div>' +
      '<p class="dx-summary-comment">' + escapeHtml(result.comment) + '</p>' +
      revparNote() +
      '</div></section>';
  }

  function findingsPanel() {
    return '<section class="dx-result-section" aria-labelledby="dx-findings-heading"><h4 id="dx-findings-heading" class="dx-result-title">まず見直したい3つ</h4><div class="dx-findings">' + result.findings.map(function (finding, index) {
      const tool = relatedTools[finding.category];
      return '<article><p class="dx-priority">優先度 ' + (index + 1) + '</p><div class="dx-finding-title"><h5>' + finding.category + '</h5><strong>' + finding.score + '<small>点</small></strong></div><p>' + escapeHtml(finding.text) + '</p><div class="dx-finding-action"><span>まずやること</span><b>' + escapeHtml(finding.action) + '</b></div>' +
        (tool ? '<a class="dx-finding-link" href="' + tool.href + '">' + tool.label + ' <span aria-hidden="true">→</span></a>' : "") + '</article>';
    }).join("") + '</div></section>';
  }

  function scoreBars() {
    const priority = result.findings.map(function (finding) { return finding.category; });
    return '<section class="dx-result-section" aria-labelledby="dx-score-heading"><h4 id="dx-score-heading" class="dx-result-title">カテゴリ別スコア</h4><p class="dx-result-lead">色の濃い3つが、まず見直したいカテゴリです。</p><ul class="dx-bars">' + model.categories.map(function (category) {
      const score = result.scores[category];
      const isPriority = priority.indexOf(category) > -1;
      return '<li' + (isPriority ? ' class="is-priority"' : "") + '><span class="dx-bar-label">' + category + (isPriority ? '<span class="visually-hidden">（優先）</span>' : "") + '</span><span class="dx-bar-track" aria-hidden="true"><span style="width:' + score + '%"></span></span><b>' + score + '<span class="visually-hidden">点</span></b></li>';
    }).join("") + '</ul></section>';
  }

  function defaultMark(field) {
    return touched[field] ? "" : "（標準値）";
  }

  function timePanel() {
    return '<section class="dx-time-panel" aria-labelledby="dx-time-heading"><h4 id="dx-time-heading" class="dx-result-title">改善できそうな作業時間の目安</h4><dl><div><dt>1か月</dt><dd>約 ' + formatNumber(result.monthlyHours) + ' 時間</dd></div><div><dt>1年間</dt><dd>約 ' + formatNumber(result.annualHours) + ' 時間</dd></div><div><dt>人件費換算</dt><dd>約 ' + formatNumber(Math.round(result.annualValue / 10000)) + ' 万円/年</dd></div></dl>' +
      '<p>簡易モデルによる参考値です。正式な効果試算には、現場の作業時間を確認する必要があります。</p>' +
      '<p class="dx-inputs">計算に使った数値：客室 ' + formatNumber(facility.rooms) + ' 室、従業員 ' + formatNumber(facility.employees) + ' 人、OTA比率 ' + facility.otaRatio + '%、ADR ¥' + formatNumber(facility.adr) + defaultMark("adr") + '、客室稼働率 ' + facility.occupancy + '%' + defaultMark("occupancy") + '、参考RevPAR ¥' + formatNumber(result.revpar) + '、人件費の目安 ¥' + formatNumber(facility.hourlyCost) + '/時間' + defaultMark("hourlyCost") + '</p></section>';
  }

  function solutionsPanel() {
    return '<section class="dx-result-section" aria-labelledby="dx-solutions-heading"><h4 id="dx-solutions-heading" class="dx-result-title">関連するDX施策</h4><div class="dx-solutions">' + result.matchedSolutions.map(function (solution) {
      return '<details><summary><span>' + solution.category + '</span><strong>' + escapeHtml(solution.name) + '</strong></summary><div><p>' + escapeHtml(solution.summary) + '</p><dl><div><dt>向いている施設</dt><dd>' + escapeHtml(solution.fit) + '</dd></div><div><dt>比較ポイント</dt><dd>' + escapeHtml(solution.comparePoints) + '</dd></div></dl></div></details>';
    }).join("") + '</div></section>';
  }

  function renderResult() {
    const title = facility.name ? escapeHtml(facility.name) + "の診断結果" : "診断結果";
    app.innerHTML = stepper() + '<section class="dx-panel dx-results" aria-labelledby="dx-step-heading">' +
      '<div class="dx-panel-heading"><h3 id="dx-step-heading" tabindex="-1">' + title + '</h3><p>点数そのものより、優先して見直す場所を決めるために活用してください。</p></div>' +
      summaryPanel() +
      '<div class="dx-result-tools"><button class="dx-chip" type="button" data-review>回答を見直す</button><button class="dx-chip" type="button" data-reset>最初からやり直す</button></div>' +
      findingsPanel() + scoreBars() + timePanel() + solutionsPanel() +
      '<section class="dx-next-steps" aria-labelledby="dx-next-heading"><h4 id="dx-next-heading" class="dx-result-title">診断後に確認すること</h4><ul><li>二重入力が起きている業務と所要時間を記録する</li><li>清掃状況や引継ぎ情報の共有方法を整理する</li><li>改善対象を決めてから、必要な仕組みを比較する</li></ul></section>' +
      '<section class="dx-consultation"><div><h4>この結果をもとに、進め方を一緒に整理しませんか？</h4><p>診断結果をもとに、施設の状況に合った進め方を合同会社UGATTAが一緒に整理します。ご相談は無料です。</p></div><a class="button" href="' + CONTACT_URL + '" target="_blank" rel="noopener noreferrer" data-analytics-event="consultation_click" data-tool-id="dx-diagnosis-result">診断結果について相談する <span aria-hidden="true">↗</span></a></section>' +
      '</section>';
    bindResultEvents();
  }

  function bindResultEvents() {
    app.querySelectorAll("[data-reset]").forEach(function (button) { button.addEventListener("click", resetDiagnosis); });
    app.querySelector("[data-review]").addEventListener("click", function () { page = 0; goToStep(1); });
    app.querySelector('[data-analytics-event="consultation_click"]').addEventListener("click", function () {
      track("consultation_click");
    });
  }

  function resetDiagnosis() {
    facility = Object.assign({}, model.initialFacility);
    answers = {};
    missing = [];
    touched = {};
    page = 0;
    result = null;
    errors = {};
    goToStep(1);
  }

  function goToStep(nextStep) {
    step = nextStep;
    render();
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("tool").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    const heading = document.getElementById("dx-step-heading");
    if (heading) heading.focus({ preventScroll: true });
  }

  function render() {
    if (step === 1) renderQuestions();
    else if (step === 2) renderFacility();
    else renderResult();
  }

  render();
})();
