import json
import subprocess
from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "management-ai.html"
RULES = ROOT / "js" / "management-ai-rules.js"
UI = ROOT / "js" / "management-ai.js"


def run_rules_cases():
    script = r"""
const fs=require('fs');
require('./js/management-ai-rules.js');
const J=(path)=>JSON.parse(fs.readFileSync(path,'utf8'));
const datasets={
  statistics:J('data/analysis/prefecture-statistics.json'),
  dx:J('data/analysis/dx-necessity.json'),
  supply:J('data/analysis/supply-demand-gap.json'),
  tourism:J('data/analysis/tourism-pressure.json'),
  inbound:J('data/inbound/latest.json')
};
const R=globalThis.ManagementAIRules;
const make=(slug,topic,facility={})=>{
  const context=R.getRegionContext(datasets,slug);
  const answer=R.generateInsights(context,topic,facility,'フロントと予約管理を効率化したい');
  return {slug:context.slug,name:context.name,topic:answer.topic,references:answer.references,facts:answer.facts.length,hypotheses:answer.hypotheses.length,checklist:answer.checklist.length,comparisons:answer.comparisons,matchedRules:answer.matchedRules,status:answer.status,relatedTools:answer.relatedTools};
};
const missingDatasets=structuredClone(datasets);
missingDatasets.statistics.prefectures['13'].occupancy_rate=null;
missingDatasets.statistics.prefectures['13'].foreign_guest_nights=null;
missingDatasets.statistics.prefectures['13'].lodging_employees=null;
const missingContext=R.getRegionContext(missingDatasets,'tokyo');
const missingAnswer=R.generateInsights(missingContext,'sales',{},'');
console.log(JSON.stringify({
  classifications:[R.classifyQuestion('外国人集客を考えたい',''),R.classifyQuestion('採用が難しい',''),R.classifyQuestion('外国人について','dx'),R.classifyQuestion('何を相談できる？','other')],
  slugs:[R.resolvePrefectureSlug(datasets.statistics.prefectures,'nagano'),R.resolvePrefectureSlug(datasets.statistics.prefectures,'abc'),R.resolvePrefectureSlug(datasets.statistics.prefectures,null)],
  dx:make('nagano','dx'),
  inbound:make('kyoto','inbound'),
  sales:make('kagoshima','sales',{occupancyRate:20,rooms:30,employees:10}),
  market:make('okinawa','market'),
  other:make('tokyo','other'),
  multi:make('nagano','market'),
  missing:{missing:missingAnswer.missing,facts:missingAnswer.facts}
}));
"""
    completed = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True,
        text=True, encoding="utf-8"
    )
    return json.loads(completed.stdout)


def test_page_has_required_inputs_and_fixed_answer_structure():
    soup = BeautifulSoup(PAGE.read_text(encoding="utf-8"), "html.parser")
    assert soup.title.string == "宿泊経営の課題整理（β）｜公的統計と施設情報から次の確認を整理｜宿泊DXラボ"
    assert soup.find("link", rel="canonical")["href"] == "https://lab.ugatta-llc.com/management-ai.html"
    assert len(soup.select('input[name="topic"]')) == 5
    assert soup.find(id="management-prefecture").has_attr("required")
    for field_id in ("facility-type", "facility-rooms", "facility-employees", "facility-occupancy", "facility-foreign-share", "management-question"):
        assert soup.find(id=field_id)
    for section_id in ("answer-status", "answer-facts", "answer-hypotheses", "answer-checklist", "answer-related", "answer-data-periods", "answer-references", "answer-metrics", "answer-rules", "answer-rule-version"):
        assert soup.find(id=section_id)
    assert soup.find("noscript")


def test_answer_sections_follow_the_agreed_information_order():
    soup = BeautifulSoup(PAGE.read_text(encoding="utf-8"), "html.parser")
    result = soup.find(id="management-result")
    headings = [node.get_text(strip=True) for node in result.select("h3.management-section-label, #answer-next-heading")]
    assert headings == [
        "最初に確認したいこと",
        "自施設で確認する具体的な項目",
        "地域データから見える傾向",
        "地域の外国人宿泊需要を詳しく見る",
        "詳しいデータ・地域との参考比較",
        "出典・データ時点・判定ルール",
    ]
    # 分析対象は冒頭の見出し。最初に確認したいことはその直後に置く。
    assert result.find("h2", id="answer-title") and "分析対象" in result.select_one(".management-answer-header").get_text()
    text = result.get_text(" ", strip=True)
    assert "公的機関が公表したランキングではありません" in text
    # 判定根拠の詳細は折りたためるが、ルール版と注意書きは折りたたみの外に出す。
    grounds = result.select_one("details.management-grounds")
    assert grounds and not grounds.has_attr("open")
    assert not grounds.find(id="answer-rule-version")
    assert not grounds.select_one(".management-grounds-note")
    link = result.find(id="answer-next-link")
    assert link.get_text(strip=True) == "インバウンド宿泊者分析を見る →" and link["href"] == "inbound-analysis.html"


def test_facility_fields_follow_topic_table_and_foreign_share_is_defined():
    soup = BeautifulSoup(PAGE.read_text(encoding="utf-8"), "html.parser")
    fields = {node["data-facility-field"] for node in soup.select("[data-facility-field]")}
    assert fields == {"type", "rooms", "employees", "occupancyRate", "foreignShare"}
    basis = soup.find(id="facility-foreign-basis")
    assert [option["value"] for option in basis.find_all("option")] == ["", "guest_nights", "guests", "bookings", "unknown"]
    help_text = soup.find(id="foreign-share-help").get_text()
    assert "延べ宿泊者数（人泊）" in help_text and "予約件数" in help_text and "差は比べません" in help_text
    assert soup.find(id="facility-foreign-share")["aria-describedby"] == "foreign-share-help"
    assert "文章の意味を読み取って回答するものではありません" in soup.find(id="management-question-help").get_text()
    assert soup.find(id="management-selection") is not None
    assert soup.find(id="management-stale").has_attr("hidden")


def test_number_inputs_allow_blank_but_reject_out_of_range_in_markup():
    soup = BeautifulSoup(PAGE.read_text(encoding="utf-8"), "html.parser")
    occupancy = soup.find(id="facility-occupancy")
    foreign = soup.find(id="facility-foreign-share")
    assert not occupancy.has_attr("required") and occupancy["min"] == "0" and occupancy["max"] == "100"
    assert not foreign.has_attr("required") and foreign["min"] == "0" and foreign["max"] == "100"
    assert soup.find(id="facility-rooms")["min"] == "1"
    assert soup.find(id="facility-employees")["min"] == "1"


def test_primary_controls_are_prominent_and_facility_details_stay_optional():
    soup = BeautifulSoup(PAGE.read_text(encoding="utf-8"), "html.parser")
    intro = soup.select_one(".management-form__intro")
    assert "必須なのは「相談テーマ」と「都道府県」だけ" in intro.get_text()
    primary = soup.select_one(".management-primary-controls")
    assert primary.find(id="management-topic-title")
    assert primary.find(id="management-prefecture")
    optional = soup.select_one("details.management-optional")
    assert optional and not optional.has_attr("open")
    assert "施設情報を追加する" in optional.summary.get_text()
    assert "生成AIではありません" in soup.get_text()


def test_v1_uses_only_local_rules_and_public_json():
    combined = RULES.read_text(encoding="utf-8") + UI.read_text(encoding="utf-8")
    for forbidden in ("api.openai.com", "generativelanguage.googleapis.com", "OPENAI_API_KEY", "GEMINI_API_KEY"):
        assert forbidden not in combined
    for required in (
        "data/analysis/prefecture-statistics.json",
        "data/analysis/dx-necessity.json",
        "data/analysis/supply-demand-gap.json",
        "data/analysis/tourism-pressure.json",
        "data/inbound/latest.json",
    ):
        assert required in combined
    assert "sessionStorage" not in combined and "localStorage" not in combined


def test_topic_classification_pref_fallback_and_five_representative_cases():
    data = run_rules_cases()
    assert data["classifications"] == ["inbound", "dx", "dx", "other"]
    assert data["slugs"] == ["nagano", "tokyo", "tokyo"]

    assert data["dx"]["name"] == "長野県"
    assert "04 地域の省人化・DX検討指標" in data["dx"]["references"]
    diagnosis_link = next(tool["href"] for tool in data["dx"]["relatedTools"] if tool["number"] == "01")
    regional_links = [tool["href"] for tool in data["dx"]["relatedTools"] if tool["number"] != "01"]
    assert diagnosis_link == "dx-diagnosis.html"
    assert regional_links and all("?pref=nagano" in link for link in regional_links)
    assert data["inbound"]["name"] == "京都府"
    assert data["inbound"]["references"] == ["02 インバウンド宿泊者分析", "05 宿泊市場の成長・稼働ポジション", "06 宿泊集中度・宿泊業依存度"]
    assert data["sales"]["name"] == "鹿児島県"
    assert any(row["key"] == "occupancy" for row in data["sales"]["comparisons"])
    assert len(data["sales"]["matchedRules"]) >= 1
    assert data["market"]["name"] == "沖縄県"
    assert "05 宿泊市場の成長・稼働ポジション" in data["market"]["references"]
    assert data["other"]["name"] == "東京都"
    assert data["other"]["references"] == ["相談テーマ一覧"]
    assert 2 <= len(data["multi"]["matchedRules"]) <= 3
    assert set(data["missing"]["missing"]) == {"客室稼働率", "外国人延べ宿泊者数", "宿泊業従業者数"}
    occupancy_fact = next(row for row in data["missing"]["facts"] if "客室稼働率" in row["text"])
    assert occupancy_fact["symbol"] == "→" and "データなし" in occupancy_fact["text"]
    for case in (data["dx"], data["inbound"], data["sales"], data["market"], data["other"]):
        assert 1 <= case["hypotheses"] <= 3
        assert case["checklist"] == 3
        assert 2 <= case["facts"] <= 4


def test_ga4_events_exclude_free_text_and_rules_are_separated():
    source = UI.read_text(encoding="utf-8")
    for event in ("tool_open", "analysis_run", "analysis_result_view"):
        assert event in source
    analyze_payload = source[source.index("analysis_run"):source.index("analysis_run") + 450]
    assert "question" not in analyze_payload
    assert 'src="js/management-ai-rules.js' in PAGE.read_text(encoding="utf-8")
    assert 'src="js/management-ai.js' in PAGE.read_text(encoding="utf-8")
    assert "params.get('pref')" in source and "params.get('topic')" in source
    assert "url.searchParams.set('pref'" in source and "url.searchParams.set('topic'" in source
    assert "result.focus({ preventScroll: true })" in source


def test_responsive_styles_and_home_tool_regression():
    css = (ROOT / "css" / "useful.css").read_text(encoding="utf-8")
    assert ".management-topic-grid" in css
    assert "@media(max-width:760px)" in css
    assert "@media(max-width:620px)" in css
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "/report.html" in home
    assert "AIに相談する" in home and "/management-ai.html" in home
    for existing in ("dx-diagnosis.html", "inbound-analysis.html", "dx-necessity-analysis.html", "supply-demand-gap-analysis.html", "tourism-pressure-analysis.html"):
        assert (ROOT / existing).exists()


def run_node(script):
    completed = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True,
        text=True, encoding="utf-8"
    )
    return json.loads(completed.stdout)


LOAD_DATASETS = r"""
const fs=require('fs');
require('./js/management-ai-rules.js');
const J=(path)=>JSON.parse(fs.readFileSync(path,'utf8'));
const datasets={
  statistics:J('data/analysis/prefecture-statistics.json'),
  dx:J('data/analysis/dx-necessity.json'),
  supply:J('data/analysis/supply-demand-gap.json'),
  tourism:J('data/analysis/tourism-pressure.json'),
  inbound:J('data/inbound/latest.json')
};
const R=globalThis.ManagementAIRules;
"""

# 具体的な数値を確かめるテストは、2026年7月分（第2次速報）で固定したデータを使う。
# 公開データ（data/）は週次の自動更新で変わり、更新処理は pytest が通った場合だけコミットするため、
# 公開データに数値を固定すると次の月のデータ更新が止まってしまう。
LOAD_FIXTURES = LOAD_DATASETS.replace(
    "data/analysis/prefecture-statistics.json", "tests/fixtures/management-ai/prefecture-statistics.json"
).replace(
    "data/analysis/dx-necessity.json", "tests/fixtures/cross-analysis/dx-necessity.json"
).replace(
    "data/analysis/supply-demand-gap.json", "tests/fixtures/cross-analysis/supply-demand-gap.json"
).replace(
    "data/analysis/tourism-pressure.json", "tests/fixtures/cross-analysis/tourism-pressure.json"
).replace(
    "data/inbound/latest.json", "tests/fixtures/inbound/latest.json"
)


def test_fixture_datasets_are_one_consistent_snapshot():
    data = run_node(LOAD_FIXTURES + r"""
console.log(JSON.stringify({lodging:datasets.statistics.metadata.sources.lodging.reference_period,
  dx:datasets.dx.metadata.sources.lodging.reference_period,inbound:[datasets.inbound.metadata.year,datasets.inbound.metadata.month]}));
""")
    assert data == {"lodging": "2025-08〜2026-07", "dx": "2025-08〜2026-07", "inbound": [2026, 7]}


def test_all_47_prefectures_and_topics_produce_complete_answers():
    data = run_node(LOAD_DATASETS + r"""
const rows=[];
for (const row of Object.values(datasets.statistics.prefectures)) {
  for (const topic of Object.keys(R.TOPICS)) {
    const context=R.getRegionContext(datasets,row.prefecture_slug);
    const answer=R.generateInsights(context,topic,{},'');
    rows.push({slug:row.prefecture_slug,name:context.name,topic,text:JSON.stringify(answer),lead:answer.lead,
      perspectives:(answer.perspectives||[]).map((item)=>({id:item.id,status:item.status,checks:item.checks.length,lines:item.data?item.data.lines.length:0})),
      checklist:answer.checklist.length,trendNotes:answer.trendNotes.length,regionNote:answer.regionNote,
      monthly:answer.seasons?answer.seasons.rows.length:null});
  }
}
console.log(JSON.stringify(rows));
""")
    assert len(data) == 47 * 5
    for row in data:
        assert "undefined" not in row["text"] and "NaN" not in row["text"], (row["slug"], row["topic"])
        assert row["lead"]["title"] and row["lead"]["note"], (row["slug"], row["topic"])
        assert row["regionNote"].startswith(f"表示している地域データは{row['name']}全体の集計値です")
        if row["topic"] == "inbound":
            assert [item["id"] for item in row["perspectives"]] == ["markets", "seasons", "reception"]
            assert [item["status"] for item in row["perspectives"]] == ["data", "data", "self-check"], row["slug"]
            assert all(item["checks"] == 3 for item in row["perspectives"])
            assert row["perspectives"][0]["lines"] >= 3 and row["perspectives"][2]["lines"] == 0
            assert row["monthly"] == 12
        else:
            assert row["perspectives"] == [] and row["checklist"] == 3


def test_inbound_perspectives_use_inbound_tool_figures_and_split_survey_scopes():
    data = run_node(LOAD_FIXTURES + r"""
const M=require('./js/inbound-analysis-model.js');
const mismatches=[];
for (const row of Object.values(datasets.statistics.prefectures)) {
  const context=R.getRegionContext(datasets,row.prefecture_slug);
  const markets=R.inboundMarkets(context);
  const expected=M.marketRows(datasets.inbound.prefectures[context.name],datasets.inbound.national);
  const top=expected.slice(0,3).map((item)=>[item.name,item.value,item.localShare]);
  if (JSON.stringify(top)!==JSON.stringify(markets.top.map((item)=>[item.name,item.value,item.localShare]))) mismatches.push(context.name);
}
const niigata=R.getRegionContext(datasets,'niigata');
const seasons=R.inboundSeasons(niigata);
const answer=R.generateInsights(niigata,'inbound',{type:'旅館'},'');
console.log(JSON.stringify({mismatches,segments:seasons.segments.map((s)=>({scope:s.scope,months:s.months.length,peak:s.peak&&s.peak.month,low:s.low&&s.low.month})),
  markets:answer.perspectives[0].data,seasonData:answer.perspectives[1].data,reception:answer.perspectives[2],lead:answer.lead,facts:answer.facts}));
""")
    assert data["mismatches"] == []
    # 集計対象が変わる 2026年1月で区切り、区切りの中でだけ多い月・少ない月を選ぶ。
    assert data["segments"] == [
        {"scope": "従業者数10人以上の施設", "months": 5, "peak": 12, "low": 9},
        {"scope": "客室数20室以上の施設", "months": 7, "peak": 2, "low": 5},
    ]
    assert "集計・層化基準が変わり" in data["seasonData"]["note"]
    assert data["markets"]["lines"][0] == {"label": "1位 台湾", "value": "5,450人泊（構成比20.1%）"}
    assert "2026年7月（第2次速報）の1か月分・客室数20室以上の施設" in data["markets"]["note"]
    # ③は統計で判定しない。
    assert data["reception"]["status"] == "self-check" and data["reception"]["data"] is None
    assert "判定せず" in data["reception"]["selfCheck"]
    assert "大浴場" in data["reception"]["checks"][0]
    assert data["lead"]["title"] == "外国人宿泊が集中する時期に、自施設の販売と受け入れが合っているか"
    assert "2月が5月の約6.1倍" in data["lead"]["note"] and "全国（約1.2倍）" in data["lead"]["note"]
    assert "2026年1月〜2026年7月・客室数20室以上の施設" in data["lead"]["evidence"][0]
    assert all(fact["note"] for fact in data["facts"])
    assert "2025-08〜2026-07" in data["facts"][0]["note"] and "人泊" in data["facts"][0]["note"]


def test_inbound_missing_data_shows_no_figures():
    data = run_node(LOAD_DATASETS + r"""
const broken=structuredClone(datasets);
delete broken.inbound.prefectures['新潟県'];
broken.statistics.prefectures['15'].foreign_guest_nights=null;
const context=R.getRegionContext(broken,'niigata');
const answer=R.generateInsights(context,'inbound',{},'');
console.log(JSON.stringify({perspectives:answer.perspectives.map((item)=>({status:item.status,data:item.data,missing:item.missing})),seasons:answer.seasons,lead:answer.lead,missing:answer.missing}));
""")
    assert [item["status"] for item in data["perspectives"]] == ["missing", "missing", "self-check"]
    assert data["perspectives"][0]["data"] is None and "取得できませんでした" in data["perspectives"][0]["missing"]
    assert data["seasons"] is None
    assert "取得できませんでした" in data["lead"]["note"]
    assert "外国人延べ宿泊者数" in data["missing"]


def test_foreign_share_gap_needs_guest_night_basis_and_rule_version_is_bumped():
    data = run_node(LOAD_FIXTURES + r"""
const context=R.getRegionContext(datasets,'tokyo');
const run=(basis)=>{const a=R.generateInsights(context,'inbound',{foreignShare:2,foreignShareBasis:basis},'');return {rules:a.matchedRules,row:a.comparisons[0],lead:a.lead.title};};
console.log(JSON.stringify({version:R.RULE_VERSION,nights:run('guest_nights'),bookings:run('bookings'),guests:run('guests'),unknown:run('unknown'),none:run(null)}));
""")
    assert data["version"] == "1.1.0"
    assert data["nights"]["rules"][0] == "facility-foreign-gap" and data["nights"]["row"]["comparable"]
    assert data["nights"]["row"]["difference"].endswith("pt")
    assert data["nights"]["lead"] == "地域と比べて、自施設の外国人宿泊が少ない理由はどこにあるか"
    for key in ("bookings", "guests", "unknown", "none"):
        assert "facility-foreign-gap" not in data[key]["rules"], key
        assert data[key]["row"]["rawDifference"] is None and data[key]["row"]["difference"] == "差は出していません"
    assert "予約件数" in data["bookings"]["row"]["note"] and "未確認" in data["unknown"]["row"]["note"]


def test_topic_fields_examples_and_question_guide():
    data = run_node(LOAD_DATASETS + r"""
const context=R.getRegionContext(datasets,'niigata');
const guide=(topic,q)=>R.generateInsights(context,topic,{},q).questionGuide;
console.log(JSON.stringify({fields:R.FACILITY_FIELDS,examples:Object.fromEntries(Object.entries(R.TOPIC_EXAMPLES).map(([k,v])=>[k,v.map((e)=>e.text)])),
  example:guide('inbound','外国人宿泊需要が多い時期は？'),other:guide('inbound','採用が難しい'),unknown:guide('inbound','今日の天気は？'),
  dx:guide('dx','フロントの電話対応が多い'),empty:guide('inbound','')}));
""")
    assert data["fields"] == {
        "dx": ["type", "rooms", "employees"],
        "inbound": ["type", "foreignShare"],
        "sales": ["type", "rooms", "occupancyRate"],
        "market": ["type"],
        "other": ["type"],
    }
    assert data["examples"]["inbound"] == [
        "この地域ではどの国・地域からの宿泊が多い？",
        "外国人宿泊需要が多い時期は？",
        "自施設のインバウンド対応で何を確認すべき？",
    ]
    assert all(len(texts) >= 2 for texts in data["examples"].values())
    assert data["example"]["reflected"] and "②" in data["example"]["text"]
    assert data["other"]["suggestedTopic"] == "dx" and "人手不足・DX" in data["other"]["text"]
    assert not data["unknown"]["reflected"] and "反映していません" in data["unknown"]["text"]
    assert data["dx"]["reflected"]
    assert data["empty"] is None


def test_hidden_facility_fields_are_not_read_and_url_keeps_only_pref_and_topic():
    source = UI.read_text(encoding="utf-8")
    assert "Rules.FACILITY_FIELDS[topic]" in source
    assert "$(id).disabled = !active" in source
    update_url = source[source.index("function updateUrl"):source.index("function selectedTopic")]
    assert update_url.count("searchParams.set") == 2
    for forbidden in ("rooms", "employees", "occupancy", "foreign"):
        assert forbidden not in update_url


def test_regional_features_are_compared_with_national_within_one_survey_scope():
    data = run_node(LOAD_FIXTURES + r"""
const pick=(slug)=>{const c=R.getRegionContext(datasets,slug);const a=R.generateInsights(c,'inbound',{},'');return {profile:c.inboundProfile,rules:a.matchedRules,lead:a.lead,trend:a.trendNotes};};
const leads={};
for (const row of Object.values(datasets.statistics.prefectures)) {
  const a=R.generateInsights(R.getRegionContext(datasets,row.prefecture_slug),'inbound',{},'');
  leads[a.lead.ruleId||'none']=(leads[a.lead.ruleId||'none']||0)+1;
}
const others={};
for (const topic of ['dx','sales','market','other']) others[topic]=R.generateInsights(R.getRegionContext(datasets,'niigata'),topic,{},'').matchedRules;
console.log(JSON.stringify({niigata:pick('niigata'),kagawa:pick('kagawa'),tokyo:pick('tokyo'),leads,others}));
""")
    season = data["niigata"]["profile"]["seasonality"]
    # 2026年1月以降（客室数20室以上の施設）の月だけで、地域と全国の最多月÷最少月を比べる。
    assert season["period"] == "2026年1月〜2026年7月" and season["scope"] == "客室数20室以上の施設"
    assert (season["peak"]["month"], season["low"]["month"]) == (2, 5)
    assert round(season["ratio"], 1) == 6.1 and round(season["nationalRatio"], 1) == 1.2
    assert data["niigata"]["rules"][0] == "inbound-seasonality"
    assert "inbound-concentration" not in data["niigata"]["rules"]  # 上位3つは46.1%で全国（46.6%）並み
    concentration = data["kagawa"]["profile"]["concentration"]
    assert concentration["names"] == ["台湾", "韓国", "中国"] and round(concentration["share"] * 100) == 82
    assert data["kagawa"]["lead"]["ruleId"] == "inbound-concentration" and "82%" in data["kagawa"]["lead"]["note"]
    assert data["tokyo"]["lead"]["ruleId"] == "inbound-market-opportunity" and "56.3%" in data["tokyo"]["lead"]["note"]
    # 冒頭の論点は地域ごとに分かれ、一律の案内だけにならない。
    assert sum(data["leads"].values()) == 47 and data["leads"].get("none", 0) < 15
    # 追加ルールはインバウンドだけに効く。
    assert not any(rule.startswith("inbound-") for rules in data["others"].values() for rule in rules)
