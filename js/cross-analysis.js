(() => {
  'use strict';

  function resolvePrefectureSlug(rows, requested, fallback = '') {
    if (!requested) return fallback;
    const match = rows.find((item) => item.prefecture_slug === requested || item.prefecture_code === String(requested).padStart(2, '0'));
    return match ? match.prefecture_slug : fallback;
  }
  globalThis.CrossAnalysisUtils = { resolvePrefectureSlug };
  if (typeof document === 'undefined') return;

  const root = document.querySelector('[data-cross-analysis]');
  if (!root) return;

  const type = root.dataset.crossAnalysis;
  const configs = {
    dx: {
      url: 'data/analysis/dx-necessity.json',
      scoreKey: 'score', rankKey: 'rank',
      labels: ['需要伸び率', '客室稼働率', '宿泊運営負荷', '生産年齢人口の減少'],
      percentileKeys: ['demand_growth', 'occupancy', 'lodging_operation_load', 'workforce_decline']
    },
    supply: {
      url: 'data/analysis/supply-demand-gap.json',
      scoreKey: 'score', rankKey: 'rank',
      labels: ['需要伸び率', '客室稼働率', '1事業所あたり宿泊需要'],
      percentileKeys: ['demand_growth', 'occupancy', 'demand_per_establishment']
    },
    tourism: {
      url: 'data/analysis/tourism-pressure.json',
      scoreKey: 'pressure_score', rankKey: 'pressure_rank',
      labels: ['宿泊密度', '宿泊施設密度', '宿泊業従業者比率', '宿泊業事業所比率'],
      percentileKeys: ['lodging_density', 'establishment_density', 'employee_share', 'establishment_share']
    }
  };
  const config = configs[type];
  if (!config) return;

  const $ = (id) => document.getElementById(id);
  const select = $('prefecture-select');
  const loading = $('data-loading');
  const error = $('data-error');
  const dashboard = $('analysis-dashboard');
  const nf0 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  let dataset;

  function setText(id, value) { const node = $(id); if (node) node.textContent = value; }
  function pct(value) { return value == null ? '公表値なし' : `${value >= 0 ? '+' : ''}${nf1.format(value * 100)}%`; }
  function rate(value) { return value == null ? '公表値なし' : `${nf1.format(value)}%`; }
  function number(value, unit = '') { return value == null ? '公表値なし' : `${nf0.format(value)}${unit}`; }
  function per(value, unit = '') { return value == null ? '公表値なし' : `${nf1.format(value)}${unit}`; }
  function ratio(value) { return value == null ? '公表値なし' : `${nf1.format(value * 100)}%`; }
  function compare(value, national, tolerance = 0.03) {
    if (!Number.isFinite(value) || !Number.isFinite(national)) return '比較不可';
    const band = Math.max(Math.abs(national) * tolerance, 0.0001);
    return value > national + band ? '全国より高い' : value < national - band ? '全国より低い' : '全国並み';
  }

  function sourcePeriod(metadata) {
    const lodging = metadata.sources.lodging;
    return `${lodging.reference_period}（${lodging.release_type}）`;
  }

  function updateUrl(slug) {
    const url = new URL(window.location.href);
    url.searchParams.set('pref', slug);
    history.replaceState(null, '', url);
  }

  function updateRelatedLinks(slug) {
    document.querySelectorAll('[data-pref-link]').forEach((link) => {
      const url = new URL(link.href, window.location.href);
      url.searchParams.set('pref', slug);
      link.href = `${url.pathname}${url.search}${url.hash}`;
    });
  }

  function selectedRecord() {
    return Object.values(dataset.prefectures).find((item) => item.prefecture_slug === select.value);
  }

  function renderBars(item) {
    const target = $('factor-bars');
    if (!target) return;
    target.replaceChildren(...config.labels.map((label, index) => {
      const value = item.percentiles[config.percentileKeys[index]];
      const row = document.createElement('div');
      row.className = 'factor-row';
      row.innerHTML = `<div><span>${label}</span><strong>${value == null ? '算出不可' : `${nf1.format(value)} / 100`}</strong></div><span class="factor-track"><span style="width:${value || 0}%"></span></span>`;
      return row;
    }));
  }

  function renderRanking() {
    const target = $('prefecture-ranking');
    if (!target) return;
    const rows = Object.values(dataset.prefectures)
      .filter((item) => item[config.scoreKey] != null)
      .sort((a, b) => b[config.scoreKey] - a[config.scoreKey] || a.prefecture_code.localeCompare(b.prefecture_code));
    target.replaceChildren(...rows.map((item) => {
      const li = document.createElement('li');
      li.dataset.slug = item.prefecture_slug;
      const detail = type === 'dx' ? `運営負荷 ${per(item.lodging_demand_per_employee, '人泊／人')}` : type === 'supply' ? `稼働 ${rate(item.occupancy_rate)}` : `宿泊密度 ${per(item.lodging_density, '人泊／住民')}`;
      li.innerHTML = `<button type="button"><span class="ranking-number">${item[config.rankKey]}</span><span class="ranking-name"><strong>${item.prefecture_name}</strong><small>${detail}</small></span><span>${item[config.scoreKey]}点</span></button>`;
      li.querySelector('button').addEventListener('click', () => {
        select.value = item.prefecture_slug;
        render();
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return li;
    }));
  }

  function renderScatter(item) {
    const target = $('scatter-chart');
    if (!target) return;
    const records = Object.values(dataset.prefectures);
    const isSupply = type === 'supply';
    const xKey = isSupply ? 'demand_growth_rate' : 'dependency_score';
    const yKey = isSupply ? 'occupancy_rate' : 'pressure_score';
    const xNational = isSupply ? dataset.national.demand_growth_rate : 50;
    const yNational = isSupply ? dataset.national.occupancy_rate : 50;
    const xs = records.map((r) => r[xKey]).filter(Number.isFinite);
    const ys = records.map((r) => r[yKey]).filter(Number.isFinite);
    const xMin = isSupply ? Math.min(...xs, xNational) : 0;
    const xMax = isSupply ? Math.max(...xs, xNational) : 100;
    const yMin = isSupply ? Math.min(...ys, yNational) : 0;
    const yMax = isSupply ? Math.max(...ys, yNational) : 100;
    const pad = 48, width = 820, height = 430;
    const sx = (v) => pad + ((v - xMin) / (xMax - xMin || 1)) * (width - pad * 2);
    const sy = (v) => height - pad - ((v - yMin) / (yMax - yMin || 1)) * (height - pad * 2);
    const maxEstablishments = Math.max(...records.map((r) => r.lodging_establishments || 0));
    const dots = records.filter((r) => Number.isFinite(r[xKey]) && Number.isFinite(r[yKey])).map((r) => {
      const selected = r.prefecture_code === item.prefecture_code;
      const baseRadius = isSupply ? 3 + Math.sqrt((r.lodging_establishments || 0) / maxEstablishments) * 8 : 5;
      const radius = selected ? Math.max(baseRadius, 9) : baseRadius;
      const details = isSupply ? `需要伸び率 ${pct(r.demand_growth_rate)}／稼働率 ${rate(r.occupancy_rate)}／事業所 ${number(r.lodging_establishments)}／事業所あたり ${per(r.lodging_demand_per_establishment, '人泊')}` : `観光負荷 ${r.pressure_score}点／宿泊観光依存度 ${r.dependency_score}点`;
      return `<g class="scatter-point${selected ? ' is-selected' : ''}"><circle cx="${sx(r[xKey])}" cy="${sy(r[yKey])}" r="${radius}"><title>${r.prefecture_name}：${details}</title></circle>${selected ? `<text x="${sx(r[xKey]) + 14}" y="${sy(r[yKey]) - 12}">${r.prefecture_name}</text>` : ''}</g>`;
    }).join('');
    const xLabel = isSupply ? '宿泊需要伸び率 →' : '宿泊観光依存度参考スコア →';
    const yLabel = isSupply ? '客室稼働率 →' : '観光負荷参考スコア →';
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="47都道府県の散布図"><line class="scatter-axis" x1="${sx(xNational)}" y1="${pad}" x2="${sx(xNational)}" y2="${height-pad}"/><line class="scatter-axis" x1="${pad}" y1="${sy(yNational)}" x2="${width-pad}" y2="${sy(yNational)}"/>${dots}<text class="scatter-x-label" x="${width-pad}" y="${height-12}">${xLabel}</text><text class="scatter-y-label" x="${pad}" y="25">${yLabel}</text></svg>`;
  }

  function reasons(item) {
    if (type === 'dx') {
      const ranked = [
        ['需要の伸び', item.percentiles.demand_growth], ['客室稼働', item.percentiles.occupancy],
        ['従業者あたり運営負荷', item.percentiles.lodging_operation_load], ['働き手の減少', item.percentiles.workforce_decline]
      ].sort((a, b) => (b[1] || 0) - (a[1] || 0));
      return `${ranked[0][0]}と${ranked[1][0]}が、全国47都道府県の中で相対的に高いことが主な要因です。客室稼働率は${rate(item.occupancy_rate)}で${compare(item.occupancy_rate, dataset.national.occupancy_rate)}、需要伸び率は${pct(item.demand_growth_rate)}で${compare(item.demand_growth_rate, dataset.national.demand_growth_rate)}です。人員増だけで対応するのではなく、予約管理、フロント、集計、問い合わせ対応などの省力化を検討する際の参考にできます。`;
    }
    if (type === 'supply') return `全国の需要伸び率・客室稼働率との比較では「${item.market_type}」に位置します。需要伸び率は${pct(item.demand_growth_rate)}で${compare(item.demand_growth_rate, dataset.national.demand_growth_rate)}、稼働率は${rate(item.occupancy_rate)}で${compare(item.occupancy_rate, dataset.national.occupancy_rate)}です。供給状況を詳しく調べる入口であり、投資や撤退の結論を示すものではありません。`;
    return `観光負荷は${item.pressure_score}点、宿泊観光への依存度は${item.dependency_score}点で、「${item.region_type}」に位置します。宿泊密度は${per(item.lodging_density, '人泊／住民')}で${compare(item.lodging_density, dataset.national.lodging_density)}、宿泊業従業者比率は${ratio(item.lodging_employee_share)}で${compare(item.lodging_employee_share, dataset.national.lodging_employee_share)}です。地域全体のオーバーツーリズムや観光GDPを直接示すものではなく、地点別・産業別の追加確認が必要です。`;
  }

  function render() {
    const item = selectedRecord();
    if (!item) return;
    updateUrl(item.prefecture_slug);
    updateRelatedLinks(item.prefecture_slug);
    setText('selected-area-name', item.prefecture_name);
    setText('analysis-period', `分析期間：${sourcePeriod(dataset.metadata)}`);
    setText('primary-score', `${item[config.scoreKey]} / 100`);
    setText('primary-rank', `47都道府県中 ${item[config.rankKey]}位`);
    setText('primary-level', item.score_level || '');
    setText('analysis-reason', reasons(item));
    setText('metric-occupancy', rate(item.occupancy_rate));
    setText('metric-growth', pct(item.demand_growth_rate));
    setText('metric-nights', number(item.total_guest_nights, '人泊'));
    setText('metric-establishments', number(item.lodging_establishments, '事業所'));
    setText('metric-employees', number(item.lodging_employees, '人'));
    setText('metric-population', number(item.population, '人'));
    setText('metric-load', per(item.lodging_demand_per_employee, '人泊／人'));
    setText('metric-establishment-load', per(item.lodging_demand_per_establishment, '人泊／事業所'));
    setText('metric-density', per(item.lodging_density, '人泊／住民1人'));
    setText('metric-foreign-density', per(item.foreign_lodging_density, '人泊／住民1人'));
    setText('metric-establishment-density', per(item.lodging_establishments_per_10000, '事業所／人口1万人'));
    setText('metric-employee-share', ratio(item.lodging_employee_share));
    setText('metric-establishment-share', ratio(item.lodging_establishment_share));
    setText('metric-type', item.market_type || item.region_type || '—');
    if (type === 'tourism') {
      setText('secondary-score', `${item.dependency_score} / 100`);
      setText('secondary-rank', `47都道府県中 ${item.dependency_rank}位`);
    }
    renderBars(item);
    renderScatter(item);
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
    const sources = dataset.metadata.sources;
    setText('source-updated', dataset.metadata.retrieved_at);
    const target = $('source-list');
    target.replaceChildren(...Object.values(sources).map((source) => {
      const div = document.createElement('div');
      div.innerHTML = `<dt>${source.source_name}</dt><dd><a href="${source.source_url}" target="_blank" rel="noopener noreferrer">${source.table_name} ↗</a><br><span>基準時点：${source.reference_period}／公表日：${source.published_date || '各月公表'}</span></dd>`;
      return div;
    }));
  }

  async function load() {
    error.hidden = true;
    loading.hidden = false;
    try {
      const response = await fetch(config.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      dataset = await response.json();
      if (!dataset.prefectures || Object.keys(dataset.prefectures).length !== 47) throw new Error('47都道府県分のデータを確認できませんでした。');
      const rows = Object.values(dataset.prefectures).sort((a, b) => a.prefecture_code.localeCompare(b.prefecture_code));
      select.replaceChildren(new Option('都道府県を選択してください', ''), ...rows.map((item) => new Option(item.prefecture_name, item.prefecture_slug)));
      const requested = new URLSearchParams(location.search).get('pref');
      select.value = resolvePrefectureSlug(rows, requested);
      select.disabled = false;
      select.addEventListener('change', render, { passive: true });
      renderRanking();
      renderSources();
      loading.hidden = true;
      if (select.value) {
        render();
      } else {
        setText('analysis-period', requested ? '指定された都道府県を確認できません。選択欄から選び直してください。' : '都道府県を選ぶと分析結果を表示します。');
      }
      root.setAttribute('aria-busy', 'false');
    } catch (cause) {
      console.error(cause);
      showError('通信状況をご確認のうえ、時間をおいて再度お試しください。サンプル値は表示していません。');
    }
  }

  load();
})();
