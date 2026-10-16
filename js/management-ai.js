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
  const stale = $('management-stale');
  let datasets = null;

  // 入力欄の id と、ルールに渡す施設値の名前。
  const FACILITY_INPUTS = {
    type: ['facility-type'],
    rooms: ['facility-rooms'],
    employees: ['facility-employees'],
    occupancyRate: ['facility-occupancy'],
    foreignShare: ['facility-foreign-share', 'facility-foreign-basis']
  };
  const OPTIONAL_HINTS = {
    dx: '客室数と従業員数から参考値を表示できます',
    inbound: '外国人宿泊比率を地域値と参考比較できます',
    sales: '自施設の稼働率を地域値と参考比較できます',
    market: '施設タイプを結果に表示できます（判定には使いません）',
    other: '施設タイプを結果に表示できます（判定には使いません）'
  };
  const MORE_INPUT_GUIDES = {
    dx: '客室数と従業員数を入力すると、1従業員あたり客室数の参考値を表示します。',
    inbound: '外国人宿泊比率（延べ宿泊者数で数えた割合）を入力すると、地域値と並べて参考比較できます。',
    sales: '自施設の稼働率を入力すると、地域の客室稼働率と並べて参考比較できます。'
  };
  const PLACEHOLDERS = {
    dx: '例：フロント業務を効率化したい',
    inbound: '例：外国人のお客様が多い時期を知りたい',
    sales: '例：平日の稼働率が低い',
    market: '例：この地域の宿泊需要の特徴を知りたい',
    other: '例：何から考えればよいか分からない'
  };

  const RULE_LABELS = {
    'facility-occupancy-gap': '自施設の稼働率が地域値を10ポイント以上下回る',
    'facility-foreign-gap': '自施設の外国人宿泊比率が地域値を10ポイント以上下回る',
    'dx-high-workforce-decline': '省人化・DX参考スコアが比較的高く、生産年齢人口が減少傾向',
    'dx-operation-load': '従業者あたり宿泊需要が全国上位',
    'supply-tight-candidate': '市場タイプが「需給ひっ迫候補」',
    'market-growth': '宿泊需要伸び率が全国値を上回る',
    'inbound-market-opportunity': '外国人宿泊比率が全国値を上回る',
    'inbound-seasonality': '外国人宿泊の季節差（最多月÷最少月）が2倍以上で、全国の1.5倍以上',
    'inbound-concentration': '上位3つの国・地域の構成比が全国より10ポイント以上高い',
    'inbound-domestic-complement': '外国人の割合が最も高い月が、1年間の割合の1.5倍以上かつ5ポイント以上高く、その月の国内客が年平均を下回る',
    'sales-seasonal-gap': '客室稼働率の最も高い月と低い月の差が、全国の差の1.5倍以上',
    'dx-seasonal-workload': '延べ宿泊者数の最多月が最少月を上回る幅が、全国の2倍以上',
    'market-peak-full': '客室稼働率が最も高い月で75%以上',
    'market-peak-slack': '客室稼働率が最も高い月でも60%未満',
    'tourism-context': '観光負荷または観光依存度の参考スコアが比較的高い'
  };

  function analytics(eventName, parameters = {}) {
    if (globalThis.LabAnalytics) globalThis.LabAnalytics.track(eventName, parameters);
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

  // 選んだテーマで表示している項目だけを読む。非表示の項目に残った値は判定に使わない。
  function facilityValues(topic = selectedTopic()) {
    const fields = Rules.FACILITY_FIELDS[topic] || [];
    const values = {};
    if (fields.includes('type')) values.type = $('facility-type').value || null;
    if (fields.includes('rooms')) values.rooms = numericValue('facility-rooms');
    if (fields.includes('employees')) values.employees = numericValue('facility-employees');
    if (fields.includes('occupancyRate')) values.occupancyRate = numericValue('facility-occupancy');
    if (fields.includes('foreignShare')) {
      values.foreignShare = numericValue('facility-foreign-share');
      values.foreignShareBasis = $('facility-foreign-basis').value || null;
    }
    return values;
  }

  function renderExamples(topic) {
    const container = $('management-examples');
    container.replaceChildren(...(Rules.TOPIC_EXAMPLES[topic] || []).map((example) => {
      const button = element('button', '', example.text);
      button.type = 'button';
      button.dataset.questionExample = '';
      button.dataset.topic = topic;
      button.addEventListener('click', () => {
        question.value = example.text;
        markStale();
        question.focus();
      });
      return button;
    }));
  }

  function selectedPrefectureName() {
    return prefectureSelect.selectedOptions[0]?.textContent || '';
  }

  function renderSelection(topic) {
    const node = $('management-selection');
    const pref = element('b', '', selectedPrefectureName());
    const label = element('b', '', Rules.TOPICS[topic].label);
    node.replaceChildren('選択中の条件：', pref, ' × ', label);
  }

  // 相談テーマに合わせて、任意項目・質問例・入力例・選択中の条件を切り替える。
  function applyTopic(topic) {
    const fields = Rules.FACILITY_FIELDS[topic] || [];
    document.querySelectorAll('[data-facility-field]').forEach((wrapper) => {
      const active = fields.includes(wrapper.dataset.facilityField);
      wrapper.hidden = !active;
      (FACILITY_INPUTS[wrapper.dataset.facilityField] || []).forEach((id) => { $(id).disabled = !active; });
    });
    setText('management-optional-hint', OPTIONAL_HINTS[topic]);
    question.placeholder = PLACEHOLDERS[topic];
    renderExamples(topic);
    renderSelection(topic);
  }

  // 結果を表示したあとに条件が変わったら、古い結果であることを示す。
  function markStale() {
    if (!result.hidden) stale.hidden = false;
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
      if (row.note) card.append(element('p', 'management-comparison-card__note', row.note));
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
      ['国・地域別構成', `${inboundMeta.year}年${inboundMeta.month}月（${inboundMeta.release_type}・${inboundMeta.survey_scope}）`],
      ...(context.monthlyProfile ? [['月別の宿泊統計', `${context.monthlyProfile.period}（${context.datasets.monthly.metadata.release_type}・${context.monthlyProfile.basisLabel}）`]] : []),
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
      ? answer.matchedRules.map((id) => `${id}：${RULE_LABELS[id] || '条件一致'}`)
      : ['該当する条件なし：選択テーマの基本案内を表示'];
    replaceList('answer-rules', rules, (text) => element('li', '', text));
    setText('answer-rule-version', Rules.RULE_VERSION);
    setText('answer-methodology-note', context.datasets.statistics.metadata?.methodology_note || '');

    const sources = context.datasets.dx.metadata.sources;
    const sourceRows = [sources.lodging, ...(context.monthlyProfile ? [context.datasets.monthly.metadata] : []), sources.population, sources.economic_census];
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

  function renderLead(answer) {
    setText('answer-lead-title', answer.lead.title);
    setText('answer-lead-note', answer.lead.note);
    const basis = [answer.lead.ruleId ? (RULE_LABELS[answer.lead.ruleId] || '条件一致') : '該当する個別ルールなし（テーマの基本案内）', ...answer.lead.evidence];
    setText('answer-lead-basis', basis.join('／'));
  }

  function renderPerspectives(answer) {
    const container = $('answer-perspectives');
    const checklist = $('answer-checklist');
    if (!answer.perspectives) {
      container.hidden = true;
      container.replaceChildren();
      checklist.hidden = false;
      replaceList('answer-checklist', answer.checklist, (text) => element('li', '', text));
      return;
    }
    checklist.hidden = true;
    checklist.replaceChildren();
    container.hidden = false;
    replaceList('answer-perspectives', answer.perspectives, (item) => {
      const article = element('article', `management-perspective management-perspective--${item.status}`);
      const heading = element('h4');
      heading.append(element('span', 'management-perspective__number', item.number), element('span', '', item.title));
      article.append(heading);
      const region = element('div', 'management-perspective__region');
      region.append(element('p', 'management-perspective__label', item.status === 'self-check' ? '公的統計' : '地域データ'));
      if (item.status === 'data') {
        const list = element('dl', 'management-perspective__data');
        item.data.lines.forEach((line) => {
          const row = element('div');
          row.append(element('dt', '', line.label), element('dd', '', line.value));
          list.append(row);
        });
        region.append(list, element('p', 'management-perspective__note', item.data.note));
      } else if (item.status === 'missing') {
        region.append(element('p', 'management-perspective__empty', `データなし：${item.missing}`));
      } else {
        region.append(element('p', 'management-perspective__empty', item.selfCheck));
      }
      const checks = element('div', 'management-perspective__checks');
      checks.append(element('p', 'management-perspective__label', '自施設で確認すること'));
      const list = element('ul');
      item.checks.forEach((text) => list.append(element('li', '', text)));
      checks.append(list);
      article.append(region, checks);
      return article;
    });
  }

  function renderMonthly(answer, context) {
    const wrapper = $('answer-monthly');
    const seasons = answer.seasons;
    if (!seasons || !seasons.rows.length) {
      wrapper.hidden = true;
      return;
    }
    wrapper.hidden = false;
    setText('answer-monthly-title', `月別の外国人延べ宿泊者数（${context.name}・${seasons.period}）`);
    const peaks = new Map();
    seasons.segments.forEach((segment) => {
      if (segment.peak) peaks.set(`${segment.peak.year}-${segment.peak.month}`, '多い月');
      if (segment.low) peaks.set(`${segment.low.year}-${segment.low.month}`, '少ない月');
    });
    const rows = [];
    seasons.segments.forEach((segment) => {
      segment.months.forEach((month) => {
        const row = element('tr');
        const mark = peaks.get(`${month.year}-${month.month}`);
        const label = element('th', '', `${month.year}年${month.month}月`);
        label.scope = 'row';
        const value = element('td', '', Rules.formatNumber(month.foreign_guest_nights) + (typeof month.foreign_guest_nights === 'number' ? '人泊' : ''));
        if (mark) value.append(element('span', 'management-monthly-mark', mark));
        row.append(label, value, element('td', '', month.survey_scope || '—'));
        rows.push(row);
      });
    });
    $('answer-monthly-body').replaceChildren(...rows);
    setText('answer-monthly-note', seasons.scopeChanged
      ? '多い月・少ない月は、集計対象が同じ期間の中で比べています。2026年1月から宿泊旅行統計調査の集計・層化基準が変わったため、前後の期間の値をそのまま比べないでください。'
      : '単位は人泊（1人が2泊すると2人泊）です。');
  }

  // 月別の宿泊者数・客室稼働率（宿泊旅行統計調査 第2表・第8表）。インバウンドと売上・稼働で列を変える。
  function renderLodgingTable(answer) {
    const wrapper = $('answer-lodging');
    const table = answer.lodgingTable;
    if (!table) {
      wrapper.hidden = true;
      return;
    }
    wrapper.hidden = false;
    const titles = {
      inbound: `月別の国内客と外国人の延べ宿泊者数（${table.period}）`,
      sales: `月別の客室稼働率（${table.period}）`,
      dx: `月別の延べ宿泊者数（${table.period}）`,
      market: `月別の延べ宿泊者数と客室稼働率（${table.period}）`
    };
    setText('answer-lodging-title', titles[table.topic]);
    const headings = {
      inbound: ['月', '国内客', '外国人', '外国人の割合'],
      sales: ['月', '客室稼働率', '全国', '全国との差'],
      dx: ['月', '延べ宿泊者数', '年平均との比'],
      market: ['月', '延べ宿泊者数', '客室稼働率', '全国の稼働率']
    }[table.topic];
    $('answer-lodging-head').replaceChildren(...headings.map((text) => {
      const cell = element('th', '', text);
      cell.scope = 'col';
      return cell;
    }));
    const signed = (value) => typeof value === 'number' ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Rules.formatNumber(Math.abs(value), 1)}pt` : 'データなし';
    $('answer-lodging-body').replaceChildren(...table.rows.map((row) => {
      const tr = element('tr');
      const label = element('th', '', `${row.month}月`);
      label.scope = 'row';
      row.marks.forEach((mark) => label.append(element('span', 'management-monthly-mark', mark)));
      const values = {
        inbound: () => [`${Rules.formatNumber(row.domestic)}`, `${Rules.formatNumber(row.foreign)}`, Rules.formatPercent(row.share)],
        sales: () => [Rules.formatRate1(row.occupancy), Rules.formatRate1(row.nationalOccupancy),
          signed(typeof row.occupancy === 'number' && typeof row.nationalOccupancy === 'number' ? Math.round((row.occupancy - row.nationalOccupancy) * 10) / 10 : null)],
        dx: () => [Rules.formatNumber(row.total), typeof row.total === 'number' && table.demandMean ? Rules.formatPercent(row.total / table.demandMean, 0) : 'データなし'],
        market: () => [Rules.formatNumber(row.total), Rules.formatRate1(row.occupancy), Rules.formatRate1(row.nationalOccupancy)]
      }[table.topic]();
      tr.append(label, ...values.map((text) => element('td', '', text)));
      if (row.marks.length) tr.classList.add('is-marked');
      return tr;
    }));
    const basis = `${table.basisLabel}で12か月そろう最新の期間`;
    setText('answer-lodging-note', {
      inbound: `単位は人泊。宿泊旅行統計調査 第2表の月別値（${basis}）。国内客は延べ宿泊者数から外国人を除いた値で、日本に住む外国人を含みます。国籍別の集計表より対象施設が広いため、上の表の外国人の値とは一致しません。`,
      sales: `宿泊旅行統計調査 第8表の月別値（${basis}）。2026年1月から集計・層化基準が変わったため、基準が異なる月どうしは比べていません。`,
      dx: `単位は人泊。宿泊旅行統計調査 第2表の月別値（${basis}）。年平均との比は、12か月の平均を100%とした値です。`,
      market: `延べ宿泊者数（単位は人泊）は第2表、客室稼働率は第8表の月別値（${basis}）。2026年1月から集計・層化基準が変わったため、基準が異なる月どうしは比べていません。`
    }[table.topic]);
  }

  function renderAnswer(context, answer, facility) {
    setText('answer-prefecture', context.name);
    setText('answer-topic', answer.topicLabel);
    setText('answer-scope', `${context.name}全体の公的統計${answer.facilityType ? `／施設タイプ：${answer.facilityType}（入力値）` : ''}`);
    const guide = $('answer-question-guide');
    guide.hidden = !answer.questionGuide;
    guide.textContent = answer.questionGuide ? answer.questionGuide.text : '';

    renderLead(answer);
    renderPerspectives(answer);

    setText('answer-status', answer.status);
    replaceList('answer-facts', answer.facts, (fact) => {
      const item = element('li');
      const body = element('span', 'management-fact-body');
      body.append(element('span', '', fact.text));
      if (fact.note) body.append(element('small', 'management-fact-note', fact.note));
      item.append(element('span', 'management-fact-symbol', fact.symbol), body);
      return item;
    });
    replaceList('answer-hypotheses', answer.trendNotes, (text) => element('p', '', text));
    setText('answer-region-note', answer.regionNote);

    const next = $('answer-next');
    const inboundTool = answer.relatedTools.find((tool) => tool.href.startsWith('inbound-analysis.html'));
    next.hidden = answer.topic !== 'inbound' || !inboundTool;
    if (!next.hidden) $('answer-next-link').href = inboundTool.href;

    const related = answer.topic === 'inbound' ? answer.relatedTools.filter((tool) => tool !== inboundTool) : answer.relatedTools;
    replaceList('answer-related', related, (tool) => {
      const item = element('li');
      const link = element('a', '', `${tool.number} ${tool.label} →`);
      link.href = tool.href;
      link.dataset.relatedTool = tool.number;
      link.addEventListener('click', () => analytics('tool_open', { tool_id: `related-${tool.number}` }));
      item.append(link);
      return item;
    });

    renderMonthly(answer, context);
    renderLodgingTable(answer);
    renderComparisons(answer.comparisons, context.name);
    renderDataPeriods(context);
    renderGrounds(answer, context);

    const guideText = MORE_INPUT_GUIDES[answer.topic];
    const hasOptionalData = Object.entries(facility).some(([key, value]) => key !== 'foreignShareBasis' && value != null && value !== '');
    $('more-input-guide').hidden = !guideText || hasOptionalData;
    setText('more-input-guide', guideText || '');
    const missingNote = $('missing-data-note');
    if (answer.missing.length) {
      missingNote.textContent = `${answer.missing.join('、')}は現在データを取得できないため、今回の分析には使用していません。`;
      missingNote.hidden = false;
    } else {
      missingNote.hidden = true;
      missingNote.textContent = '';
    }

    stale.hidden = true;
    result.hidden = false;
    result.inert = false;
    result.focus({ preventScroll: true });
    result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function analyze() {
    if (!datasets || !form.reportValidity()) return;
    const context = Rules.getRegionContext(datasets, prefectureSelect.value);
    if (!context) return showError('選択した地域の統計を確認できません。時間をおいて再度お試しください。');
    const topic = selectedTopic();
    const facility = facilityValues(topic);
    const answer = Rules.generateInsights(context, topic, facility, question.value.trim());
    updateUrl(context.slug, topic);
    renderAnswer(context, answer, facility);
    analytics('analysis_run', { tool_id: 'management-issue-organizer', prefecture_code: context.statistics.prefecture_code });
    analytics('analysis_result_view', { tool_id: 'management-issue-organizer', dataset_version: context.datasets.dx.metadata.retrieved_at.replaceAll('-', '') });
  }

  function showError(message) {
    loading.hidden = true;
    error.textContent = message;
    error.hidden = false;
    fields.disabled = true;
    result.hidden = true;
    result.inert = true;
    root.setAttribute('aria-busy', 'false');
  }

  // 共通の出典ブロック（_includes/tool-sources.html）を地域統計の出典で埋める。
  function renderSourceBlock() {
    const list = $('source-list');
    const sources = datasets.dx.metadata.sources;
    if (list) {
      list.replaceChildren(...[sources.lodging, ...(datasets.monthly ? [datasets.monthly.metadata] : []), sources.population, sources.economic_census].map((source) => {
        const row = element('div');
        const link = element('a', '', `${source.table_name} ↗`);
        link.href = source.source_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const detail = element('dd');
        detail.append(link, element('span', '', `基準時点：${source.reference_period}／公表日：${source.published_date || '各月公表'}`));
        row.append(element('dt', '', source.source_name), detail);
        return row;
      }));
    }
    const updated = $('source-updated');
    if (updated) updated.textContent = datasets.dx.metadata.retrieved_at;
  }

  function initialize() {
    renderSourceBlock();
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
    applyTopic(topic);

    loading.hidden = true;
    fields.disabled = false;
    root.setAttribute('aria-busy', 'false');
    analytics('tool_open', { tool_id: 'management-issue-organizer' });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    analyze();
  });
  prefectureSelect.addEventListener('change', () => {
    updateUrl(prefectureSelect.value, selectedTopic());
    renderSelection(selectedTopic());
    markStale();
  });
  form.querySelectorAll('input[name="topic"]').forEach((radio) => radio.addEventListener('change', () => {
    updateUrl(prefectureSelect.value, radio.value);
    applyTopic(radio.value);
    markStale();
  }));
  form.querySelector('.management-optional').addEventListener('input', markStale);
  question.addEventListener('input', markStale);

  Promise.all([
    fetch('data/analysis/prefecture-statistics.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('statistics'))),
    fetch('data/analysis/dx-necessity.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('dx'))),
    fetch('data/analysis/supply-demand-gap.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('supply'))),
    fetch('data/analysis/tourism-pressure.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('tourism'))),
    fetch('data/inbound/latest.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('inbound'))),
    // 月別の値は補助的な材料のため、取得できなくても他の結果は表示する（該当する判定と表だけを出さない）。
    fetch('data/analysis/lodging-monthly.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).catch(() => null)
  ]).then(([statistics, dx, supply, tourism, inbound, monthly]) => {
    datasets = { statistics, dx, supply, tourism, inbound, monthly };
    initialize();
  }).catch(() => showError('現在、地域統計を取得できません。時間をおいて再度お試しください。'));
})();
