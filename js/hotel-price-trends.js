(() => {
  "use strict";

  const DATA_ROOT = "/data/hotel-price-trends/";
  const MEAL_LABELS = {two_meals: "朝夕食付き", breakfast: "朝食付き", room_only: "素泊まり"};
  const RATING_LABELS = {service:"サービス",location:"立地",room:"部屋",equipment:"設備",bath:"風呂",breakfast:"朝食",dinner:"夕食",cleanliness:"清潔さ"};
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
  const yen = (value) => value == null ? "データなし" : `¥${Number(value).toLocaleString("ja-JP")}`;
  const pct = (value) => value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  const median = (values) => quantile(values, .5);
  const ratingMedian = (values) => rawQuantile(values, .5);
  function rawQuantile(values, q) {
    const sorted = values.filter((value) => value != null).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base] + (sorted[base + 1] == null ? 0 : rest * (sorted[base + 1] - sorted[base]));
  }
  function quantile(values, q) {
    const value = rawQuantile(values, q);
    return value == null ? null : Math.round(value);
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
  function ratesFor(snapshot, regionCode, stayDate, mealType) {
    const region = regionFrom(snapshot, regionCode);
    return region ? region.rates.filter((row) => row.stay_date === stayDate && row.meal_type === mealType) : [];
  }
  function summarize(snapshot, regionCode, stayDate, mealType) {
    const region = regionFrom(snapshot, regionCode);
    const rows = ratesFor(snapshot, regionCode, stayDate, mealType);
    const successful = rows.filter((row) => row.status === "success" && row.min_price_yen != null);
    const prices = successful.map((row) => row.min_price_yen);
    const marketMedian = median(prices);
    const names = new Map((region?.properties || []).map((property) => [Number(property.hotel_no), property.name]));
    const byHotel = new Map(rows.map((row) => [Number(row.hotel_no), row]));
    const positions = (region?.properties || []).map((property) => {
      const row = byHotel.get(Number(property.hotel_no));
      const price = row?.min_price_yen ?? null;
      return {
        hotel_no: Number(property.hotel_no), name: names.get(Number(property.hotel_no)),
        min_price_yen: price, plan_count: row?.plan_count || 0, status: row?.status || "no_data",
        price_index: price != null && marketMedian ? price / marketMedian * 100 : null
      };
    });
    return {marketMedian, p25: quantile(prices, .25), p75: quantile(prices, .75), successful: successful.length, target: region?.properties.length || 0, planCount: successful.reduce((sum, row) => sum + Number(row.plan_count || 0), 0), positions};
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
    const parsed = new Date(`${value}T00:00:00+09:00`);
    return new Intl.DateTimeFormat("ja-JP", {month:"numeric", day:"numeric", weekday:"short"}).format(parsed);
  }
  function renderKpis(summary, previousSummary) {
    const selected = summary.positions.find((row) => row.hotel_no === Number(elements.hotel.value));
    const previousSelected = previousSummary?.positions.find((row) => row.hotel_no === Number(elements.hotel.value));
    const marketChange = summary.marketMedian != null && previousSummary?.marketMedian ? (summary.marketMedian / previousSummary.marketMedian - 1) * 100 : null;
    const selectedChange = selected?.min_price_yen != null && previousSelected?.min_price_yen ? (selected.min_price_yen / previousSelected.min_price_yen - 1) * 100 : null;
    const cards = [
      ["地域市場中央値", yen(summary.marketMedian), MEAL_LABELS[elements.meal.value]],
      ["選択施設の代表料金", yen(selected?.min_price_yen), `前回取得比 ${pct(selectedChange)}`],
      ["価格指数", selected?.price_index == null ? "—" : selected.price_index.toFixed(1), "地域中央値＝100"],
      ["取得成功施設", `${summary.successful}/${summary.target}`, "3施設未満は比較注意"],
      ["市場中央値の前回比", pct(marketChange), previousSummary?.marketMedian ? `前回 ${yen(previousSummary.marketMedian)}` : "比較データ蓄積中"]
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
  function makeProfileInsights(summary) {
    const profile=selectedProfile(),latestProfile=profile?.latest,selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value));
    if (!latestProfile||latestProfile.review_average==null||selected?.price_index==null) return [];
    const comparison=ratingComparison(profile),peerRatings=profileData.properties.filter((row)=>row.latest?.review_average!=null&&(comparison.label.startsWith(selectedRegion().name)?row.region_code===elements.region.value:true)),peerMedian=ratingMedian(peerRatings.map((row)=>row.latest.review_average));
    const items=[];
    if (peerMedian!=null&&latestProfile.review_average>=peerMedian&&selected.price_index<90) items.push({title:"評価に対して価格が低い可能性があります",body:"評価は比較中央値以上、料金は地域中央値の90%未満です。値上げ余地を需要・在庫と合わせて確認してください。",confidence:"medium",evidence:`総合評価 ${Number(latestProfile.review_average).toFixed(2)} / ${comparison.label} ${Number(peerMedian).toFixed(2)} / 価格指数 ${selected.price_index.toFixed(1)}`});
    if (peerMedian!=null&&latestProfile.review_average<peerMedian&&selected.price_index>110) items.push({title:"価格差を支える評価か確認が必要です",body:"料金は地域中央値を上回る一方、総合評価は比較中央値を下回ります。販売内容と最新口コミを確認してください。",confidence:"medium",evidence:`総合評価 ${Number(latestProfile.review_average).toFixed(2)} / ${comparison.label} ${Number(peerMedian).toFixed(2)} / 価格指数 ${selected.price_index.toFixed(1)}`});
    const mealKey=elements.meal.value==="two_meals"?"dinner":elements.meal.value==="breakfast"?"breakfast":null;
    if (mealKey&&latestProfile.ratings?.[mealKey]!=null&&comparison.medians[mealKey]!=null&&latestProfile.ratings[mealKey]<comparison.medians[mealKey]) items.push({title:`${RATING_LABELS[mealKey]}評価とプラン価格を確認してください`,body:`${MEAL_LABELS[elements.meal.value]}の価格判断では、${RATING_LABELS[mealKey]}の内容が価格差に見合っているか確認する余地があります。`,confidence:"medium",evidence:`${RATING_LABELS[mealKey]}評価 ${Number(latestProfile.ratings[mealKey]).toFixed(2)} / ${comparison.label} ${Number(comparison.medians[mealKey]).toFixed(2)}`});
    const history=(profile.history||[]).filter((row)=>row.review_average!=null);if(history.length>=2){const delta=Number(history.at(-1).review_average)-Number(history.at(-2).review_average);if(delta<=-.2)items.push({title:"総合評価の変化を確認してください",body:"前月から評価が低下しています。最新口コミと項目別評価を確認し、変化の背景を探ってください。",confidence:"medium",evidence:`総合評価 前月比 ${delta.toFixed(2)}`});}
    return items;
  }
  function makeFallbackInsight(summary) {
    const selected = summary.positions.find((row) => row.hotel_no === Number(elements.hotel.value));
    if (summary.successful < 3) return {title:"比較データを蓄積しています",body:"取得成功施設が3施設未満のため、地域比較は参考表示です。次回以降の取得結果も確認してください。",confidence:"low",evidence:`取得成功 ${summary.successful}/${summary.target}施設`};
    if (!selected || selected.min_price_yen == null) return {title:"選択日に販売プランを確認できません",body:"今回の取得では該当条件のプランが見つかりませんでした。満室とは限らないため、公式販売画面や在庫設定も併せて確認してください。",confidence:"medium",evidence:"取得結果: 販売プランなし"};
    if (selected.price_index < 90) return {title:"地域中央値を下回る価格位置です",body:"選択施設の代表料金は地域中央値の90%未満です。意図した価格差か、需要・在庫・客室条件と合わせて確認する余地があります。",confidence:"medium",evidence:`価格指数 ${selected.price_index.toFixed(1)}`};
    if (selected.price_index > 110) return {title:"地域中央値を上回る価格位置です",body:"選択施設の代表料金は地域中央値の110%を超えています。付加価値が料金差として伝わる販売内容かを確認してください。",confidence:"medium",evidence:`価格指数 ${selected.price_index.toFixed(1)}`};
    return {title:"地域中央値に近い価格位置です",body:"選択施設の代表料金は地域中央値の前後10%以内です。今後の取得で変化幅と販売プラン数の推移を観察してください。",confidence:"medium",evidence:`価格指数 ${selected.price_index.toFixed(1)}`};
  }
  function renderInsights(summary) {
    const region = selectedRegion();
    const exact = region.insights.filter((item) => Number(item.hotel_no) === Number(elements.hotel.value) && item.stay_date === elements.stayDate.value && item.meal_type === elements.meal.value);
    const priceItems = exact.length ? exact.map((item) => ({title:item.title, body:item.body, confidence:item.confidence, evidence:Object.entries(item.evidence || {}).map(([key,value]) => `${key}=${value ?? "—"}`).join(" / ")})) : [makeFallbackInsight(summary)];
    const items=[...makeProfileInsights(summary),...priceItems].slice(0,3);
    document.querySelector("#hpt-insights").innerHTML = items.map((item) => `<article class="hpt-insight"><span class="hpt-insight__meta">信頼度 ${escapeHtml(item.confidence)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><small>根拠：${escapeHtml(item.evidence)}</small></article>`).join("");
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
    document.querySelector("#hpt-calendar").innerHTML=dates.map((stayDate)=>{const summary=summarize(latest,elements.region.value,stayDate,elements.meal.value),selected=summary.positions.find((row)=>row.hotel_no===Number(elements.hotel.value)),index=selected?.price_index;const level=index==null?"none":index<90?"low":index>110?"high":"mid";return `<article class="hpt-calendar-cell hpt-calendar-cell--${level}" title="${escapeHtml(stayDate)}"><time datetime="${escapeHtml(stayDate)}">${escapeHtml(formatDate(stayDate))}</time><strong>${escapeHtml(yen(selected?.min_price_yen))}</strong><span>${index==null?"比較不可":`指数 ${index.toFixed(1)}`}</span></article>`}).join("");
  }
  function renderPositions(summary) {
    const available=summary.positions.filter((row)=>row.min_price_yen!=null),max=Math.max(...available.map((row)=>row.min_price_yen),1);
    document.querySelector("#hpt-positions").innerHTML=summary.positions.map((row)=>{const selected=row.hotel_no===Number(elements.hotel.value),width=row.min_price_yen==null?0:Math.max(row.min_price_yen/max*100,2);return `<div class="hpt-position ${selected?"hpt-position--selected":""}"><div class="hpt-position__name">${escapeHtml(row.name)}</div><div class="hpt-position__track"><div class="hpt-position__bar" style="width:${width}%"></div></div><div class="hpt-position__value">${escapeHtml(yen(row.min_price_yen))}<small>${row.price_index==null?"比較不可":`指数 ${row.price_index.toFixed(1)}`}</small></div></div>`}).join("");
  }
  function render() {
    syncUrl();
    const summary=summarize(latest,elements.region.value,elements.stayDate.value,elements.meal.value);
    const previous=snapshotHistory.length>1?summarize(snapshotHistory[snapshotHistory.length-2],elements.region.value,elements.stayDate.value,elements.meal.value):null;
    renderProfile(summary);renderKpis(summary,previous);renderInsights(summary);renderTrend(buildTrend());renderCalendar();renderRatings();renderRatingHistory();renderReview();renderPositions(summary);
    document.querySelector("#hpt-scope-title").textContent=`${selectedRegion().name}・${selectedRegion().properties.length}施設`;
    elements.freshness.textContent=`最終取得日：${latest.snapshot_date} ／ 条件：大人2名・1室・1泊・${MEAL_LABELS[elements.meal.value]}`;
  }
  async function init() {
    elements.loading.hidden=false;elements.error.hidden=true;elements.dashboard.hidden=true;
    try {
      [manifest,profileData]=await Promise.all([getJson(`${DATA_ROOT}manifest.json`),getJson(`${DATA_ROOT}profiles.json`).catch(()=>({properties:[]}))]);
      profilesByHotel=new Map((profileData.properties||[]).map((profile)=>[Number(profile.hotel_no),profile]));
      latest=await getJson(`${DATA_ROOT}${manifest.snapshots[0].file}`);
      snapshotHistory=(await Promise.all(manifest.snapshots.slice(0,30).reverse().map((item)=>getJson(`${DATA_ROOT}${item.file}`).catch(()=>null)))).filter(Boolean);
      populateControls();render();elements.loading.hidden=true;elements.dashboard.hidden=false;
      if (window.gtag) window.gtag("event","analysis_result_view",{tool_id:"hotel-price-trends",dataset_version:latest.snapshot_date});
    } catch (error) {elements.loading.hidden=true;elements.error.hidden=false;elements.errorMessage.textContent=error.message || "時間をおいて再度お試しください。";elements.freshness.textContent="データ取得エラー";}
  }
  elements.region.addEventListener("change",()=>{populateHotels();populateDates();render()});
  [elements.hotel,elements.stayDate,elements.meal].forEach((control)=>control.addEventListener("change",render));
  elements.retry.addEventListener("click",init);
  init();
})();
