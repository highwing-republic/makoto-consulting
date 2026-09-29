(() => {
  "use strict";

  const DATA_ROOT = "data/hotel-price-trends/";
  const MEAL_LABELS = {two_meals: "朝夕食付き", breakfast: "朝食付き", room_only: "素泊まり"};
  const RATING_LABELS = {service:"サービス",location:"立地",room:"部屋",equipment:"設備",bath:"風呂",breakfast:"朝食",dinner:"夕食",cleanliness:"清潔さ"};
  const model = window.HotelPriceTrendsModel;
  const elements = {
    region: document.querySelector("#hpt-region"), hotel: document.querySelector("#hpt-hotel"),
    stayDate: document.querySelector("#hpt-stay-date"), meal: document.querySelector("#hpt-meal"),
    loading: document.querySelector("#hpt-loading"), error: document.querySelector("#hpt-error"),
    errorMessage: document.querySelector("#hpt-error-message"), retry: document.querySelector("#hpt-retry"),
    dashboard: document.querySelector("#hpt-dashboard"), freshness: document.querySelector("#hpt-freshness")
  };
  let manifest;
  let latest;
  let snapshotHistory = [];
  let profileData = {properties: []};
  let profilesByHotel = new Map();

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  const yen = (value) => model.isFinitePositive(value) ? `¥${Number(value).toLocaleString("ja-JP")}` : "料金未確認";
  const pct = (value) => model.signedPercent(value);
  const ratingMedian = (values) => rawQuantile(values, .5);
  function rawQuantile(values, q) {
    const sorted = values.filter((value) => value != null).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base] + (sorted[base + 1] == null ? 0 : rest * (sorted[base + 1] - sorted[base]));
  }
  function dayDiff(later, earlier) {
    return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000);
  }
  async function getJson(path) {
    const response = await fetch(path, {cache: "no-cache"});
    if (!response.ok) throw new Error(`データ取得に失敗しました（${response.status}）`);
    return response.json();
  }
  function regionFrom(snapshot, code) { return snapshot.regions.find((region) => region.code === code); }
  function selectedRegion() { return regionFrom(latest, elements.region.value); }
  function selectedProfile() { return profilesByHotel.get(Number(elements.hotel.value)) || null; }
  function summarize(snapshot, regionCode, stayDate, mealType) {
    return model.summarize(snapshot, regionCode, stayDate, mealType);
  }
  function syncUrl() {
    const params = new URLSearchParams({region: elements.region.value, hotel_no: elements.hotel.value, stay_date: elements.stayDate.value, meal_type: elements.meal.value});
    window.history.replaceState(null, "", `${location.pathname}?${params}`);
  }
  function populateControls() {
    const params = new URLSearchParams(location.search);
    elements.region.innerHTML = manifest.regions.map((region) => `<option value="${escapeHtml(region.code)}">${escapeHtml(region.name)}</option>`).join("");
    if (params.get("region") && manifest.regions.some((region) => region.code === params.get("region"))) elements.region.value = params.get("region");
    populateHotels(params.get("hotel_no"));
    populateDates(params.get("stay_date"));
    if (params.get("meal_type") && MEAL_LABELS[params.get("meal_type")]) elements.meal.value = params.get("meal_type");
  }
  function populateHotels(preferred) {
    const region = selectedRegion();
    elements.hotel.innerHTML = region.properties.map((property) => `<option value="${property.hotel_no}">${escapeHtml(property.name)}</option>`).join("");
    if (preferred && region.properties.some((property) => String(property.hotel_no) === String(preferred))) elements.hotel.value = String(preferred);
  }
  function populateDates(preferred) {
    const region = selectedRegion();
    const dates = [...new Set(region.rates.map((row) => row.stay_date))].sort();
    elements.stayDate.innerHTML = dates.map((value) => `<option value="${value}">${escapeHtml(formatDate(value))}</option>`).join("");
    if (preferred && dates.includes(preferred)) elements.stayDate.value = preferred;
  }
  function formatDate(value) {
    return model.formatJapaneseDate(value);
  }
  function formatGeneratedAt(value) {
    if (!value || !/(Z|[+-]\d\d:\d\d)$/.test(value) || Number.isNaN(Date.parse(value))) return null;
    return new Intl.DateTimeFormat("ja-JP", {timeZone:"Asia/Tokyo", year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
  }
  function renderKpis(summary, comparison) {
    const selected = summary.positions.find((row) => row.hotel_no === Number(elements.hotel.value));
    const rank = model.priceRank(summary, elements.hotel.value);
    const comparisonNote = summary.comparisonReady ? "対象施設との差を表示" : "3施設未満のため比較しません";
    const confirmationValue = summary.observations === 0 ? "観測なし" : `${summary.successful}/${summary.target}`;
    const medianNote = summary.observations === 0 ? "指定条件の観測なし" : summary.comparisonReady ? `料金確認 ${summary.successful}/${summary.target}施設` : `料金確認 ${summary.successful}/${summary.target}施設（参考表示）`;
    const cards = [
      ["対象施設の中央値", yen(summary.marketMedian), medianNote],
      ["選択施設の料金", yen(selected?.min_price_yen), comparison?.previousSelected?.min_price_yen != null ? `7日前 ${yen(comparison.previousSelected.min_price_yen)}` : "7日前の料金は比較データなし"],
      ["対象中央値との差", summary.comparisonReady && selected?.price_index != null ? pct(selected.price_index - 100) : "比較不足", comparisonNote],
      ["中央値の7日前比", comparison?.marketChange != null ? pct(comparison.marketChange) : "比較データなし", comparison?.marketChange != null ? `7日前 ${yen(comparison.prior.marketMedian)}` : "正確な7日前・同条件のデータが必要"],
      ...(rank ? [["価格順位", `高い方から${rank.rank}番目`, `料金確認${rank.total}施設中${rank.equal > 1 ? "・同額あり" : ""}`]] : []),
      ["料金確認", confirmationValue, summary.observations === 0 ? "指定条件の観測なし" : summary.successful === 0 ? "観測あり・成功0件" : "未確認を満室とは判定しません"]
    ];
    document.querySelector("#hpt-kpis").innerHTML = cards.map(([label, value, note]) => `<article class="hpt-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  }
  function ratingComparison(profile) {
    if (!profile?.latest) return {label:"比較データなし", medians:{}};
    const regionProfiles=profileData.properties.filter((row)=>row.region_code===elements.region.value&&row.latest);
    const peers=regionProfiles.length>=3?regionProfiles:profileData.properties.filter((row)=>row.latest);
    const medians={};
    Object.keys(RATING_LABELS).forEach((key)=>{medians[key]=ratingMedian(peers.map((row)=>row.latest?.ratings?.[key]).filter((value)=>value!=null))});
    return {label:regionProfiles.length>=3?`${selectedRegion().name}${regionProfiles.length}施設中央値`:`対象${peers.length}施設中央値`,medians};
  }
  function renderProfile(summary) {
    const profile=selectedProfile(),selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value));
    const container=document.querySelector("#hpt-profile");
    if (!profile) {container.innerHTML='<p class="hpt-empty">この施設の基本情報はまだ取得されていません。料金データは引き続き確認できます。</p>';return;}
    const latestProfile=profile.latest;
    const rating=latestProfile?.review_average==null?"—":Number(latestProfile.review_average).toFixed(2);
    const source=profile.source_url?`<a href="${escapeHtml(profile.source_url)}" target="_blank" rel="noopener noreferrer">楽天トラベルで確認 ↗</a>`:"";
    container.innerHTML=`<div class="hpt-profile__identity"><p class="eyebrow">PROPERTY PROFILE</p><h2>${escapeHtml(profile.name)}</h2><p>${escapeHtml([profile.prefecture,profile.address].filter(Boolean).join(" "))}</p><small>楽天エリア：${escapeHtml(profile.rakuten_area_name||"—")}</small>${source}</div><div class="hpt-profile__metrics"><article><span>大人2名1室の比較料金</span><strong>${escapeHtml(yen(selected?.min_price_yen))}</strong><small>${escapeHtml(formatDate(elements.stayDate.value))}・${escapeHtml(MEAL_LABELS[elements.meal.value])}</small></article><article><span>楽天参考最安料金</span><strong>${escapeHtml(yen(latestProfile?.reference_min_charge_yen))}</strong><small>条件統一料金ではありません</small></article><article><span>楽天総合評価</span><strong>${escapeHtml(rating)}</strong><small>${latestProfile?`取得月 ${escapeHtml(latestProfile.snapshot_month)}`:"月次データ蓄積中"}</small></article></div>`;
  }
  function renderRatings() {
    const profile=selectedProfile(),container=document.querySelector("#hpt-ratings"),table=document.querySelector("#hpt-ratings-table");
    if (!profile?.latest) {container.innerHTML='<p class="hpt-empty">評価データを蓄積しています。</p>';table.innerHTML="";return;}
    const comparison=ratingComparison(profile),rows=Object.entries(RATING_LABELS).map(([key,label])=>({key,label,value:profile.latest.ratings?.[key]??null,median:comparison.medians[key]??null}));
    container.setAttribute("aria-label",`${profile.name}の楽天評価。比較対象は${comparison.label}`);
    container.innerHTML=`<p class="hpt-rating-scope">0〜5点 ／ 金色の印：${escapeHtml(comparison.label)}</p>${rows.map((row)=>{const width=row.value==null?0:Math.max(0,Math.min(100,Number(row.value)*20)),marker=row.median==null?null:Math.max(0,Math.min(100,Number(row.median)*20));return `<div class="hpt-rating-row"><span>${escapeHtml(row.label)}</span><div class="hpt-rating-track"><i style="width:${width}%"></i>${marker==null?"":`<b style="left:${marker}%" title="中央値 ${Number(row.median).toFixed(2)}"></b>`}</div><strong>${row.value==null?"—":Number(row.value).toFixed(2)}</strong></div>`}).join("")}`;
    table.innerHTML=`<details><summary>評価を表で確認</summary><table><thead><tr><th>項目</th><th>選択施設</th><th>${escapeHtml(comparison.label)}</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.label)}</td><td>${row.value==null?"—":Number(row.value).toFixed(2)}</td><td>${row.median==null?"—":Number(row.median).toFixed(2)}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function renderRatingHistory() {
    const profile=selectedProfile(),rows=(profile?.history||[]).filter((row)=>row.review_average!=null),chart=document.querySelector("#hpt-rating-history"),table=document.querySelector("#hpt-rating-history-table");
    if (rows.length<2) {chart.innerHTML='<p class="hpt-empty">評価推移は月次データを蓄積中です。2か月分から表示します。</p>';table.innerHTML="";return;}
    const width=860,height=250,left=54,right=22,top=18,bottom=42,x=(index)=>left+(width-left-right)*(index/(rows.length-1)),y=(value)=>top+(height-top-bottom)*(1-Number(value)/5),points=rows.map((row,index)=>`${x(index)},${y(row.review_average)}`).join(" ");
    const grid=[0,1,2,3,4,5].map((value)=>`<line class="hpt-grid-line" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text class="hpt-axis-label" x="${left-9}" y="${y(value)+4}" text-anchor="end">${value}</text>`).join("");
    const dots=rows.map((row,index)=>`<circle class="hpt-selected-dot" cx="${x(index)}" cy="${y(row.review_average)}" r="4"><title>${escapeHtml(row.snapshot_month)} ${Number(row.review_average).toFixed(2)}</title></circle><text class="hpt-axis-label" x="${x(index)}" y="${height-14}" text-anchor="middle">${escapeHtml(row.snapshot_month.slice(0,7))}</text>`).join("");
    chart.innerHTML=`<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}<polyline class="hpt-selected-line" points="${points}"/>${dots}</svg>`;
    chart.setAttribute("aria-label",`${profile.name}の総合評価月次推移。${rows[0].snapshot_month} ${Number(rows[0].review_average).toFixed(2)}から${rows.at(-1).snapshot_month} ${Number(rows.at(-1).review_average).toFixed(2)}`);
    table.innerHTML=`<details><summary>評価推移を表で確認</summary><table><thead><tr><th>取得月</th><th>総合評価</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.snapshot_month)}</td><td>${Number(row.review_average).toFixed(2)}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function renderReview() {
    const profile=selectedProfile(),container=document.querySelector("#hpt-review"),review=profile?.latest?.latest_review_excerpt;
    if (!profile?.latest) {container.innerHTML='<p class="hpt-empty">口コミデータを蓄積しています。</p>';return;}
    const source=profile.source_url?`<a href="${escapeHtml(profile.source_url)}" target="_blank" rel="noopener noreferrer">楽天トラベルで全文を確認 ↗</a>`:"";
    container.innerHTML=review?`<blockquote>${escapeHtml(review)}</blockquote><p>取得月：${escapeHtml(profile.latest.snapshot_month)} ／ 楽天トラベル利用者による最新口コミの抜粋</p>${source}`:`<p class="hpt-empty">取得できる最新口コミはありません。</p>${source}`;
  }
  function renderInsights(summary, comparison) {
    const lines = model.insightLines(summary, comparison, elements.hotel.value);
    const titleFor = (line) => line.includes("7日前比") ? "対象中央値の変化" : line.includes("選択施設") ? "選択施設の位置" : "料金確認の範囲";
    document.querySelector("#hpt-insights").innerHTML = lines.map((line) => `<article class="hpt-insight"><h3>${escapeHtml(titleFor(line))}</h3><p>${escapeHtml(line)}</p></article>`).join("");
  }
  function buildTrend() {
    return snapshotHistory.map((snapshot) => {
      const summary = summarize(snapshot, elements.region.value, elements.stayDate.value, elements.meal.value);
      const selected = summary.positions.find((row) => row.hotel_no === Number(elements.hotel.value));
      return {snapshot_date:snapshot.snapshot_date, lead_days:dayDiff(elements.stayDate.value, snapshot.snapshot_date), selected_price:selected?.min_price_yen ?? null, median:summary.marketMedian, p25:summary.p25, p75:summary.p75, plan_count:selected?.plan_count || 0};
    }).filter((row) => row.lead_days >= 0).sort((a,b) => a.snapshot_date.localeCompare(b.snapshot_date));
  }
  function renderTrend(rows) {
    const chart = document.querySelector("#hpt-trend-chart");
    const values = rows.flatMap((row) => [row.selected_price,row.median,row.p25,row.p75]).filter((value) => value != null);
    if (!values.length) { chart.innerHTML = '<p class="hpt-empty">この条件の推移データはまだありません。</p>'; document.querySelector("#hpt-trend-table").innerHTML = ""; return; }
    const width=920,height=340,left=72,right=24,top=22,bottom=52;
    const minValue=Math.floor(Math.min(...values)*.9/1000)*1000,maxValue=Math.ceil(Math.max(...values)*1.1/1000)*1000;
    const x=(index)=>left+(width-left-right)*(rows.length===1?.5:index/(rows.length-1));
    const y=(value)=>top+(height-top-bottom)*(1-(value-minValue)/Math.max(maxValue-minValue,1));
    const points=(key)=>rows.map((row,index)=>row[key]==null?null:`${x(index)},${y(row[key])}`).filter(Boolean).join(" ");
    const upper=rows.map((row,index)=>row.p75==null?null:`${x(index)},${y(row.p75)}`).filter(Boolean),lower=rows.map((row,index)=>row.p25==null?null:`${x(index)},${y(row.p25)}`).filter(Boolean).reverse();
    const grid=[0,.25,.5,.75,1].map((ratio)=>{const value=Math.round(maxValue-(maxValue-minValue)*ratio),yy=top+(height-top-bottom)*ratio;return `<line class="hpt-grid-line" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text class="hpt-axis-label" x="${left-9}" y="${yy+4}" text-anchor="end">${escapeHtml(yen(value))}</text>`}).join("");
    const labels=rows.map((row,index)=>index%Math.max(Math.ceil(rows.length/6),1)===0?`<text class="hpt-axis-label" x="${x(index)}" y="${height-18}" text-anchor="middle">${row.lead_days}日前</text>`:"").join("");
    const dots=rows.map((row,index)=>row.selected_price==null?"":`<circle class="hpt-selected-dot" cx="${x(index)}" cy="${y(row.selected_price)}" r="4"><title>${escapeHtml(row.snapshot_date)} ${escapeHtml(yen(row.selected_price))}</title></circle>`).join("");
    chart.innerHTML=`<div class="hpt-chart-legend"><span><i class="selected"></i>選択施設</span><span><i class="market"></i>地域中央値</span><span>帯：市場25〜75%</span></div><svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${upper.length&&lower.length?`<polygon class="hpt-market-band" points="${upper.concat(lower).join(" ")}"/>`:""}<polyline class="hpt-market-line" points="${points("median")}"/><polyline class="hpt-selected-line" points="${points("selected_price")}"/>${dots}${labels}</svg>`;
    document.querySelector("#hpt-trend-table").innerHTML=`<details><summary>推移を表で確認</summary><table><thead><tr><th>取得日</th><th>残日数</th><th>選択施設</th><th>地域中央値</th><th>プラン数</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.snapshot_date)}</td><td>${row.lead_days}日</td><td>${escapeHtml(yen(row.selected_price))}</td><td>${escapeHtml(yen(row.median))}</td><td>${row.plan_count}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function renderCalendar() {
    const region=selectedRegion();
    const dates=[...new Set(region.rates.map((row)=>row.stay_date))].sort();
    document.querySelector("#hpt-calendar").innerHTML=dates.map((stayDate)=>{const summary=summarize(latest,elements.region.value,stayDate,elements.meal.value),selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value)),difference=summary.comparisonReady&&selected?.price_index!=null?selected.price_index-100:null,level=difference==null?"none":difference<=-10?"low":difference>=10?"high":"mid";return `<article class="hpt-calendar-cell hpt-calendar-cell--${level}" title="${escapeHtml(stayDate)}"><time datetime="${escapeHtml(stayDate)}">${escapeHtml(formatDate(stayDate))}</time><strong>選択 ${escapeHtml(yen(selected?.min_price_yen))}</strong><span>中央値 ${escapeHtml(yen(summary.marketMedian))}</span><span>${difference==null?"比較不足":`差 ${escapeHtml(pct(difference))}`}</span></article>`}).join("");
  }
  function renderPositions(summary) {
    const available=summary.positions.filter((row)=>row.min_price_yen!=null),max=Math.max(...available.map((row)=>row.min_price_yen),1);
    document.querySelector("#hpt-positions").innerHTML=summary.positions.map((row)=>{const selected=row.hotel_no===Number(elements.hotel.value),width=row.min_price_yen==null?0:Math.max(row.min_price_yen/max*100,2);return `<div class="hpt-position ${selected?"hpt-position--selected":""}"><div class="hpt-position__name">${escapeHtml(row.name)}${selected?"（選択施設）":""}</div><div class="hpt-position__track"><div class="hpt-position__bar" style="width:${width}%"></div></div><div class="hpt-position__value">${escapeHtml(yen(row.min_price_yen))}<small>${summary.comparisonReady&&row.price_index!=null?`中央値との差 ${pct(row.price_index-100)}`:"比較不足"}</small></div></div>`}).join("");
  }
  function render() {
    syncUrl();
    const summary=summarize(latest,elements.region.value,elements.stayDate.value,elements.meal.value);
    const selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value));
    const comparison=model.sevenDayComparison(latest,snapshotHistory,{regionCode:elements.region.value,hotelNo:elements.hotel.value,stayDate:elements.stayDate.value,mealType:elements.meal.value});
    renderProfile(summary);renderKpis(summary,comparison);renderInsights(summary,comparison);renderTrend(buildTrend());renderCalendar();renderRatings();renderRatingHistory();renderReview();renderPositions(summary);
    document.querySelector("#hpt-scope-title").textContent=`${selectedRegion().name}・${selectedRegion().properties.length}施設`;
    document.querySelector("#hpt-selection-meta").textContent=`地域：${selectedRegion().name} ／ 選択施設：${selected?.name || "—"} ／ 宿泊日：${formatDate(elements.stayDate.value)} ／ 条件：大人2名・1室・1泊・${MEAL_LABELS[elements.meal.value]} ／ 取得日：${latest.snapshot_date}`;
    const trendComparison=document.querySelector("#hpt-trend-comparison");
    const comparisonParts=[];
    if (comparison.selectedChange != null) comparisonParts.push(`選択施設：7日前 ${yen(comparison.previousSelected.min_price_yen)} → 現在 ${yen(selected?.min_price_yen)}（${pct(comparison.selectedChange)}）`);
    if (comparison.marketChange != null) comparisonParts.push(`対象中央値：7日前 ${yen(comparison.prior.marketMedian)} → 現在 ${yen(summary.marketMedian)}（${pct(comparison.marketChange)}）`);
    trendComparison.hidden=!comparisonParts.length;
    trendComparison.textContent=comparisonParts.join(" ／ ");
    const generatedAt=formatGeneratedAt(latest.generated_at);
    elements.freshness.textContent=`取得日：${latest.snapshot_date} ／ 条件：大人2名・1室・1泊・${MEAL_LABELS[elements.meal.value]}${generatedAt?` ／ データ生成日時（日本時間）：${generatedAt}`:""}`;
  }
  async function init() {
    elements.loading.hidden=false;elements.error.hidden=true;elements.dashboard.hidden=true;
    try {
      [manifest,profileData]=await Promise.all([getJson(`${DATA_ROOT}manifest.json`),getJson(`${DATA_ROOT}profiles.json`).catch(()=>({properties:[]}))]);
      profilesByHotel=new Map((profileData.properties||[]).map((profile)=>[Number(profile.hotel_no),profile]));
      latest=await getJson(`${DATA_ROOT}${manifest.snapshots[0].file}`);
      const historyItems=manifest.snapshots.slice(0,30).filter((item)=>item.date!==latest.snapshot_date&&item.file!==manifest.snapshots[0].file);
      const olderSnapshots=(await Promise.all(historyItems.map((item)=>getJson(`${DATA_ROOT}${item.file}`).catch(()=>null)))).filter(Boolean);
      snapshotHistory=[latest,...olderSnapshots].sort((left,right)=>left.snapshot_date.localeCompare(right.snapshot_date));
      populateControls();render();elements.loading.hidden=true;elements.dashboard.hidden=false;
      if (window.gtag) window.gtag("event","analysis_result_view",{tool_id:"hotel-price-trends",dataset_version:latest.snapshot_date});
    } catch (error) {elements.loading.hidden=true;elements.error.hidden=false;elements.errorMessage.textContent=error.message || "時間をおいて再度お試しください。";elements.freshness.textContent="データ取得エラー";}
  }
  elements.region.addEventListener("change",()=>{populateHotels();populateDates();render()});
  [elements.hotel,elements.stayDate,elements.meal].forEach((control)=>control.addEventListener("change",render));
  elements.retry.addEventListener("click",init);
  init();
})();
