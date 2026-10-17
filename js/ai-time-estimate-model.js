(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AiTimeModel = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  'use strict';

  // 生成AI時短みつもり: 業務ごとの「件数 × 1件の時間 × 削減率」を積み上げ、浮く時間を幅（控えめ〜標準）で出す純粋関数。
  // 削減率は宿泊DXラボの仮定で、AIの下書きを人が確認・直す時間を含めた見込みとして研究の数字より控えめに置いている。
  // 初期値の件数・時間は架空の30室の宿の想定。
  // risk: low=社内向け, mid=お客様に出す文章（公開前に確認）, high=個人情報・アレルギー・料金に関わる

  const tasks = [
    { id: "review", name: "口コミへの返信", unit: "件", count: 60, minutes: 6, low: 30, high: 50, risk: "mid",
      tip: "お礼・指摘への返答の下書きをAIに作らせ、施設ならではの事実は人が足す。" },
    { id: "foreign-mail", name: "外国語のお問い合わせ返信", unit: "件", count: 40, minutes: 12, low: 40, high: 60, risk: "high",
      tip: "宿泊者の氏名・連絡先・予約番号は入れずに文面だけ訳す。料金・キャンセル規定は原文で確かめる。" },
    { id: "plan-copy", name: "プラン・宿紹介文の作成", unit: "本", count: 8, minutes: 40, low: 30, high: 50, risk: "mid",
      tip: "設備・料理・アクセスの事実を箇条書きで渡し、文章にするところだけを任せる。" },
    { id: "sns", name: "SNS・お知らせの投稿文", unit: "本", count: 12, minutes: 20, low: 30, high: 50, risk: "mid",
      tip: "写真の説明と伝えたいことを渡し、文案を3つ出させて選ぶ。" },
    { id: "signage", name: "館内案内の多言語化", unit: "枚", count: 2, minutes: 60, low: 40, high: 60, risk: "mid",
      tip: "訳文は、その言葉が分かる人か別の翻訳サービスで日本語に戻して確かめる。" },
    { id: "manual", name: "マニュアル・手順書の作成", unit: "本", count: 2, minutes: 120, low: 30, high: 50, risk: "low",
      tip: "作業をしながら話した録音やメモを渡し、手順書の形に整えさせる。" },
    { id: "minutes", name: "会議・申し送りのまとめ", unit: "回", count: 8, minutes: 30, low: 30, high: 50, risk: "low",
      tip: "メモを貼り、決まったこと・担当・期限の形に整理させる。" },
    { id: "recruit", name: "求人票・採用の文面", unit: "本", count: 1, minutes: 60, low: 30, high: 50, risk: "mid",
      tip: "仕事の中身と条件を渡し、応募する人の目線の文に直させる。" },
    { id: "faq", name: "よくある質問（FAQ）の作成", unit: "本", count: 2, minutes: 60, low: 30, high: 50, risk: "mid",
      tip: "電話やメールで多い質問を10個集め、回答の下書きを作らせる。" },
    { id: "allergy", name: "お品書き・アレルギー表記の翻訳", unit: "枚", count: 2, minutes: 45, low: 10, high: 20, risk: "high",
      tip: "アレルギー表記は必ず人が原文と照らし合わせる。削減率は低めに見ています。" }
  ];

  const riskLabel = { low: "社内向け", mid: "公開前に確認", high: "個人情報・安全に注意" };
  // 最初に試す業務は、浮く時間（標準）に失敗したときの影響の小ささを掛けて選ぶ
  const riskWeight = { low: 1, mid: 0.8, high: 0.5 };
  // 有料プランの費用の例（1人あたり月額 × 人数）。実際の料金は各サービスで確かめてもらう
  const defaults = { hourlyCost: 1400, seats: 2, seatCost: 3000 };
  const MAX_RATE = 90;

  function parseNumber(text) {
    if (text === null || text === undefined) return null;
    const normalized = String(text)
      .replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[,，\s円%％件本枚回分人]/g, "");
    if (normalized === "") return null;
    return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  }

  function sampleInput() {
    return {
      tasks: tasks.map(function (t) { return { id: t.id, enabled: true, count: t.count, minutes: t.minutes, low: t.low, high: t.high }; }),
      hourlyCost: defaults.hourlyCost, seats: defaults.seats, seatCost: defaults.seatCost
    };
  }

  function inRange(value, min, max) { return typeof value === "number" && isFinite(value) && value >= min && value <= max; }

  // 誤りは "count:review" のような入力欄ごとのキーで返す。選んでいない業務の欄は見ない。
  function validate(input) {
    const errors = {};
    input.tasks.forEach(function (row) {
      if (!row.enabled) return;
      if (!inRange(row.count, 0, 9999)) errors["count:" + row.id] = "0〜9,999で入れてください";
      if (!inRange(row.minutes, 0, 600)) errors["minutes:" + row.id] = "0〜600分で入れてください";
      if (!inRange(row.low, 0, MAX_RATE)) errors["low:" + row.id] = "0〜" + MAX_RATE + "%で入れてください";
      if (!inRange(row.high, 0, MAX_RATE)) errors["high:" + row.id] = "0〜" + MAX_RATE + "%で入れてください";
      else if (inRange(row.low, 0, MAX_RATE) && row.low > row.high) errors["high:" + row.id] = "控えめ以上にしてください";
    });
    if (!inRange(input.hourlyCost, 0, 100000)) errors.hourlyCost = "0〜100,000円で入れてください";
    if (!inRange(input.seats, 0, 999) || Math.floor(input.seats) !== input.seats) errors.seats = "0〜999人で入れてください";
    if (!inRange(input.seatCost, 0, 100000)) errors.seatCost = "0〜100,000円で入れてください";
    return errors;
  }

  const round1 = function (value) { return Math.round(value * 10) / 10; };

  function estimate(input) {
    const byId = {};
    tasks.forEach(function (t) { byId[t.id] = t; });
    const rows = input.tasks.filter(function (row) { return row.enabled && byId[row.id]; }).map(function (row) {
      const task = byId[row.id];
      const base = row.count * row.minutes / 60;
      return {
        id: row.id, name: task.name, risk: task.risk, riskLabel: riskLabel[task.risk], tip: task.tip,
        baseHours: base, lowHours: base * row.low / 100, highHours: base * row.high / 100,
        startScore: base * row.high / 100 * riskWeight[task.risk]
      };
    });
    const sum = function (key) { return rows.reduce(function (total, row) { return total + row[key]; }, 0); };
    const monthlyLow = sum("lowHours");
    const monthlyHigh = sum("highHours");
    const valueLow = Math.round(monthlyLow * 12 * input.hourlyCost);
    const valueHigh = Math.round(monthlyHigh * 12 * input.hourlyCost);
    const toolCost = Math.round(input.seats * input.seatCost * 12);
    return {
      selected: rows.length,
      rows: rows,
      baseHours: round1(sum("baseHours")),
      monthly: { low: round1(monthlyLow), high: round1(monthlyHigh) },
      annual: { low: Math.round(monthlyLow * 12), high: Math.round(monthlyHigh * 12) },
      value: { low: valueLow, high: valueHigh },
      toolCost: toolCost,
      net: { low: valueLow - toolCost, high: valueHigh - toolCost },
      // 同点なら一覧の順。浮く時間が0の業務は選ばない
      firstPicks: rows.map(function (row, order) { return { row: row, order: order }; })
        .filter(function (item) { return item.row.startScore > 0; })
        .sort(function (a, b) { return b.row.startScore - a.row.startScore || a.order - b.order; })
        .slice(0, 3).map(function (item) { return item.row; })
    };
  }

  return { tasks: tasks, riskLabel: riskLabel, riskWeight: riskWeight, defaults: defaults, MAX_RATE: MAX_RATE,
    parseNumber: parseNumber, sampleInput: sampleInput, validate: validate, estimate: estimate };
});
