(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DxDiagnosisModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  const categories = ["経営", "予約・販売", "会計", "業務", "勤怠・シフト", "システム", "集客", "データ活用"];

  const questions = [
    { id: "mgmt_1", category: "経営", question: "主要な経営指標をどの頻度で確認していますか？", options: [{ label: "月次以下／ほぼ確認しない", score: 20 }, { label: "週次", score: 65 }, { label: "日次で確認している", score: 100 }] },
    { id: "mgmt_2", category: "経営", question: "部門別・施設別の収益性を把握できますか？", options: [{ label: "できない", score: 20 }, { label: "一部のみ", score: 60 }, { label: "いつでも把握できる", score: 100 }] },
    { id: "sales_1", category: "予約・販売", question: "PMS・サイトコントローラー・OTAの在庫／料金連携は？", options: [{ label: "手作業が多い", score: 20 }, { label: "一部自動", score: 65 }, { label: "ほぼ自動連携", score: 100 }] },
    { id: "sales_2", category: "予約・販売", question: "自社予約を増やすための施策を継続的に行っていますか？", options: [{ label: "ほぼしていない", score: 20 }, { label: "時々行う", score: 60 }, { label: "数値を見ながら継続改善", score: 100 }] },
    { id: "acct_1", category: "会計", question: "売上データを会計システムへ入力する方法は？", options: [{ label: "手入力・転記が中心", score: 15 }, { label: "CSV等で半自動", score: 60 }, { label: "API等で自動連携", score: 100 }] },
    { id: "acct_2", category: "会計", question: "入金照合・売掛管理はどの程度自動化されていますか？", options: [{ label: "ほぼ手作業", score: 20 }, { label: "一部自動", score: 60 }, { label: "大部分が自動", score: 100 }] },
    { id: "ops_1", category: "業務", question: "客室清掃の指示・進捗確認は？", options: [{ label: "紙・口頭・電話中心", score: 15 }, { label: "チャット／表計算中心", score: 55 }, { label: "専用システム等で一元管理", score: 100 }] },
    { id: "ops_2", category: "業務", question: "チェックイン前後の定型業務は？", options: [{ label: "手作業が多い", score: 20 }, { label: "一部自動", score: 60 }, { label: "かなり自動化", score: 100 }] },
    { id: "work_1", category: "勤怠・シフト", question: "シフト作成は？", options: [{ label: "Excel・紙中心", score: 20 }, { label: "クラウドだが手作業中心", score: 60 }, { label: "需要予測等も活用", score: 100 }] },
    { id: "work_2", category: "勤怠・シフト", question: "勤怠実績と給与・人件費管理は連携していますか？", options: [{ label: "分断・手入力", score: 20 }, { label: "一部連携", score: 60 }, { label: "ほぼ自動連携", score: 100 }] },
    { id: "sys_1", category: "システム", question: "同じ情報を複数システムへ二重入力することは？", options: [{ label: "頻繁にある", score: 15 }, { label: "時々ある", score: 60 }, { label: "ほぼない", score: 100 }] },
    { id: "sys_2", category: "システム", question: "主要システムのAPI／CSV連携可否を把握していますか？", options: [{ label: "把握していない", score: 20 }, { label: "一部把握", score: 60 }, { label: "把握し活用している", score: 100 }] },
    { id: "mkt_1", category: "集客", question: "OTA・自社・Google・SNSの成果を比較していますか？", options: [{ label: "ほぼしていない", score: 20 }, { label: "月次程度", score: 65 }, { label: "定期的に比較し施策に反映", score: 100 }] },
    { id: "mkt_2", category: "集客", question: "チャネル別の獲得コストや手数料を把握していますか？", options: [{ label: "把握していない", score: 20 }, { label: "概算のみ", score: 60 }, { label: "継続的に把握", score: 100 }] },
    { id: "data_1", category: "データ活用", question: "ADR・稼働率・RevPAR・予約ペースを一画面で見られますか？", options: [{ label: "見られない", score: 15 }, { label: "一部見られる", score: 60 }, { label: "ダッシュボード等で見られる", score: 100 }] },
    { id: "data_2", category: "データ活用", question: "データを使って具体的な意思決定をしていますか？", options: [{ label: "勘と経験が中心", score: 20 }, { label: "一部活用", score: 60 }, { label: "定例で活用", score: 100 }] }
  ];

  const solutions = [
    { category: "予約・販売", name: "サイトコントローラー連携見直し", summary: "在庫・料金更新の手作業を減らすため、PMS・OTA・自社予約の連携状態を整理します。", fit: "複数OTAを運用し更新作業が多い施設", comparePoints: "連携先、API、料金、サポート、切替工数", priority: 1 },
    { category: "予約・販売", name: "自社予約導線改善", summary: "公式サイトの予約導線、プラン設計、Google連携、会員施策などを見直します。", fit: "OTA依存度を下げたい施設", comparePoints: "予約エンジン、手数料、UI、Google連携", priority: 2 },
    { category: "会計", name: "PMS・会計連携", summary: "売上データや仕訳データの転記を減らす連携方式を検討します。", fit: "売上転記や照合に時間がかかる施設", comparePoints: "CSV／API、仕訳粒度、税区分、部門管理", priority: 1 },
    { category: "業務", name: "清掃管理デジタル化", summary: "清掃指示、完了報告、客室ステータスをスマートフォン等で共有します。", fit: "紙・口頭で清掃指示をしている施設", comparePoints: "PMS連携、多言語、端末、現場操作性", priority: 1 },
    { category: "勤怠・シフト", name: "クラウド勤怠・シフト管理", summary: "勤怠実績、シフト、給与連携を一元化し集計作業を削減します。", fit: "Excelや紙でシフト管理している施設", comparePoints: "給与連携、変形労働、権限、操作性", priority: 1 },
    { category: "システム", name: "システム連携棚卸し", summary: "PMS、会計、POS、予約、勤怠などのデータフローを可視化します。", fit: "システムが増え二重入力が多い施設", comparePoints: "API／CSV、マスタ、費用、保守体制", priority: 1 },
    { category: "集客", name: "チャネル別収益管理", summary: "OTA・自社・Google等の売上、手数料、予約単価を比較できるようにします。", fit: "チャネル別採算が見えにくい施設", comparePoints: "手数料、キャンセル率、単価、LTV", priority: 1 },
    { category: "データ活用", name: "宿泊経営ダッシュボード", summary: "ADR、稼働率、RevPAR、売上、予約ペース等を一画面にまとめます。", fit: "数字が複数ファイルに分散している施設", comparePoints: "データ取込、更新頻度、指標定義、権限", priority: 1 },
    { category: "経営", name: "経営KPI設計", summary: "施設で毎日・毎週・毎月見る数字と判断基準を整理します。", fit: "数字はあるが意思決定につながらない施設", comparePoints: "KPI数、更新頻度、責任者、アクション", priority: 1 }
  ];

  const initialFacility = { name: "", rooms: 30, adr: 18000, occupancy: 65, otaRatio: 60, employees: 20, hourlyCost: 1400 };

  const findingCopy = {
    "経営": { text: "数字を見る頻度や、現場の数字を経営判断につなげる部分に改善余地があります。", action: "毎週見る数字を3〜5個に絞る" },
    "予約・販売": { text: "予約・料金・在庫の更新やOTA依存に改善余地があります。", action: "自社予約比率とOTA手数料を一度見える化する" },
    "会計": { text: "売上や入金の転記・照合作業に手間が残っている可能性があります。", action: "会計までに何回手入力しているか数える" },
    "業務": { text: "清掃指示やフロント連絡など、紙・口頭・電話に頼る業務が残っている可能性があります。", action: "紙・口頭で行っている業務を3つ書き出す" },
    "勤怠・シフト": { text: "シフト作成や勤怠集計に人手がかかっている可能性があります。", action: "シフト作成と集計にかかる時間を測る" },
    "システム": { text: "同じ情報の二重入力や、システム間の分断が発生している可能性があります。", action: "PMS・会計・予約・勤怠のつながりを図にする" },
    "集客": { text: "OTA、自社サイト、Googleなどの成果を比べきれていない可能性があります。", action: "予約経路ごとの売上と手数料を並べる" },
    "データ活用": { text: "ADR・稼働率・RevPARなどが、日々の判断に十分使われていない可能性があります。", action: "ADR・稼働率・RevPARを毎週確認する" }
  };

  function defaultAnswers() {
    return Object.fromEntries(questions.map(function (question) { return [question.id, 1]; }));
  }

  function selectedScore(question, answers) {
    const index = Number(answers && answers[question.id]);
    return Number.isInteger(index) && question.options[index] ? question.options[index].score : null;
  }

  function calculateScores(answers, facility) {
    const scores = {};
    categories.forEach(function (category) {
      const values = questions.filter(function (question) { return question.category === category; })
        .map(function (question) { return selectedScore(question, answers); })
        .filter(function (score) { return score !== null; });
      scores[category] = values.length ? Math.round(values.reduce(function (sum, score) { return sum + score; }, 0) / values.length) : 50;
    });
    if (facility.otaRatio >= 80) scores["予約・販売"] = Math.max(0, scores["予約・販売"] - 12);
    else if (facility.otaRatio >= 65) scores["予約・販売"] = Math.max(0, scores["予約・販売"] - 6);
    const total = Math.round(categories.reduce(function (sum, category) { return sum + scores[category]; }, 0) / categories.length);
    return { total: total, scores: scores };
  }

  function deriveFindings(scores, facility) {
    const findings = categories.map(function (category, order) {
      return { category: category, score: scores[category], order: order, text: findingCopy[category].text, action: findingCopy[category].action };
    }).sort(function (a, b) { return a.score - b.score || a.order - b.order; }).slice(0, 3).map(function (item) {
      return { category: item.category, score: item.score, text: item.text, action: item.action };
    });
    if (facility.otaRatio >= 70 && !findings.some(function (finding) { return finding.category === "予約・販売"; })) {
      findings[2] = {
        category: "予約・販売",
        score: scores["予約・販売"],
        text: "OTA比率が" + facility.otaRatio + "%と高めです。手数料負担と自社予約導線を一度確認する価値があります。",
        action: "自社予約比率とOTA手数料を見える化する"
      };
    }
    return findings;
  }

  function revpar(facility) {
    return Math.round(facility.adr * facility.occupancy / 100);
  }

  function validateFacility(facility) {
    const errors = {};
    const rules = {
      rooms: [1, 1000, "客室数は1〜1,000室で入力してください。"],
      employees: [1, 5000, "従業員数は1〜5,000人で入力してください。"],
      adr: [0, 500000, "平均客室単価は0〜500,000円で入力してください。"],
      occupancy: [0, 100, "客室稼働率は0〜100%で入力してください。"],
      otaRatio: [0, 100, "OTA比率は0〜100%で入力してください。"],
      hourlyCost: [500, 10000, "人件費の目安は500〜10,000円で入力してください。"]
    };
    Object.keys(rules).forEach(function (field) {
      const value = Number(facility && facility[field]);
      const rule = rules[field];
      if (!Number.isFinite(value) || value < rule[0] || value > rule[1]) errors[field] = rule[2];
    });
    return errors;
  }

  function buildResult(answers, facility) {
    const scoreResult = calculateScores(answers, facility);
    const findings = deriveFindings(scoreResult.scores, facility);
    const wanted = findings.map(function (finding) { return finding.category; });
    const matchedSolutions = solutions.filter(function (solution) { return wanted.includes(solution.category); })
      .sort(function (a, b) { return wanted.indexOf(a.category) - wanted.indexOf(b.category) || a.priority - b.priority; }).slice(0, 6);
    const lowCategories = categories.filter(function (category) { return scoreResult.scores[category] < 60; }).length;
    const monthlyHours = Math.round(Math.min(160, Math.max(12, facility.rooms * 0.55 + facility.employees * 0.9 + lowCategories * 4)));
    const annualHours = monthlyHours * 12;
    const annualValue = annualHours * facility.hourlyCost;
    const referenceRevpar = revpar(facility);
    const comment = "DX総合スコアは" + scoreResult.total + "点です。最優先は「" + findings[0].category + "」です。まずは「" + findings[0].action + "」から始めてください。現在の参考RevPARは約" + referenceRevpar.toLocaleString("ja-JP") + "円です。システム導入を急ぐより、手作業の多い場所から順に改善するのがおすすめです。";
    return { total: scoreResult.total, scores: scoreResult.scores, findings: findings, matchedSolutions: matchedSolutions, monthlyHours: monthlyHours, annualHours: annualHours, annualValue: annualValue, revpar: referenceRevpar, comment: comment };
  }

  return { categories: categories, questions: questions, solutions: solutions, initialFacility: initialFacility, findingCopy: findingCopy, defaultAnswers: defaultAnswers, calculateScores: calculateScores, deriveFindings: deriveFindings, buildResult: buildResult, revpar: revpar, validateFacility: validateFacility };
});
