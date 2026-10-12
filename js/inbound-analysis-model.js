/*
 * 都道府県別インバウンド宿泊者分析の計算・判定・文言。
 * DOM と通信を持たない純粋関数だけを置き、画面側（inbound-analysis.js）は
 * ここから受け取った値を表示するだけにする。算式・判定ロジックは変更しない。
 * Node（テスト）とブラウザの両方から同じファイルを読む。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InboundAnalysisModel = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const PREFECTURE_SLUGS = [
    ['北海道', 'hokkaido'], ['青森県', 'aomori'], ['岩手県', 'iwate'], ['宮城県', 'miyagi'],
    ['秋田県', 'akita'], ['山形県', 'yamagata'], ['福島県', 'fukushima'], ['茨城県', 'ibaraki'],
    ['栃木県', 'tochigi'], ['群馬県', 'gunma'], ['埼玉県', 'saitama'], ['千葉県', 'chiba'],
    ['東京都', 'tokyo'], ['神奈川県', 'kanagawa'], ['新潟県', 'niigata'], ['富山県', 'toyama'],
    ['石川県', 'ishikawa'], ['福井県', 'fukui'], ['山梨県', 'yamanashi'], ['長野県', 'nagano'],
    ['岐阜県', 'gifu'], ['静岡県', 'shizuoka'], ['愛知県', 'aichi'], ['三重県', 'mie'],
    ['滋賀県', 'shiga'], ['京都府', 'kyoto'], ['大阪府', 'osaka'], ['兵庫県', 'hyogo'],
    ['奈良県', 'nara'], ['和歌山県', 'wakayama'], ['鳥取県', 'tottori'], ['島根県', 'shimane'],
    ['岡山県', 'okayama'], ['広島県', 'hiroshima'], ['山口県', 'yamaguchi'], ['徳島県', 'tokushima'],
    ['香川県', 'kagawa'], ['愛媛県', 'ehime'], ['高知県', 'kochi'], ['福岡県', 'fukuoka'],
    ['佐賀県', 'saga'], ['長崎県', 'nagasaki'], ['熊本県', 'kumamoto'], ['大分県', 'oita'],
    ['宮崎県', 'miyazaki'], ['鹿児島県', 'kagoshima'], ['沖縄県', 'okinawa']
  ];
  const NATIONAL = '全国';
  const numberFormatter = new Intl.NumberFormat('ja-JP');
  const percentFormatter = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const slugToPrefecture = new Map(PREFECTURE_SLUGS.map(function (item) { return [item[1], item[0]]; }));
  const prefectureToSlug = new Map(PREFECTURE_SLUGS);

  function formatNumber(value) {
    return Number.isFinite(value) ? numberFormatter.format(Math.round(value)) : '公表値なし';
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? percentFormatter.format(value * 100) + '%' : '算出不可';
  }

  function formatCompact(value) {
    if (value >= 10000000) return (value / 10000000).toFixed(1).replace(/\.0$/, '') + '千万';
    if (value >= 10000) return (value / 10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
    return formatNumber(value);
  }

  function periodLabel(metadata) {
    return metadata.year + '年' + metadata.month + '月（' + metadata.release_type + '）';
  }

  function validateDataset(data) {
    if (!data || typeof data !== 'object') throw new Error('データ形式が不正です。');
    if (!data.metadata || data.metadata.release_type !== '第2次速報') throw new Error('第2次速報ではありません。');
    if (!data.national || !Number.isFinite(data.national.foreign_guest_nights)) throw new Error('全国値がありません。');
    if (!data.prefectures || Object.keys(data.prefectures).length !== 47) throw new Error('47都道府県が揃っていません。');
    if (!data.national.nationality || !Object.keys(data.national.nationality).length) throw new Error('国籍データがありません。');
    return data;
  }

  // ?pref= の値から表示する地域名を決める（なし→全国、不明→null）
  function resolveArea(slug) {
    if (!slug) return NATIONAL;
    if (slugToPrefecture.has(slug)) return slugToPrefecture.get(slug);
    const code = Number(slug);
    if (Number.isInteger(code) && code >= 1 && code <= PREFECTURE_SLUGS.length) return PREFECTURE_SLUGS[code - 1][0];
    return null;
  }

  function areaSlug(area) {
    return area === NATIONAL ? null : prefectureToSlug.get(area);
  }

  function areaCode(area) {
    return area === NATIONAL ? '00' : String(PREFECTURE_SLUGS.findIndex(function (item) { return item[0] === area; }) + 1).padStart(2, '0');
  }

  function areaRecord(dataset, area) {
    return area === NATIONAL ? dataset.national : dataset.prefectures[area];
  }

  function selectorOptions(dataset, selectedArea) {
    const options = [];
    if (!selectedArea) options.push({ value: '', label: '都道府県を選択してください' });
    options.push({ value: NATIONAL, label: NATIONAL });
    PREFECTURE_SLUGS.forEach(function (item) {
      if (dataset.prefectures[item[0]]) options.push({ value: item[0], label: item[0] });
    });
    return options;
  }

  function marketRows(record, national) {
    const localTotal = record.foreign_guest_nights || 0;
    const nationalTotal = national.foreign_guest_nights || 0;
    return Object.keys(record.nationality)
      .filter(function (name) { return name !== 'その他' && record.nationality[name] > 0; })
      .map(function (name) {
        const value = record.nationality[name] || 0;
        const nationalValue = national.nationality[name] || 0;
        const localShare = localTotal ? value / localTotal : 0;
        const nationalShare = nationalTotal ? nationalValue / nationalTotal : 0;
        const specialization = nationalShare ? localShare / nationalShare : 0;
        return { name: name, value: value, localShare: localShare, nationalShare: nationalShare, specialization: specialization };
      })
      .sort(function (a, b) { return b.value - a.value; });
  }

  function mostSpecialized(markets) {
    return markets.slice().sort(function (a, b) { return b.specialization - a.specialization; })[0];
  }

  function specializationClass(value) {
    if (value >= 1.5) return 'specialization specialization--high';
    if (value >= 1) return 'specialization specialization--mid';
    return 'specialization specialization--low';
  }

  // 期間・集計対象の見出し文
  function headerTexts(dataset) {
    const period = periodLabel(dataset.metadata);
    return {
      'analysis-period': '最新分析月：' + period,
      'analysis-summary': period + ' / ' + dataset.metadata.survey_scope,
      'survey-scope': dataset.metadata.survey_scope
    };
  }

  // 「現在地」の KPI（文字列と、数値ではない表示に付ける状態フラグ）
  function kpiTexts(area, record, markets, national) {
    const largest = markets[0];
    const specialized = mostSpecialized(markets);
    const nationalShare = national.foreign_guest_nights ? record.foreign_guest_nights / national.foreign_guest_nights : 0;
    const isNational = area === NATIONAL;
    return {
      texts: {
        'selected-area-name': area,
        'kpi-total': formatNumber(record.foreign_guest_nights),
        'kpi-total-unit': '人泊',
        'kpi-national-share': isNational ? '100.0%' : formatPercent(nationalShare),
        'kpi-share-note': isNational ? '分析対象の全国計' : '全国値に占める割合',
        'kpi-largest-market': largest ? largest.name : '—',
        'kpi-largest-value': largest ? formatNumber(largest.value) + '人泊' : '該当データなし',
        'kpi-specialized-market': isNational ? '—' : specialized ? specialized.name : '—',
        'kpi-specialized-value': isNational ? '都道府県を選ぶと表示' : specialized ? '全国平均の' + specialized.specialization.toFixed(2) + '倍' : '該当データなし'
      },
      status: {
        'kpi-total': !Number.isFinite(record.foreign_guest_nights),
        'kpi-national-share': !Number.isFinite(nationalShare),
        'kpi-largest-market': true,
        'kpi-specialized-market': true
      }
    };
  }

  // 月次推移の棒グラフ座標とラベル（SVG の組み立ては画面側）
  function trendLayout(area, monthly) {
    if (!monthly || !monthly.length) return { empty: '月次データを表示できません。' };
    const width = 760;
    const height = 300;
    const padding = { top: 28, right: 18, bottom: 48, left: 62 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max.apply(null, monthly.map(function (item) { return item.foreign_guest_nights; })) || 1;
    const groupWidth = plotWidth / monthly.length;
    const barWidth = Math.min(34, groupWidth * 0.58);
    const grid = [0, 0.5, 1].map(function (ratio) {
      const y = padding.top + plotHeight * (1 - ratio);
      return { x1: padding.left, y: y, x2: width - padding.right, labelX: padding.left - 10, labelY: y + 4, label: formatCompact(maxValue * ratio) };
    });
    const bars = monthly.map(function (item, index) {
      const value = item.foreign_guest_nights;
      const barHeight = plotHeight * (value / maxValue);
      const x = padding.left + index * groupWidth + (groupWidth - barWidth) / 2;
      const bar = {
        x: x, y: padding.top + plotHeight - barHeight, width: barWidth, height: Math.max(1, barHeight),
        title: item.year + '年' + item.month + '月：' + formatNumber(value) + '人泊',
        axisX: x + barWidth / 2, axisY: height - 21, axisLabel: String(item.year).slice(2) + '/' + item.month,
        valueLabel: item.year + '年' + item.month + '月', valueText: formatNumber(value) + '人泊'
      };
      if (item.year === 2026 && item.month === 1) {
        bar.boundary = { x: x - groupWidth * 0.2, y1: padding.top, y2: padding.top + plotHeight, labelX: x - groupWidth * 0.2 + 5, labelY: padding.top + 11, label: '注意：基準変更' };
      }
      return bar;
    });
    return { viewBox: '0 0 ' + width + ' ' + height, grid: grid, bars: bars, ariaLabel: area + 'の直近' + monthly.length + 'か月の外国人延べ宿泊者数' };
  }

  // 多く泊まっている国・地域 TOP10
  function rankingRows(markets) {
    const top = markets.slice(0, 10);
    const maxValue = top.length ? top[0].value : 1;
    return top.map(function (market, index) {
      return { rank: String(index + 1).padStart(2, '0'), name: market.name, value: formatNumber(market.value) + '人泊', width: Math.max(1, market.value / maxValue * 100) + '%' };
    });
  }

  function candidateReason(market) {
    if (market.specialization >= 1.5 && market.localShare >= 0.05) return '宿泊者数に厚みがあり、全国平均より宿泊比率が高い市場です。';
    if (market.specialization >= 1.5) return '全国平均より宿泊比率が高く、この地域に特徴的な市場候補です。';
    if (market.localShare >= 0.1) return '宿泊者数が多く、地域内シェアも高い市場です。';
    if (market.specialization >= 1) return '一定の市場規模があり、構成比が全国平均を上回っています。';
    return '地域内で一定の宿泊者数が確認できる市場です。';
  }

  // 詳しく調べたい市場候補（市場規模60%＋地域特化度40%、上位3件）
  function candidates(markets) {
    const maxValue = markets.length ? markets[0].value : 1;
    return markets.map(function (market) {
      const sizeScore = maxValue ? market.value / maxValue : 0;
      const specializationScore = Math.min(market.specialization / 2.5, 1);
      return Object.assign({}, market, { score: sizeScore * 0.6 + specializationScore * 0.4 });
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3).map(function (market, index) {
      return { number: String(index + 1), name: market.name, score: '注目度 ' + Math.round(market.score * 100), reason: candidateReason(market) };
    });
  }

  // 全国との比較表（上位10市場）
  function comparisonRows(markets) {
    return markets.slice(0, 10).map(function (market) {
      return {
        cells: [
          ['市場', market.name],
          ['宿泊者数', formatNumber(market.value) + '人泊'],
          ['地域シェア', formatPercent(market.localShare)],
          ['全国シェア', formatPercent(market.nationalShare)]
        ],
        specialization: market.specialization.toFixed(2),
        specializationClass: specializationClass(market.specialization)
      };
    });
  }

  // 集客・販売へのヒント（段落の配列）
  function insightTexts(area, markets) {
    if (!markets.length) return ['国・地域別データを確認できません。'];
    const largest = markets[0];
    const specialized = mostSpecialized(markets);
    const first = area + 'で最も多いのは' + largest.name + '（' + formatNumber(largest.value) + '人泊、外国人延べ宿泊者数の' + formatPercent(largest.localShare) + '）。自施設でも多い市場か、同じ月の実績と比べてみてください。';
    let second;
    if (area === NATIONAL) {
      second = '全国の傾向を表示しています。宿のある都道府県を選ぶと、地域に多い市場と全国との違いを確認できます。';
    } else if (specialized.specialization > 1) {
      second = specialized.name + 'の構成比は全国の' + specialized.specialization.toFixed(2) + '倍（地域内' + formatPercent(specialized.localShare) + '、' + formatNumber(specialized.value) + '人泊）。' + (specialized.name === largest.name ? '規模・構成比の両面から、自施設の販売経路を確認する候補です。' : '規模も確かめながら、自施設の販売経路を確認する候補に。');
    } else {
      second = '表示対象の市場に、全国より構成比が高い市場はありません。まずは宿泊人泊の多い市場から、自施設の客層や販売経路との違いを確認してください。';
    }
    return [first, second];
  }

  // 出典・更新日ブロックの行
  function sourceEntries(metadata) {
    return [
      { name: '出典', text: '観光庁「宿泊旅行統計調査」↗', url: metadata.source_url },
      { name: '最新分析月', text: periodLabel(metadata) },
      { name: '単位', text: metadata.unit },
      { name: '集計対象', text: metadata.survey_scope }
    ];
  }

  function sourceUpdated(metadata) {
    return metadata.updated_at.replace(/-/g, '.');
  }

  function emptyMessage() {
    return '指定された都道府県を確認できません。選択欄から選び直してください。';
  }

  return {
    PREFECTURE_SLUGS: PREFECTURE_SLUGS, NATIONAL: NATIONAL,
    formatNumber: formatNumber, formatPercent: formatPercent, formatCompact: formatCompact, periodLabel: periodLabel,
    validateDataset: validateDataset, resolveArea: resolveArea, areaSlug: areaSlug, areaCode: areaCode, areaRecord: areaRecord,
    selectorOptions: selectorOptions, marketRows: marketRows, specializationClass: specializationClass,
    headerTexts: headerTexts, kpiTexts: kpiTexts, trendLayout: trendLayout, rankingRows: rankingRows,
    candidateReason: candidateReason, candidates: candidates, comparisonRows: comparisonRows, insightTexts: insightTexts,
    sourceEntries: sourceEntries, sourceUpdated: sourceUpdated, emptyMessage: emptyMessage
  };
});
