(function () {
  "use strict";

  const model = window.DxDiagnosisModel;
  const app = document.getElementById("dx-diagnosis-app");
  if (!model || !app) return;

  let step = 1;
  let facility = Object.assign({}, model.initialFacility);
  let answers = model.defaultAnswers();
  let result = null;
  let errors = {};
  let chartView = "bars";
  let runTracked = false;
  let resultTracked = false;

  const formatNumber = function (value) { return Number(value).toLocaleString("ja-JP"); };
  const escapeHtml = function (value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  };
  const stepNames = ["施設情報", "16の質問", "診断結果"];
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

  function renderFacility() {
    app.innerHTML = stepper() + '<section class="dx-panel dx-facility" aria-labelledby="dx-step-heading">' +
      '<div class="dx-panel-heading"><p class="eyebrow">STEP 1</p><h3 id="dx-step-heading" tabindex="-1">まず、施設のことを教えてください</h3><p>分かる範囲のおおよその数字で大丈夫です。</p></div>' +
      '<p class="dx-privacy-note"><strong>このページ内で完結します</strong>入力内容はこのブラウザの中だけで計算し、送信・保存しません。施設名は任意です。</p>' +
      '<form id="dx-facility-form" novalidate><div class="dx-form-grid">' +
      '<label class="dx-field dx-field--wide"><span>施設名 <small>任意</small></span><input name="name" type="text" maxlength="80" autocomplete="organization" value="' + escapeHtml(facility.name) + '"></label>' +
      '<label class="dx-field"><span>客室数</span><span class="dx-input-unit"><input name="rooms" type="number" min="1" max="1000" step="1" required value="' + facility.rooms + '"' + invalidAttr("rooms") + ' aria-describedby="' + fieldDescribedBy("rooms", "hint-rooms") + '"><b>室</b></span><small id="hint-rooms">販売している客室のおおよその数</small>' + errorText("rooms") + '</label>' +
      '<label class="dx-field"><span>従業員数</span><span class="dx-input-unit"><input name="employees" type="number" min="1" max="5000" step="1" required value="' + facility.employees + '"' + invalidAttr("employees") + ' aria-describedby="' + fieldDescribedBy("employees", "hint-employees") + '"><b>人</b></span><small id="hint-employees">正社員・パートを合わせた目安</small>' + errorText("employees") + '</label>' +
      '<label class="dx-field"><span>平均客室単価（ADR）</span><span class="dx-input-unit"><input name="adr" type="number" min="0" max="500000" step="100" required value="' + facility.adr + '"' + invalidAttr("adr") + ' aria-describedby="' + fieldDescribedBy("adr", "hint-adr") + '"><b>円</b></span><small id="hint-adr">客室売上 ÷ 販売した客室数</small>' + errorText("adr") + '</label>' +
      '<div class="dx-field dx-range-field"><label for="dx-occupancy"><span>客室稼働率</span><output id="dx-occupancy-output" for="dx-occupancy">' + facility.occupancy + '%</output></label><input id="dx-occupancy" name="occupancy" type="range" min="0" max="100" step="1" value="' + facility.occupancy + '"' + invalidAttr("occupancy") + ' aria-describedby="' + fieldDescribedBy("occupancy", "hint-occupancy") + '"><small id="hint-occupancy">参考RevPARは ADR × 客室稼働率</small>' + errorText("occupancy") + '</div>' +
      '<div class="dx-field dx-range-field"><label for="dx-ota-ratio"><span>OTA比率</span><output id="dx-ota-output" for="dx-ota-ratio">' + facility.otaRatio + '%</output></label><input id="dx-ota-ratio" name="otaRatio" type="range" min="0" max="100" step="1" value="' + facility.otaRatio + '"' + invalidAttr("otaRatio") + ' aria-describedby="' + fieldDescribedBy("otaRatio", "hint-ota") + '"><small id="hint-ota">じゃらん・楽天・Booking.comなど</small>' + errorText("otaRatio") + '</div>' +
      '</div><details class="dx-details"' + (errors.hourlyCost ? " open" : "") + '><summary>詳細設定</summary><label class="dx-field"><span>人件費の目安（1時間）</span><span class="dx-input-unit"><input name="hourlyCost" type="number" min="500" max="10000" step="100" required value="' + facility.hourlyCost + '"' + invalidAttr("hourlyCost") + ' aria-describedby="' + fieldDescribedBy("hourlyCost", "hint-hourly") + '"><b>円</b></span><small id="hint-hourly">改善できそうな作業時間の人件費換算に使います</small>' + errorText("hourlyCost") + '</label></details>' +
      '<div class="dx-revpar"><span>現在の参考RevPAR</span><strong id="dx-revpar-value">¥' + formatNumber(model.revpar(facility)) + '</strong><small>ADR × 客室稼働率</small></div>' +
      '<div class="dx-actions dx-actions--end"><button class="button" type="submit">16の質問へ進む <span aria-hidden="true">→</span></button></div></form></section>';

    const form = document.getElementById("dx-facility-form");
    ["occupancy", "otaRatio", "adr"].forEach(function (name) {
      form.elements[name].addEventListener("input", updateLiveMetrics);
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
    document.getElementById("dx-ota-output").textContent = current.otaRatio + "%";
    document.getElementById("dx-revpar-value").textContent = Number.isFinite(current.adr) ? "¥" + formatNumber(model.revpar(current)) : "—";
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
    if (!runTracked) {
      runTracked = true;
      track("analysis_run");
    }
    goToStep(2);
  }

  function renderQuestions() {
    app.innerHTML = stepper() + '<section class="dx-panel dx-questions" aria-labelledby="dx-step-heading">' +
      '<div class="dx-panel-heading"><p class="eyebrow">STEP 2</p><h3 id="dx-step-heading" tabindex="-1">16の質問に答えてください</h3><p>今の施設に最も近いものを選んでください。中央の選択肢を初期選択しています。</p></div>' +
      '<form id="dx-question-form"><div class="dx-question-list">' + model.questions.map(function (question, index) {
        return '<fieldset class="dx-question"><legend><span>' + String(index + 1).padStart(2, "0") + '</span>' + escapeHtml(question.question) + '</legend><p>' + escapeHtml(question.category) + '</p><div class="dx-options">' + question.options.map(function (option, optionIndex) {
          const id = "answer-" + question.id + "-" + optionIndex;
          return '<label for="' + id + '"><input id="' + id + '" type="radio" name="' + question.id + '" value="' + optionIndex + '"' + (answers[question.id] === optionIndex ? " checked" : "") + '><span>' + escapeHtml(option.label) + '</span></label>';
        }).join("") + '</div></fieldset>';
      }).join("") + '</div><div class="dx-actions"><button class="button button--outline" type="button" data-back>施設情報に戻る</button><button class="button" type="submit">診断結果を見る <span aria-hidden="true">→</span></button></div></form></section>';
    const form = document.getElementById("dx-question-form");
    form.addEventListener("change", function (event) {
      if (event.target.matches('input[type="radio"]')) answers[event.target.name] = Number(event.target.value);
    });
    form.querySelector("[data-back]").addEventListener("click", function () { goToStep(1); });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      result = model.buildResult(answers, facility);
      if (!resultTracked) {
        resultTracked = true;
        track("analysis_result_view");
      }
      goToStep(3);
    });
  }

  function scoreTable() {
    return '<table class="visually-hidden"><caption>カテゴリ別DXスコア</caption><thead><tr><th>カテゴリ</th><th>点数</th></tr></thead><tbody>' + model.categories.map(function (category) {
      return '<tr><th scope="row">' + category + '</th><td>' + result.scores[category] + '点</td></tr>';
    }).join("") + '</tbody></table>';
  }

  function barChart() {
    const width = 720;
    const left = 142;
    const usable = 520;
    return '<svg class="dx-score-svg" viewBox="0 0 ' + width + ' 390" role="img" aria-label="8カテゴリのDXスコア横棒グラフ">' + model.categories.map(function (category, index) {
      const y = 25 + index * 46;
      const score = result.scores[category];
      return '<text class="dx-chart-label" x="0" y="' + (y + 15) + '">' + category + '</text><rect class="dx-chart-track" x="' + left + '" y="' + y + '" width="' + usable + '" height="20" rx="10"></rect><rect class="dx-chart-bar" x="' + left + '" y="' + y + '" width="' + (usable * score / 100) + '" height="20" rx="10"></rect><text class="dx-chart-score" x="' + (left + usable + 12) + '" y="' + (y + 15) + '">' + score + '</text>';
    }).join("") + '</svg>';
  }

  function radarPoint(index, value, radius) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / model.categories.length;
    return [200 + Math.cos(angle) * radius * value / 100, 200 + Math.sin(angle) * radius * value / 100];
  }

  function pointsFor(value, radius) {
    return model.categories.map(function (_, index) { return radarPoint(index, value, radius).join(","); }).join(" ");
  }

  function radarChart() {
    const radius = 126;
    const dataPoints = model.categories.map(function (category, index) { return radarPoint(index, result.scores[category], radius).join(","); }).join(" ");
    return '<svg class="dx-radar-svg" viewBox="0 0 400 400" role="img" aria-label="8カテゴリのDXスコアレーダーチャート">' +
      [25, 50, 75, 100].map(function (value) { return '<polygon class="dx-radar-grid" points="' + pointsFor(value, radius) + '"></polygon>'; }).join("") +
      model.categories.map(function (category, index) {
        const end = radarPoint(index, 100, radius);
        const label = radarPoint(index, 122, radius);
        const anchor = label[0] < 180 ? "end" : label[0] > 220 ? "start" : "middle";
        return '<line class="dx-radar-axis" x1="200" y1="200" x2="' + end[0] + '" y2="' + end[1] + '"></line><text class="dx-radar-label" x="' + label[0] + '" y="' + (label[1] + 4) + '" text-anchor="' + anchor + '">' + category + '</text>';
      }).join("") + '<polygon class="dx-radar-data" points="' + dataPoints + '"></polygon>' +
      model.categories.map(function (category, index) { const point = radarPoint(index, result.scores[category], radius); return '<circle class="dx-radar-point" cx="' + point[0] + '" cy="' + point[1] + '" r="4"></circle>'; }).join("") + '</svg>';
  }

  function chartPanel() {
    const barsActive = chartView === "bars";
    return '<section class="dx-result-section" aria-labelledby="dx-score-heading"><div class="dx-result-heading"><p class="eyebrow">CATEGORY SCORE</p><h4 id="dx-score-heading">カテゴリ別スコア</h4></div>' +
      '<div class="dx-tabs" role="tablist" aria-label="スコア表示"><button id="dx-tab-bars" role="tab" aria-selected="' + barsActive + '" aria-controls="dx-panel-bars" tabindex="' + (barsActive ? "0" : "-1") + '" data-chart="bars">比較して見る</button><button id="dx-tab-radar" role="tab" aria-selected="' + (!barsActive) + '" aria-controls="dx-panel-radar" tabindex="' + (!barsActive ? "0" : "-1") + '" data-chart="radar">全体像を見る</button></div>' +
      '<div id="dx-panel-bars" class="dx-chart-panel" role="tabpanel" aria-labelledby="dx-tab-bars"' + (barsActive ? "" : " hidden") + '>' + barChart() + '</div>' +
      '<div id="dx-panel-radar" class="dx-chart-panel dx-chart-panel--radar" role="tabpanel" aria-labelledby="dx-tab-radar"' + (!barsActive ? "" : " hidden") + '>' + radarChart() + '</div>' + scoreTable() + '</section>';
  }

  function renderResult() {
    const title = facility.name ? escapeHtml(facility.name) + "の診断結果" : "診断結果";
    app.innerHTML = stepper() + '<section class="dx-panel dx-results" aria-labelledby="dx-step-heading">' +
      '<div class="dx-result-top"><div class="dx-panel-heading"><p class="eyebrow">STEP 3</p><h3 id="dx-step-heading" tabindex="-1">' + title + '</h3><p>点数そのものより、優先して見直す場所を決めるために活用してください。</p></div><button class="dx-text-button" type="button" data-reset>最初から診断</button></div>' +
      '<div class="dx-metrics"><article><span>ADR</span><strong>¥' + formatNumber(facility.adr) + '</strong></article><article><span>客室稼働率</span><strong>' + facility.occupancy + '%</strong></article><article><span>参考RevPAR</span><strong>¥' + formatNumber(result.revpar) + '</strong></article><article><span>OTA比率</span><strong>' + facility.otaRatio + '%</strong></article></div>' +
      '<section class="dx-overview" aria-labelledby="dx-overview-heading"><div class="dx-score-ring" style="--score:' + result.total + '"><div><strong>' + result.total + '</strong><span>/ 100</span></div></div><div><p class="eyebrow">TOTAL SCORE</p><h4 id="dx-overview-heading">DX総合スコア</h4><div class="dx-score-scale"><span>これから</span><span>整備中</span><span>定着・活用</span></div></div></section>' +
      '<section class="dx-comment"><p class="eyebrow">DIAGNOSIS COMMENT</p><h4>現在地から始める、無理のない一歩</h4><p>' + escapeHtml(result.comment) + '</p></section>' + chartPanel() +
      '<section class="dx-result-section" aria-labelledby="dx-findings-heading"><div class="dx-result-heading"><p class="eyebrow">PRIORITIES</p><h4 id="dx-findings-heading">まず直したい3つ</h4></div><div class="dx-findings">' + result.findings.map(function (finding, index) {
        return '<article><span class="dx-priority">優先度 0' + (index + 1) + '</span><div class="dx-finding-title"><h5>' + finding.category + '</h5><strong>' + finding.score + '<small>点</small></strong></div><p>' + escapeHtml(finding.text) + '</p><div><span>まずやること</span><b>' + escapeHtml(finding.action) + '</b></div></article>';
      }).join("") + '</div></section>' +
      '<section class="dx-time-panel" aria-labelledby="dx-time-heading"><div><p class="eyebrow">POTENTIAL</p><h4 id="dx-time-heading">改善できそうな作業時間の目安</h4></div><dl><div><dt>1か月</dt><dd>約 ' + formatNumber(result.monthlyHours) + ' 時間</dd></div><div><dt>1年間</dt><dd>約 ' + formatNumber(result.annualHours) + ' 時間</dd></div><div><dt>人件費換算</dt><dd>約 ' + formatNumber(Math.round(result.annualValue / 10000)) + ' 万円/年</dd></div></dl><p>簡易モデルによる参考値です。正式な効果試算には、現場の作業時間を確認する必要があります。</p></section>' +
      '<section class="dx-result-section" aria-labelledby="dx-solutions-heading"><div class="dx-result-heading"><p class="eyebrow">NEXT SOLUTIONS</p><h4 id="dx-solutions-heading">関連するDX施策</h4></div><div class="dx-solutions">' + result.matchedSolutions.map(function (solution) {
        return '<details><summary><span>' + solution.category + '</span><strong>' + escapeHtml(solution.name) + '</strong></summary><div><p>' + escapeHtml(solution.summary) + '</p><dl><div><dt>向いている施設</dt><dd>' + escapeHtml(solution.fit) + '</dd></div><div><dt>比較ポイント</dt><dd>' + escapeHtml(solution.comparePoints) + '</dd></div></dl></div></details>';
      }).join("") + '</div></section>' +
      '<section class="dx-consultation"><p class="eyebrow">CONSULTATION</p><h4>次の一歩を一緒に整理しませんか？</h4><p>診断結果をもとに、施設の状況に合った進め方を合同会社UGATTAが一緒に整理します。ご相談は無料です。</p><a class="button" href="' + CONTACT_URL + '" target="_blank" rel="noopener noreferrer" data-analytics-event="consultation_click" data-tool-id="dx-diagnosis-result">診断結果について相談する <span aria-hidden="true">↗</span></a></section>' +
      '<div class="dx-actions"><button class="button button--outline" type="button" data-review>回答を見直す</button><button class="dx-text-button" type="button" data-reset>最初からやり直す</button></div></section>';
    bindResultEvents();
  }

  function bindResultEvents() {
    app.querySelectorAll("[data-reset]").forEach(function (button) { button.addEventListener("click", resetDiagnosis); });
    app.querySelector("[data-review]").addEventListener("click", function () { goToStep(2); });
    app.querySelector('[data-analytics-event="consultation_click"]').addEventListener("click", function () {
      track("consultation_click");
    });
    app.querySelectorAll('[role="tab"]').forEach(function (tab) {
      tab.addEventListener("click", function () { setChartView(tab.dataset.chart, true); });
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        setChartView(chartView === "bars" ? "radar" : "bars", true);
      });
    });
  }

  function setChartView(view, focus) {
    chartView = view;
    ["bars", "radar"].forEach(function (name) {
      const selected = name === chartView;
      const tab = document.getElementById("dx-tab-" + name);
      const panel = document.getElementById("dx-panel-" + name);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    });
    if (focus) document.getElementById("dx-tab-" + chartView).focus();
  }

  function resetDiagnosis() {
    facility = Object.assign({}, model.initialFacility);
    answers = model.defaultAnswers();
    result = null;
    errors = {};
    chartView = "bars";
    runTracked = false;
    resultTracked = false;
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
    if (step === 1) renderFacility();
    else if (step === 2) renderQuestions();
    else renderResult();
  }

  render();
})();
