(() => {
  'use strict';

  const TOPICS = {
    dx: { label: '人手不足・DX', keywords: ['人手不足', '採用', 'スタッフ', '省人化', 'フロント', '清掃', '予約管理', '電話', '問い合わせ', '集計'] },
    inbound: { label: 'インバウンド', keywords: ['外国人', 'インバウンド', '海外', '中国', '台湾', '韓国', '欧米'] },
    sales: { label: '売上・稼働', keywords: ['売上', '稼働', 'adr', '客単価', '集客', '予約'] },
    market: { label: '地域市場', keywords: ['市場', '競合', '出店', '地域', '需要', '供給', 'ホテル不足'] },
    other: { label: 'その他', keywords: [] }
  };

  const RELATED_TOOLS = {
    diagnosis: { number: '01', label: 'DXかんたん診断を見る', href: 'dx-diagnosis.html' },
    inbound: { number: '02', label: 'インバウンド分析を見る', href: 'inbound-analysis.html' },
    dx: { number: '04', label: '宿泊DX必要度を見る', href: 'dx-necessity-analysis.html' },
    supply: { number: '05', label: '宿泊市場需給を見る', href: 'supply-demand-gap-analysis.html' },
    tourism: { number: '06', label: '観光負荷・観光依存度を見る', href: 'tourism-pressure-analysis.html' }
  };

  const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  const formatNumber = (value, digits = 0) => isNumber(value)
    ? new Intl.NumberFormat('ja-JP', { maximumFractionDigits: digits }).format(value)
    : 'データなし';
  const formatPercent = (value, digits = 1, signed = false) => isNumber(value)
    ? `${signed && value >= 0 ? '+' : ''}${formatNumber(value * 100, digits)}%`
    : 'データなし';
  const formatRate = (value, digits = 1) => isNumber(value) ? `${formatNumber(value, digits)}%` : 'データなし';

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
      specializedMarket: specialization(datasets.inbound, statistics.prefecture_name)
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
        rawDifference: difference
      });
    }
    if (isNumber(facility.foreignShare) && isNumber(context.foreignShare)) {
      const regionRate = context.foreignShare * 100;
      const difference = facility.foreignShare - regionRate;
      comparisons.push({
        key: 'foreignShare',
        label: '外国人宿泊比率',
        facility: formatRate(facility.foreignShare),
        region: formatRate(regionRate),
        difference: `${difference >= 0 ? '+' : ''}${formatNumber(difference, 1)}pt`,
        rawDifference: difference
      });
    }
    if (isNumber(facility.rooms) && facility.rooms > 0 && isNumber(facility.employees) && facility.employees > 0) {
      comparisons.push({
        key: 'roomsPerEmployee',
        label: '1従業員あたり客室数（参考値）',
        facility: `${formatNumber(facility.rooms / facility.employees, 1)}室`,
        region: '比較対象なし',
        difference: '自施設内の参考値',
        rawDifference: null
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
      condition: ({ context, comparisons }) => comparisons.some((row) => row.key === 'foreignShare' && row.rawDifference <= -10) && isNumber(context.foreignShare) && context.foreignShare > context.nationalForeignShare,
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
      id: 'tourism-context', category: 'market', priority: 60,
      condition: ({ context }) => context.tourism.pressure_score >= 60 || context.tourism.dependency_score >= 60,
      message: () => '地域人口に対する宿泊需要や宿泊業の比重が相対的に高いため、需要変動が採用や運営へ与える影響も合わせて確認するとよい可能性があります。'
    }
  ];

  function topicFacts(context, topic, comparisons) {
    const s = context.statistics;
    const n = context.national;
    const facts = [];
    const add = (symbol, text) => facts.push({ symbol, text });
    if (topic === 'dx') {
      add('→', `宿泊DX必要度は${context.dx.score == null ? '算出不可' : `${context.dx.score} / 100・全国${context.dx.rank}位`}`);
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${compareText(s.demand_growth_rate, n.demand_growth_rate)}（${formatPercent(s.demand_growth_rate, 1, true)}）です`);
      add(isNumber(context.ranks.operationLoad) && context.ranks.operationLoad <= 15 ? '↑' : '→', isNumber(s.lodging_demand_per_employee) && isNumber(context.ranks.operationLoad)
        ? `従業者あたり宿泊需要は${formatNumber(s.lodging_demand_per_employee)}人泊・全国${context.ranks.operationLoad}位です`
        : '従業者あたり宿泊需要は現在データを取得できません');
      add(s.working_age_population_change_rate < 0 ? '↓' : '→', `生産年齢人口は5年前比${formatPercent(s.working_age_population_change_rate, 1, true)}です`);
    } else if (topic === 'inbound') {
      add('→', `年間外国人延べ宿泊者数は${formatNumber(s.foreign_guest_nights)}人泊です`);
      add(trendSymbol(context.foreignShare, context.nationalForeignShare), `外国人宿泊比率は${formatPercent(context.foreignShare)}で${compareText(context.foreignShare, context.nationalForeignShare)}です`);
      if (context.specializedMarket) add('→', `最新月は「${context.specializedMarket.name}」の構成比が全国構成に対して相対的に高い傾向です`);
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`);
    } else if (topic === 'sales') {
      add(trendSymbol(s.occupancy_rate, n.occupancy_rate, 'rate'), `地域の客室稼働率は${formatRate(s.occupancy_rate)}で${compareText(s.occupancy_rate, n.occupancy_rate, 'rate')}です`);
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${formatPercent(s.demand_growth_rate, 1, true)}で${compareText(s.demand_growth_rate, n.demand_growth_rate)}です`);
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`);
      const occupancy = comparisons.find((row) => row.key === 'occupancy');
      if (occupancy) add(occupancy.rawDifference >= 0 ? '↑' : '↓', `自施設の稼働率は地域値との差が${occupancy.difference}です`);
    } else if (topic === 'market') {
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`);
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${formatPercent(s.demand_growth_rate, 1, true)}で${compareText(s.demand_growth_rate, n.demand_growth_rate)}です`);
      add('→', `観光負荷参考スコアは${context.tourism.pressure_score ?? '算出不可'}、観光依存度参考スコアは${context.tourism.dependency_score ?? '算出不可'}です`);
      add('→', `地域類型は「${context.tourism.region_type}」です`);
    } else {
      add('→', '「人手不足・DX」では業務負荷と人材環境を確認できます');
      add('→', '「インバウンド」では外国人宿泊需要と国・地域別構成を確認できます');
      add('→', '「売上・稼働」では地域稼働率と自施設を参考比較できます');
      add('→', '「地域市場」では需給と観光の地域特性を確認できます');
    }
    return facts.slice(0, 4);
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

    return {
      topic,
      topicLabel: TOPICS[topic].label,
      status: statusFor(context, topic),
      facts: topicFacts(context, topic, comparisons),
      hypotheses: hypotheses.slice(0, 3),
      checklist: checklistFor(topic, question),
      relatedTools: relatedFor(topic).map((tool) => ({ ...tool, href: `${tool.href}?pref=${encodeURIComponent(context.slug)}` })),
      comparisons,
      matchedRules: matched.map((rule) => rule.id),
      missing,
      references: topic === 'dx' ? ['01 DXかんたん診断', '04 宿泊DX必要度分析', '05 宿泊市場需給ギャップ分析']
        : topic === 'inbound' ? ['02 インバウンド宿泊者分析', '05 宿泊市場需給ギャップ分析', '06 観光負荷・観光依存度分析']
          : topic === 'sales' ? ['05 宿泊市場需給ギャップ分析', '04 宿泊DX必要度分析']
            : topic === 'market' ? ['05 宿泊市場需給ギャップ分析', '06 観光負荷・観光依存度分析', '02 インバウンド宿泊者分析']
              : ['相談テーマ一覧'],
      usedMetrics: topicFacts(context, topic, comparisons).map((fact) => fact.text)
    };
  }

  globalThis.ManagementAIRules = {
    TOPICS,
    RULES,
    classifyQuestion,
    resolvePrefectureSlug,
    getRegionContext,
    compareFacilityWithRegion,
    generateInsights,
    formatNumber,
    formatPercent,
    formatRate
  };
})();
