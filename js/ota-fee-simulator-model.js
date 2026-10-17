(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OtaFeeModel = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  'use strict';

  // OTA手数料シミュレーター: 予約経路ごとの売上の割合と手数料から、年間の負担と
  // 自社サイトの割合を変えたときの差し引きを計算する純粋関数。
  // 率はすべて「例」。実在のOTAの料率ではなく、契約書・請求書の値に置き換えて使う前提。

  const MAX_CHANNELS = 8;
  const TAX = 1.1;
  const kinds = { ota: "OTA", web: "自社サイト", direct: "電話・直接" };

  // 初期表示の経路。年間売上は空にしておき、「例の数字で試す」で sample.annualRevenue を入れる。
  const channels = [
    { name: "国内OTA A", kind: "ota", share: 35, feeRate: 10, extraRate: 2, monthlyFixed: 0 },
    { name: "国内OTA B", kind: "ota", share: 15, feeRate: 10, extraRate: 2, monthlyFixed: 0 },
    { name: "海外OTA", kind: "ota", share: 10, feeRate: 15, extraRate: 0, monthlyFixed: 0 },
    { name: "自社サイト", kind: "web", share: 25, feeRate: 0, extraRate: 3.6, monthlyFixed: 30000 },
    { name: "電話・直接", kind: "direct", share: 15, feeRate: 0, extraRate: 0, monthlyFixed: 0 }
  ];
  const sample = { annualRevenue: 130000000, taxOnFee: true, channels: channels, shift: 10, acquisitionRate: 5 };

  function round1(value) { return Math.round(value * 10) / 10; }
  function present(value) { return value !== null && value !== undefined && Number.isFinite(value); }

  // 全角数字・カンマ・空白・円/%を取り除いて数値にする。数字でなければ NaN、空なら null。
  function parseNumber(text) {
    if (text === null || text === undefined) return null;
    const normalized = String(text)
      .replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[,，\s円%％]/g, "");
    if (normalized === "") return null;
    return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  }

  // 手数料（消費税を加えるか選べる）＋ポイント原資・決済手数料など。月額の固定費は含めない。
  function variableRate(channel, taxOnFee) {
    return channel.feeRate * (taxOnFee ? TAX : 1) + channel.extraRate;
  }

  function validate(input) {
    const errors = { channels: input.channels.map(function () { return {}; }) };
    if (!present(input.annualRevenue) || input.annualRevenue <= 0) errors.annualRevenue = "年間の宿泊売上を入力してください。";
    input.channels.forEach(function (channel, index) {
      const row = errors.channels[index];
      if (!String(channel.name || "").trim()) row.name = "名前を入れてください。";
      if (!present(channel.share) || channel.share < 0 || channel.share > 100) row.share = "0〜100%で入力してください。";
      if (!present(channel.feeRate) || channel.feeRate < 0 || channel.feeRate > 50) row.feeRate = "0〜50%で入力してください。";
      if (!present(channel.extraRate) || channel.extraRate < 0 || channel.extraRate > 50) row.extraRate = "0〜50%で入力してください。";
      if (!present(channel.monthlyFixed) || channel.monthlyFixed < 0) row.monthlyFixed = "0円以上で入力してください。";
    });
    const rowsValid = errors.channels.every(function (row) { return Object.keys(row).length === 0; });
    const total = shareTotal(input.channels);
    if (rowsValid && Math.abs(total - 100) > 0.05) errors.shareTotal = "売上の割合の合計が" + round1(total) + "%です。100%になるように調整してください。";
    return errors;
  }

  function errorCount(errors) {
    return Object.keys(errors).filter(function (key) { return key !== "channels"; }).length +
      errors.channels.reduce(function (sum, row) { return sum + Object.keys(row).length; }, 0);
  }

  function shareTotal(list) {
    return round1(list.reduce(function (sum, channel) { return sum + (present(channel.share) ? channel.share : 0); }, 0));
  }

  function summarize(input) {
    const rows = input.channels.map(function (channel) {
      const revenue = input.annualRevenue * channel.share / 100;
      const variable = revenue * variableRate(channel, input.taxOnFee) / 100;
      const cost = variable + channel.monthlyFixed * 12;
      return {
        name: channel.name, kind: channel.kind, share: channel.share,
        revenue: Math.round(revenue), cost: Math.round(cost),
        // 売上がない経路は率を出さない（固定費だけがかかる）
        effectiveRate: revenue > 0 ? round1(cost / revenue * 100) : null,
        net: Math.round(revenue - cost)
      };
    });
    const sum = function (list, key) { return list.reduce(function (total, row) { return total + row[key]; }, 0); };
    const ota = rows.filter(function (row) { return row.kind === "ota"; });
    const totalCost = sum(rows, "cost");
    return {
      rows: rows,
      totalCost: totalCost,
      effectiveRate: round1(totalCost / input.annualRevenue * 100),
      otaShare: round1(sum(ota, "share")),
      otaCost: sum(ota, "cost"),
      otaRevenue: sum(ota, "revenue")
    };
  }

  // 自社サイトの割合を shift ポイント上げる。上げた分は各OTAから今の割合に応じて移る想定。
  // acquisitionRate は移ってきた予約の売上に対して新たにかかる広告費など（%）。
  // 月額の固定費は割合が変わっても同じなので、差し引きには入れない。
  function scenario(input, shift, acquisitionRate) {
    const web = input.channels.find(function (channel) { return channel.kind === "web"; });
    const otas = input.channels.filter(function (channel) { return channel.kind === "ota" && channel.share > 0; });
    const otaShare = otas.reduce(function (total, channel) { return total + channel.share; }, 0);
    if (!web || otaShare <= 0) return null;
    const moved = Math.max(0, Math.min(present(shift) ? shift : 0, otaShare));
    const movedRevenue = input.annualRevenue * moved / 100;
    // 移る予約にかかっていたOTAの率（売上の割合で重みづけ）と、自社サイトで新たにかかる率
    const otaRate = otas.reduce(function (total, channel) { return total + variableRate(channel, input.taxOnFee) * channel.share; }, 0) / otaShare;
    const webRate = variableRate(web, input.taxOnFee);
    const feeSaving = movedRevenue * (otaRate - webRate) / 100;
    const acquisition = movedRevenue * (present(acquisitionRate) ? acquisitionRate : 0) / 100;
    const before = summarize(input);
    return {
      webName: web.name,
      moved: round1(moved),
      maxShift: round1(otaShare),
      webShareBefore: round1(web.share),
      webShareAfter: round1(web.share + moved),
      otaShareBefore: before.otaShare,
      otaShareAfter: round1(before.otaShare - moved),
      movedRevenue: Math.round(movedRevenue),
      feeSaving: Math.round(feeSaving),
      acquisition: Math.round(acquisition),
      net: Math.round(feeSaving - acquisition),
      // 自社予約を1件増やすのにかけてよい費用の上限（移ってきた売上に対する%）
      breakEvenRate: round1(otaRate - webRate)
    };
  }

  // ある月の請求額 ÷ その月のその経路の宿泊売上 = 実効の負担率（%）
  function rateFromInvoice(invoiceAmount, channelRevenue) {
    if (!present(invoiceAmount) || !present(channelRevenue) || invoiceAmount < 0 || channelRevenue <= 0) return null;
    return Math.round(invoiceAmount / channelRevenue * 1000) / 10;
  }

  // 請求書の率を表の行に入れるときの手数料率。請求額が税込みで「消費税を加える」設定なら税を戻す。
  function feeRateForRow(invoiceRate, taxOnFee) {
    return round1(invoiceRate / (taxOnFee ? TAX : 1));
  }

  // DXかんたん診断のOTA比率を表に入れる。OTAの行どうし・それ以外の行どうしの比は保ち、端数は各グループの最大の行で吸収する。
  function applyOtaRatio(channels, otaRatio) {
    const isOta = function (channel) { return channel.kind === "ota"; };
    const groups = [[channels.filter(isOta), otaRatio], [channels.filter(function (c) { return !isOta(c); }), 100 - otaRatio]];
    if (!groups[0][0].length || (!groups[1][0].length && otaRatio < 100)) return null;
    const shares = new Map();
    groups.forEach(function (group) {
      const rows = group[0];
      const target = group[1];
      if (!rows.length) return;
      const current = rows.reduce(function (sum, c) { return sum + (present(c.share) ? c.share : 0); }, 0);
      rows.forEach(function (c) { shares.set(c, round1(current > 0 ? (present(c.share) ? c.share : 0) / current * target : target / rows.length)); });
      const largest = rows.reduce(function (best, c) { return shares.get(c) > shares.get(best) ? c : best; }, rows[0]);
      const diff = round1(target - rows.reduce(function (sum, c) { return sum + shares.get(c); }, 0));
      shares.set(largest, round1(shares.get(largest) + diff));
    });
    return channels.map(function (c) { return Object.assign({}, c, { share: shares.get(c) }); });
  }

  // DXかんたん診断の客室数・ADR・客室稼働率から年間の客室売上の目安（1万円単位）。どれかが無ければ null。
  function revenueFromDiagnosis(facility) {
    if (!facility || !(facility.rooms > 0) || !(facility.adr > 0) || !(facility.occupancy > 0)) return null;
    return Math.round(facility.rooms * 365 * facility.occupancy / 100 * facility.adr / 10000) * 10000;
  }

  return {
    MAX_CHANNELS: MAX_CHANNELS, kinds: kinds, sample: sample,
    applyOtaRatio: applyOtaRatio, revenueFromDiagnosis: revenueFromDiagnosis,
    parseNumber: parseNumber, variableRate: variableRate, validate: validate, errorCount: errorCount,
    shareTotal: shareTotal, summarize: summarize, scenario: scenario,
    rateFromInvoice: rateFromInvoice, feeRateForRow: feeRateForRow
  };
});
