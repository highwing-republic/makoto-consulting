/*
 * 都道府県横断分析（宿泊市場の成長・稼働ポジション／宿泊集中度・宿泊業依存度）の計算・判定・文言。
 * dx の設定は、公開を終えた「地域の省人化・DX検討指標」の固定値照合テスト用に残している。
 * DOM と通信を持たない純粋関数だけを置き、画面側（cross-analysis.js）は
 * ここから受け取った値を表示するだけにする。算式・判定ロジックは変更しない。
 * Node（テスト）とブラウザの両方から同じファイルを読む。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CrossAnalysisModel = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

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

  const STATUS_VALUES = ['公表値なし', '算出不可', '比較不可', '—'];
  const nf0 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });

  function resolvePrefectureSlug(rows, requested, fallback = '') {
    if (!requested) return fallback;
    const match = rows.find((item) => item.prefecture_slug === requested || item.prefecture_code === String(requested).padStart(2, '0'));
    return match ? match.prefecture_slug : fallback;
  }

  function classifySupplyPosition(growth, occupancy, nationalGrowth, nationalOccupancy) {
    if (![growth, occupancy, nationalGrowth, nationalOccupancy].every(Number.isFinite)) return '';
    return {
      'true,true': '需要成長・高稼働型',
      'true,false': '需要成長・稼働余力型',
      'false,true': '需要減速・高稼働型',
      'false,false': '需要減速・稼働余力型'
    }[[growth >= nationalGrowth, occupancy >= nationalOccupancy].join(',')];
  }

  function differenceLabel(value, national, kind) {
    if (!Number.isFinite(value) || !Number.isFinite(national)) return { difference: null, comparison: '比較不可', boundary: false };
    const multiplier = kind === 'growth' ? 100 : 1;
    const difference = (value - national) * multiplier;
    const boundary = Math.abs(difference) < 0.5;
    return {
      difference,
      comparison: boundary ? '全国とほぼ同じ' : difference > 0 ? '全国より高い' : '全国より低い',
      boundary
    };
  }

  function relativePositionLabel(value, format = (number) => String(Number(number.toFixed(1)))) {
    if (!Number.isFinite(value)) return '算出不可';
    if (value >= 45 && value <= 55) return `${format(value)}百分位（中央値付近）`;
    return value > 50
      ? `${format(value)}百分位（上位約${format(100 - value)}%）`
      : `${format(value)}百分位（下位約${format(value)}%）`;
  }

  function pct(value) { return value == null ? '公表値なし' : `${value >= 0 ? '+' : ''}${nf1.format(value * 100)}%`; }
  function rate(value) { return value == null ? '公表値なし' : `${nf1.format(value)}%`; }
  function number(value, unit = '') { return value == null ? '公表値なし' : `${nf0.format(value)}${unit}`; }
  function per(value, unit = '') { return value == null ? '公表値なし' : `${nf1.format(value)}${unit}`; }
  function ratio(value) { return value == null ? '公表値なし' : `${nf1.format(value * 100)}%`; }
  function signedPoints(value) {
    if (!Number.isFinite(value)) return '比較不可';
    return `${value >= 0 ? '+' : ''}${nf1.format(value)}pt`;
  }
  function compare(value, national, tolerance = 0.03) {
    if (!Number.isFinite(value) || !Number.isFinite(national)) return '比較不可';
    const band = Math.max(Math.abs(national) * tolerance, 0.0001);
    return value > national + band ? '全国より高い' : value < national - band ? '全国より低い' : '全国並み';
  }

  function sourcePeriod(metadata) {
    const lodging = metadata.sources.lodging;
    return `${lodging.reference_period}（${lodging.release_type}）`;
  }

  function validateDataset(dataset) {
    if (!dataset || !dataset.prefectures || Object.keys(dataset.prefectures).length !== 47) throw new Error('47都道府県分のデータを確認できませんでした。');
    return dataset;
  }

  function sortedRows(dataset) {
    return Object.values(dataset.prefectures).sort((a, b) => a.prefecture_code.localeCompare(b.prefecture_code));
  }

  function findRecord(dataset, slug) {
    return Object.values(dataset.prefectures).find((item) => item.prefecture_slug === slug);
  }

  function emptyMessage(requested) {
    return requested ? '指定された都道府県を確認できません。選択欄から選び直してください。' : '都道府県を選ぶと分析結果を表示します。';
  }

  // 「4つの構成要因」の各行（表示文字列とバーの幅）
  function factorRows(type, item) {
    const config = configs[type];
    return config.labels.map((label, index) => {
      const value = item.percentiles[config.percentileKeys[index]];
      const display = type === 'supply' && value != null
        ? relativePositionLabel(value, (number) => nf1.format(number))
        : value == null ? '算出不可' : `${nf1.format(value)} / 100`;
      return { label, value, display, width: `${value || 0}%` };
    });
  }

  // 47都道府県ランキング（スコア降順、同点は都道府県コード順）
  function rankingRows(type, dataset) {
    const config = configs[type];
    return Object.values(dataset.prefectures)
      .filter((item) => item[config.scoreKey] != null)
      .sort((a, b) => b[config.scoreKey] - a[config.scoreKey] || a.prefecture_code.localeCompare(b.prefecture_code))
      .map((item) => ({
        slug: item.prefecture_slug,
        rank: item[config.rankKey],
        name: item.prefecture_name,
        detail: type === 'dx' ? `運営負荷 ${per(item.lodging_demand_per_employee, '人泊／人')}` : type === 'supply' ? `稼働 ${rate(item.occupancy_rate)}` : `宿泊密度 ${per(item.lodging_density, '人泊／住民')}`,
        score: `${item[config.scoreKey]}点`
      }));
  }

  function reasons(type, item, national) {
    if (type === 'dx') {
      const ranked = [
        ['需要の伸び', item.percentiles.demand_growth], ['客室稼働', item.percentiles.occupancy],
        ['従業者あたり運営負荷', item.percentiles.lodging_operation_load], ['働き手の減少', item.percentiles.workforce_decline]
      ].sort((a, b) => (b[1] || 0) - (a[1] || 0));
      return `${ranked[0][0]}と${ranked[1][0]}が、全国47都道府県の中で相対的に高いことが主な要因です。客室稼働率は${rate(item.occupancy_rate)}で${compare(item.occupancy_rate, national.occupancy_rate)}、需要伸び率は${pct(item.demand_growth_rate)}で${compare(item.demand_growth_rate, national.demand_growth_rate)}です。人員増だけで対応するのではなく、予約管理、フロント、集計、問い合わせ対応などの省力化を検討する際の参考にできます。`;
    }
    if (type === 'supply') return supplyReason(item, national);
    return `観光負荷は${item.pressure_score}点、宿泊観光への依存度は${item.dependency_score}点で、「${item.region_type}」に位置します。宿泊密度は${per(item.lodging_density, '人泊／住民')}で${compare(item.lodging_density, national.lodging_density)}、宿泊業従業者比率は${ratio(item.lodging_employee_share)}で${compare(item.lodging_employee_share, national.lodging_employee_share)}です。地域全体のオーバーツーリズムや観光GDPを直接示すものではなく、地点別・産業別の追加確認が必要です。`;
  }

  function supplyReason(item, national) {
    const position = classifySupplyPosition(item.demand_growth_rate, item.occupancy_rate, national.demand_growth_rate, national.occupancy_rate);
    const growth = differenceLabel(item.demand_growth_rate, national.demand_growth_rate, 'growth');
    const occupancy = differenceLabel(item.occupancy_rate, national.occupancy_rate, 'occupancy');
    if (!position) return '判定に必要な公表値が不足しています。出典の更新状況を確認してください。';
    const templates = {
      '需要成長・高稼働型': `${item.prefecture_name}は、需要の伸びと客室稼働率がともに全国値を上回っています。供給制約の可能性を確認する優先度が高い地域です。施設タイプ、立地、曜日別の客室供給を追加確認してください。`,
      '需要成長・稼働余力型': `${item.prefecture_name}は、宿泊需要が全国より伸びています。一方、客室稼働率は全国値を下回っており、県全体で供給不足とは断定できません。需要を取り込める地域・曜日・施設タイプを確認してください。`,
      '需要減速・高稼働型': `${item.prefecture_name}は、客室稼働率が全国値を上回っていますが、需要の伸びは全国を下回っています。現在の高稼働が継続するか、需要構成や先行予約の確認が必要です。`,
      '需要減速・稼働余力型': `${item.prefecture_name}は、需要の伸びと客室稼働率がともに全国値を下回っています。供給追加より先に、需要減速の要因と施設競争力を確認したい地域です。`
    };
    const boundary = growth.boundary || occupancy.boundary ? ' 全国値との差が小さい指標は境界付近として慎重に見てください。' : '';
    return templates[position] + boundary;
  }

  // 「全国値との差」ブロックと読み上げ用の文言（需給ギャップのみ）
  function supplyComparison(item, national) {
    const growth = differenceLabel(item.demand_growth_rate, national.demand_growth_rate, 'growth');
    const occupancy = differenceLabel(item.occupancy_rate, national.occupancy_rate, 'occupancy');
    const percentile = item.percentiles?.demand_per_establishment;
    const position = classifySupplyPosition(item.demand_growth_rate, item.occupancy_rate, national.demand_growth_rate, national.occupancy_rate);
    const summary = `${item.prefecture_name}：需要伸び率 ${pct(item.demand_growth_rate)}（全国比 ${signedPoints(growth.difference)}）／客室稼働率 ${rate(item.occupancy_rate)}（全国比 ${signedPoints(occupancy.difference)}）`;
    return {
      position,
      'national-growth': pct(national.demand_growth_rate),
      'national-occupancy': rate(national.occupancy_rate),
      'growth-difference': `${growth.comparison}（${signedPoints(growth.difference)}）`,
      'occupancy-difference': `${occupancy.comparison}（${signedPoints(occupancy.difference)}）`,
      'establishment-percentile': relativePositionLabel(percentile, (number) => nf1.format(number)),
      'scatter-summary': summary,
      'market-announcement': `${item.prefecture_name}は${position}です。${summary}`
    };
  }

  // 「この市場で次に確認すること」（需給ギャップのみ）
  function supplyActions(item, national) {
    const position = classifySupplyPosition(item.demand_growth_rate, item.occupancy_rate, national.demand_growth_rate, national.occupancy_rate);
    const first = {
      '需要成長・高稼働型': '価格改定余地、販売制限、増室・改装の前提条件',
      '需要成長・稼働余力型': '集客導線、商品造成、曜日別販売、需要の地域偏在',
      '需要減速・高稼働型': '現在の稼働の持続性、先行予約、顧客構成',
      '需要減速・稼働余力型': '需要減速の要因、価格競争、商品・販路の見直し'
    }[position] || '不足している公表値と代替データ';
    return {
      lead: `${position || '市場タイプ判定不可'}を踏まえ、次の情報を組み合わせて確認してください。`,
      actions: [
        first,
        '市区町村・温泉地・駅周辺など、県内エリア別の客室供給',
        '旅館、ビジネスホテル、リゾートホテルなどの施設タイプ別稼働',
        '平日、休前日、繁忙期、閑散期の価格と稼働の差',
        '国内客、インバウンド、団体、イベント需要の構成'
      ]
    };
  }

  // 分析結果ブロックに表示する文字列（要素 id → 文字列）
  function summaryTexts(type, item, dataset) {
    const config = configs[type];
    const national = dataset.national;
    const supplyPosition = type === 'supply'
      ? classifySupplyPosition(item.demand_growth_rate, item.occupancy_rate, national.demand_growth_rate, national.occupancy_rate)
      : '';
    const texts = {
      'selected-area-name': item.prefecture_name,
      'analysis-period': `分析期間：${sourcePeriod(dataset.metadata)}`,
      'primary-score': `${item[config.scoreKey]} / 100`,
      'primary-rank': `47都道府県中 ${item[config.rankKey]}位`,
      'primary-level': item.score_level || '',
      'analysis-reason': reasons(type, item, national),
      'metric-occupancy': rate(item.occupancy_rate),
      'metric-growth': pct(item.demand_growth_rate),
      'metric-nights': number(item.total_guest_nights, '人泊'),
      'metric-establishments': number(item.lodging_establishments, '事業所'),
      'metric-employees': number(item.lodging_employees, '人'),
      'metric-population': number(item.population, '人'),
      'metric-load': per(item.lodging_demand_per_employee, '人泊／人'),
      'metric-establishment-load': per(item.lodging_demand_per_establishment, '人泊／事業所'),
      'metric-density': per(item.lodging_density, '人泊／住民1人'),
      'metric-foreign-density': per(item.foreign_lodging_density, '人泊／住民1人'),
      'metric-establishment-density': per(item.lodging_establishments_per_10000, '事業所／人口1万人'),
      'metric-employee-share': ratio(item.lodging_employee_share),
      'metric-establishment-share': ratio(item.lodging_establishment_share),
      'metric-type': supplyPosition || item.market_type || item.region_type || '—'
    };
    if (type === 'tourism') {
      texts['secondary-score'] = `${item.dependency_score} / 100`;
      texts['secondary-rank'] = `47都道府県中 ${item.dependency_rank}位`;
    }
    return texts;
  }

  // 散布図の座標とラベル（SVG の組み立ては画面側）
  function scatterLayout(type, item, dataset) {
    const records = Object.values(dataset.prefectures);
    const isSupply = type === 'supply';
    const xKey = isSupply ? 'demand_growth_rate' : 'dependency_score';
    const yKey = isSupply ? 'occupancy_rate' : 'pressure_score';
    const xNational = isSupply ? dataset.national.demand_growth_rate : 50;
    const yNational = isSupply ? dataset.national.occupancy_rate : 50;
    const xs = records.map((r) => r[xKey]).filter(Number.isFinite);
    const ys = records.map((r) => r[yKey]).filter(Number.isFinite);
    const xRange = Math.max(...xs, xNational) - Math.min(...xs, xNational) || 1;
    const yRange = Math.max(...ys, yNational) - Math.min(...ys, yNational) || 1;
    const xMin = isSupply ? Math.min(...xs, xNational) - xRange * .06 : 0;
    const xMax = isSupply ? Math.max(...xs, xNational) + xRange * .06 : 100;
    const yMin = isSupply ? Math.max(0, Math.min(...ys, yNational) - yRange * .08) : 0;
    const yMax = isSupply ? Math.min(100, Math.max(...ys, yNational) + yRange * .08) : 100;
    const width = isSupply ? 900 : 820, height = isSupply ? 500 : 430;
    const left = isSupply ? 78 : 48, right = isSupply ? 30 : 48, top = isSupply ? 58 : 48, bottom = isSupply ? 72 : 48;
    const sx = (v) => left + ((v - xMin) / (xMax - xMin || 1)) * (width - left - right);
    const sy = (v) => height - bottom - ((v - yMin) / (yMax - yMin || 1)) * (height - top - bottom);
    const points = records.filter((r) => Number.isFinite(r[xKey]) && Number.isFinite(r[yKey])).map((r) => {
      const selected = r.prefecture_code === item.prefecture_code;
      const details = isSupply ? `需要伸び率 ${pct(r.demand_growth_rate)}／稼働率 ${rate(r.occupancy_rate)}／事業所 ${number(r.lodging_establishments)}／事業所あたり ${per(r.lodging_demand_per_establishment, '人泊')}` : `観光負荷 ${r.pressure_score}点／宿泊観光依存度 ${r.dependency_score}点`;
      return {
        slug: r.prefecture_slug, name: r.prefecture_name, selected,
        cx: sx(r[xKey]), cy: sy(r[yKey]), r: selected ? 10 : 6, details,
        labelX: Math.min(sx(r[xKey]) + 15, width - 95), labelY: Math.max(sy(r[yKey]) - 13, 22)
      };
    });
    const layout = {
      isSupply, width, height, left, right, top, bottom,
      xNational, yNational, xNationalPosition: sx(xNational), yNationalPosition: sy(yNational),
      nationalGrowthLabel: pct(xNational), nationalOccupancyLabel: rate(yNational),
      points
    };
    if (isSupply) {
      layout.xTicks = Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4).map((value) => ({ position: sx(value), label: `${nf1.format(value * 100)}%` }));
      layout.yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yMax - yMin) * index / 4).map((value) => ({ position: sy(value), label: `${nf1.format(value)}%` }));
      layout.ariaLabel = `${item.prefecture_name}は${classifySupplyPosition(item.demand_growth_rate, item.occupancy_rate, xNational, yNational)}。需要伸び率${pct(item.demand_growth_rate)}、客室稼働率${rate(item.occupancy_rate)}。47都道府県の市場ポジション図。`;
      layout.xLabel = '宿泊需要伸び率 →';
      layout.yLabel = '客室稼働率 ↑';
    } else {
      layout.ariaLabel = '47都道府県の散布図';
      layout.xLabel = '宿泊観光依存度参考スコア →';
      layout.yLabel = '観光負荷参考スコア →';
    }
    return layout;
  }

  // 散布図の下の一覧表（需給ギャップのみ）
  function scatterTableRows(dataset, selected) {
    const national = dataset.national;
    return sortedRows(dataset).map((record) => ({
      selected: record.prefecture_code === selected.prefecture_code,
      name: record.prefecture_name,
      growth: pct(record.demand_growth_rate),
      occupancy: rate(record.occupancy_rate),
      position: classifySupplyPosition(record.demand_growth_rate, record.occupancy_rate, national.demand_growth_rate, national.occupancy_rate) || '判定不可'
    }));
  }

  // 出典一覧
  function sourceEntries(metadata) {
    return Object.values(metadata.sources).map((source) => ({
      name: source.source_name,
      url: source.source_url,
      table: source.table_name,
      period: source.reference_period,
      published: source.published_date || '各月公表'
    }));
  }

  return {
    configs, STATUS_VALUES,
    resolvePrefectureSlug, classifySupplyPosition, differenceLabel, relativePositionLabel,
    pct, rate, number, per, ratio, signedPoints, compare, sourcePeriod,
    validateDataset, sortedRows, findRecord, emptyMessage,
    factorRows, rankingRows, reasons, supplyReason, supplyComparison, supplyActions,
    summaryTexts, scatterLayout, scatterTableRows, sourceEntries
  };
});
