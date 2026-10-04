(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HotelPriceTrendsModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  const isFinitePositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  const asDateParts = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.split("-").map(Number) : null;
  const addDays = (value, days) => {
    const parts = asDateParts(value);
    if (!parts) return null;
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return date.toISOString().slice(0, 10);
  };
  const formatJapaneseDate = (value) => {
    const parts = asDateParts(value);
    if (!parts) return value || "";
    const weekday = ["日", "月", "火", "水", "木", "金", "土"][new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
    return `${parts[1]}/${parts[2]}（${weekday}）`;
  };
  const rawQuantile = (values, q) => {
    const sorted = values.filter(isFinitePositive).map(Number).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base] + (sorted[base + 1] == null ? 0 : rest * (sorted[base + 1] - sorted[base]));
  };
  const quantile = (values, q) => {
    const value = rawQuantile(values, q);
    return value == null ? null : Math.round(value);
  };
  const median = (values) => quantile(values, 0.5);
  const regionFrom = (snapshot, code) => snapshot?.regions?.find((region) => region.code === code) || null;
  const cohortMetadata = (region) => {
    const version = typeof region?.cohort_version === "string" && region.cohort_version.trim() ? region.cohort_version.trim() : null;
    const expectedCount = Number(region?.expected_core_count);
    const sourceProperties = Array.isArray(region?.properties) ? region.properties : [];
    const hasRoles = sourceProperties.some((property) => property.role != null);
    const declared = Boolean(version || region?.expected_core_count != null || hasRoles);
    const properties = declared && hasRoles
      ? sourceProperties.filter((property) => String(property.role || "").toLowerCase() === "core")
      : sourceProperties;
    const propertyIds = properties.map((property) => String(property.hotel_no));
    const valid = !declared || Boolean(version && expectedCount === 5 && properties.length === 5 && new Set(propertyIds).size === 5);
    return {active: declared, expectedCount: declared ? 5 : properties.length, properties, propertyIds, valid, version};
  };
  const qualityForCount = (successful) => successful >= 5 ? "sufficient" : successful === 4 ? "comparable" : successful === 3 ? "reference" : "insufficient";
  const conditionsMatch = (current, candidate) => ["adults", "rooms", "nights"].every((key) =>
    current?.conditions?.[key] != null && candidate?.conditions?.[key] != null &&
    Number(current.conditions[key]) === Number(candidate.conditions[key])
  );
  const idsFor = (positions) => new Set((positions || []).map((property) => String(property.hotel_no)));
  const sameIds = (left, right) => left.size === right.size && [...left].every((id) => right.has(id));

  function summarize(snapshot, regionCode, stayDate, mealType) {
    const region = regionFrom(snapshot, regionCode);
    const cohort = cohortMetadata(region);
    const propertyIds = new Set(cohort.propertyIds);
    const observations = (region?.rates || []).filter((row) => propertyIds.has(String(row.hotel_no)) && row.stay_date === stayDate && row.meal_type === mealType);
    const rowsByHotel = new Map();
    observations.forEach((row) => {
      const id = String(row.hotel_no);
      if (!rowsByHotel.has(id)) rowsByHotel.set(id, row);
    });
    const positions = cohort.properties.map((property) => {
      const row = rowsByHotel.get(String(property.hotel_no));
      const valid = row?.status === "success" && isFinitePositive(row?.min_price_yen);
      return {
        hotel_no: Number(property.hotel_no), name: property.name,
        min_price_yen: valid ? Number(row.min_price_yen) : null,
        plan_count: valid ? Number(row.plan_count || 0) : 0,
        status: row?.status || "no_data"
      };
    });
    const prices = positions.map((position) => position.min_price_yen).filter(isFinitePositive);
    const successful = prices.length;
    const dataQuality = cohort.active ? qualityForCount(successful) : successful >= 3 ? "legacy_comparable" : "legacy_reference";
    const comparisonReady = cohort.active ? cohort.valid && dataQuality !== "insufficient" : successful >= 3;
    const marketMedian = cohort.active && !comparisonReady ? null : median(prices);
    positions.forEach((position) => {
      position.price_index = marketMedian != null && position.min_price_yen != null ? position.min_price_yen / marketMedian * 100 : null;
    });
    return {
      region, observations: observations.length, successful, target: cohort.expectedCount,
      marketMedian, p25: cohort.active && !comparisonReady ? null : quantile(prices, .25), p75: cohort.active && !comparisonReady ? null : quantile(prices, .75),
      planCount: positions.reduce((sum, row) => sum + row.plan_count, 0), positions,
      comparisonReady, dataQuality, cohortActive: cohort.active, cohortValid: cohort.valid,
      cohortVersion: cohort.version, propertyIds: cohort.propertyIds
    };
  }

  function priceRank(summary, hotelNo) {
    if (!summary?.comparisonReady) return null;
    const selected = summary.positions.find((row) => Number(row.hotel_no) === Number(hotelNo));
    if (!selected?.min_price_yen) return null;
    const available = summary.positions.filter((row) => row.min_price_yen != null);
    const above = available.filter((row) => row.min_price_yen > selected.min_price_yen).length;
    const equal = available.filter((row) => row.min_price_yen === selected.min_price_yen).length;
    return {rank: above + 1, total: available.length, equal};
  }

  function sevenDayComparison(currentSnapshot, history, selection) {
    const targetDate = addDays(currentSnapshot?.snapshot_date, -7);
    const previous = (history || []).find((snapshot) => snapshot?.snapshot_date === targetDate);
    if (!previous) return {status: "missing_snapshot", previous: null};
    if (!conditionsMatch(currentSnapshot, previous)) return {status: "conditions_mismatch", previous};
    const previousRegion = regionFrom(previous, selection.regionCode);
    if (!previousRegion) return {status: "missing_region", previous};
    const current = summarize(currentSnapshot, selection.regionCode, selection.stayDate, selection.mealType);
    const prior = summarize(previous, selection.regionCode, selection.stayDate, selection.mealType);
    const currentSelected = current.positions.find((row) => Number(row.hotel_no) === Number(selection.hotelNo));
    const previousSelected = prior.positions.find((row) => Number(row.hotel_no) === Number(selection.hotelNo));
    const cohortVersionsMatch = current.cohortVersion === prior.cohortVersion;
    const selectedChange = cohortVersionsMatch && currentSelected?.min_price_yen != null && previousSelected?.min_price_yen != null
      ? (currentSelected.min_price_yen / previousSelected.min_price_yen - 1) * 100 : null;
    const propertySetsMatch = sameIds(idsFor(current.positions), idsFor(prior.positions));
    const marketComparable = cohortVersionsMatch && propertySetsMatch && current.cohortValid && prior.cohortValid;
    const marketChange = marketComparable && current.comparisonReady && prior.comparisonReady && current.marketMedian != null && prior.marketMedian != null
      ? (current.marketMedian / prior.marketMedian - 1) * 100 : null;
    const status = !cohortVersionsMatch ? "cohort_version_mismatch" : propertySetsMatch ? "available" : "property_set_mismatch";
    return {status, previous, current, prior, currentSelected, previousSelected, selectedChange, marketChange};
  }

  const signedPercent = (value) => {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.round(value * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
  };
  const positionLabel = (index) => index >= 110 ? "中央値より高い" : index <= 90 ? "中央値より低い" : "中央値付近";
  const changeLabel = (value) => {
    const normalized = Math.round(value * 1e10) / 1e10;
    return normalized >= 10 ? "上昇" : normalized >= 3 ? "やや上昇" : normalized <= -10 ? "低下" : normalized <= -3 ? "やや低下" : "大きな変化なし";
  };
  function insightLines(summary, comparison, hotelNo) {
    const selected = summary.positions.find((row) => Number(row.hotel_no) === Number(hotelNo));
    const lines = [];
    const hasComparableObservations = comparison?.status === "available" && comparison.prior?.observations > 0 && summary.observations > 0;
    if (comparison?.marketChange != null) {
      const direction = changeLabel(comparison.marketChange);
      lines.push(`比較施設群中央値は7日前比 ${signedPercent(comparison.marketChange)}（${direction}）です。`);
    }
    if (summary.cohortActive && !summary.cohortValid) {
      lines.push("比較施設群の構成を確認できないため、中央値・順位を表示しません。");
    } else if (!summary.comparisonReady) {
      const legacyLine = summary.observations === 0 ? "指定条件の観測行はありません。料金確認数は表示しません。" : hasComparableObservations ? `料金確認は7日前${comparison.prior.successful}/${comparison.prior.target}施設、現在${summary.successful}/${summary.target}施設です。3施設未満のため地域比較は参考表示です。` : summary.successful === 0 ? `指定条件の観測はありますが、料金確認は0/${summary.target}施設です。` : `料金確認は${summary.successful}/${summary.target}施設です。3施設未満のため地域比較は参考表示です。`;
      const cohortLine = summary.observations === 0 ? `指定条件の観測行はありません。料金確認は0/${summary.target}施設で、比較施設群中央値・順位は表示しません。` : hasComparableObservations ? `料金確認は7日前${comparison.prior.successful}/${comparison.prior.target}施設、現在${summary.successful}/${summary.target}施設です。2施設以下のため比較施設群中央値・順位は表示しません。` : `料金確認は${summary.successful}/${summary.target}施設です。2施設以下のため比較施設群中央値・順位は表示しません。`;
      lines.push(summary.cohortActive ? cohortLine : legacyLine);
    } else if (selected?.price_index != null) {
      const difference = selected.price_index - 100;
      const reference = summary.dataQuality === "reference" ? `（${summary.successful}/${summary.target}施設の参考値）` : "";
      lines.push(Math.round(difference * 10) === 0 ? `選択施設は比較施設群中央値と同水準です${reference}。` : `選択施設は比較施設群中央値より${Math.abs(difference).toFixed(1)}%${difference > 0 ? "高く" : "低く"}、${positionLabel(selected.price_index)}です${reference}。`);
    } else {
      lines.push("選択施設の料金は今回確認できませんでした（料金未確認は満室を意味しません）。");
    }
    if (summary.comparisonReady) {
      const quality = summary.dataQuality === "sufficient" ? "十分" : summary.dataQuality === "comparable" ? "比較可能" : summary.dataQuality === "reference" ? "参考値" : null;
      const suffix = quality ? `（${quality}）` : "";
      lines.push(hasComparableObservations ? `料金確認は7日前${comparison.prior.successful}/${comparison.prior.target}施設、現在${summary.successful}/${summary.target}施設です${suffix}。` : `料金確認は${summary.successful}/${summary.target}施設です${suffix}。`);
    }
    return lines.slice(0, 3);
  }

  return {addDays, changeLabel, cohortMetadata, conditionsMatch, formatJapaneseDate, insightLines, isFinitePositive, median, priceRank, qualityForCount, rawQuantile, regionFrom, sevenDayComparison, signedPercent, summarize};
});
