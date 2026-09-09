(function () {
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

  const byId = function (id) { return document.getElementById(id); };
  const numberFormatter = new Intl.NumberFormat('ja-JP');
  const percentFormatter = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const slugToPrefecture = new Map(PREFECTURE_SLUGS.map(function (item) { return [item[1], item[0]]; }));
  const prefectureToSlug = new Map(PREFECTURE_SLUGS);
  let dataset = null;

  function formatNumber(value) {
    return numberFormatter.format(Math.round(value || 0));
  }

  function formatPercent(value) {
    return percentFormatter.format((value || 0) * 100) + '%';
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
  }

  function getInitialArea() {
    const slug = new URLSearchParams(window.location.search).get('pref');
    return slugToPrefecture.get(slug) || '全国';
  }

  function populateSelector(selectedArea) {
    const select = byId('prefecture-select');
    select.textContent = '';
    const nationalOption = document.createElement('option');
    nationalOption.value = '全国';
    nationalOption.textContent = '全国';
    select.appendChild(nationalOption);
    PREFECTURE_SLUGS.forEach(function (item) {
      if (!dataset.prefectures[item[0]]) return;
      const option = document.createElement('option');
      option.value = item[0];
      option.textContent = item[0];
      select.appendChild(option);
    });
    select.value = selectedArea;
    select.disabled = false;
  }

  function getMarketRows(record) {
    const localTotal = record.foreign_guest_nights || 0;
    const nationalTotal = dataset.national.foreign_guest_nights || 0;
    return Object.keys(record.nationality)
      .filter(function (name) { return name !== 'その他' && record.nationality[name] > 0; })
      .map(function (name) {
        const value = record.nationality[name] || 0;
        const nationalValue = dataset.national.nationality[name] || 0;
        const localShare = localTotal ? value / localTotal : 0;
        const nationalShare = nationalTotal ? nationalValue / nationalTotal : 0;
        const specialization = nationalShare ? localShare / nationalShare : 0;
        return { name: name, value: value, localShare: localShare, nationalShare: nationalShare, specialization: specialization };
      })
      .sort(function (a, b) { return b.value - a.value; });
  }

  function specializationClass(value) {
    if (value >= 1.5) return 'specialization specialization--high';
    if (value >= 1) return 'specialization specialization--mid';
    return 'specialization specialization--low';
  }

  function renderKpis(area, record, markets) {
    const largest = markets[0];
    const specialized = markets.slice().sort(function (a, b) { return b.specialization - a.specialization; })[0];
    const nationalShare = dataset.national.foreign_guest_nights ? record.foreign_guest_nights / dataset.national.foreign_guest_nights : 0;

    byId('selected-area-name').textContent = area;
    byId('kpi-total').textContent = formatNumber(record.foreign_guest_nights);
    byId('kpi-total-unit').textContent = '人泊';
    byId('kpi-national-share').textContent = area === '全国' ? '100.0%' : formatPercent(nationalShare);
    byId('kpi-share-note').textContent = area === '全国' ? '分析対象の全国計' : '全国値に占める割合';
    byId('kpi-largest-market').textContent = largest ? largest.name : '—';
    byId('kpi-largest-value').textContent = largest ? formatNumber(largest.value) + '人泊' : '該当データなし';
    if (area === '全国') {
      byId('kpi-specialized-market').textContent = '—';
      byId('kpi-specialized-value').textContent = '都道府県を選ぶと表示';
    } else {
      byId('kpi-specialized-market').textContent = specialized ? specialized.name : '—';
      byId('kpi-specialized-value').textContent = specialized ? '全国平均の' + specialized.specialization.toFixed(2) + '倍' : '該当データなし';
    }
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
    if (!monthly || !monthly.length) {
      container.textContent = '月次データを表示できません。';
      return;
    }

    const width = 760;
    const height = 300;
    const padding = { top: 28, right: 18, bottom: 48, left: 62 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max.apply(null, monthly.map(function (item) { return item.foreign_guest_nights; })) || 1;
    const groupWidth = plotWidth / monthly.length;
    const barWidth = Math.min(34, groupWidth * 0.58);
    const svg = createSvgElement('svg', { viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': 'true', focusable: 'false' });

    [0, 0.5, 1].forEach(function (ratio) {
      const y = padding.top + plotHeight * (1 - ratio);
      svg.appendChild(createSvgElement('line', { x1: padding.left, y1: y, x2: width - padding.right, y2: y, class: 'trend-grid-line' }));
      svg.appendChild(createSvgElement('text', { x: padding.left - 10, y: y + 4, class: 'trend-axis-label', 'text-anchor': 'end' }, formatCompact(maxValue * ratio)));
    });

    monthly.forEach(function (item, index) {
      const value = item.foreign_guest_nights;
      const barHeight = plotHeight * (value / maxValue);
      const x = padding.left + index * groupWidth + (groupWidth - barWidth) / 2;
      const y = padding.top + plotHeight - barHeight;
      const bar = createSvgElement('rect', { x: x, y: y, width: barWidth, height: Math.max(1, barHeight), class: 'trend-bar' });
      bar.appendChild(createSvgElement('title', {}, item.year + '年' + item.month + '月：' + formatNumber(value) + '人泊'));
      svg.appendChild(bar);
      svg.appendChild(createSvgElement('text', { x: x + barWidth / 2, y: height - 21, class: 'trend-axis-label', 'text-anchor': 'middle' }, String(item.year).slice(2) + '/' + item.month));

      if (item.year === 2026 && item.month === 1) {
        svg.appendChild(createSvgElement('line', { x1: x - groupWidth * 0.2, y1: padding.top, x2: x - groupWidth * 0.2, y2: padding.top + plotHeight, class: 'trend-boundary-line' }));
        svg.appendChild(createSvgElement('text', { x: x - groupWidth * 0.2 + 5, y: padding.top + 11, class: 'trend-boundary-label' }, '基準変更'));
      }

      const valueItem = document.createElement('div');
      const label = document.createElement('span');
      const strong = document.createElement('strong');
      label.textContent = item.year + '年' + item.month + '月';
      strong.textContent = formatNumber(value) + '人泊';
      valueItem.append(label, strong);
      valuesContainer.appendChild(valueItem);
    });
    container.setAttribute('aria-label', area + 'の直近' + monthly.length + 'か月の外国人延べ宿泊者数');
    container.appendChild(svg);
  }

  function renderRanking(markets) {
    const list = byId('market-ranking');
    list.textContent = '';
    const top = markets.slice(0, 10);
    const maxValue = top.length ? top[0].value : 1;
    top.forEach(function (market, index) {
      const item = document.createElement('li');
      const rank = document.createElement('span');
      const details = document.createElement('div');
      const heading = document.createElement('div');
      const name = document.createElement('strong');
      const value = document.createElement('span');
      const bar = document.createElement('span');
      const fill = document.createElement('span');
      rank.className = 'market-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      details.className = 'market-ranking__details';
      heading.className = 'market-ranking__heading';
      name.textContent = market.name;
      value.textContent = formatNumber(market.value) + '人泊';
      bar.className = 'market-bar';
      fill.style.width = Math.max(1, market.value / maxValue * 100) + '%';
      bar.appendChild(fill);
      heading.append(name, value);
      details.append(heading, bar);
      item.append(rank, details);
      list.appendChild(item);
    });
  }

  function candidateReason(market) {
    if (market.specialization >= 1.5 && market.localShare >= 0.05) return '宿泊者数に厚みがあり、全国平均より宿泊比率が高い市場です。';
    if (market.specialization >= 1.5) return '全国平均より宿泊比率が高く、この地域に特徴的な市場候補です。';
    if (market.localShare >= 0.1) return '宿泊者数が多く、地域内シェアも高い市場です。';
    if (market.specialization >= 1) return '一定の市場規模があり、構成比が全国平均を上回っています。';
    return '地域内で一定の宿泊者数が確認できる市場です。';
  }

  function renderCandidates(markets) {
    const list = byId('candidate-list');
    list.textContent = '';
    const maxValue = markets.length ? markets[0].value : 1;
    const scored = markets.map(function (market) {
      const sizeScore = maxValue ? market.value / maxValue : 0;
      const specializationScore = Math.min(market.specialization / 2.5, 1);
      return Object.assign({}, market, { score: sizeScore * 0.6 + specializationScore * 0.4 });
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3);

    scored.forEach(function (market, index) {
      const item = document.createElement('li');
      const number = document.createElement('span');
      const content = document.createElement('div');
      const heading = document.createElement('div');
      const title = document.createElement('strong');
      const score = document.createElement('span');
      const reason = document.createElement('p');
      number.className = 'candidate-number';
      number.textContent = String(index + 1);
      title.textContent = market.name;
      score.textContent = '注目度 ' + Math.round(market.score * 100);
      reason.textContent = candidateReason(market);
      heading.append(title, score);
      content.append(heading, reason);
      item.append(number, content);
      list.appendChild(item);
    });
  }

  function renderComparison(markets) {
    const body = byId('comparison-body');
    body.textContent = '';
    markets.slice(0, 10).forEach(function (market) {
      const row = document.createElement('tr');
      const values = [
        ['市場', market.name],
        ['宿泊者数', formatNumber(market.value) + '人泊'],
        ['地域シェア', formatPercent(market.localShare)],
        ['全国シェア', formatPercent(market.nationalShare)]
      ];
      values.forEach(function (item, index) {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row';
        cell.dataset.label = item[0];
        cell.textContent = item[1];
        row.appendChild(cell);
      });
      const specializationCell = document.createElement('td');
      const badge = document.createElement('span');
      specializationCell.dataset.label = '地域特化度';
      badge.className = specializationClass(market.specialization);
      badge.textContent = market.specialization.toFixed(2);
      specializationCell.appendChild(badge);
      row.appendChild(specializationCell);
      body.appendChild(row);
    });
  }

  function renderInsight(area, markets) {
    const container = byId('short-insight');
    container.textContent = '';
    if (!markets.length) {
      const paragraph = document.createElement('p');
      paragraph.textContent = '国・地域別データを確認できません。';
      container.appendChild(paragraph);
      return;
    }
    const largest = markets[0];
    const specialized = markets.slice().sort(function (a, b) { return b.specialization - a.specialization; })[0];
    const first = document.createElement('p');
    const second = document.createElement('p');
    const third = document.createElement('p');
    first.textContent = area + 'では、' + largest.name + 'からの宿泊者数が最も多く、' + formatNumber(largest.value) + '人泊となっています。';
    if (area === '全国') {
      second.textContent = '都道府県を選択すると、全国の構成比との差から、その地域で相対的に強い市場を確認できます。';
    } else {
      second.textContent = '全国平均との差を見ると、' + specialized.name + '市場の地域特化度は' + specialized.specialization.toFixed(2) + 'で、相対的に特徴のある市場候補です。';
    }
    third.textContent = '単純な宿泊者数に加えて「全国より相対的に強い市場」を見ることで、集客施策の優先順位を考える材料になります。';
    container.append(first, second, third);
  }

  function updateUrl(area) {
    const url = new URL(window.location.href);
    if (area === '全国') url.searchParams.delete('pref');
    else url.searchParams.set('pref', prefectureToSlug.get(area));
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  function renderArea(area, updateAddress) {
    const record = area === '全国' ? dataset.national : dataset.prefectures[area];
    if (!record) return;
    const markets = getMarketRows(record);
    const period = periodLabel(dataset.metadata);
    byId('analysis-period').textContent = '最新分析月：' + period;
    byId('analysis-summary').textContent = period + ' / ' + dataset.metadata.survey_scope;
    byId('survey-scope').textContent = dataset.metadata.survey_scope;
    renderKpis(area, record, markets);
    renderTrend(area, record.monthly);
    renderRanking(markets);
    renderCandidates(markets);
    renderComparison(markets);
    renderInsight(area, markets);
    if (updateAddress) updateUrl(area);
  }

  function setSourceMetadata() {
    const metadata = dataset.metadata;
    const period = periodLabel(metadata);
    byId('source-period').textContent = period;
    byId('source-updated').textContent = metadata.updated_at.replace(/-/g, '.');
    byId('source-unit').textContent = metadata.unit;
    byId('source-scope').textContent = metadata.survey_scope;
    byId('source-link').href = metadata.source_url;
  }

  function showError(error) {
    console.error(error);
    const errorPanel = byId('data-error');
    const title = document.createElement('strong');
    const message = document.createElement('p');
    const retry = document.createElement('button');
    title.textContent = '現在、最新統計を取得できません';
    message.textContent = '時間をおいて再度お試しください。統計を取得できない場合は数値を表示しません。';
    retry.className = 'button button--outline';
    retry.type = 'button';
    retry.textContent = '再読み込みする';
    retry.addEventListener('click', loadData);
    errorPanel.replaceChildren(title, message, retry);
    byId('data-loading').hidden = true;
    byId('analysis-dashboard').hidden = true;
    byId('analysis-dashboard').inert = true;
    byId('analysis-dashboard').setAttribute('aria-hidden', 'true');
    errorPanel.hidden = false;
    byId('analysis-period').textContent = '最新統計を取得できません';
    byId('prefecture-select').disabled = true;
    byId('tool').setAttribute('aria-busy', 'false');
  }

  function loadData() {
    const errorPanel = byId('data-error');
    errorPanel.hidden = true;
    errorPanel.replaceChildren();
    byId('data-loading').hidden = false;
    byId('analysis-dashboard').hidden = true;
    byId('analysis-dashboard').inert = true;
    byId('analysis-dashboard').setAttribute('aria-hidden', 'true');
    byId('analysis-period').textContent = '';
    byId('tool').setAttribute('aria-busy', 'true');
    return fetch('data/inbound/latest.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('統計JSONの取得に失敗しました。');
        return response.json();
      })
      .then(function (data) {
        validateDataset(data);
        dataset = data;
        const selectedArea = getInitialArea();
        populateSelector(selectedArea);
        setSourceMetadata();
        renderArea(selectedArea, false);
        byId('data-loading').hidden = true;
        byId('analysis-dashboard').hidden = false;
        byId('analysis-dashboard').inert = false;
        byId('analysis-dashboard').removeAttribute('aria-hidden');
        byId('tool').setAttribute('aria-busy', 'false');
      })
      .catch(showError);
  }

  document.addEventListener('DOMContentLoaded', function () {
    byId('prefecture-select').addEventListener('change', function (event) {
      renderArea(event.target.value, true);
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'inbound_prefecture_change', { prefecture: event.target.value });
      }
    });
    loadData();
  });
})();
