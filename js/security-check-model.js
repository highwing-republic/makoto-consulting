(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SecurityCheckModel = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  'use strict';

  // 宿のセキュリティ10問チェック: 回答から「今週やること3つ」と分野ごとの内訳を出す純粋関数。
  // 回答は 2=できている / 1=一部できている / 0=できていない・わからない。
  // weight 2 は、宿泊施設で実際に被害が出ている手口に関わる項目。
  // 設問は宿向けに独自に作ったもので、IPA「5分でできる！情報セキュリティ自社診断」の設問の転載ではない。

  const areas = ["アカウント", "端末・サイト", "データ", "ネットワーク", "人", "事故対応"];

  const questions = [
    { id: "mfa", area: "アカウント", weight: 2,
      question: "OTA・予約サイトの管理画面に、2段階認証を設定していますか？",
      todo: "主要なOTA・サイトコントローラー・PMSの管理画面で、2段階認証（SMS・認証アプリ）を有効にする。",
      why: "OTAの管理画面に不正にログインされ、宿泊予定のお客様へ偽の支払い案内が送られる被害が国内の宿で相次ぎました（2023年に観光庁が注意喚起）。",
      cost: "無料" },
    { id: "account", area: "アカウント", weight: 2,
      question: "管理画面やPMSのIDを、スタッフごとに分けていますか？",
      todo: "共用IDをやめてスタッフごとに発行し、退職・異動の日にIDを止める手順を決める。",
      why: "共用IDでは誰が操作したか追えず、辞めた人が使い続けられる状態になりがちです。",
      cost: "無料〜（ID数で料金が変わるサービスもあります）" },
    { id: "password", area: "アカウント", weight: 1,
      question: "パスワードは管理画面ごとに別にし、人目につかない方法で管理していますか？",
      todo: "管理画面ごとに別のパスワードにし、パスワード管理ツールか鍵のかかる場所で管理する。",
      why: "1つのサービスから漏れたパスワードで、ほかの管理画面にも入られてしまいます。フロントに貼ったメモも同じです。",
      cost: "無料〜" },
    { id: "update", area: "端末・サイト", weight: 1,
      question: "フロントや事務所のパソコン、公式サイトの更新を、自動または定期的に行っていますか？",
      todo: "OS・ブラウザの自動更新をオンにし、公式サイトは更新の担当と頻度を決める。ウイルス対策が有効になっているかも確かめる。",
      why: "古いままのOSや公式サイトの仕組み（WordPressなど）は、知られた弱点から入り込まれます。",
      cost: "無料" },
    { id: "backup", area: "データ", weight: 2,
      question: "予約・顧客・会計のデータを、別の場所にもバックアップしていますか？",
      todo: "予約・顧客・会計データのバックアップを取る。クラウドのPMSはデータを書き出す手順を確かめ、パソコンに保存しているデータは週1回、外付けの機器やクラウドへ。年1回は元に戻せるか試す。",
      why: "ランサムウェア（データを使えなくして金銭を求める攻撃）でパソコンやサーバーが止まると、当日の予約台帳も見られなくなります。",
      cost: "無料〜" },
    { id: "wifi", area: "ネットワーク", weight: 1,
      question: "お客様用Wi-Fiと、事務用のネットワークを分けていますか？",
      todo: "ルーターのゲスト用ネットワーク機能などで分け、ルーターや機器の初期パスワードを変える。",
      why: "同じネットワークにつながっていると、館内の誰でも事務用のパソコンや機器に近づけてしまいます。",
      cost: "無料〜" },
    { id: "guest-data", area: "データ", weight: 1,
      question: "宿泊者名簿・旅券の写し・カード情報の保管と廃棄のルールがありますか？",
      todo: "何を・どこに・いつまで保管し、どう捨てるかを1枚にまとめる。カード番号は紙に書き写さない。",
      why: "宿泊者名簿は旅館業法で作成から3年間の保存が求められています。保存期間を過ぎた名簿や、カード番号のメモのような不要な控えが残っていると、漏えいしたときの被害が大きくなります。",
      cost: "無料" },
    { id: "phishing", area: "人", weight: 2,
      question: "予約者やOTAを名乗る不審なメール・メッセージへの対応を、スタッフと決めていますか？",
      todo: "添付ファイルやリンクを開く前に相談する相手を決め、怪しい例をスタッフと共有する。お客様にも「メッセージでカード情報をお聞きしない」と案内する。",
      why: "「予約の確認」「苦情の写真」を装った添付ファイルやリンクから、パソコンが乗っ取られる手口が宿泊施設を狙っています。",
      cost: "無料" },
    { id: "ai-rule", area: "人", weight: 1,
      question: "生成AIや翻訳サービスに、お客様の個人情報を入れないルールがありますか？",
      todo: "入れてよい情報・いけない情報を決め、業務で使うサービスとその設定（入力を学習に使わない設定など）をそろえる。",
      why: "入力した内容がサービス側に残る設定のこともあり、氏名や連絡先を入れると管理が難しくなります。",
      cost: "無料" },
    { id: "incident", area: "事故対応", weight: 1,
      question: "情報漏えいや乗っ取りが起きたときの連絡先と手順を決めていますか？",
      todo: "OTA・PMSの会社・カード会社・警察の相談窓口・個人情報保護委員会の連絡先を1枚にまとめ、フロントに置く。",
      why: "不正アクセスによる漏えいや、カード情報など財産的な被害につながる漏えい、1,000人を超える漏えいなどは、個人情報保護委員会への報告（速報は概ね3〜5日以内）と本人への通知が法律で義務づけられています。慌てないよう連絡先を先にそろえておきます。",
      cost: "無料" }
  ];

  const options = [
    { value: 2, label: "できている" },
    { value: 1, label: "一部できている" },
    { value: 0, label: "できていない・わからない" }
  ];

  function isAnswer(value) { return value === 0 || value === 1 || value === 2; }

  function missing(answers) {
    return questions.filter(function (q) { return !isAnswer(answers[q.id]); }).map(function (q) { return q.id; });
  }

  // 今週やることは「重み ×（2 − 回答）」の大きい順。同じなら質問の順。
  function evaluate(answers) {
    const gaps = questions.map(function (q, order) {
      const value = isAnswer(answers[q.id]) ? answers[q.id] : 0;
      return { question: q, value: value, order: order, priority: q.weight * (2 - value) };
    }).filter(function (item) { return item.priority > 0; })
      .sort(function (a, b) { return b.priority - a.priority || a.order - b.order; });
    const toItem = function (item) { return Object.assign({ partial: item.value === 1 }, item.question); };
    return {
      total: questions.length,
      answered: questions.length - missing(answers).length,
      done: questions.filter(function (q) { return answers[q.id] === 2; }).length,
      partial: questions.filter(function (q) { return answers[q.id] === 1; }).length,
      thisWeek: gaps.slice(0, 3).map(toItem),
      later: gaps.slice(3).map(toItem),
      byArea: areas.map(function (area) {
        const list = questions.filter(function (q) { return q.area === area; });
        return { area: area, total: list.length, done: list.filter(function (q) { return answers[q.id] === 2; }).length };
      })
    };
  }

  return { areas: areas, questions: questions, options: options, missing: missing, evaluate: evaluate };
});
