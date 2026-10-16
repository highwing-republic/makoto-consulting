(() => {
  'use strict';

  // 1.1.0: 外国人宿泊比率は「延べ宿泊者数（人泊）」で数えた場合だけ地域値との差を判定する。
  const RULE_VERSION = '1.1.0';

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
    } else if (topic === 'inbound') {
      add('→', `年間外国人延べ宿泊者数は${formatNumber(s.foreign_guest_nights)}人泊です`, `${lodgingPeriod}の合計・単位は人泊（1人が2泊すると2人泊）。国・地域別や月別の値とは集計表が異なるため、合計は一致しません`);
      add(trendSymbol(context.foreignShare, context.nationalForeignShare), `外国人宿泊比率は${formatPercent(context.foreignShare)}で${compareText(context.foreignShare, context.nationalForeignShare)}です`, `延べ宿泊者数に占める外国人の割合・${lodgingPeriod}・全国は${formatPercent(context.nationalForeignShare)}`);
      if (context.specializedMarket) add('→', `最新月は「${context.specializedMarket.name}」の構成比が全国構成に対して相対的に高い傾向です`, `${inboundMonth}の国・地域別集計`);
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`, '宿泊市場の成長・稼働ポジションでの類型（当サイトの参考分類）');
    } else if (topic === 'sales') {
      add(trendSymbol(s.occupancy_rate, n.occupancy_rate, 'rate'), `地域の客室稼働率は${formatRate(s.occupancy_rate)}で${compareText(s.occupancy_rate, n.occupancy_rate, 'rate')}です`, `${lodgingPeriod}・全国は${formatRate(n.occupancy_rate)}`);
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${formatPercent(s.demand_growth_rate, 1, true)}で${compareText(s.demand_growth_rate, n.demand_growth_rate)}です`, `延べ宿泊者数・${growthPeriod}`);
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`, '宿泊市場の成長・稼働ポジションでの類型（当サイトの参考分類）');
      const occupancy = comparisons.find((row) => row.key === 'occupancy');
      if (occupancy) add(occupancy.rawDifference >= 0 ? '↑' : '↓', `自施設の稼働率は地域値との差が${occupancy.difference}です`, '入力値と地域統計の参考比較（集計期間・対象施設が異なります）');
    } else if (topic === 'market') {
      add('→', `宿泊市場タイプは「${context.supply.market_type}」です`, '宿泊市場の成長・稼働ポジションでの類型（当サイトの参考分類）');
      add(trendSymbol(s.demand_growth_rate, n.demand_growth_rate), `宿泊需要の伸びは${formatPercent(s.demand_growth_rate, 1, true)}で${compareText(s.demand_growth_rate, n.demand_growth_rate)}です`, `延べ宿泊者数・${growthPeriod}`);
      add('→', `観光負荷参考スコアは${context.tourism.pressure_score ?? '算出不可'}、観光依存度参考スコアは${context.tourism.dependency_score ?? '算出不可'}です`, '宿泊集中度・宿泊業依存度の参考スコア（47都道府県内の相対評価）');
      add('→', `地域類型は「${context.tourism.region_type}」です`, '宿泊集中度・宿泊業依存度での類型（当サイトの参考分類）');
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
        ...(markets.specialized ? [{ label: '全国と比べて構成比が高い', value: `${markets.specialized.name}（地域特化度${markets.specialized.specialization.toFixed(2)}）` }] : [])
      ],
      note: `${markets.period}の1か月分・${markets.scope}・単位は人泊。季節によって構成は変わるため、②の時期とあわせてご覧ください。${markets.specialized ? '地域特化度は「地域内の構成比÷全国の構成比」で、1を超えると全国より構成比が高い国・地域です。宿泊数が少なくても高くなることがあります。' : ''}`
    } : null;
    const seasonLines = seasons ? seasons.segments.filter((segment) => segment.peak).map((segment) => ({
      label: `${segment.label}${seasons.scopeChanged ? `（${segment.scope}）` : ''}`,
      value: `多い月 ${segment.peak.month}月（${fmt(segment.peak.foreign_guest_nights)}）\n少ない月 ${segment.low.month}月（${fmt(segment.low.foreign_guest_nights)}）`
    })) : [];
    const seasonData = seasonLines.length ? {
      lines: seasonLines,
      note: seasons.scopeChanged
        ? `宿泊旅行統計調査は${seasons.segments[1].months[0].year}年${seasons.segments[1].months[0].month}月から集計・層化基準が変わり、集計対象が「${seasons.segments[0].scope}」から「${seasons.segments[1].scope}」になりました。対象が異なる期間どうしでは多い・少ないを比べず、期間ごとに分けて表示しています。単位は人泊。`
        : `${seasons.period}・${seasons.segments[0].scope}・単位は人泊。`
    } : null;
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
          '外国人宿泊が少ない時期に向けて、宿泊プランや販売開始の時期を見直す余地がないか'
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
      if (ruleId === 'inbound-market-opportunity') {
        return { title: '地域の外国人宿泊需要と、自施設の集客状況に違いがないか', note: '地域の外国人宿泊比率は全国を上回っています。地域の主要な国・地域と、自施設の予約実績を照らし合わせてみましょう。', ruleId, evidence };
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
    const titles = {
      dx: '負荷の大きい業務がどこにあるか',
      sales: ruleId === 'facility-occupancy-gap' ? '地域と比べて、自施設の稼働が低い時期や客室はどこか' : '地域の稼働や需要の動きと、自施設の販売状況に違いがないか',
      market: '地域の需要の動きが、自施設の客層や時期に当てはまるか',
      other: '相談したい内容に近いテーマを選ぶ'
    };
    return { title: titles[topic], note: hypotheses[0], ruleId, evidence: [] };
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

    const lead = leadFor(context, topic, matched, hypotheses, comparisons);

    return {
      topic,
      topicLabel: TOPICS[topic].label,
      lead,
      // 冒頭の論点（hypotheses[0]）以外の判定文を「地域データから見える傾向」に出す。
      trendNotes: hypotheses.slice(1, 3),
      perspectives: topic === 'inbound' ? inboundPerspectives(context, facility) : null,
      seasons: topic === 'inbound' ? inboundSeasons(context) : null,
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
    formatRate
  };
})();
