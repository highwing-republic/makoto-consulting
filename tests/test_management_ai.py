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
  inbound:J('data/inbound/latest.json'),
  monthly:J('data/analysis/lodging-monthly.json')
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
    assert "省人化・DX参考スコア（当サイトの集計）" in data["dx"]["references"]
    assert all("dx-necessity-analysis" not in tool["href"] for tool in data["dx"]["relatedTools"])
    diagnosis_link = next(tool["href"] for tool in data["dx"]["relatedTools"] if tool["number"] == "01")
    regional_links = [tool["href"] for tool in data["dx"]["relatedTools"] if tool["number"] != "01"]
    assert diagnosis_link == "dx-diagnosis.html"
    assert regional_links and all("?pref=nagano" in link for link in regional_links)
    assert data["inbound"]["name"] == "京都府"
    assert data["inbound"]["references"] == ["02 インバウンド宿泊者分析", "05 宿泊市場の成長・稼働ポジション", "観光負荷・観光依存度参考スコア（当サイトの集計）"]
    assert data["sales"]["name"] == "鹿児島県"
    assert any(row["key"] == "occupancy" for row in data["sales"]["comparisons"])
    assert len(data["sales"]["matchedRules"]) >= 1
    assert data["market"]["name"] == "沖縄県"
    assert "05 宿泊市場の成長・稼働ポジション" in data["market"]["references"]
    assert "観光負荷・観光依存度参考スコア（当サイトの集計）" in data["market"]["references"]
    assert all("tourism-pressure-analysis" not in tool["href"] for topic in ("inbound", "market", "other") for tool in data[topic]["relatedTools"])
    assert data["other"]["name"] == "東京都"
    assert data["other"]["references"] == ["相談テーマ一覧"]
    assert 2 <= len(data["multi"]["matchedRules"]) <= 3
    assert set(data["missing"]["missing"]) == {"客室稼働率", "外国人延べ宿泊者数", "宿泊業従業者数"}
    occupancy_fact = next(row for row in data["missing"]["facts"] if "客室稼働率" in row["text"])
    assert occupancy_fact["symbol"] == "→" and "データなし" in occupancy_fact["text"]
    for case in (data["dx"], data["inbound"], data["sales"], data["market"], data["other"]):
        assert 1 <= case["hypotheses"] <= 3
        assert case["checklist"] == 3
        assert 2 <= case["facts"] <= 5


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
  inbound:J('data/inbound/latest.json'),
  monthly:J('data/analysis/lodging-monthly.json')
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
).replace(
    "data/analysis/lodging-monthly.json", "tests/fixtures/management-ai/lodging-monthly.json"
)


def test_fixture_datasets_are_one_consistent_snapshot():
    data = run_node(LOAD_FIXTURES + r"""
console.log(JSON.stringify({lodging:datasets.statistics.metadata.sources.lodging.reference_period,
  dx:datasets.dx.metadata.sources.lodging.reference_period,inbound:[datasets.inbound.metadata.year,datasets.inbound.metadata.month],
  monthly:datasets.monthly.metadata.reference_period}));
""")
    assert data == {"lodging": "2025-08〜2026-07", "dx": "2025-08〜2026-07", "inbound": [2026, 7], "monthly": "2024-08〜2026-07"}


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
  markets:answer.perspectives[0].data,seasonData:answer.perspectives[1].data,reception:answer.perspectives[2],lead:answer.lead,trend:answer.trendNotes,facts:answer.facts}));
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
    # 冒頭は月別値（第2表）の「国内客が減る月の外国人の比重」。季節の差（国籍別の集計表）は傾向の欄に回る。
    assert data["lead"]["title"] == "国内客が減る時期に、外国人の宿泊を取り込めているか"
    assert "1月、国内客が年平均を10%下回る" in data["lead"]["note"] and "20.7%（2025年の1年間では8.1%）" in data["lead"]["note"]
    assert "2025年1月〜2025年12月の月別値" in data["lead"]["evidence"][0]
    assert any("2月が5月の約6.1倍" in text and "全国（約1.2倍）" in text for text in data["trend"])
    assert all(fact["note"] for fact in data["facts"])
    assert "2025-08〜2026-07" in data["facts"][0]["note"] and "人泊" in data["facts"][0]["note"]


def test_inbound_missing_data_shows_no_figures():
    data = run_node(LOAD_DATASETS + r"""
const broken=structuredClone(datasets);
delete broken.inbound.prefectures['新潟県'];
delete broken.monthly.prefectures['15'];
broken.statistics.prefectures['15'].foreign_guest_nights=null;
const context=R.getRegionContext(broken,'niigata');
const answer=R.generateInsights(context,'inbound',{},'');
const partial=structuredClone(datasets);
delete partial.inbound.prefectures['新潟県'];
const partialAnswer=R.generateInsights(R.getRegionContext(partial,'niigata'),'inbound',{},'');
console.log(JSON.stringify({perspectives:answer.perspectives.map((item)=>({status:item.status,data:item.data,missing:item.missing})),seasons:answer.seasons,lead:answer.lead,missing:answer.missing,
  table:answer.lodgingTable,partialSeason:partialAnswer.perspectives[1].data}));
""")
    assert [item["status"] for item in data["perspectives"]] == ["missing", "missing", "self-check"]
    assert data["perspectives"][0]["data"] is None and "取得できませんでした" in data["perspectives"][0]["missing"]
    assert data["seasons"] is None
    assert "取得できませんでした" in data["lead"]["note"]
    assert "外国人延べ宿泊者数" in data["missing"] and "月別の宿泊統計" in data["missing"]
    assert data["table"] is None
    # 国籍別の集計表だけが欠けた場合は、月別値（第2表）の行だけを出す。
    assert [line["label"] for line in data["partialSeason"]["lines"]] == ["外国人の割合が最も高い月（2025年1月〜2025年12月）"]


def test_foreign_share_gap_needs_guest_night_basis_and_rule_version_is_bumped():
    data = run_node(LOAD_FIXTURES + r"""
const context=R.getRegionContext(datasets,'tokyo');
const run=(basis)=>{const a=R.generateInsights(context,'inbound',{foreignShare:2,foreignShareBasis:basis},'');return {rules:a.matchedRules,row:a.comparisons[0],lead:a.lead.title};};
console.log(JSON.stringify({version:R.RULE_VERSION,nights:run('guest_nights'),bookings:run('bookings'),guests:run('guests'),unknown:run('unknown'),none:run(null)}));
""")
    assert data["version"] == "1.3.0"
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
    assert data["niigata"]["rules"][:2] == ["inbound-domestic-complement", "inbound-seasonality"]
    assert "inbound-concentration" not in data["niigata"]["rules"]  # 上位3つは46.1%で全国（46.6%）並み
    concentration = data["kagawa"]["profile"]["concentration"]
    assert concentration["names"] == ["台湾", "韓国", "中国"] and round(concentration["share"] * 100) == 82
    assert data["kagawa"]["lead"]["ruleId"] == "inbound-concentration" and "82%" in data["kagawa"]["lead"]["note"]
    assert data["tokyo"]["lead"]["ruleId"] == "inbound-market-opportunity" and "56.3%" in data["tokyo"]["lead"]["note"]
    # 冒頭の論点は地域ごとに分かれ、一律の案内だけにならない。
    assert sum(data["leads"].values()) == 47 and data["leads"].get("none", 0) < 15
    # 追加ルールはインバウンドだけに効く。
    assert not any(rule.startswith("inbound-") for rules in data["others"].values() for rule in rules)


def test_monthly_rules_compare_one_basis_year_and_name_the_month():
    data = run_node(LOAD_FIXTURES + r"""
const run=(slug,topic,facility={})=>{const c=R.getRegionContext(datasets,slug);const a=R.generateInsights(c,topic,facility,'');
  return {profile:{period:c.monthlyProfile.period,yearLabel:c.monthlyProfile.yearLabel,basis:c.monthlyProfile.basisLabel},
    rules:a.matchedRules,lead:a.lead,trend:a.trendNotes,facts:a.facts,table:a.lodgingTable,season:a.perspectives?a.perspectives[1]:null};};
const lists={complement:[],gap:[]};
for (const row of Object.values(datasets.statistics.prefectures)) {
  const c=R.getRegionContext(datasets,row.prefecture_slug);
  if (R.generateInsights(c,'inbound',{},'').matchedRules.includes('inbound-domestic-complement')) lists.complement.push(row.prefecture_name);
  if (R.generateInsights(c,'sales',{},'').matchedRules.includes('sales-seasonal-gap')) lists.gap.push(row.prefecture_name);
}
const shifted=structuredClone(datasets);
shifted.monthly.basis=shifted.monthly.basis.map(()=> 'after');
const shiftedProfile=R.getRegionContext(shifted,'niigata').monthlyProfile;
const mixed=structuredClone(datasets);
mixed.monthly.basis=mixed.monthly.basis.map((value,index)=>index%2?'after':'before');
console.log(JSON.stringify({niigata:run('niigata','inbound'),niigataSales:run('niigata','sales'),aomori:run('aomori','sales'),
  aomoriLow:run('aomori','sales',{occupancyRate:20}),tokyo:run('tokyo','inbound'),lists,
  shifted:{period:shiftedProfile.period,yearLabel:shiftedProfile.yearLabel},mixed:R.getRegionContext(mixed,'niigata').monthlyProfile,
  others:['other'].map((topic)=>R.generateInsights(R.getRegionContext(datasets,'aomori'),topic,{},'').lodgingTable)}));
""")
    # 2026年1月の基準変更をまたがず、同じ基準で12か月そろう最新の期間（2025年1〜12月）を使う。
    assert data["niigata"]["profile"] == {"period": "2025年1月〜2025年12月", "yearLabel": "2025年の1年間", "basis": "2025年12月までの集計・層化基準"}
    assert data["shifted"] == {"period": "2025年8月〜2026年7月", "yearLabel": "2025年8月〜2026年7月の1年間"}
    assert data["mixed"] is None

    niigata = data["niigata"]
    assert niigata["rules"][0] == "inbound-domestic-complement"
    season_line = niigata["season"]["data"]["lines"][-1]
    assert season_line == {"label": "外国人の割合が最も高い月（2025年1月〜2025年12月）", "value": "1月 20.7%（1年間では 8.1%）\nこの月の国内客は年平均の90%"}
    assert "第2表" in niigata["season"]["data"]["note"] and "一致しません" in niigata["season"]["data"]["note"]
    assert niigata["season"]["checks"][2].startswith("国内客が少ない1月前後に")
    marked = {row["month"]: row["marks"] for row in niigata["table"]["rows"] if row["marks"]}
    assert marked == {1: ["外国人の割合が最も高い月"], 4: ["国内客が最も少ない月"]}
    assert [row["period"] for row in niigata["table"]["rows"]][0] == "2025-01" and len(niigata["table"]["rows"]) == 12

    # 売上・稼働：季節差が全国の1.5倍以上なら閑散月の論点、そうでなければ最も低い月を示す。
    aomori = data["aomori"]
    assert aomori["rules"][0] == "sales-seasonal-gap"
    assert aomori["lead"]["title"] == "稼働が落ちる月に向けて、販売と運営の手当てができているか"
    assert "最も高い10月が75.3%、最も低い1月が45.2%で、差は30.1ポイント" in aomori["lead"]["note"] and "全国（12.5ポイント）" in aomori["lead"]["note"]
    assert data["aomoriLow"]["rules"][0] == "facility-occupancy-gap"  # 自施設の入力値による判定が先
    sales = data["niigataSales"]
    assert sales["rules"] == [] and sales["lead"]["ruleId"] is None
    assert sales["lead"]["title"] == "稼働率が下がる月に、自施設の稼働と販売がどうなっているか"
    assert "1月（40.9%）で、全国の同じ月（54.6%）より13.7ポイント低い水準" in sales["lead"]["note"]
    assert sales["trend"][0].startswith("地域の稼働率や需要伸びは、自施設の売上を直接説明するものではありません")
    assert any("最も低いのは1月（40.9%）" in fact["text"] and "第8表" in fact["note"] for fact in sales["facts"])
    assert {row["month"]: row["marks"] for row in sales["table"]["rows"] if row["marks"]} == {1: ["稼働率が最も低い月"], 8: ["稼働率が最も高い月"]}

    assert "inbound-domestic-complement" not in data["tokyo"]["rules"]
    assert sorted(data["lists"]["complement"]) == sorted(["北海道", "岩手県", "山形県", "新潟県", "富山県", "長野県", "和歌山県", "広島県"])
    assert len(data["lists"]["gap"]) == 21 and "青森県" in data["lists"]["gap"] and "東京都" not in data["lists"]["gap"]
    assert data["others"] == [None]


def test_monthly_data_is_optional_and_published_with_its_source():
    ui = UI.read_text(encoding="utf-8")
    assert "fetch('data/analysis/lodging-monthly.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).catch(() => null)" in ui
    soup = BeautifulSoup(PAGE.read_text(encoding="utf-8"), "html.parser")
    table = soup.select_one("#answer-lodging")
    assert table is not None and table.has_attr("hidden")
    assert table.find_parent("section")["aria-labelledby"] == "answer-details-heading"
    data = run_node(LOAD_DATASETS + r"""
const rows=[];
for (const row of Object.values(datasets.statistics.prefectures)) for (const topic of ['inbound','sales','dx','market']) {
  const a=R.generateInsights(R.getRegionContext(datasets,row.prefecture_slug),topic,{},'');
  rows.push({topic,rows:a.lodgingTable?a.lodgingTable.rows.length:0,missing:a.missing});
}
const none=structuredClone(datasets); delete none.monthly;
const plain=R.generateInsights(R.getRegionContext(none,'niigata'),'sales',{},'');
console.log(JSON.stringify({rows,plain:{rules:plain.matchedRules,table:plain.lodgingTable,missing:plain.missing,lead:plain.lead.title},
  meta:datasets.monthly.metadata}));
""")
    assert all(row["rows"] == 12 and "月別の宿泊統計" not in row["missing"] for row in data["rows"])
    assert data["plain"]["table"] is None and data["plain"]["missing"] == ["月別の宿泊統計"]
    assert data["plain"]["lead"] == "地域の稼働や需要の動きと、自施設の販売状況に違いがないか"
    assert data["meta"]["source_name"] == "観光庁「宿泊旅行統計調査」" and "第8表" in data["meta"]["table_name"]


def test_dx_and_market_leads_name_each_prefectures_months():
    data = run_node(LOAD_FIXTURES + r"""
const run=(slug,topic)=>{const c=R.getRegionContext(datasets,slug);const a=R.generateInsights(c,topic,{},'');
  return {rules:a.matchedRules,lead:a.lead,trend:a.trendNotes,facts:a.facts,marks:a.lodgingTable?Object.fromEntries(a.lodgingTable.rows.filter((r)=>r.marks.length).map((r)=>[r.month,r.marks])):null};};
const leads={dx:{},market:{}};
const titles={dx:new Set(),market:new Set()};
for (const row of Object.values(datasets.statistics.prefectures)) for (const topic of ['dx','market']) {
  const a=R.generateInsights(R.getRegionContext(datasets,row.prefecture_slug),topic,{},'');
  (leads[topic][a.lead.ruleId||'none']=leads[topic][a.lead.ruleId||'none']||[]).push(row.prefecture_name);
  titles[topic].add(a.lead.title);
  if (!a.lead.note.includes(R.getRegionContext(datasets,row.prefecture_slug).name)) titles[topic].add('NO-NAME:'+row.prefecture_name);
}
const none=structuredClone(datasets); delete none.monthly;
const plain=['dx','market'].map((topic)=>R.generateInsights(R.getRegionContext(none,'niigata'),topic,{},''));
console.log(JSON.stringify({yamanashi:run('yamanashi','dx'),niigata:run('niigata','dx'),aomori:run('aomori','dx'),
  tokyo:run('tokyo','market'),niigataMarket:run('niigata','market'),gifu:run('gifu','market'),
  counts:{dx:Object.fromEntries(Object.entries(leads.dx).map(([k,v])=>[k,v.length])),market:Object.fromEntries(Object.entries(leads.market).map(([k,v])=>[k,v.length]))},
  seasonal:leads.dx['dx-seasonal-workload'].sort(),titles:{dx:[...titles.dx],market:[...titles.market]},
  plain:plain.map((a)=>({title:a.lead.title,missing:a.missing,table:a.lodgingTable,rules:a.matchedRules}))}));
""")
    # 人手不足・DX：最多月÷最少月の上回る幅が全国（約1.4倍）の2倍以上なら、繁閑の差を冒頭の論点にする。
    yamanashi = data["yamanashi"]
    assert yamanashi["rules"][0] == "dx-seasonal-workload"
    assert yamanashi["lead"]["title"] == "繁忙月と閑散月で、人員配置と業務量が合っているか"
    assert "最も多い8月が最も少ない2月の約2.6倍で、全国（約1.4倍）" in yamanashi["lead"]["note"]
    assert yamanashi["marks"] == {"2": ["宿泊者が最も少ない月"], "8": ["宿泊者が最も多い月"]}
    # 既存ルールが先に当たる県は、そのルールの数値を冒頭に出し、繁閑の差は傾向の欄に回る。
    aomori = data["aomori"]
    assert aomori["rules"][:2] == ["dx-high-workforce-decline", "dx-seasonal-workload"]
    assert aomori["lead"]["title"] == "人を増やしにくい中で、どの業務から省力化するか" and "全国1位" in aomori["lead"]["note"]
    assert any("繁閑の差が大きい" in text for text in aomori["trend"])
    # どのルールにも当たらない県も、月別の値で県ごとの論点を出し、基本案内は傾向の欄に残す。
    niigata = data["niigata"]
    assert niigata["rules"] == [] and niigata["lead"]["title"] == "繁忙月に、どの業務で人手が足りなくなるか"
    assert "最も多いのは8月で、最も少ない4月の約1.6倍" in niigata["lead"]["note"]
    assert niigata["trend"][0].startswith("地域の参考スコアだけで優先業務は決まりません")
    assert any("最も少ない4月の約1.6倍" in fact["text"] and "第2表" in fact["note"] for fact in niigata["facts"])
    assert data["seasonal"] == sorted(["福井県", "山梨県", "長野県", "滋賀県", "奈良県", "和歌山県", "鳥取県", "島根県", "秋田県", "栃木県"])

    # 地域市場：繁忙月の客室稼働率で、埋まる地域（75%以上）と余裕がある地域（60%未満）を分ける。
    tokyo = data["tokyo"]
    assert tokyo["rules"][0] == "market-peak-full"
    assert "10月に81.2%まで上がり（全国の同じ月は67.1%）" in tokyo["lead"]["note"]
    niigata_market = data["niigataMarket"]
    assert niigata_market["rules"][0] == "market-peak-slack"
    assert "最も高い8月でも52.8%です（全国の同じ月は65.9%）" in niigata_market["lead"]["note"]
    assert data["gifu"]["rules"] == [] and data["gifu"]["lead"]["title"] == "地域の宿泊が多い時期と、自施設の繁忙期は同じか"

    assert data["counts"]["dx"] == {"none": 19, "dx-operation-load": 10, "dx-high-workforce-decline": 8, "dx-seasonal-workload": 10}
    assert data["counts"]["market"] == {"market-peak-slack": 13, "market-growth": 19, "market-peak-full": 5, "tourism-context": 6, "none": 4}
    # 冒頭の文に県名と数値が入り、全県共通の一文だけにはならない。
    assert not any(title.startswith("NO-NAME") for titles in data["titles"].values() for title in titles)
    assert "負荷の大きい業務がどこにあるか" not in data["titles"]["dx"]
    assert "地域の需要の動きが、自施設の客層や時期に当てはまるか" not in data["titles"]["market"]

    # 月別データがない場合は、既存ルールの論点か従来の基本案内になり、欠けたデータを明示する。
    assert [item["title"] for item in data["plain"]] == ["負荷の大きい業務がどこにあるか", "伸びている需要に、自施設の客層や時期が合っているか"]
    assert data["plain"][1]["rules"][0] == "market-growth"
    assert all(item["missing"] == ["月別の宿泊統計"] and item["table"] is None for item in data["plain"])
