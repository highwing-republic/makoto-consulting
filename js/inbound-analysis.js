/*
 * 都道府県別インバウンド宿泊者分析の画面側。
 * データ取得・選択状態・DOM 描画だけを担当し、計算・判定・文言は
 * inbound-analysis-model.js（InboundAnalysisModel）から受け取る。
 */
(function () {
  'use strict';

  const model = globalThis.InboundAnalysisModel;
  if (!model || typeof document === 'undefined') return;

  const byId = function (id) { return document.getElementById(id); };
  let dataset = null;

  // ---- 状態 ----------------------------------------------------------

  function populateSelector(selectedArea) {
    const select = byId('prefecture-select');
    select.textContent = '';
    model.selectorOptions(dataset, selectedArea).forEach(function (entry) {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    select.value = selectedArea;
    select.disabled = false;
  }

  function updateUrl(area) {
    const url = new URL(window.location.href);
    const slug = model.areaSlug(area);
    if (slug) url.searchParams.set('pref', slug);
    else url.searchParams.delete('pref');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  function showDashboard(visible) {
    const dashboard = byId('analysis-dashboard');
    dashboard.hidden = !visible;
    dashboard.inert = !visible;
    if (visible) dashboard.removeAttribute('aria-hidden');
    else dashboard.setAttribute('aria-hidden', 'true');
  }

  // ---- 描画 ----------------------------------------------------------

  function setTexts(texts) {
    Object.keys(texts).forEach(function (id) { byId(id).textContent = texts[id]; });
  }

  function renderKpis(area, record, markets) {
    const kpis = model.kpiTexts(area, record, markets, dataset.national);
    setTexts(kpis.texts);
    Object.keys(kpis.status).forEach(function (id) { byId(id).classList.toggle('kpi-value--status', kpis.status[id]); });
  }

  function createSvgElement(name, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderTrend(area, monthly) {
    const container = byId('trend-chart');
    const valuesContainer = byId('trend-values');
    container.textContent = '';
    valuesContainer.textContent = '';
    const layout = model.trendLayout(area, monthly);
    if (layout.empty) {
      container.textContent = layout.empty;
      return;
    }
    const svg = createSvgElement('svg', { viewBox: layout.viewBox, 'aria-hidden': 'true', focusable: 'false' });
    layout.grid.forEach(function (line) {
      svg.appendChild(createSvgElement('line', { x1: line.x1, y1: line.y, x2: line.x2, y2: line.y, class: 'trend-grid-line' }));
      svg.appendChild(createSvgElement('text', { x: line.labelX, y: line.labelY, class: 'trend-axis-label', 'text-anchor': 'end' }, line.label));
    });
    layout.bars.forEach(function (item) {
      const bar = createSvgElement('rect', { x: item.x, y: item.y, width: item.width, height: item.height, class: 'trend-bar' });
      bar.appendChild(createSvgElement('title', {}, item.title));
      svg.appendChild(bar);
      svg.appendChild(createSvgElement('text', { x: item.axisX, y: item.axisY, class: 'trend-axis-label', 'text-anchor': 'middle' }, item.axisLabel));
      if (item.boundary) {
        svg.appendChild(createSvgElement('line', { x1: item.boundary.x, y1: item.boundary.y1, x2: item.boundary.x, y2: item.boundary.y2, class: 'trend-boundary-line' }));
        svg.appendChild(createSvgElement('text', { x: item.boundary.labelX, y: item.boundary.labelY, class: 'trend-boundary-label' }, item.boundary.label));
      }
      const valueItem = document.createElement('div');
      const label = document.createElement('span');
      const strong = document.createElement('strong');
      label.textContent = item.valueLabel;
      strong.textContent = item.valueText;
      valueItem.append(label, strong);
      valuesContainer.appendChild(valueItem);
    });
    container.setAttribute('aria-label', layout.ariaLabel);
    container.appendChild(svg);
  }

  function renderRanking(markets) {
    const list = byId('market-ranking');
    list.textContent = '';
    model.rankingRows(markets).forEach(function (row) {
      const item = document.createElement('li');
      const rank = document.createElement('span');
      const details = document.createElement('div');
      const heading = document.createElement('div');
      const name = document.createElement('strong');
      const value = document.createElement('span');
      const bar = document.createElement('span');
      const fill = document.createElement('span');
      rank.className = 'market-rank';
      rank.textContent = row.rank;
      details.className = 'market-ranking__details';
      heading.className = 'market-ranking__heading';
      name.textContent = row.name;
      value.textContent = row.value;
      bar.className = 'market-bar';
      fill.style.width = row.width;
      bar.appendChild(fill);
      heading.append(name, value);
      details.append(heading, bar);
      item.append(rank, details);
      list.appendChild(item);
    });
  }

  function renderCandidates(markets) {
    const list = byId('candidate-list');
    list.textContent = '';
    model.candidates(markets).forEach(function (candidate) {
      const item = document.createElement('li');
      const number = document.createElement('span');
      const content = document.createElement('div');
      const heading = document.createElement('div');
      const title = document.createElement('strong');
      const score = document.createElement('span');
      const reason = document.createElement('p');
      number.className = 'candidate-number';
      number.textContent = candidate.number;
      title.textContent = candidate.name;
      score.textContent = candidate.score;
      reason.textContent = candidate.reason;
      heading.append(title, score);
      content.append(heading, reason);
      item.append(number, content);
      list.appendChild(item);
    });
  }

  function renderComparison(markets) {
    const body = byId('comparison-body');
    body.textContent = '';
    model.comparisonRows(markets).forEach(function (entry) {
      const row = document.createElement('tr');
      entry.cells.forEach(function (item, index) {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row';
        cell.dataset.label = item[0];
        cell.textContent = item[1];
        row.appendChild(cell);
      });
      const specializationCell = document.createElement('td');
      const badge = document.createElement('span');
      specializationCell.dataset.label = '地域特化度';
      badge.className = entry.specializationClass;
      badge.textContent = entry.specialization;
      specializationCell.appendChild(badge);
      row.appendChild(specializationCell);
      body.appendChild(row);
    });
  }

  function renderInsight(area, markets) {
    const container = byId('short-insight');
    container.textContent = '';
    model.insightTexts(area, markets).forEach(function (text) {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      container.appendChild(paragraph);
    });
  }

  function renderArea(area, updateAddress) {
    const record = model.areaRecord(dataset, area);
    if (!record) return;
    const markets = model.marketRows(record, dataset.national);
    setTexts(model.headerTexts(dataset));
    renderKpis(area, record, markets);
    renderTrend(area, record.monthly);
    renderRanking(markets);
    renderCandidates(markets);
    renderComparison(markets);
    renderInsight(area, markets);
    if (updateAddress) updateUrl(area);
    if (globalThis.LabAnalytics) {
      globalThis.LabAnalytics.track('analysis_run', { tool_id: 'inbound', prefecture_code: model.areaCode(area) });
      globalThis.LabAnalytics.track('analysis_result_view', { tool_id: 'inbound', dataset_version: String(dataset.metadata.updated_at).replaceAll('-', '') });
    }
  }

  function renderSources() {
    const list = byId('source-list');
    if (list) {
      list.replaceChildren.apply(list, model.sourceEntries(dataset.metadata).map(function (entry) {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = entry.name;
        if (entry.url) {
          const link = document.createElement('a');
          link.href = entry.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = entry.text;
          detail.appendChild(link);
        } else {
          detail.textContent = entry.text;
        }
        row.append(term, detail);
        return row;
      }));
    }
    byId('source-updated').textContent = model.sourceUpdated(dataset.metadata);
  }

  function showError(error) {
    console.error(error);
    const errorPanel = byId('data-error');
    const title = document.createElement('strong');
    const message = document.createElement('p');
    const retry = document.createElement('button');
    const source = document.createElement('a');
    title.textContent = '現在、最新統計を取得できません';
    message.textContent = '時間をおいて再度お試しください。統計を取得できない場合は数値を表示しません。';
    retry.className = 'button button--outline';
    retry.type = 'button';
    retry.textContent = '再読み込みする';
    retry.addEventListener('click', loadData);
    source.className = 'button button--outline';
    source.href = 'https://www.mlit.go.jp/kankocho/tokei_hakusyo/shukuhakutokei.html';
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = '観光庁の出典を見る';
    errorPanel.replaceChildren(title, message, retry, source);
    byId('data-loading').hidden = true;
    showDashboard(false);
    errorPanel.hidden = false;
    byId('analysis-period').textContent = '最新統計を取得できません';
    byId('prefecture-select').disabled = true;
    byId('tool').setAttribute('aria-busy', 'false');
    if (globalThis.LabAnalytics) globalThis.LabAnalytics.track('tool_error', { tool_id: 'inbound', error_code: 'data_fetch' });
  }

  // ---- 取得 ----------------------------------------------------------

  function loadData() {
    const errorPanel = byId('data-error');
    errorPanel.hidden = true;
    errorPanel.replaceChildren();
    byId('data-loading').hidden = false;
    showDashboard(false);
    byId('analysis-period').textContent = '';
    byId('tool').setAttribute('aria-busy', 'true');
    return fetch('data/inbound/latest.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('統計JSONの取得に失敗しました。');
        return response.json();
      })
      .then(function (data) {
        dataset = model.validateDataset(data);
        const selectedArea = model.resolveArea(new URLSearchParams(window.location.search).get('pref'));
        populateSelector(selectedArea);
        renderSources();
        byId('data-loading').hidden = true;
        if (selectedArea) {
          renderArea(selectedArea, false);
          showDashboard(true);
        } else {
          byId('analysis-period').textContent = model.emptyMessage();
        }
        byId('tool').setAttribute('aria-busy', 'false');
      })
      .catch(showError);
  }

  document.addEventListener('DOMContentLoaded', function () {
    byId('prefecture-select').addEventListener('change', function (event) {
      if (!event.target.value) return;
      renderArea(event.target.value, true);
      showDashboard(true);
    });
    loadData();
  });
})();
