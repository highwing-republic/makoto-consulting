(() => {
  'use strict';

  const Rules = globalThis.ManagementAIRules;
  const root = document.querySelector('[data-management-ai]');
  if (!Rules || !root) return;

  const $ = (id) => document.getElementById(id);
  const form = $('management-ai-form');
  const fields = $('management-fields');
  const prefectureSelect = $('management-prefecture');
  const question = $('management-question');
  const loading = $('management-loading');
  const error = $('management-error');
  const result = $('management-result');
  let datasets = null;

  const RULE_LABELS = {
    'facility-occupancy-gap': '自施設の稼働率が地域値を10ポイント以上下回る',
    'facility-foreign-gap': '自施設の外国人宿泊比率が地域値を10ポイント以上下回る',
    'dx-high-workforce-decline': 'DX必要度が比較的高く、生産年齢人口が減少傾向',
    'dx-operation-load': '従業者あたり宿泊需要が全国上位',
    'supply-tight-candidate': '市場タイプが「需給ひっ迫候補」',
    'market-growth': '宿泊需要伸び率が全国値を上回る',
    'inbound-market-opportunity': '外国人宿泊比率が全国値を上回る',
    'tourism-context': '観光負荷または観光依存度の参考スコアが比較的高い'
  };

  function analytics(eventName, parameters = {}) {
    if (typeof globalThis.gtag === 'function') globalThis.gtag('event', eventName, parameters);
  }

  function updateUrl(pref, topic) {
    const url = new URL(window.location.href);
    url.searchParams.set('pref', pref);
    url.searchParams.set('topic', topic);
    history.replaceState(null, '', url);
  }

  function selectedTopic() {
    return form.elements.topic.value || 'dx';
  }

  function numericValue(id) {
    const input = $(id);
    if (!input || input.value.trim() === '') return null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : null;
  }

  function facilityValues() {
    return {
      type: $('facility-type').value || null,
      rooms: numericValue('facility-rooms'),
      employees: numericValue('facility-employees'),
      occupancyRate: numericValue('facility-occupancy'),
      foreignShare: numericValue('facility-foreign-share')
    };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function replaceList(id, items, builder) {
    const target = $(id);
    target.replaceChildren(...items.map(builder));
  }

  function renderComparisons(comparisons, prefectureName) {
    const section = $('facility-comparison-section');
    if (!comparisons.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    setText('comparison-region-name', prefectureName);
    replaceList('facility-comparisons', comparisons, (row) => {
      const card = element('article', 'management-comparison-card');
      card.append(element('h4', '', row.label));
      const grid = element('dl', 'management-comparison-grid');
      [['あなたの施設', row.facility], [prefectureName, row.region], ['差・参考', row.difference]].forEach(([label, value]) => {
        const wrapper = element('div');
        wrapper.append(element('dt', '', label), element('dd', '', value));
        grid.append(wrapper);
      });
      card.append(grid);
      return card;
    });
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value ?? '';
  }

  function renderDataPeriods(context) {
    const sources = context.datasets.dx.metadata.sources;
    const inboundMeta = context.datasets.inbound.metadata;
    const rows = [
      ['宿泊旅行統計', `${sources.lodging.reference_period}（${sources.lodging.release_type}）`],
      ['国・地域別構成', `${inboundMeta.year}年${inboundMeta.month}月（${inboundMeta.release_type}）`],
      ['人口推計', sources.population.reference_period],
      ['経済センサス', sources.economic_census.reference_period]
    ];
    replaceList('answer-data-periods', rows, ([label, value]) => {
      const row = element('div');
      row.append(element('dt', '', label), element('dd', '', value));
      return row;
    });
  }

  function renderGrounds(answer, context) {
    replaceList('answer-references', answer.references, (text) => element('li', '', text));
    replaceList('answer-metrics', answer.usedMetrics, (text) => element('li', '', text));
    const rules = answer.matchedRules.length
      ? answer.matchedRules.map((id) => RULE_LABELS[id] || id)
      : ['選択テーマに対応する基本案内を表示'];
    replaceList('answer-rules', rules, (text) => element('li', '', text));

    const sources = context.datasets.dx.metadata.sources;
    const sourceRows = [sources.lodging, sources.population, sources.economic_census];
    replaceList('answer-sources', sourceRows, (source) => {
      const item = element('li');
      const link = element('a', '', `${source.source_name}｜${source.table_name}`);
      link.href = source.source_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(link);
      return item;
    });
  }

  function renderAnswer(context, answer, facility) {
    setText('answer-prefecture', context.name);
    setText('answer-topic', answer.topicLabel);
    setText('answer-status', answer.status);

    replaceList('answer-facts', answer.facts, (fact) => {
      const item = element('li');
      item.append(element('span', 'management-fact-symbol', fact.symbol), element('span', '', fact.text));
      return item;
    });
    replaceList('answer-hypotheses', answer.hypotheses, (text) => element('p', '', text));
    replaceList('answer-checklist', answer.checklist, (text) => element('li', '', text));
    replaceList('answer-related', answer.relatedTools, (tool) => {
      const item = element('li');
      const link = element('a', '', `${tool.number} ${tool.label} →`);
      link.href = tool.href;
      link.dataset.relatedTool = tool.number;
      link.addEventListener('click', () => analytics('management_ai_related_tool_click', {
        tool_number: tool.number,
        topic: answer.topic,
        prefecture: context.slug
      }));
      item.append(link);
      return item;
    });

    renderComparisons(answer.comparisons, context.name);
    renderDataPeriods(context);
    renderGrounds(answer, context);

    const hasOptionalData = Object.values(facility).some((value) => value != null && value !== '');
    $('more-input-guide').hidden = hasOptionalData;
    const missingNote = $('missing-data-note');
    if (answer.missing.length) {
      missingNote.textContent = `${answer.missing.join('、')}は現在データを取得できないため、今回の分析には使用していません。`;
      missingNote.hidden = false;
    } else {
      missingNote.hidden = true;
      missingNote.textContent = '';
    }

    result.hidden = false;
    result.inert = false;
    result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function analyze() {
    if (!datasets || !form.reportValidity()) return;
    const context = Rules.getRegionContext(datasets, prefectureSelect.value);
    if (!context) return showError('選択した地域の統計を確認できません。時間をおいて再度お試しください。');
    const topic = selectedTopic();
    const facility = facilityValues();
    const answer = Rules.generateInsights(context, topic, facility, question.value.trim());
    updateUrl(context.slug, topic);
    renderAnswer(context, answer, facility);
    analytics('management_ai_analyze', {
      topic,
      prefecture: context.slug,
      has_facility_data: Object.values(facility).some((value) => value != null && value !== '')
    });
  }

  function showError(message) {
    loading.hidden = true;
    error.textContent = message;
    error.hidden = false;
    fields.disabled = true;
  }

  function initialize() {
    const rows = Object.values(datasets.statistics.prefectures).sort((a, b) => a.prefecture_code.localeCompare(b.prefecture_code));
    prefectureSelect.replaceChildren(...rows.map((row) => {
      const option = element('option', '', row.prefecture_name);
      option.value = row.prefecture_slug;
      return option;
    }));

    const params = new URLSearchParams(window.location.search);
    const slug = Rules.resolvePrefectureSlug(datasets.statistics.prefectures, params.get('pref'));
    const topic = Rules.TOPICS[params.get('topic')] ? params.get('topic') : 'dx';
    prefectureSelect.value = slug;
    const topicRadio = form.querySelector(`input[name="topic"][value="${topic}"]`);
    if (topicRadio) topicRadio.checked = true;
    updateUrl(slug, topic);

    loading.hidden = true;
    fields.disabled = false;
    root.setAttribute('aria-busy', 'false');
    analytics('management_ai_start', { prefecture: slug });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    analyze();
  });
  prefectureSelect.addEventListener('change', () => updateUrl(prefectureSelect.value, selectedTopic()));
  form.querySelectorAll('input[name="topic"]').forEach((radio) => radio.addEventListener('change', () => {
    updateUrl(prefectureSelect.value, radio.value);
    analytics('management_ai_topic_select', { topic: radio.value, prefecture: prefectureSelect.value });
  }));
  document.querySelectorAll('[data-question-example]').forEach((button) => button.addEventListener('click', () => {
    question.value = button.textContent.trim();
    const topic = button.dataset.topic;
    const radio = form.querySelector(`input[name="topic"][value="${topic}"]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    question.focus();
  }));

  Promise.all([
    fetch('data/analysis/prefecture-statistics.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('statistics'))),
    fetch('data/analysis/dx-necessity.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('dx'))),
    fetch('data/analysis/supply-demand-gap.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('supply'))),
    fetch('data/analysis/tourism-pressure.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('tourism'))),
    fetch('data/inbound/latest.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('inbound')))
  ]).then(([statistics, dx, supply, tourism, inbound]) => {
    datasets = { statistics, dx, supply, tourism, inbound };
    initialize();
  }).catch(() => showError('現在、地域統計を取得できません。時間をおいて再度お試しください。'));
})();
