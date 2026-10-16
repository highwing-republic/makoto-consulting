(() => {
  'use strict';

  // 1.1.0: 外国人宿泊比率は「延べ宿泊者数（人泊）」で数えた場合だけ地域値との差を判定する。
  //        インバウンドに「季節の差」「上位3つの国・地域への集中」を全国と比べるルールを追加。
  // 1.2.0: 宿泊旅行統計調査の月別値（lodging-monthly.json）から、インバウンドの「国内客が減る月の外国人の比重」と
  //        売上・稼働の「客室稼働率の季節差（閑散月）」を判定するルールを追加。
  // 1.3.0: 月別値から、人手不足・DXの「繁閑の差」と地域市場の「繁忙月の客室の埋まり方」を判定するルールを追加し、
  //        両テーマの冒頭の論点を判定結果に合わせて県ごとに示す。
  const RULE_VERSION = '1.3.0';

  // 外国人宿泊比率の数え方。地域値（延べ宿泊者数に占める外国人の割合）と同じ数え方のときだけ差を出す。
  const FOREIGN_SHARE_BASES = {
    guest_nights: '延べ宿泊者数（人泊）',
    guests: '宿泊者の人数',
    bookings: '予約件数',
    unknown: 'わからない'
  };

  // 相談テーマ別の質問例。guide は、その質問に結果のどこで答えているかの案内（文章の意味は解釈しない）。
  const TOPIC_EXAMPLES = {
    dx: [
      { text: '人手不足対策はどこから始めればいい？', guide: '「最初に確認したいこと」と確認項目で、業務負荷を確かめる順番を示しています。' },
      { text: 'DXで優先する業務はどこ？', guide: '確認項目で、優先する業務を見つけるために測る内容を示しています。' },
      { text: 'フロントや電話対応の負担を減らしたい', guide: '' }
    ],
    inbound: [
      { text: 'この地域ではどの国・地域からの宿泊が多い？', guide: '①「どの国・地域から宿泊しているか」で、地域で宿泊の多い国・地域を示しています。' },
      { text: '外国人宿泊需要が多い時期は？', guide: '②「どの時期に宿泊しているか」で、月別に多い月・少ない月を示しています。' },
      { text: '自施設のインバウンド対応で何を確認すべき？', guide: '③「自施設は受け入れに対応できているか」で、自施設で確認する項目を示しています。' }
    ],
    sales: [
      { text: '地域と比べてうちの稼働率は低い？', guide: '自施設の稼働率を入力すると、「詳しいデータ・地域との参考比較」で地域値と並べて確認できます。' },
      { text: '稼働率を比べるときは何に注意する？', guide: '確認項目で、地域値と比べるときに確かめる点を示しています。' },
      { text: 'この地域の宿泊需要は伸びている？', guide: '「地域データから見える傾向」で、宿泊需要の伸びを示しています。' }
    ],
    market: [
      { text: 'この地域の宿泊市場は伸びている？', guide: '「地域データから見える傾向」で、宿泊需要の伸びと市場タイプを示しています。' },
      { text: 'この地域の宿泊需要の特徴は？', guide: '「地域データから見える傾向」で、市場タイプと地域類型を示しています。' },
      { text: '競合を調べるときの観点は？', guide: '確認項目で、競合施設を整理する観点を示しています。' }
    ],
    other: [
      { text: 'このツールで何を相談できる？', guide: '「地域データから見える傾向」に、各テーマで確認できる内容を示しています。' },
      { text: 'どのテーマを選べばいい？', guide: '確認項目で、テーマを選ぶための問いを示しています。' }
    ]
  };

  // 相談テーマごとに入力欄を出す施設情報（既存ルールが使う値はすべて含む）。
  const FACILITY_FIELDS = {
    dx: ['type', 'rooms', 'employees'],
    inbound: ['type', 'foreignShare'],
    sales: ['type', 'rooms', 'occupancyRate'],
    market: ['type'],
    other: ['type']
  };

  const TOPICS = {
    dx: { label: '人手不足・DX', keywords: ['人手不足', '採用', 'スタッフ', '省人化', 'フロント', '清掃', '予約管理', '電話', '問い合わせ', '集計'] },
    inbound: { label: 'インバウンド', keywords: ['外国人', 'インバウンド', '海外', '中国', '台湾', '韓国', '欧米'] },
    sales: { label: '売上・稼働', keywords: ['売上', '稼働', 'adr', '客単価', '集客', '予約'] },
    market: { label: '地域市場', keywords: ['市場', '競合', '出店', '地域', '需要', '供給', 'ホテル不足'] },
    other: { label: 'その他', keywords: [] }
  };

  const RELATED_TOOLS = {
    diagnosis: { number: '01', label: 'DXかんたん診断を見る', href: 'dx-diagnosis.html', supportsPref: false },
    inbound: { number: '02', label: 'インバウンド分析を見る', href: 'inbound-analysis.html', supportsPref: true },
    dx: { number: '04', label: '地域の省人化・DX検討指標を見る', href: 'dx-necessity-analysis.html', supportsPref: true },
    supply: { number: '05', label: '宿泊市場の成長・稼働ポジションを見る', href: 'supply-demand-gap-analysis.html', supportsPref: true },
    tourism: { number: '06', label: '宿泊集中度・宿泊業依存度を見る', href: 'tourism-pressure-analysis.html', supportsPref: true }
  };

  const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  const formatNumber = (value, digits = 0) => isNumber(value)
    ? new Intl.NumberFormat('ja-JP', { maximumFractionDigits: digits }).format(value)
    : 'データなし';
  const formatPercent = (value, digits = 1, signed = false) => isNumber(value)
    ? `${signed && value >= 0 ? '+' : ''}${formatNumber(value * 100, digits)}%`
    : 'データなし';
  const formatRate = (value, digits = 1) => isNumber(value) ? `${formatNumber(value, digits)}%` : 'データなし';
  // 月別の客室稼働率は小数第1位までそろえて表示する（59% と 54.6% が並ばないように）。
  const formatRate1 = (value) => isNumber(value) ? `${value.toFixed(1)}%` : 'データなし';

  function classifyQuestion(text = '', selectedTopic = '') {
    if (TOPICS[selectedTopic]) return selectedTopic;
    const normalized = String(text).toLowerCase();
    let best = { topic: 'other', hits: 0 };
    Object.entries(TOPICS).forEach(([topic, config]) => {
      const hits = config.keywords.reduce((count, keyword) => count + (normalized.includes(keyword) ? 1 : 0), 0);
      if (hits > best.hits) best = { topic, hits };
    });
    return best.topic;
  }

  function resolvePrefectureSlug(prefectures, requested, fallback = 'tokyo') {
    const rows = Object.values(prefectures || {});
    return rows.some((row) => row.prefecture_slug === requested) ? requested : fallback;
  }

  function findBySlug(dataset, slug) {
    return Object.values(dataset?.prefectures || {}).find((row) => row.prefecture_slug === slug) || null;
  }

  function metricRank(dataset, key, selectedValue, ascending = false) {
    if (!isNumber(selectedValue)) return null;
    const values = Object.values(dataset?.prefectures || {})
      .map((row) => row[key])
      .filter(isNumber);
    return 1 + values.filter((value) => ascending ? value < selectedValue : value > selectedValue).length;
  }

  function compareText(value, national, unit = 'value') {
    if (!isNumber(value) || !isNumber(national)) return '全国比較のデータなし';
    const tolerance = unit === 'rate' ? 1 : Math.max(Math.abs(national) * 0.03, 0.0001);
    if (value > national + tolerance) return '全国より高い';
    if (value < national - tolerance) return '全国より低い';
    return '全国並み';
  }

  function trendSymbol(value, national, unit = 'value') {
    if (!isNumber(value) || !isNumber(national)) return '→';
    const comparison = compareText(value, national, unit);
    return comparison === '全国より高い' ? '↑' : comparison === '全国より低い' ? '↓' : '→';
  }

  function specialization(inbound, prefectureName) {
    const region = inbound?.prefectures?.[prefectureName];
    const national = inbound?.national;
    if (!region?.nationality || !national?.nationality) return null;
    const regionTotal = Object.values(region.nationality).filter(isNumber).reduce((sum, value) => sum + value, 0);
    const nationalTotal = Object.values(national.nationality).filter(isNumber).reduce((sum, value) => sum + value, 0);
    if (!regionTotal || !nationalTotal) return null;
    return Object.entries(region.nationality)
      .filter(([name, value]) => name !== 'その他' && isNumber(value) && value > 0 && isNumber(national.nationality[name]) && national.nationality[name] > 0)
      .map(([name, value]) => ({
        name,
        value,
        share: value / regionTotal,
        index: (value / regionTotal) / (national.nationality[name] / nationalTotal)
      }))
      .sort((a, b) => b.index - a.index)[0] || null;
  }

  // 最新の集計対象（survey_scope）が続く月だけを取り出す。集計対象の変更をまたいで比べないため。
  function latestScopeMonths(record) {
    const monthly = (record?.monthly || [])
      .filter((row) => isNumber(row.year) && isNumber(row.month))
      .slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
    if (!monthly.length) return [];
    const scope = monthly[monthly.length - 1].survey_scope || '';
    let start = monthly.length - 1;
    while (start > 0 && (monthly[start - 1].survey_scope || '') === scope) start -= 1;
    return monthly.slice(start);
  }

  function peakToLow(months) {
    const valued = months.filter((row) => isNumber(row.foreign_guest_nights));
    if (valued.length < 3) return null;
    const peak = valued.reduce((best, row) => row.foreign_guest_nights > best.foreign_guest_nights ? row : best);
    const low = valued.reduce((best, row) => row.foreign_guest_nights < best.foreign_guest_nights ? row : best);
    if (!(low.foreign_guest_nights > 0)) return null;
    return { peak, low, ratio: peak.foreign_guest_nights / low.foreign_guest_nights };
  }

  function topShare(record, count = 3) {
    if (!record?.nationality || !isNumber(record.foreign_guest_nights) || record.foreign_guest_nights <= 0) return null;
    const top = Object.entries(record.nationality)
      .filter(([name, value]) => name !== 'その他' && isNumber(value) && value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count);
    if (top.length < count) return null;
    return { names: top.map(([name]) => name), share: top.reduce((sum, [, value]) => sum + value, 0) / record.foreign_guest_nights };
  }

  // 地域の外国人宿泊の特徴を全国と比べる材料（季節の差・上位3つの国・地域への集中）。
  function inboundProfile(datasets, prefectureName) {
    const record = datasets.inbound?.prefectures?.[prefectureName];
    const national = datasets.inbound?.national;
    const meta = datasets.inbound?.metadata;
    if (!record || !national) return null;
    const months = latestScopeMonths(record);
    const region = peakToLow(months);
    const keys = new Set(months.map((row) => `${row.year}-${row.month}`));
    const nationalSeason = peakToLow((national.monthly || []).filter((row) => keys.has(`${row.year}-${row.month}`) && (row.survey_scope || '') === (months[0]?.survey_scope || '')));
    const label = (row) => `${row.year}年${row.month}月`;
    const regionTop = topShare(record);
    const nationalTop = topShare(national);
    return {
      seasonality: region && nationalSeason ? {
        ratio: region.ratio,
        nationalRatio: nationalSeason.ratio,
        peak: region.peak,
        low: region.low,
        period: `${label(months[0])}〜${label(months[months.length - 1])}`,
        scope: months[0].survey_scope || ''
      } : null,
      concentration: regionTop && nationalTop ? {
        share: regionTop.share,
        nationalShare: nationalTop.share,
        names: regionTop.names,
        period: meta ? `${meta.year}年${meta.month}月` : ''
      } : null
    };
  }

  const timesText = (value) => `約${formatNumber(value, 1)}倍`;
  const round1 = (value) => Math.round(value * 10) / 10;

  // 月別値（lodging-monthly.json）のうち、集計・層化基準が同じ月が12か月続く最新の期間。
  // 2026年1月の基準変更をまたいで月どうしを比べないため。
  function lodgingWindow(monthly) {
    const periods = monthly?.periods || [];
    const basis = monthly?.basis || [];
    if (basis.length !== periods.length) return null;
    for (let end = periods.length - 1; end >= 11; end -= 1) {
      const start = end - 11;
      if (basis.slice(start, end + 1).every((value) => value === basis[end])) return { start, end, basis: basis[end] };
    }
    return null;
  }

  function lodgingMonths(record, periods, start) {
    return periods.map((period, index) => {
      const at = start + index;
      const total = record.total_guest_nights?.[at];
      const foreign = record.foreign_guest_nights?.[at];
      return {
        period,
        year: Number(period.slice(0, 4)),
        month: Number(period.slice(5, 7)),
        total,
        foreign,
        domestic: record.domestic_guest_nights?.[at],
        occupancy: record.occupancy_rate?.[at],
        share: isNumber(foreign) && isNumber(total) && total > 0 ? foreign / total : null
      };
    });
  }

  // 客室稼働率の最も高い月・低い月と、その差（ポイント）を全国と比べる。
  function occupancySeason(region, national) {
    if (!region.every((row) => isNumber(row.occupancy)) || !national.every((row) => isNumber(row.occupancy))) return null;
    const highest = (rows) => rows.reduce((best, row) => row.occupancy > best.occupancy ? row : best);
    const lowest = (rows) => rows.reduce((best, row) => row.occupancy < best.occupancy ? row : best);
    const peak = highest(region);
    const low = lowest(region);
    return {
      peak,
      low,
      gap: round1(peak.occupancy - low.occupancy),
      nationalGap: round1(highest(national).occupancy - lowest(national).occupancy),
      nationalAtLow: national[region.indexOf(low)].occupancy,
      nationalAtPeak: national[region.indexOf(peak)].occupancy
    };
  }

  // 延べ宿泊者数の最も多い月・少ない月（繁閑の差）を全国と比べる。
  function demandSeason(region, national) {
    const valid = (rows) => rows.every((row) => isNumber(row.total) && row.total > 0);
    if (!valid(region) || !valid(national)) return null;
    const highest = (rows) => rows.reduce((best, row) => row.total > best.total ? row : best);
    const lowest = (rows) => rows.reduce((best, row) => row.total < best.total ? row : best);
    const peak = highest(region);
    const low = lowest(region);
    return {
      peak,
      low,
      mean: region.reduce((total, row) => total + row.total, 0) / region.length,
      ratio: peak.total / low.total,
      nationalRatio: highest(national).total / lowest(national).total
    };
  }

  // 外国人の割合が最も高い月に、国内客（延べ宿泊者数−外国人）が年平均と比べてどうだったか。
  function domesticComplement(region) {
    if (!region.every((row) => isNumber(row.domestic) && isNumber(row.foreign) && isNumber(row.total) && row.total > 0)) return null;
    const sum = (key) => region.reduce((total, row) => total + row[key], 0);
    const domesticMean = sum('domestic') / region.length;
    const foreignMean = sum('foreign') / region.length;
    if (!(domesticMean > 0) || !(foreignMean > 0)) return null;
    const month = region.reduce((best, row) => row.share > best.share ? row : best);
    const domesticLow = region.reduce((best, row) => row.domestic < best.domestic ? row : best);
    return {
      month,
      share: month.share,
      annualShare: sum('foreign') / sum('total'),
      domesticIndex: month.domestic / domesticMean,
      foreignIndex: month.foreign / foreignMean,
      domesticLow
    };
  }

  function monthlyProfile(datasets, code) {
    const monthly = datasets.monthly;
    const record = monthly?.prefectures?.[code];
    const window = lodgingWindow(monthly);
    if (!record || !monthly?.national || !window) return null;
    const periods = monthly.periods.slice(window.start, window.end + 1);
    const region = lodgingMonths(record, periods, window.start);
    const national = lodgingMonths(monthly.national, periods, window.start);
    const label = (row) => `${row.year}年${row.month}月`;
    const first = region[0];
    const last = region[region.length - 1];
    return {
      period: `${label(first)}〜${label(last)}`,
      yearLabel: first.month === 1 && last.month === 12 && first.year === last.year ? `${first.year}年の1年間` : `${label(first)}〜${label(last)}の1年間`,
      basisLabel: monthly.metadata?.basis_labels?.[window.basis] || '',
      months: region.map((row, index) => ({ ...row, nationalOccupancy: national[index].occupancy })),
      occupancy: occupancySeason(region, national),
      demand: demandSeason(region, national),
      complement: domesticComplement(region)
    };
  }

  function getRegionContext(datasets, requestedSlug) {
    const slug = resolvePrefectureSlug(datasets.statistics?.prefectures, requestedSlug);
    const statistics = findBySlug(datasets.statistics, slug);
    const dx = findBySlug(datasets.dx, slug);
    const supply = findBySlug(datasets.supply, slug);
    const tourism = findBySlug(datasets.tourism, slug);
    if (!statistics || !dx || !supply || !tourism) return null;
    const inbound = datasets.inbound?.prefectures?.[statistics.prefecture_name] || null;
    const national = datasets.statistics.national || {};
    return {
      slug,
      name: statistics.prefecture_name,
      statistics,
      dx,
      supply,
      tourism,
      inbound,
      national,
      datasets,
      ranks: {
        operationLoad: metricRank(datasets.statistics, 'lodging_demand_per_employee', statistics.lodging_demand_per_employee),
        lodgingDensity: metricRank(datasets.statistics, 'lodging_density', statistics.lodging_density),
        foreignDensity: metricRank(datasets.statistics, 'foreign_lodging_density', statistics.foreign_lodging_density)
      },
      foreignShare: isNumber(statistics.foreign_guest_nights) && isNumber(statistics.total_guest_nights) && statistics.total_guest_nights > 0
        ? statistics.foreign_guest_nights / statistics.total_guest_nights : null,
      nationalForeignShare: isNumber(national.foreign_guest_nights) && isNumber(national.total_guest_nights) && national.total_guest_nights > 0
        ? national.foreign_guest_nights / national.total_guest_nights : null,
      specializedMarket: specialization(datasets.inbound, statistics.prefecture_name),
      inboundProfile: inboundProfile(datasets, statistics.prefecture_name),
      monthlyProfile: monthlyProfile(datasets, statistics.prefecture_code)
    };
  }

  function compareFacilityWithRegion(context, facility = {}) {
    const comparisons = [];
    if (isNumber(facility.occupancyRate) && isNumber(context.statistics.occupancy_rate)) {
      const difference = facility.occupancyRate - context.statistics.occupancy_rate;
      comparisons.push({
        key: 'occupancy',
        label: '客室稼働率',
        facility: formatRate(facility.occupancyRate),
        region: formatRate(context.statistics.occupancy_rate),
        difference: `${difference >= 0 ? '+' : ''}${formatNumber(difference, 1)}pt`,
        rawDifference: difference,
        comparable: true,
        note: `地域値は${context.statistics.data_period || '直近12か月'}の客室稼働率です。集計期間・対象施設が異なるため参考比較です。`
      });
    }
    if (isNumber(facility.foreignShare) && isNumber(context.foreignShare)) {
      const regionRate = context.foreignShare * 100;
      const difference = facility.foreignShare - regionRate;
      const comparable = facility.foreignShareBasis === 'guest_nights';
      const basisLabel = FOREIGN_SHARE_BASES[facility.foreignShareBasis];
      comparisons.push({
        key: 'foreignShare',
        label: '外国人宿泊比率',
        facility: formatRate(facility.foreignShare),
        region: formatRate(regionRate),
        difference: comparable
          ? `${difference >= 0 ? '+' : ''}${formatNumber(difference, 1)}pt`
          : '差は出していません',
        rawDifference: comparable ? difference : null,
        comparable,
        note: comparable
          ? `地域値は${context.statistics.data_period || '直近12か月'}の延べ宿泊者数（人泊）に占める外国人の割合です。集計対象の施設が異なるため参考比較です。`
          : `地域値は延べ宿泊者数（人泊）で数えた割合です。自施設の比率の数え方が「${basisLabel && facility.foreignShareBasis !== 'unknown' ? basisLabel : '未確認'}」のため、差の比較はしていません。`
      });
    }
    if (isNumber(facility.rooms) && facility.rooms > 0 && isNumber(facility.employees) && facility.employees > 0) {
      comparisons.push({
        key: 'roomsPerEmployee',
        label: '1従業員あたり客室数（参考値）',
        facility: `${formatNumber(facility.rooms / facility.employees, 1)}室`,
        region: '比較対象なし',
        difference: '自施設内の参考値',
        rawDifference: null,
        comparable: false,
        note: '地域統計に同じ指標がないため、自施設の値だけを表示しています。'
      });
    }
    return comparisons;
  }

  const RULES = [
    {
      id: 'facility-occupancy-gap', category: 'sales', priority: 100,
      condition: ({ comparisons }) => comparisons.some((row) => row.key === 'occupancy' && row.rawDifference <= -10),
      message: ({ context }) => `地域統計に対して自施設の稼働率が10ポイント以上低くなっています。省人化だけでなく、販売方法、商品構成、予約チャネルも確認するとよい可能性があります。`
    },
    {
      id: 'facility-foreign-gap', category: 'inbound', priority: 100,
      condition: ({ context, comparisons }) => comparisons.some((row) => row.key === 'foreignShare' && row.comparable && row.rawDifference <= -10) && isNumber(context.foreignShare) && context.foreignShare > context.nationalForeignShare,
      message: () => '地域の外国人宿泊比率に対して自施設の比率が低いため、対応言語、販売チャネル、写真・案内情報などに確認余地がある可能性があります。'
    },
    {
      id: 'dx-high-workforce-decline', category: 'dx', priority: 90,
      condition: ({ context }) => context.dx.score >= 60 && context.statistics.working_age_population_change_rate < 0,
      message: () => '地域の宿泊需要と今後の人材確保環境を踏まえると、人員増だけでなく、予約管理、問い合わせ対応、集計などの省力化を検討する余地があります。'
    },
    {
      id: 'dx-operation-load', category: 'dx', priority: 80,
      condition: ({ context }) => context.ranks.operationLoad && context.ranks.operationLoad <= 15,
      message: () => '従業者あたり宿泊需要が全国上位にあるため、現場ごとの作業時間や二重入力を確認すると、改善対象を見つけやすい可能性があります。'
    },
    {
      id: 'supply-tight-candidate', category: 'sales', priority: 80,
      condition: ({ context }) => context.supply.market_type === '需給ひっ迫候補',
      message: () => '地域では高稼働と需要成長の両方が見られます。単純な値下げを前提にせず、単価、販売構成、販売停止日の状況を確認する余地があります。'
    },
    {
      id: 'market-growth', category: 'market', priority: 75,
      condition: ({ context }) => isNumber(context.statistics.demand_growth_rate) && context.statistics.demand_growth_rate > context.national.demand_growth_rate,
      message: () => '宿泊需要の伸びは全国値を上回っています。ただし、新規出店や供給不足を直接示すものではないため、曜日別稼働や客室単価、競合施設も追加確認が必要です。'
    },
    {
      id: 'inbound-market-opportunity', category: 'inbound', priority: 75,
      condition: ({ context }) => isNumber(context.foreignShare) && isNumber(context.nationalForeignShare) && context.foreignShare > context.nationalForeignShare,
      message: () => '外国人宿泊の構成比は全国値を上回っています。国・地域別の構成と自施設の予約経路を照らすことで、対応の優先順位を考えやすくなります。'
    },
    {
      id: 'inbound-seasonality', category: 'inbound', priority: 85,
      condition: ({ context }) => {
        const season = context.inboundProfile?.seasonality;
        return Boolean(season) && season.ratio >= 2 && season.ratio >= season.nationalRatio * 1.5;
      },
      message: ({ context }) => {
        const season = context.inboundProfile.seasonality;
        return `外国人宿泊は${season.peak.month}月が${season.low.month}月の${timesText(season.ratio)}で、全国（${timesText(season.nationalRatio)}）より季節による差が大きい地域です。多い時期と少ない時期で、販売の仕方や受け入れ体制を分けて考える余地があります。`;
      }
    },
    {
      id: 'inbound-concentration', category: 'inbound', priority: 70,
      condition: ({ context }) => {
        const concentration = context.inboundProfile?.concentration;
        return Boolean(concentration) && concentration.share >= concentration.nationalShare + 0.1;
      },
      message: ({ context }) => {
        const concentration = context.inboundProfile.concentration;
        return `外国人宿泊の${formatPercent(concentration.share, 0)}を上位3つの国・地域（${concentration.names.join('・')}）が占め、全国（${formatPercent(concentration.nationalShare, 0)}）より特定の国・地域への集中が強い地域です。主要な国・地域の渡航環境が変わると影響を受けやすい点も、あわせて確認しておきましょう。`;
      }
    },
    {
      id: 'inbound-domestic-complement', category: 'inbound', priority: 90,
      condition: ({ context }) => {
        const complement = context.monthlyProfile?.complement;
        return Boolean(complement) && complement.share >= complement.annualShare * 1.5
          && complement.share - complement.annualShare >= 0.05 && complement.domesticIndex < 1;
      },
      message: ({ context }) => {
        const complement = context.monthlyProfile.complement;
        return `${complement.month.month}月は国内客が年平均より${formatPercent(1 - complement.domesticIndex, 0)}少ない一方、外国人は年平均の${timesText(complement.foreignIndex)}で、宿泊者に占める外国人の割合が${formatPercent(complement.share)}（${context.monthlyProfile.yearLabel}では${formatPercent(complement.annualShare)}）に上がります。国内客が少ない時期に、外国人の宿泊の比重が高まる地域です。`;
      }
    },
    {
      id: 'sales-seasonal-gap', category: 'sales', priority: 85,
      condition: ({ context }) => {
        const occupancy = context.monthlyProfile?.occupancy;
        return Boolean(occupancy) && occupancy.gap >= occupancy.nationalGap * 1.5;
      },
      message: ({ context }) => {
        const occupancy = context.monthlyProfile.occupancy;
        return `客室稼働率は最も高い${occupancy.peak.month}月が${formatRate1(occupancy.peak.occupancy)}、最も低い${occupancy.low.month}月が${formatRate1(occupancy.low.occupancy)}で、差は${formatNumber(occupancy.gap, 1)}ポイントです（全国は${formatNumber(occupancy.nationalGap, 1)}ポイント）。閑散月の販売方法や、休館日・人員配置の組み方を確認する余地があります。`;
      }
    },
    {
      id: 'dx-seasonal-workload', category: 'dx', priority: 85,
      condition: ({ context }) => {
        const demand = context.monthlyProfile?.demand;
        return Boolean(demand) && demand.ratio - 1 >= (demand.nationalRatio - 1) * 2;
      },
      message: ({ context }) => {
        const demand = context.monthlyProfile.demand;
        return `延べ宿泊者数は最も多い${demand.peak.month}月が最も少ない${demand.low.month}月の${timesText(demand.ratio)}で、全国（${timesText(demand.nationalRatio)}）より繁閑の差が大きい地域です。繁忙月に足りなくなる業務と、閑散月に人が余る業務を分けて見ると、省力化の対象を絞りやすくなります。`;
      }
    },
    {
      id: 'market-peak-full', category: 'market', priority: 80,
      condition: ({ context }) => isNumber(context.monthlyProfile?.occupancy?.peak?.occupancy) && context.monthlyProfile.occupancy.peak.occupancy >= 75,
      message: ({ context }) => {
        const occupancy = context.monthlyProfile.occupancy;
        return `客室稼働率は最も高い${occupancy.peak.month}月に${formatRate1(occupancy.peak.occupancy)}まで上がり、地域全体で客室が埋まりやすい時期があります。周辺が満室に近い時期の料金や販売開始の時期を確認する余地があります。`;
      }
    },
    {
      id: 'market-peak-slack', category: 'market', priority: 80,
      condition: ({ context }) => isNumber(context.monthlyProfile?.occupancy?.peak?.occupancy) && context.monthlyProfile.occupancy.peak.occupancy < 60,
      message: ({ context }) => {
        const occupancy = context.monthlyProfile.occupancy;
        return `客室稼働率は最も高い${occupancy.peak.month}月でも${formatRate1(occupancy.peak.occupancy)}で、地域全体では繁忙期にも客室に余裕があります。値下げで取り合う前に、自施設がどの客層・時期の需要を取れているかを確認する余地があります。`;
      }
    },
    {
      id: 'tourism-context', category: 'market', priority: 60,
      condition: ({ context }) => context.tourism.pressure_score >= 60 || context.tourism.dependency_score >= 60,
      message: () => '地域人口に対する宿泊需要や宿泊業の比重が相対的に高いため、需要変動が採用や運営へ与える影響も合わせて確認するとよい可能性があります。'
    }
  ];

  function topicFacts(context, topic, comparisons) {
    const s = context.statistics;
    const n = context.national;
    const facts = [];
    const add = (symbol, text, note = '') => facts.push({ symbol, text, note });
    const sources = context.datasets?.statistics?.metadata?.sources || {};
    const lodgingPeriod = s.data_period || sources.lodging?.reference_period || '';
    const growthPeriod = sources.lodging?.comparison_period ? `${lodgingPeriod}と前年同期間（${sources.lodging.comparison_period}）の比較` : lodgingPeriod;
    const populationPeriod = sources.population ? `${sources.population.comparison_period}→${sources.population.reference_period}` : '';
    const inboundMeta = context.datasets?.inbound?.metadata;
    const inboundMonth = inboundMeta ? `${inboundMeta.year}年${inboundMeta.month}月（${inboundMeta.release_type}）・${inboundMeta.survey_scope}` : '';
    if (topic === 'dx') {
      add('→', `宿泊DX必要度は${context.dx.score == null ? '算出不可' : `${context.dx.score} / 100・全国${context.dx.rank}位`}`, '当サイトが公的統計から算出した参考スコア（地域の省人化・DX検討指標）');
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${compareText(s.demand_growth_rate, n.demand_growth_rate)}（${formatPercent(s.demand_growth_rate, 1, true)}）です`, `延べ宿泊者数・${growthPeriod}`);
      add(isNumber(context.ranks.operationLoad) && context.ranks.operationLoad <= 15 ? '↑' : '→', isNumber(s.lodging_demand_per_employee) && isNumber(context.ranks.operationLoad)
        ? `従業者あたり宿泊需要は${formatNumber(s.lodging_demand_per_employee)}人泊・全国${context.ranks.operationLoad}位です`
        : '従業者あたり宿泊需要は現在データを取得できません', `延べ宿泊者数（${lodgingPeriod}）÷宿泊業従業者数（経済センサス ${sources.economic_census?.reference_period || ''}）`);
      add(s.working_age_population_change_rate < 0 ? '↓' : '→', `生産年齢人口は5年前比${formatPercent(s.working_age_population_change_rate, 1, true)}です`, `人口推計・${populationPeriod}`);
      const demand = context.monthlyProfile?.demand;
      if (demand) add(demand.ratio - 1 >= (demand.nationalRatio - 1) * 2 ? '↑' : '→', `延べ宿泊者数が最も多いのは${demand.peak.month}月で、最も少ない${demand.low.month}月の${timesText(demand.ratio)}です`, `${context.monthlyProfile.period}の月別値（第2表）・全国は${timesText(demand.nationalRatio)}`);
    } else if (topic === 'inbound') {
      add('→', `年間外国人延べ宿泊者数は${formatNumber(s.foreign_guest_nights)}人泊です`, `${lodgingPeriod}の合計・単位は人泊（1人が2泊すると2人泊）。国・地域別や月別の値とは集計表が異なるため、合計は一致しません`);
      add(trendSymbol(context.foreignShare, context.nationalForeignShare), `外国人宿泊比率は${formatPercent(context.foreignShare)}で${compareText(context.foreignShare, context.nationalForeignShare)}です`, `延べ宿泊者数に占める外国人の割合・${lodgingPeriod}・全国は${formatPercent(context.nationalForeignShare)}`);
      if (context.specializedMarket) add('→', `最新月は「${context.specializedMarket.name}」の構成比が全国構成に対して相対的に高い傾向です`, `${inboundMonth}の国・地域別集計`);
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`, '宿泊市場の成長・稼働ポジションでの類型（当サイトの参考分類）');
    } else if (topic === 'sales') {
      add(trendSymbol(s.occupancy_rate, n.occupancy_rate, 'rate'), `地域の客室稼働率は${formatRate(s.occupancy_rate)}で${compareText(s.occupancy_rate, n.occupancy_rate, 'rate')}です`, `${lodgingPeriod}・全国は${formatRate(n.occupancy_rate)}`);
      const season = context.monthlyProfile?.occupancy;
      if (season) {
        const difference = round1(season.low.occupancy - season.nationalAtLow);
        const relation = Math.abs(difference) < 1 ? 'と同程度' : `より${formatNumber(Math.abs(difference), 1)}ポイント${difference < 0 ? '低い水準' : '高い水準'}`;
        add(difference <= -1 ? '↓' : '→', `客室稼働率が最も低いのは${season.low.month}月（${formatRate1(season.low.occupancy)}）で、全国の同じ月（${formatRate1(season.nationalAtLow)}）${relation}です`, `${context.monthlyProfile.period}の月別値（第8表）・最も高いのは${season.peak.month}月（${formatRate1(season.peak.occupancy)}）`);
      }
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${formatPercent(s.demand_growth_rate, 1, true)}で${compareText(s.demand_growth_rate, n.demand_growth_rate)}です`, `延べ宿泊者数・${growthPeriod}`);
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`, '宿泊市場の成長・稼働ポジションでの類型（当サイトの参考分類）');
      const occupancy = comparisons.find((row) => row.key === 'occupancy');
      if (occupancy) add(occupancy.rawDifference >= 0 ? '↑' : '↓', `自施設の稼働率は地域値との差が${occupancy.difference}です`, '入力値と地域統計の参考比較（集計期間・対象施設が異なります）');
    } else if (topic === 'market') {
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`, '宿泊市場の成長・稼働ポジションでの類型（当サイトの参考分類）');
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${formatPercent(s.demand_growth_rate, 1, true)}で${compareText(s.demand_growth_rate, n.demand_growth_rate)}です`, `延べ宿泊者数・${growthPeriod}`);
      add('→', `観光負荷参考スコアは${context.tourism.pressure_score ?? '算出不可'}、観光依存度参考スコアは${context.tourism.dependency_score ?? '算出不可'}です`, '宿泊集中度・宿泊業依存度の参考スコア（47都道府県内の相対評価）');
      add('→', `地域類型は「${context.tourism.region_type}」です`, '宿泊集中度・宿泊業依存度での類型（当サイトの参考分類）');
      const peak = context.monthlyProfile?.occupancy;
      if (peak) {
        const difference = round1(peak.peak.occupancy - peak.nationalAtPeak);
        const relation = Math.abs(difference) < 1 ? 'と同程度' : `より${formatNumber(Math.abs(difference), 1)}ポイント${difference < 0 ? '低い水準' : '高い水準'}`;
        add(peak.peak.occupancy >= 75 ? '↑' : peak.peak.occupancy < 60 ? '↓' : '→', `客室稼働率が最も高いのは${peak.peak.month}月（${formatRate1(peak.peak.occupancy)}）で、全国の同じ月（${formatRate1(peak.nationalAtPeak)}）${relation}です`, `${context.monthlyProfile.period}の月別値（第8表）`);
      }
    } else {
      add('→', '「人手不足・DX」では業務負荷と人材環境を確認できます');
      add('→', '「インバウンド」では外国人宿泊需要と国・地域別構成を確認できます');
      add('→', '「売上・稼働」では地域稼働率と自施設を参考比較できます');
      add('→', '「地域市場」では需給と観光の地域特性を確認できます');
    }
    return facts.slice(0, 5);
  }

  function checklistFor(topic, question = '') {
    const lists = {
      dx: ['予約・顧客情報の二重入力があるか', '電話・メール対応に1日何時間使っているか', '日報・月報作成を手作業で行っているか'],
      inbound: ['自施設の国・地域別宿泊実績を把握できているか', '主要予約ページの言語・写真・案内情報が十分か', '国・地域別に予約経路とキャンセル率が違うか'],
      sales: ['曜日・客室タイプ別の稼働率を確認できているか', '地域値と自施設で集計期間・対象がどう違うか', '単価・販売チャネル・販売停止日を一緒に見ているか'],
      market: ['競合施設を客室タイプ・価格帯別に整理しているか', '需要の伸びが平日・休日のどちらで起きているか', '採用・交通・地域イベントなど統計外の条件を確認したか'],
      other: ['相談したい内容が人手・インバウンド・稼働・地域市場のどれに近いか', '自施設で比較したい数字は何か', '最初に確認したい経営上の問いを一文にできるか']
    };
    const result = [...lists[topic]];
    if (/フロント|電話|問い合わせ/.test(question) && topic === 'dx') result[0] = 'フロント・電話・問い合わせ対応に1日何時間使っているか';
    if (/予約管理|予約/.test(question) && topic === 'dx') result[1] = '予約情報を複数システムへ転記していないか';
    return result.slice(0, 3);
  }

  function relatedFor(topic) {
    const map = {
      dx: ['diagnosis', 'dx', 'supply'],
      inbound: ['inbound', 'supply', 'tourism'],
      sales: ['supply', 'dx'],
      market: ['supply', 'tourism', 'inbound'],
      other: ['dx', 'inbound', 'supply', 'tourism']
    };
    return map[topic].map((key) => RELATED_TOOLS[key]);
  }

  function statusFor(context, topic) {
    if (topic === 'dx') return `${context.name}の宿泊DX必要度は、全国47都道府県中${context.dx.rank ?? '算出不可'}位です。`;
    if (topic === 'inbound') return isNumber(context.statistics.foreign_guest_nights)
      ? `${context.name}では、年間${formatNumber(context.statistics.foreign_guest_nights)}人泊の外国人宿泊需要が記録されています。`
      : `${context.name}の外国人延べ宿泊者数は現在データを取得できません。`;
    if (topic === 'sales') return `${context.name}の客室稼働率は${formatRate(context.statistics.occupancy_rate)}、市場タイプは「${context.supply.market_type}」です。`;
    if (topic === 'market') return `${context.name}は、宿泊市場では「${context.supply.market_type}」、観光の地域類型では「${context.tourism.region_type}」です。`;
    return '相談内容に近いテーマを選ぶと、地域統計と自施設情報を組み合わせて確認できます。';
  }

  // 国・地域別の構成（インバウンド宿泊者分析の marketRows と同じ計算：地域内シェア÷全国シェア）。
  function inboundMarkets(context) {
    const meta = context.datasets?.inbound?.metadata;
    const record = context.inbound;
    const national = context.datasets?.inbound?.national;
    if (!meta || !record?.nationality || !isNumber(record.foreign_guest_nights) || record.foreign_guest_nights <= 0 || !national?.nationality) return null;
    const rows = Object.entries(record.nationality)
      .filter(([name, value]) => name !== 'その他' && isNumber(value) && value > 0)
      .map(([name, value]) => {
        const nationalValue = national.nationality[name];
        const localShare = value / record.foreign_guest_nights;
        const nationalShare = isNumber(nationalValue) && national.foreign_guest_nights > 0 ? nationalValue / national.foreign_guest_nights : 0;
        return { name, value, localShare, specialization: nationalShare ? localShare / nationalShare : 0 };
      })
      .sort((a, b) => b.value - a.value);
    if (!rows.length) return null;
    const specialized = rows.slice().sort((a, b) => b.specialization - a.specialization)[0];
    return {
      period: `${meta.year}年${meta.month}月（${meta.release_type}）`,
      scope: meta.survey_scope,
      unit: meta.unit || '人泊',
      total: record.foreign_guest_nights,
      top: rows.slice(0, 3),
      specialized: specialized && specialized.specialization > 1 ? specialized : null
    };
  }

  // 月別の外国人延べ宿泊者数。集計対象（survey_scope）が変わる月で区切り、区切りの中でだけ多い月・少ない月を比べる。
  function inboundSeasons(context) {
    const monthly = (context.inbound?.monthly || [])
      .filter((row) => isNumber(row.year) && isNumber(row.month))
      .slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
    if (!monthly.length) return null;
    const segments = [];
    monthly.forEach((row) => {
      const last = segments[segments.length - 1];
      if (last && last.scope === (row.survey_scope || '')) last.months.push(row);
      else segments.push({ scope: row.survey_scope || '', months: [row] });
    });
    const label = (row) => `${row.year}年${row.month}月`;
    segments.forEach((segment) => {
      const valued = segment.months.filter((row) => isNumber(row.foreign_guest_nights));
      segment.label = segment.months.length > 1
        ? `${label(segment.months[0])}〜${label(segment.months[segment.months.length - 1])}`
        : label(segment.months[0]);
      segment.peak = valued.length >= 2 ? valued.reduce((best, row) => row.foreign_guest_nights > best.foreign_guest_nights ? row : best) : null;
      segment.low = valued.length >= 2 ? valued.reduce((best, row) => row.foreign_guest_nights < best.foreign_guest_nights ? row : best) : null;
      segment.missing = segment.months.length - valued.length;
    });
    return {
      rows: monthly.map((row) => ({ label: label(row), value: isNumber(row.foreign_guest_nights) ? row.foreign_guest_nights : null, scope: row.survey_scope || '' })),
      segments,
      period: `${label(monthly[0])}〜${label(monthly[monthly.length - 1])}`,
      scopeChanged: segments.length > 1,
      surveyNote: context.datasets?.inbound?.metadata?.survey_note || ''
    };
  }

  function receptionCheck(type) {
    if (type === '旅館') return '外国語での宿泊案内（チェックイン、食事の時間、大浴場・温泉の入り方、浴衣など）';
    if (type === 'ホテル') return '外国語での宿泊案内（チェックイン、朝食、館内設備の使い方など）';
    if (type === '簡易宿所') return '外国語での宿泊案内（セルフチェックイン、共用設備の使い方、ハウスルールなど）';
    return '外国語での宿泊案内（チェックイン、館内設備、食事など）';
  }

  // インバウンドの3つの確認観点。①②は公的統計、③は自施設で確認する項目（統計では判定しない）。
  function inboundPerspectives(context, facility = {}) {
    const markets = inboundMarkets(context);
    const seasons = inboundSeasons(context);
    const fmt = (value) => `${formatNumber(value)}人泊`;
    const marketData = markets ? {
      lines: [
        ...markets.top.map((row, index) => ({ label: `${index + 1}位 ${row.name}`, value: `${fmt(row.value)}（構成比${formatPercent(row.localShare)}）` })),
        ...(context.inboundProfile?.concentration ? [{ label: '上位3つの合計', value: `${formatPercent(context.inboundProfile.concentration.share)}（全国 ${formatPercent(context.inboundProfile.concentration.nationalShare)}）` }] : []),
        ...(markets.specialized ? [{ label: '全国と比べて構成比が高い', value: `${markets.specialized.name}（地域特化度${markets.specialized.specialization.toFixed(2)}）` }] : [])
      ],
      note: `${markets.period}の1か月分・${markets.scope}・単位は人泊。季節によって構成は変わるため、②の時期とあわせてご覧ください。${markets.specialized ? '地域特化度は「地域内の構成比÷全国の構成比」で、1を超えると全国より構成比が高い国・地域です。宿泊数が少なくても高くなることがあります。' : ''}`
    } : null;
    const seasonLines = seasons ? seasons.segments.filter((segment) => segment.peak).map((segment) => ({
      label: `${segment.label}${seasons.scopeChanged ? `（${segment.scope}）` : ''}`,
      value: `多い月 ${segment.peak.month}月（${fmt(segment.peak.foreign_guest_nights)}）\n少ない月 ${segment.low.month}月（${fmt(segment.low.foreign_guest_nights)}）`
    })) : [];
    const season = context.inboundProfile?.seasonality;
    if (season) seasonLines.push({ label: `季節の差（${season.period}）`, value: `最多月は最少月の${timesText(season.ratio)}\n全国は${timesText(season.nationalRatio)}` });
    const complement = context.monthlyProfile?.complement;
    if (complement) seasonLines.push({
      label: `外国人の割合が最も高い月（${context.monthlyProfile.period}）`,
      value: `${complement.month.month}月 ${formatPercent(complement.share)}（1年間では ${formatPercent(complement.annualShare)}）\nこの月の国内客は年平均の${formatPercent(complement.domesticIndex, 0)}`
    });
    const seasonNote = seasons
      ? (seasons.scopeChanged
        ? `宿泊旅行統計調査は${seasons.segments[1].months[0].year}年${seasons.segments[1].months[0].month}月から集計・層化基準が変わり、集計対象が「${seasons.segments[0].scope}」から「${seasons.segments[1].scope}」になりました。対象が異なる期間どうしでは多い・少ないを比べず、期間ごとに分けて表示しています。単位は人泊。`
        : `${seasons.period}・${seasons.segments[0].scope}・単位は人泊。`)
      : '';
    const complementNote = complement
      ? '「外国人の割合が最も高い月」は延べ宿泊者数（第2表）の月別値です。国籍別の集計表より対象施設が広いため、上の月別の値とは一致しません。国内客は延べ宿泊者数から外国人を除いた値で、日本に住む外国人を含みます。'
      : '';
    const seasonData = seasonLines.length ? {
      lines: seasonLines,
      note: [seasonNote, complementNote].filter(Boolean).join('')
    } : null;
    const complementMatched = complement && RULES.find((rule) => rule.id === 'inbound-domestic-complement').condition({ context });
    const topNames = markets ? markets.top.map((row) => row.name).join('・') : '';
    return [
      {
        id: 'markets',
        number: '①',
        title: 'どの国・地域から宿泊しているか',
        status: marketData ? 'data' : 'missing',
        data: marketData,
        missing: '国・地域別の外国人延べ宿泊者数を取得できませんでした。下の項目は、自施設の予約データで確認できます。',
        checks: [
          markets ? `自施設の外国人宿泊実績を国・地域別に集計し、地域の上位（${topNames}）と並べてみる` : '自施設の外国人宿泊実績を国・地域別に集計し、多い順に並べてみる',
          '宿泊の多い国・地域の言語で、予約ページや館内の案内を用意できているか',
          '国・地域ごとに、どの予約経路（OTA・自社サイト・旅行会社）から予約が入っているか'
        ]
      },
      {
        id: 'seasons',
        number: '②',
        title: 'どの時期に宿泊しているか',
        status: seasonData ? 'data' : 'missing',
        data: seasonData,
        missing: '月別の外国人延べ宿泊者数を取得できませんでした。下の項目は、自施設の月別実績で確認できます。',
        checks: [
          '自施設の月別の外国人宿泊実績を、地域で多い月・少ない月と比べる',
          '地域で外国人宿泊が多い時期に、販売できる客室や料金の設定が整っているか',
          complementMatched
            ? `国内客が少ない${complement.month.month}月前後に、外国人向けの販売（OTA掲載・宿泊プラン・案内の言語）を強められているか`
            : '外国人宿泊が少ない時期に向けて、宿泊プランや販売開始の時期を見直す余地がないか'
        ]
      },
      {
        id: 'reception',
        number: '③',
        title: '自施設は受け入れに対応できているか',
        status: 'self-check',
        data: null,
        selfCheck: '公的統計では施設ごとの受け入れ状況は分かりません。この観点は判定せず、自施設で確認する項目だけを示します。',
        checks: [
          receptionCheck(facility.type),
          '予約ページ・OTA掲載内容（客室写真、設備、料金に含まれるもの、言語）',
          'アクセス・送迎、食事（食事制限への対応を含む）、支払い方法、キャンセル条件の説明'
        ]
      }
    ];
  }

  // 結果の冒頭に出す「最初に確認したいこと」。既存ルールの判定結果（hypotheses[0]）を経営者向けの論点として示す。
  function leadFor(context, topic, matched, hypotheses, comparisons) {
    const ruleId = matched[0]?.id || null;
    if (topic === 'inbound') {
      const share = formatPercent(context.foreignShare);
      const nationalShare = formatPercent(context.nationalForeignShare);
      const evidence = isNumber(context.foreignShare)
        ? [`外国人宿泊比率 ${share}（全国 ${nationalShare}）・${context.statistics.data_period || ''}・延べ宿泊者数に占める割合`]
        : ['外国人延べ宿泊者数：データなし'];
      if (!isNumber(context.statistics.foreign_guest_nights) && !context.inbound) {
        return { title: '自施設の外国人宿泊の実績を、国・地域別と月別に整理できているか', note: '地域の外国人宿泊データを今回は取得できませんでした。まず自施設の予約実績から、国・地域と時期の傾向を確認しましょう。', ruleId, evidence };
      }
      if (ruleId === 'facility-foreign-gap') {
        const row = comparisons.find((item) => item.key === 'foreignShare');
        return { title: '地域と比べて、自施設の外国人宿泊が少ない理由はどこにあるか', note: `入力された外国人宿泊比率（${row.facility}）は、地域値（${row.region}）より10ポイント以上低くなっています。地域で宿泊の多い国・地域に向けた案内や予約経路から確認しましょう。集計対象が異なるため、差は参考としてご覧ください。`, ruleId, evidence };
      }
      if (ruleId === 'inbound-domestic-complement') {
        const complement = context.monthlyProfile.complement;
        const month = complement.month.month;
        return {
          title: '国内客が減る時期に、外国人の宿泊を取り込めているか',
          note: `${context.name}では${month}月、国内客が年平均を${formatPercent(1 - complement.domesticIndex, 0)}下回る一方、外国人は年平均の${timesText(complement.foreignIndex)}になり、宿泊者に占める外国人の割合は${formatPercent(complement.share)}（${context.monthlyProfile.yearLabel}では${formatPercent(complement.annualShare)}）に上がります。自施設でも${month}月前後に外国人の予約が入っているか、その時期の販売や受け入れの準備が整っているかを確認しましょう。`,
          ruleId,
          evidence: [`延べ宿泊者数（第2表）${context.monthlyProfile.period}の月別値・${month}月の外国人の割合 ${formatPercent(complement.share)}、国内客は年平均の${formatPercent(complement.domesticIndex, 0)}`, '国内客は延べ宿泊者数から外国人を除いた値（日本に住む外国人を含む）']
        };
      }
      if (ruleId === 'inbound-seasonality') {
        const season = context.inboundProfile.seasonality;
        return {
          title: '外国人宿泊が集中する時期に、自施設の販売と受け入れが合っているか',
          note: `${context.name}の外国人宿泊は${season.peak.month}月が${season.low.month}月の${timesText(season.ratio)}で、全国（${timesText(season.nationalRatio)}）より季節の差が大きい地域です。地域で多い時期に自施設も予約を取れているか、少ない時期の集客をどう考えるかを確認しましょう。`,
          ruleId,
          evidence: [`外国人延べ宿泊者数 ${season.peak.month}月 ${formatNumber(season.peak.foreign_guest_nights)}人泊・${season.low.month}月 ${formatNumber(season.low.foreign_guest_nights)}人泊（${season.period}・${season.scope}）`, ...evidence]
        };
      }
      if (ruleId === 'inbound-concentration') {
        const concentration = context.inboundProfile.concentration;
        return {
          title: '特定の国・地域への偏りが、自施設の集客にも表れているか',
          note: `${context.name}の外国人宿泊は上位3つの国・地域（${concentration.names.join('・')}）で${formatPercent(concentration.share, 0)}を占め、全国（${formatPercent(concentration.nationalShare, 0)}）より集中しています。自施設の予約も同じ国・地域に偏っているか、偏りが経営上のリスクにならないかを確認しましょう。`,
          ruleId,
          evidence: [`上位3つの国・地域の構成比 ${formatPercent(concentration.share)}（全国 ${formatPercent(concentration.nationalShare)}）・${concentration.period}`, ...evidence]
        };
      }
      if (ruleId === 'inbound-market-opportunity') {
        return { title: '地域の外国人宿泊需要と、自施設の集客状況に違いがないか', note: `${context.name}の外国人宿泊比率は${share}で、全国（${nationalShare}）を上回っています。地域の主要な国・地域と、自施設の予約実績を照らし合わせてみましょう。`, ruleId, evidence };
      }
      return {
        title: '地域で宿泊の多い国・地域と時期が、自施設の実績と合っているか',
        note: isNumber(context.foreignShare)
          ? `地域の外国人宿泊比率は${share}で、全国（${nationalShare}）${{ 全国より高い: 'を上回っています', 全国より低い: 'を下回っています', 全国並み: 'と同程度です' }[compareText(context.foreignShare, context.nationalForeignShare)] || 'との比較はできません'}。需要の大きさだけで判断せず、どの国・地域が、どの時期に宿泊しているかから確認しましょう。`
          : '需要の大きさだけで判断せず、どの国・地域が、どの時期に宿泊しているかから確認しましょう。',
        ruleId,
        evidence
      };
    }
    if (topic === 'sales' && ruleId === 'sales-seasonal-gap') {
      const occupancy = context.monthlyProfile.occupancy;
      return {
        title: '稼働が落ちる月に向けて、販売と運営の手当てができているか',
        note: `${context.name}の客室稼働率は、最も高い${occupancy.peak.month}月が${formatRate1(occupancy.peak.occupancy)}、最も低い${occupancy.low.month}月が${formatRate1(occupancy.low.occupancy)}で、差は${formatNumber(occupancy.gap, 1)}ポイントです。全国（${formatNumber(occupancy.nationalGap, 1)}ポイント）より季節による差が大きい地域です。自施設の月別の稼働率を並べ、${occupancy.low.month}月前後の販売（平日・連泊・法人・団体向けなど）や、休館日・人員配置の組み方を確認しましょう。`,
        ruleId,
        evidence: [`客室稼働率（第8表）${context.monthlyProfile.period}の月別値・${occupancy.peak.month}月 ${formatRate1(occupancy.peak.occupancy)}、${occupancy.low.month}月 ${formatRate1(occupancy.low.occupancy)}`]
      };
    }
    if (topic === 'sales' && !ruleId && context.monthlyProfile?.occupancy) {
      const occupancy = context.monthlyProfile.occupancy;
      const difference = round1(occupancy.low.occupancy - occupancy.nationalAtLow);
      const relation = Math.abs(difference) < 1 ? 'と同程度' : `より${formatNumber(Math.abs(difference), 1)}ポイント${difference < 0 ? '低い水準' : '高い水準'}`;
      return {
        title: '稼働率が下がる月に、自施設の稼働と販売がどうなっているか',
        note: `${context.name}の客室稼働率が最も低いのは${occupancy.low.month}月（${formatRate1(occupancy.low.occupancy)}）で、全国の同じ月（${formatRate1(occupancy.nationalAtLow)}）${relation}です。最も高い${occupancy.peak.month}月（${formatRate1(occupancy.peak.occupancy)}）との差は${formatNumber(occupancy.gap, 1)}ポイント（全国は${formatNumber(occupancy.nationalGap, 1)}ポイント）です。自施設の月別の稼働率を並べ、${occupancy.low.month}月前後の販売や運営の組み方を確認しましょう。`,
        ruleId,
        evidence: [`客室稼働率（第8表）${context.monthlyProfile.period}の月別値・${occupancy.low.month}月 ${formatRate1(occupancy.low.occupancy)}（全国 ${formatRate1(occupancy.nationalAtLow)}）`],
        // 冒頭はテーマの基本案内（hypotheses[0]）を使っていないため、傾向の欄にそのまま残す。
        keepFirstHypothesis: true
      };
    }
    if (topic === 'dx') return dxLead(context, ruleId, hypotheses);
    if (topic === 'market') return marketLead(context, ruleId, hypotheses);
    const titles = {
      dx: '負荷の大きい業務がどこにあるか',
      sales: ruleId === 'facility-occupancy-gap' ? '地域と比べて、自施設の稼働が低い時期や客室はどこか' : '地域の稼働や需要の動きと、自施設の販売状況に違いがないか',
      market: '地域の需要の動きが、自施設の客層や時期に当てはまるか',
      other: '相談したい内容に近いテーマを選ぶ'
    };
    return { title: titles[topic], note: hypotheses[0], ruleId, evidence: [] };
  }

  // 人手不足・DXの冒頭の論点。判定したルールごとに、根拠の数値を添えて示す。
  function dxLead(context, ruleId, hypotheses) {
    const s = context.statistics;
    const profile = context.monthlyProfile;
    const demand = profile?.demand;
    const demandEvidence = demand
      ? [`延べ宿泊者数（第2表）${profile.period}の月別値・${demand.peak.month}月 ${formatNumber(demand.peak.total)}人泊、${demand.low.month}月 ${formatNumber(demand.low.total)}人泊（全国の最多月÷最少月は${timesText(demand.nationalRatio)}）`]
      : [];
    if (ruleId === 'dx-high-workforce-decline') {
      return {
        title: '人を増やしにくい中で、どの業務から省力化するか',
        note: `${context.name}の生産年齢人口は5年前と比べて${formatPercent(s.working_age_population_change_rate, 1, true)}で、宿泊DX必要度は${context.dx.score} / 100（全国${context.dx.rank}位）です。人を増やす前提を置かず、予約管理・問い合わせ対応・集計など、手作業の時間が長い業務から確認しましょう。`,
        ruleId,
        evidence: [`生産年齢人口 5年前比 ${formatPercent(s.working_age_population_change_rate, 1, true)}（人口推計）`, `宿泊DX必要度 ${context.dx.score} / 100（当サイトが公的統計から算出した参考スコア）`]
      };
    }
    if (ruleId === 'dx-seasonal-workload') {
      return {
        title: '繁忙月と閑散月で、人員配置と業務量が合っているか',
        note: `${context.name}の延べ宿泊者数は、最も多い${demand.peak.month}月が最も少ない${demand.low.month}月の${timesText(demand.ratio)}で、全国（${timesText(demand.nationalRatio)}）より繁閑の差が大きい地域です。予約対応・清掃・配膳など宿泊数に比例して増える業務のうち、繁忙月に人手が足りなくなるものと、閑散月に人が余るものを分けて確認しましょう。`,
        ruleId,
        evidence: demandEvidence
      };
    }
    if (ruleId === 'dx-operation-load') {
      return {
        title: '従業者1人あたりの宿泊需要が多い中で、負荷の大きい業務はどこか',
        note: `${context.name}の宿泊業の従業者1人あたり延べ宿泊者数は${formatNumber(s.lodging_demand_per_employee)}人泊で、全国${context.ranks.operationLoad}位です。現場ごとの作業時間や二重入力を測り、負荷の大きい業務から確認しましょう。`,
        ruleId,
        evidence: [`従業者あたり宿泊需要 ${formatNumber(s.lodging_demand_per_employee)}人泊・全国${context.ranks.operationLoad}位（延べ宿泊者数÷宿泊業従業者数）`]
      };
    }
    if (demand) {
      return {
        title: '繁忙月に、どの業務で人手が足りなくなるか',
        note: `${context.name}の延べ宿泊者数が最も多いのは${demand.peak.month}月で、最も少ない${demand.low.month}月の${timesText(demand.ratio)}です（全国は${timesText(demand.nationalRatio)}）。繁忙月にどの業務で人手が足りなくなっているかを確認すると、省力化の対象を絞りやすくなります。`,
        ruleId,
        evidence: demandEvidence,
        keepFirstHypothesis: true
      };
    }
    return { title: '負荷の大きい業務がどこにあるか', note: hypotheses[0], ruleId, evidence: [] };
  }

  // 地域市場の冒頭の論点。
  function marketLead(context, ruleId, hypotheses) {
    const s = context.statistics;
    const n = context.national;
    const profile = context.monthlyProfile;
    const occupancy = profile?.occupancy;
    const demand = profile?.demand;
    const occupancyEvidence = occupancy
      ? [`客室稼働率（第8表）${profile.period}の月別値・${occupancy.peak.month}月 ${formatRate1(occupancy.peak.occupancy)}（全国の同じ月 ${formatRate1(occupancy.nationalAtPeak)}）`]
      : [];
    if (ruleId === 'market-peak-full') {
      return {
        title: '地域の客室が埋まる時期を、自施設の料金や販売に生かせているか',
        note: `${context.name}の客室稼働率は${occupancy.peak.month}月に${formatRate1(occupancy.peak.occupancy)}まで上がり（全国の同じ月は${formatRate1(occupancy.nationalAtPeak)}）、地域全体で客室が埋まりやすい時期があります。周辺が満室に近い時期の料金、販売開始の時期、連泊などの条件を確認しましょう。`,
        ruleId,
        evidence: occupancyEvidence
      };
    }
    if (ruleId === 'market-peak-slack') {
      return {
        title: '繁忙月でも空室が多い地域で、どの需要を取りに行くか',
        note: `${context.name}の客室稼働率は、最も高い${occupancy.peak.month}月でも${formatRate1(occupancy.peak.occupancy)}です（全国の同じ月は${formatRate1(occupancy.nationalAtPeak)}）。地域全体では繁忙期にも客室に余裕があるため、値下げで取り合う前に、自施設がどの客層・時期の需要を取れているかを確認しましょう。`,
        ruleId,
        evidence: occupancyEvidence
      };
    }
    if (ruleId === 'market-growth') {
      const comparison = context.datasets?.statistics?.metadata?.sources?.lodging?.comparison_period;
      return {
        title: '伸びている需要に、自施設の客層や時期が合っているか',
        note: `${context.name}の宿泊需要の伸びは${formatPercent(s.demand_growth_rate, 1, true)}で、全国（${formatPercent(n.demand_growth_rate, 1, true)}）を上回っています。供給不足や新規出店の余地を示すものではないため、伸びているのがどの客層・曜日・時期かを、自施設の予約実績と照らして確認しましょう。2026年1月の調査方法の変更の影響を含む可能性があります。`,
        ruleId,
        evidence: [`延べ宿泊者数の伸び率 ${formatPercent(s.demand_growth_rate, 1, true)}（${s.data_period || ''}${comparison ? `と${comparison}の比較` : ''}）`]
      };
    }
    if (ruleId === 'tourism-context') {
      return {
        title: '需要の変動が、採用や運営にどう響くかを見込めているか',
        note: `${context.name}は、地域人口に対する宿泊需要や宿泊業の比重が相対的に高い地域です（観光負荷参考スコア${context.tourism.pressure_score ?? '算出不可'}・観光依存度参考スコア${context.tourism.dependency_score ?? '算出不可'}）。需要が増える時期・減る時期に、採用や人員配置、運営がどう影響を受けるかをあわせて確認しましょう。`,
        ruleId,
        evidence: [`観光負荷参考スコア ${context.tourism.pressure_score ?? '算出不可'}・観光依存度参考スコア ${context.tourism.dependency_score ?? '算出不可'}（47都道府県内の相対評価）`]
      };
    }
    if (demand && occupancy) {
      return {
        title: '地域の宿泊が多い時期と、自施設の繁忙期は同じか',
        note: `${context.name}の延べ宿泊者数は${demand.peak.month}月が最も多く、${demand.low.month}月が最も少なくなっています（${timesText(demand.ratio)}の差）。客室稼働率が最も高いのは${occupancy.peak.month}月（${formatRate1(occupancy.peak.occupancy)}）です。自施設の繁忙期・閑散期と比べ、ずれがあれば理由を確認しましょう。`,
        ruleId,
        evidence: [`延べ宿泊者数（第2表）・客室稼働率（第8表）${profile.period}の月別値`],
        keepFirstHypothesis: true
      };
    }
    return { title: '地域の需要の動きが、自施設の客層や時期に当てはまるか', note: hypotheses[0], ruleId, evidence: [] };
  }

  // 補足メモの扱い。文章の意味は解釈せず、既存のキーワードと一致したかどうかだけを伝える。
  function questionGuide(question, topic) {
    const text = String(question || '').trim();
    if (!text) return null;
    if (topic === 'dx' && /フロント|電話|問い合わせ|予約管理|予約/.test(text)) {
      return { reflected: true, text: '補足メモの語句（フロント・電話・予約など）に合わせて、確認項目の表現を調整しました。' };
    }
    const example = (TOPIC_EXAMPLES[topic] || []).find((item) => item.text === text && item.guide);
    if (example) return { reflected: true, text: example.guide };
    const suggested = classifyQuestion(text, '');
    if (suggested !== 'other' && suggested !== topic) {
      return { reflected: false, suggestedTopic: suggested, text: `補足メモの内容は「${TOPICS[suggested].label}」のテーマに近い可能性があります。テーマを切り替えると、その観点で整理できます。` };
    }
    return { reflected: false, text: '補足メモの内容は、今回の整理には反映していません。このツールは文章の意味を読み取って回答するものではなく、「人手不足・DX」「インバウンド」「売上・稼働」「地域市場」の4テーマについて、地域統計と確認項目を整理します。' };
  }

  // 「詳しいデータ」に出す月別の表。インバウンドは国内客と外国人、売上・稼働は客室稼働率を全国と並べる。
  function lodgingTable(context, topic) {
    const profile = context.monthlyProfile;
    if (!profile || !['inbound', 'sales', 'dx', 'market'].includes(topic)) return null;
    const marks = new Map();
    const mark = (row, text) => { if (row) marks.set(row.period, [...(marks.get(row.period) || []), text]); };
    if (topic === 'sales' && profile.occupancy) {
      mark(profile.occupancy.peak, '稼働率が最も高い月');
      mark(profile.occupancy.low, '稼働率が最も低い月');
    }
    if (topic === 'inbound' && profile.complement) {
      mark(profile.complement.month, '外国人の割合が最も高い月');
      mark(profile.complement.domesticLow, '国内客が最も少ない月');
    }
    if ((topic === 'dx' || topic === 'market') && profile.demand) {
      mark(profile.demand.peak, '宿泊者が最も多い月');
      mark(profile.demand.low, '宿泊者が最も少ない月');
    }
    if (topic === 'market' && profile.occupancy) mark(profile.occupancy.peak, '稼働率が最も高い月');
    return {
      topic,
      demandMean: profile.demand ? profile.demand.mean : null,
      period: profile.period,
      basisLabel: profile.basisLabel,
      rows: profile.months.map((row) => ({ ...row, marks: marks.get(row.period) || [] }))
    };
  }

  function regionScopeNote(context) {
    return `表示している地域データは${context.name}全体の集計値です。${context.name}内でも温泉地・観光地ごとに客層や繁忙期は異なるため、自施設のある地域の状況とあわせてご確認ください。`;
  }

  function generateInsights(context, selectedTopic, facility = {}, question = '') {
    const topic = classifyQuestion(question, selectedTopic);
    const comparisons = compareFacilityWithRegion(context, facility);
    const matched = RULES
      .filter((rule) => rule.category === topic && rule.condition({ context, facility, comparisons, question }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);
    const fallbacks = {
      dx: '地域の参考スコアだけで優先業務は決まりません。現場の作業時間と転記回数を測り、負荷の大きい業務から確認すると考えやすくなります。',
      inbound: '外国人宿泊需要の大きさだけで対象市場は決まりません。国・地域別構成と自施設の実績を並べて確認することが出発点になります。',
      sales: '地域の稼働率や需要伸びは、自施設の売上を直接説明するものではありません。単価、客室タイプ、曜日、販売経路を分けて確認する必要があります。',
      market: '公的統計から地域の特徴は確認できますが、供給不足や収益性を断定することはできません。競合、価格帯、交通、季節性を追加確認してください。',
      other: 'まず相談テーマを選び、知りたいことを一文で入力してください。都道府県とテーマだけでも、確認の出発点を整理できます。'
    };
    const followups = {
      dx: '導入する仕組みを先に決めず、負荷の大きい業務、入力元、確認者、作業時間の順に整理することが出発点になります。',
      inbound: '自施設の国・地域別実績が分かる場合は、地域構成との差を確認すると、販売・受入対応の仮説を絞りやすくなります。',
      sales: '地域値との差だけで良否は決まりません。自施設の目標、休館日、客室構成も含めた参考比較として扱ってください。',
      market: '地域類型は47都道府県内の相対評価です。施設単位の投資判断には、商圏や競合の個別調査を加える必要があります。'
    };
    const hypotheses = matched.map((rule) => rule.message({ context, facility, comparisons, question }));
    if (!hypotheses.length) hypotheses.push(fallbacks[topic]);
    if (topic !== 'other' && hypotheses.length < 2) hypotheses.push(followups[topic]);

    const missing = [];
    if (!isNumber(context.statistics.occupancy_rate)) missing.push('客室稼働率');
    if (!isNumber(context.statistics.foreign_guest_nights)) missing.push('外国人延べ宿泊者数');
    if (!isNumber(context.statistics.lodging_employees)) missing.push('宿泊業従業者数');
    if (topic !== 'other' && !context.monthlyProfile) missing.push('月別の宿泊統計');

    const lead = leadFor(context, topic, matched, hypotheses, comparisons);

    return {
      topic,
      topicLabel: TOPICS[topic].label,
      lead,
      // 冒頭の論点（hypotheses[0]）以外の判定文を「地域データから見える傾向」に出す。
      trendNotes: lead.keepFirstHypothesis ? hypotheses.slice(0, 2) : hypotheses.slice(1, 3),
      perspectives: topic === 'inbound' ? inboundPerspectives(context, facility) : null,
      seasons: topic === 'inbound' ? inboundSeasons(context) : null,
      lodgingTable: lodgingTable(context, topic),
      regionNote: regionScopeNote(context),
      questionGuide: questionGuide(question, topic),
      facilityType: facility.type || null,
      status: statusFor(context, topic),
      facts: topicFacts(context, topic, comparisons),
      hypotheses: hypotheses.slice(0, 3),
      checklist: checklistFor(topic, question),
      relatedTools: relatedFor(topic).map((tool) => ({
        ...tool,
        href: tool.supportsPref ? `${tool.href}?pref=${encodeURIComponent(context.slug)}` : tool.href
      })),
      comparisons,
      matchedRules: matched.map((rule) => rule.id),
      missing,
      references: topic === 'dx' ? ['01 DXかんたん診断', '04 地域の省人化・DX検討指標', '05 宿泊市場の成長・稼働ポジション']
        : topic === 'inbound' ? ['02 インバウンド宿泊者分析', '05 宿泊市場の成長・稼働ポジション', '06 宿泊集中度・宿泊業依存度']
          : topic === 'sales' ? ['05 宿泊市場の成長・稼働ポジション', '04 地域の省人化・DX検討指標']
            : topic === 'market' ? ['05 宿泊市場の成長・稼働ポジション', '06 宿泊集中度・宿泊業依存度', '02 インバウンド宿泊者分析']
              : ['相談テーマ一覧'],
      usedMetrics: topicFacts(context, topic, comparisons).map((fact) => fact.text)
    };
  }

  globalThis.ManagementAIRules = {
    RULE_VERSION,
    TOPICS,
    FACILITY_FIELDS,
    FOREIGN_SHARE_BASES,
    TOPIC_EXAMPLES,
    inboundMarkets,
    inboundSeasons,
    RULES,
    classifyQuestion,
    resolvePrefectureSlug,
    getRegionContext,
    compareFacilityWithRegion,
    generateInsights,
    formatNumber,
    formatPercent,
    formatRate,
    formatRate1
  };
})();
