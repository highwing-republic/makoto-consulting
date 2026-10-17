const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/security-check-model.js");

const all = (value) => Object.fromEntries(model.questions.map((q) => [q.id, value]));

test("ten questions in six areas, with the attacks seen at inns weighted double", () => {
  assert.equal(model.questions.length, 10);
  assert.deepEqual(model.areas, ["アカウント", "端末・サイト", "データ", "ネットワーク", "人", "事故対応"]);
  assert.ok(model.questions.every((q) => model.areas.includes(q.area) && q.todo && q.why && q.cost));
  assert.deepEqual(model.questions.filter((q) => q.weight === 2).map((q) => q.id), ["mfa", "account", "backup", "phishing"]);
});

test("this week's three come from the weighted gaps, in question order on ties", () => {
  const answers = { ...all(0), update: 2, wifi: 2, account: 1, password: 1 };
  const result = model.evaluate(answers);
  assert.equal(result.done, 2);
  assert.equal(result.partial, 2);
  // 重み2×未対応=4: mfa, backup, phishing。account（重み2×一部=2）は次
  assert.deepEqual(result.thisWeek.map((q) => q.id), ["mfa", "backup", "phishing"]);
  assert.deepEqual(result.later.map((q) => q.id), ["account", "guest-data", "ai-rule", "incident", "password"]);
  assert.equal(result.later[0].partial, true);
  assert.deepEqual(result.byArea.find((a) => a.area === "アカウント"), { area: "アカウント", total: 3, done: 0 });
  assert.deepEqual(result.byArea.find((a) => a.area === "ネットワーク"), { area: "ネットワーク", total: 1, done: 1 });
});

test("everything done leaves nothing to do", () => {
  const result = model.evaluate(all(2));
  assert.equal(result.done, 10);
  assert.deepEqual(result.thisWeek, []);
  assert.deepEqual(result.later, []);
});

test("unanswered questions are listed and count as not done", () => {
  assert.deepEqual(model.missing({ ...all(2), wifi: undefined, incident: "2" }), ["wifi", "incident"]);
  const result = model.evaluate({ mfa: 2 });
  assert.equal(result.answered, 1);
  assert.equal(result.thisWeek[0].id, "account");
});

test("the legal notes keep the checked wording", () => {
  const byId = Object.fromEntries(model.questions.map((q) => [q.id, q]));
  assert.match(byId["guest-data"].why, /旅館業法で作成から3年間の保存/);
  assert.match(byId.incident.why, /1,000人を超える/);
  assert.match(byId.incident.why, /概ね3〜5日以内/);
});

test("the page lists the same ten questions in the same order", () => {
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "security-check.html"), "utf8");
  const ids = [...html.matchAll(/data-question="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, model.questions.map((q) => q.id));
  model.questions.forEach((q, i) => {
    assert.ok(html.includes("<span>Q" + (i + 1) + "</span>" + q.question), q.id);
    assert.equal([...html.matchAll(new RegExp('name="' + q.id + '" value="([012])"', "g"))].map((m) => m[1]).join(), "2,1,0");
  });
});

test("the contact sheet covers every contact the incident todo names, with the date and the person in charge", () => {
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "security-check.html"), "utf8");
  const sheet = html.slice(html.indexOf('id="contact-sheet"'), html.indexOf("{% include tool-sources.html %}"));
  assert.ok(sheet.length > 0);
  const rows = [...sheet.matchAll(/<tr data-sheet-row="([^"]+)"><th scope="row">([^<]+)<\/th>/g)].map((m) => m[2]);
  ["OTA", "PMS", "カード会社", "警察", "個人情報保護委員会"].forEach((name) => {
    assert.ok(model.questions.find((q) => q.id === "incident").todo.includes(name), name);
    assert.ok(rows.some((row) => row.includes(name)), name);
  });
  assert.ok(sheet.includes('name="date"') && sheet.includes('name="person"'));
  // 公的窓口の番号は確かめた値のまま
  assert.ok(sheet.includes("03-6457-9849") && sheet.includes("#9110"));
  assert.ok(!/type="password"|name="pass/.test(sheet));
});
