/*
 * 都道府県横断分析（宿泊DX必要度・需給ギャップ・観光負荷）の画面側。
 * データ取得・選択状態・DOM 描画だけを担当し、計算・判定・文言は
 * cross-analysis-model.js（CrossAnalysisModel）から受け取る。
 */
(() => {
  'use strict';

  const model = globalThis.CrossAnalysisModel;
  if (!model || typeof document === 'undefined') return;

  const root = document.querySelector('[data-cross-analysis]');
  if (!root) return;

  const type = root.dataset.crossAnalysis;
  const config = model.configs[type];
  if (!config) return;

  const $ = (id) => document.getElementById(id);
  const select = $('prefecture-select');
  const loading = $('data-loading');
  const error = $('data-error');
  const dashboard = $('analysis-dashboard');
  let dataset;

  // ---- 状態 ----------------------------------------------------------

  function selectedRecord() {
    return model.findRecord(dataset, select.value);
  }

  function selectPrefecture(slug, { scroll = false } = {}) {
    select.value = slug;
    render();
    if (scroll) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateUrl(slug) {
    const url = new URL(window.location.href);
    url.searchParams.set('pref', slug);
    window.history.replaceState(null, '', url);
  }

  function updateRelatedLinks(slug) {
    document.querySelectorAll('[data-pref-link]').forEach((link) => {
      const url = new URL(link.href, window.location.href);
      url.searchParams.set('pref', slug);
      link.href = `${url.pathname}${url.search}${url.hash}`;
    });
  }

  // ---- 描画 ----------------------------------------------------------

  function setText(id, value) {
    const node = $(id);
    if (!node) return;
    node.textContent = value;
    if (node.matches('.metric-grid strong, .market-comparison-grid strong, .score-card>strong, .attention-card>strong')) {
      node.classList.toggle('kpi-value--status', model.STATUS_VALUES.includes(value));
    }
  }

  function setTexts(texts) {
    Object.entries(texts).forEach(([id, value]) => setText(id, value));
  }

  function renderBars(item) {
    const target = $('factor-bars');
    if (!target) return;
    target.replaceChildren(...model.factorRows(type, item).map((factor) => {
      const row = document.createElement('div');
      row.className = 'factor-row';
      row.innerHTML = `<div><span>${factor.label}</span><strong>${factor.display}</strong></div><span class="factor-track" aria-hidden="true"><span style="width:${factor.width}"></span></span>`;
      return row;
    }));
  }

  function renderRanking() {
    const target = $('prefecture-ranking');
    if (!target) return;
    target.replaceChildren(...model.rankingRows(type, dataset).map((row) => {
      const li = document.createElement('li');
      li.dataset.slug = row.slug;
      li.innerHTML = `<button type="button"><span class="ranking-number">${row.rank}</span><span class="ranking-name"><strong>${row.name}</strong><small>${row.detail}</small></span><span>${row.score}</span></button>`;
      li.querySelector('button').addEventListener('click', () => selectPrefecture(row.slug, { scroll: true }));
      return li;
    }));
  }

  function renderScatter(item) {
    const target = $('scatter-chart');
    if (!target) return;
    const layout = model.scatterLayout(type, item, dataset);
    const { width, height, left, right, top, bottom, xNationalPosition, yNationalPosition } = layout;
    const dots = layout.points.map((point) => {
      const title = `${point.name}：${point.details}`;
      return `<g class="scatter-point${point.selected ? ' is-selected' : ''}"${layout.isSupply ? ` role="button" tabindex="0" data-pref-slug="${point.slug}" aria-label="${title}"` : ''}><circle cx="${point.cx}" cy="${point.cy}" r="${point.r}"><title>${title}</title></circle>${point.selected ? `<text x="${point.labelX}" y="${point.labelY}">${point.name}</text>` : ''}</g>`;
    }).join('');

    if (layout.isSupply) {
      const grids = [
        ...layout.xTicks.map((tick) => `<line class="scatter-grid" x1="${tick.position}" y1="${top}" x2="${tick.position}" y2="${height - bottom}"/><text class="scatter-tick" x="${tick.position}" y="${height - bottom + 24}" text-anchor="middle">${tick.label}</text>`),
        ...layout.yTicks.map((tick) => `<line class="scatter-grid" x1="${left}" y1="${tick.position}" x2="${width - right}" y2="${tick.position}"/><text class="scatter-tick" x="${left - 12}" y="${tick.position + 4}" text-anchor="end">${tick.label}</text>`)
      ].join('');
      const quadrants = `
        <rect class="market-quadrant market-quadrant--slow-high" x="${left}" y="${top}" width="${Math.max(0, xNationalPosition - left)}" height="${Math.max(0, yNationalPosition - top)}"/>
        <rect class="market-quadrant market-quadrant--growth-high" x="${xNationalPosition}" y="${top}" width="${Math.max(0, width - right - xNationalPosition)}" height="${Math.max(0, yNationalPosition - top)}"/>
        <rect class="market-quadrant market-quadrant--slow-room" x="${left}" y="${yNationalPosition}" width="${Math.max(0, xNationalPosition - left)}" height="${Math.max(0, height - bottom - yNationalPosition)}"/>
        <rect class="market-quadrant market-quadrant--growth-room" x="${xNationalPosition}" y="${yNationalPosition}" width="${Math.max(0, width - right - xNationalPosition)}" height="${Math.max(0, height - bottom - yNationalPosition)}"/>
        <text class="quadrant-label" x="${left + 10}" y="${top + 20}">需要減速・高稼働</text>
        <text class="quadrant-label" x="${xNationalPosition + 10}" y="${top + 20}">需要成長・高稼働</text>
        <text class="quadrant-label" x="${left + 10}" y="${height - bottom - 12}">需要減速・稼働余力</text>
        <text class="quadrant-label" x="${xNationalPosition + 10}" y="${height - bottom - 12}">需要成長・稼働余力</text>`;
      target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${layout.ariaLabel}">${quadrants}${grids}<line class="scatter-axis" x1="${xNationalPosition}" y1="${top}" x2="${xNationalPosition}" y2="${height-bottom}"/><line class="scatter-axis" x1="${left}" y1="${yNationalPosition}" x2="${width-right}" y2="${yNationalPosition}"/><text class="national-label" x="${xNationalPosition + 7}" y="${height - bottom + 44}">全国 ${layout.nationalGrowthLabel}</text><text class="national-label" x="${left + 7}" y="${yNationalPosition - 8}">全国 ${layout.nationalOccupancyLabel}</text>${dots}<text class="scatter-x-label" x="${width-right}" y="${height-12}">${layout.xLabel}</text><text class="scatter-y-label" x="${left}" y="28">${layout.yLabel}</text></svg>`;
      target.querySelectorAll('[data-pref-slug]').forEach((point) => {
        const activate = () => selectPrefecture(point.dataset.prefSlug);
        point.addEventListener('click', activate);
        point.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        });
      });
      renderScatterTable(item);
      return;
    }
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${layout.ariaLabel}"><line class="scatter-axis" x1="${xNationalPosition}" y1="${top}" x2="${xNationalPosition}" y2="${height-bottom}"/><line class="scatter-axis" x1="${left}" y1="${yNationalPosition}" x2="${width-right}" y2="${yNationalPosition}"/>${dots}<text class="scatter-x-label" x="${width-right}" y="${height-12}">${layout.xLabel}</text><text class="scatter-y-label" x="${left}" y="25">${layout.yLabel}</text></svg>`;
  }

  function renderScatterTable(selected) {
    const target = $('scatter-table-body');
    if (!target) return;
    target.replaceChildren(...model.scatterTableRows(dataset, selected).map((entry) => {
      const row = document.createElement('tr');
      if (entry.selected) row.className = 'is-selected';
      row.innerHTML = `<th scope="row">${entry.name}</th><td>${entry.growth}</td><td>${entry.occupancy}</td><td>${entry.position}</td>`;
      return row;
    }));
  }

  function renderSupplyComparison(item) {
    const { position, ...texts } = model.supplyComparison(item, dataset.national);
    setTexts(texts);
  }

  function renderSupplyActions(item) {
    const target = $('market-actions');
    if (!target) return;
    const { lead, actions } = model.supplyActions(item, dataset.national);
    setText('market-action-lead', lead);
    target.replaceChildren(...actions.map((text) => {
      const itemNode = document.createElement('li');
      itemNode.textContent = text;
      return itemNode;
    }));
  }

  function render() {
    const item = selectedRecord();
    if (!item) return;
    updateUrl(item.prefecture_slug);
    updateRelatedLinks(item.prefecture_slug);
    setTexts(model.summaryTexts(type, item, dataset));
    renderBars(item);
    renderScatter(item);
    if (type === 'supply') {
      renderSupplyComparison(item);
      renderSupplyActions(item);
    }
    dashboard.hidden = false;
    dashboard.inert = false;
    dashboard.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('#prefecture-ranking li').forEach((li) => li.classList.toggle('is-selected', li.dataset.slug === item.prefecture_slug));
    if (globalThis.LabAnalytics) {
      globalThis.LabAnalytics.track('analysis_run', { tool_id: `cross-${type}`, prefecture_code: item.prefecture_code });
      globalThis.LabAnalytics.track('analysis_result_view', { tool_id: `cross-${type}`, dataset_version: dataset.metadata.retrieved_at.replaceAll('-', '') });
    }
  }

  function showError(message) {
    loading.hidden = true;
    error.hidden = false;
    error.innerHTML = `<strong>現在、最新統計を取得できません</strong><p>${message}</p><div class="analysis-actions"><button class="button button--outline" type="button" id="retry-data">再読み込みする</button><a class="button button--outline" href="https://www.mlit.go.jp/kankocho/tokei_hakusyo/shukuhakutokei.html" target="_blank" rel="noopener noreferrer">観光庁の出典を見る</a></div>`;
    $('retry-data').addEventListener('click', load);
    root.setAttribute('aria-busy', 'false');
    if (globalThis.LabAnalytics) globalThis.LabAnalytics.track('tool_error', { tool_id: `cross-${type}`, error_code: 'data_fetch' });
  }

  function renderSources() {
    setText('source-updated', dataset.metadata.retrieved_at);
    const target = $('source-list');
    target.replaceChildren(...model.sourceEntries(dataset.metadata).map((source) => {
      const div = document.createElement('div');
      div.innerHTML = `<dt>${source.name}</dt><dd><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.table} ↗</a><br><span>基準時点：${source.period}／公表日：${source.published}</span></dd>`;
      return div;
    }));
  }

  // ---- 取得 ----------------------------------------------------------

  async function load() {
    error.hidden = true;
    loading.hidden = false;
    try {
      const response = await fetch(config.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      dataset = model.validateDataset(await response.json());
      const rows = model.sortedRows(dataset);
      select.replaceChildren(new Option('都道府県を選択してください', ''), ...rows.map((item) => new Option(item.prefecture_name, item.prefecture_slug)));
      const requested = new URLSearchParams(location.search).get('pref');
      select.value = model.resolvePrefectureSlug(rows, requested);
      select.disabled = false;
      select.addEventListener('change', render, { passive: true });
      renderRanking();
      renderSources();
      loading.hidden = true;
      if (select.value) {
        render();
      } else {
        setText('analysis-period', model.emptyMessage(requested));
      }
      root.setAttribute('aria-busy', 'false');
    } catch (cause) {
      console.error(cause);
      showError('通信状況をご確認のうえ、時間をおいて再度お試しください。サンプル値は表示していません。');
    }
  }

  load();
})();
