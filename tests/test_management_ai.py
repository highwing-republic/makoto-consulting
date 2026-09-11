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
  return {slug:context.slug,name:context.name,topic:answer.topic,references:answer.references,facts:answer.facts.length,hypotheses:answer.hypotheses.length,checklist:answer.checklist.length,comparisons:answer.comparisons,matchedRules:answer.matchedRules,status:answer.status};
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
    assert soup.title.string == "宿泊経営AI｜地域データからDX・インバウンド・宿泊市場を考える｜宿泊DXラボ"
    assert soup.find("link", rel="canonical")["href"] == "https://lab.ugatta-llc.com/management-ai.html"
    assert len(soup.select('input[name="topic"]')) == 5
    assert soup.find(id="management-prefecture").has_attr("required")
    for field_id in ("facility-type", "facility-rooms", "facility-employees", "facility-occupancy", "facility-foreign-share", "management-question"):
        assert soup.find(id=field_id)
    for section_id in ("answer-status", "answer-facts", "answer-hypotheses", "answer-checklist", "answer-related", "answer-data-periods", "answer-references", "answer-metrics", "answer-rules"):
        assert soup.find(id=section_id)
    assert soup.find("noscript")


def test_number_inputs_allow_blank_but_reject_out_of_range_in_markup():
    soup = BeautifulSoup(PAGE.read_text(encoding="utf-8"), "html.parser")
    occupancy = soup.find(id="facility-occupancy")
    foreign = soup.find(id="facility-foreign-share")
    assert not occupancy.has_attr("required") and occupancy["min"] == "0" and occupancy["max"] == "100"
    assert not foreign.has_attr("required") and foreign["min"] == "0" and foreign["max"] == "100"
    assert soup.find(id="facility-rooms")["min"] == "1"
    assert soup.find(id="facility-employees")["min"] == "1"


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
    assert "04 宿泊DX必要度分析" in data["dx"]["references"]
    assert data["inbound"]["name"] == "京都府"
    assert data["inbound"]["references"] == ["02 インバウンド宿泊者分析", "05 宿泊市場需給ギャップ分析", "06 観光負荷・観光依存度分析"]
    assert data["sales"]["name"] == "鹿児島県"
    assert any(row["key"] == "occupancy" for row in data["sales"]["comparisons"])
    assert len(data["sales"]["matchedRules"]) >= 1
    assert data["market"]["name"] == "沖縄県"
    assert "05 宿泊市場需給ギャップ分析" in data["market"]["references"]
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
    for event in ("management_ai_start", "management_ai_topic_select", "management_ai_analyze", "management_ai_related_tool_click"):
        assert event in source
    analyze_payload = source[source.index("management_ai_analyze"):source.index("management_ai_analyze") + 300]
    assert "question" not in analyze_payload
    assert 'src="js/management-ai-rules.js' in PAGE.read_text(encoding="utf-8")
    assert 'src="js/management-ai.js' in PAGE.read_text(encoding="utf-8")
    assert "params.get('pref')" in source and "params.get('topic')" in source
    assert "url.searchParams.set('pref'" in source and "url.searchParams.set('topic'" in source


def test_responsive_styles_and_tools_01_to_07_regression():
    css = (ROOT / "css" / "useful.css").read_text(encoding="utf-8")
    assert ".management-topic-grid" in css
    assert "@media(max-width:760px)" in css
    assert "@media(max-width:620px)" in css
    for page_name in ("index.html", "useful.html"):
        source = (ROOT / page_name).read_text(encoding="utf-8")
        positions = [source.index(f">{number:02d}<") for number in range(1, 8)]
        assert positions == sorted(positions)
        assert "management-ai.html" in source
    for existing in ("dx-diagnosis.html", "inbound-analysis.html", "dx-necessity-analysis.html", "supply-demand-gap-analysis.html", "tourism-pressure-analysis.html"):
        assert (ROOT / existing).exists()
