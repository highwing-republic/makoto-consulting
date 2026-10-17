(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KpiCalculatorModel = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  'use strict';

  // 宿KPI電卓: 1か月分の実績から主要な数字を計算する純粋関数。
  // 入力値は数値（未入力は null）。画面側で全角数字・カンマを取り除いてから渡す。

  const required = ["rooms", "days", "soldRooms", "roomRevenue"];
  const optional = ["guests", "capacity", "totalRevenue", "closedRoomNights", "fixedCost", "variableCostPerRoom", "lySoldRooms", "lyRoomRevenue", "lyDays"];

  // 「例を入れて試す」で入る架空の30室の宿（DXかんたん診断の初期値と同じ規模）
  const sample = {
    month: "2026-07", prefCode: "20", facilityType: "ryokan", mealsIncluded: false,
    rooms: 30, days: 31, soldRooms: 605, roomRevenue: 10890000,
    guests: 1210, capacity: 90, totalRevenue: 13600000, closedRoomNights: null,
    fixedCost: 7000000, variableCostPerRoom: 2500,
    // 前年同月（2025年7月）の実績。客室数は今と同じとみなす
    lySoldRooms: 570, lyRoomRevenue: 9690000, lyDays: null
  };

  // 宿泊旅行統計 第8表の宿泊施設タイプ（lodging-monthly.json の occupancy_rate_by_type のキー）
  const facilityTypes = {
    ryokan: "旅館", resort_hotel: "リゾートホテル", business_hotel: "ビジネスホテル",
    city_hotel: "シティホテル", simple_lodging: "簡易宿所"
  };

  const OCC_STEP = 5;
  const ADR_STEP = 1000;

  function round1(value) { return Math.round(value * 10) / 10; }
  function present(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }

  // 全角数字・カンマ・空白・円/%を取り除いて数値にする。数字でなければ NaN、空なら null。
  function parseNumber(text) {
    if (text === null || text === undefined) return null;
    const normalized = String(text)
      .replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[,，\s円%％室人日]/g, "");
    if (normalized === "") return null;
    return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  }

  function daysInMonth(month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month || "");
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  }

  function lastYearMonth(month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month || "");
    return match ? (Number(match[1]) - 1) + "-" + match[2] : null;
  }

  // 前年の営業日数。空欄なら前年のその月の日数（月がなければ今年と同じ）
  function lastYearDays(input) {
    if (present(input.lyDays)) return input.lyDays;
    return daysInMonth(lastYearMonth(input.month)) || input.days;
  }

  function availableRooms(input) {
    return input.rooms * input.days - (present(input.closedRoomNights) ? input.closedRoomNights : 0);
  }

  function validate(input) {
    const errors = {};
    const isWhole = function (value) { return Number.isInteger(value); };
    if (!present(input.rooms) || !isWhole(input.rooms) || input.rooms < 1 || input.rooms > 3000) errors.rooms = "客室数は1〜3,000室の整数で入力してください。";
    const maxDays = daysInMonth(input.month) || 31;
    if (!present(input.days) || !isWhole(input.days) || input.days < 1 || input.days > maxDays) errors.days = "営業日数は1〜" + maxDays + "日の整数で入力してください。";
    if (present(input.closedRoomNights) && (!isWhole(input.closedRoomNights) || input.closedRoomNights < 0)) errors.closedRoomNights = "0以上の整数で入力してください。";
    if (!errors.rooms && !errors.days && present(input.closedRoomNights) && input.closedRoomNights >= input.rooms * input.days) errors.closedRoomNights = "客室数×営業日数より少ない数にしてください。";
    if (!present(input.soldRooms) || !isWhole(input.soldRooms) || input.soldRooms < 1) errors.soldRooms = "販売客室数を1以上の整数で入力してください。";
    else if (!errors.rooms && !errors.days && !errors.closedRoomNights && input.soldRooms > availableRooms(input)) errors.soldRooms = "販売客室数が販売できる室数（" + availableRooms(input).toLocaleString("ja-JP") + "室）を超えています。";
    if (!present(input.roomRevenue) || input.roomRevenue <= 0) errors.roomRevenue = "客室売上を入力してください。";
    if (present(input.guests) && (!isWhole(input.guests) || input.guests < 1)) errors.guests = "宿泊人数は1以上の整数で入力してください。";
    else if (present(input.guests) && !errors.soldRooms && input.guests < input.soldRooms) errors.guests = "宿泊人数が販売客室数より少なくなっています。";
    if (present(input.capacity) && (!isWhole(input.capacity) || input.capacity < 1)) errors.capacity = "定員は1以上の整数で入力してください。";
    else if (present(input.capacity) && present(input.guests) && !errors.days && input.guests > input.capacity * input.days) errors.capacity = "宿泊人数が定員×営業日数を超えています。";
    if (present(input.totalRevenue) && !errors.roomRevenue && input.totalRevenue < input.roomRevenue) errors.totalRevenue = "総売上は客室売上以上の額で入力してください。";
    if (present(input.fixedCost) && input.fixedCost < 0) errors.fixedCost = "0以上で入力してください。";
    if (present(input.variableCostPerRoom) && input.variableCostPerRoom < 0) errors.variableCostPerRoom = "0以上で入力してください。";
    // 前年同月は、販売客室数と客室売上の両方があるときだけ比べる
    const lyMaxDays = daysInMonth(lastYearMonth(input.month)) || 31;
    if (present(input.lyDays) && (!isWhole(input.lyDays) || input.lyDays < 1 || input.lyDays > lyMaxDays)) errors.lyDays = "前年の営業日数は1〜" + lyMaxDays + "日の整数で入力してください。";
    if (present(input.lySoldRooms) || present(input.lyRoomRevenue) || present(input.lyDays)) {
      if (!present(input.lySoldRooms) || !isWhole(input.lySoldRooms) || input.lySoldRooms < 1) errors.lySoldRooms = "前年の販売客室数を1以上の整数で入力してください。";
      else if (!errors.rooms && !errors.lyDays && input.lySoldRooms > input.rooms * lastYearDays(input)) errors.lySoldRooms = "客室数×前年の営業日数（" + (input.rooms * lastYearDays(input)).toLocaleString("ja-JP") + "室）を超えています。客室数が前年と違う場合は比べられません。";
      if (!present(input.lyRoomRevenue) || input.lyRoomRevenue <= 0) errors.lyRoomRevenue = "前年の客室売上を入力してください。";
    }
    return errors;
  }

  function calculate(input) {
    const available = availableRooms(input);
    const adr = input.roomRevenue / input.soldRooms;
    const occupancy = input.soldRooms / available;
    const result = {
      availableRooms: available,
      occupancy: round1(occupancy * 100),
      adr: Math.round(adr),
      revpar: Math.round(input.roomRevenue / available),
      guestsPerRoom: present(input.guests) ? Math.round(input.guests / input.soldRooms * 100) / 100 : null,
      revenuePerGuest: present(input.guests) ? Math.round(input.roomRevenue / input.guests) : null,
      bedOccupancy: present(input.guests) && present(input.capacity) ? round1(input.guests / (input.capacity * input.days) * 100) : null,
      trevpar: present(input.totalRevenue) ? Math.round(input.totalRevenue / available) : null,
      breakEven: null
    };

    const variable = present(input.variableCostPerRoom) ? input.variableCostPerRoom : 0;
    if (present(input.fixedCost) && input.fixedCost > 0) {
      const margin = adr - variable;
      if (margin > 0) {
        const rooms = Math.ceil(input.fixedCost / margin);
        result.breakEven = {
          reachable: rooms <= available,
          rooms: rooms,
          occupancy: round1(rooms / available * 100),
          marginPerRoom: Math.round(margin),
          monthlyProfit: Math.round(margin * input.soldRooms - input.fixedCost)
        };
      } else {
        result.breakEven = { reachable: false, rooms: null, occupancy: null, marginPerRoom: Math.round(margin), monthlyProfit: Math.round(margin * input.soldRooms - input.fixedCost) };
      }
    }

    // 打ち手の比較。稼働率は100%を超えない範囲で上げる。
    const extraRooms = Math.max(0, Math.min(available * OCC_STEP / 100, available - input.soldRooms));
    result.levers = {
      occupancy: {
        step: OCC_STEP,
        extraRooms: Math.round(extraRooms),
        revenue: Math.round(extraRooms * adr),
        // 費用を入れていないときは null（売上の増分だけを示す）
        margin: present(input.variableCostPerRoom) ? Math.round(extraRooms * (adr - variable)) : null,
        capped: extraRooms < available * OCC_STEP / 100
      },
      adr: {
        step: ADR_STEP,
        revenue: Math.round(input.soldRooms * ADR_STEP),
        margin: Math.round(input.soldRooms * ADR_STEP)
      }
    };
    return result;
  }

  // 前年同月との比較。客室数は今と同じとみなし、使えなかった客室は前年には引かない。
  // RevPAR の変化は 稼働率の伸び × 単価の伸び に分けられるので、伸び（対数）の大きいほうを主な要因とする。
  function yearOverYear(input) {
    if (!present(input.lySoldRooms) || !present(input.lyRoomRevenue)) return null;
    const available = availableRooms(input);
    const lyAvailable = input.rooms * lastYearDays(input);
    const pct = function (now, last) { return round1((now / last - 1) * 100); };
    const now = { occupancy: input.soldRooms / available, adr: input.roomRevenue / input.soldRooms, revpar: input.roomRevenue / available };
    const last = { occupancy: input.lySoldRooms / lyAvailable, adr: input.lyRoomRevenue / input.lySoldRooms, revpar: input.lyRoomRevenue / lyAvailable };
    const occLog = Math.log(now.occupancy / last.occupancy);
    const adrLog = Math.log(now.adr / last.adr);
    const revparChange = pct(now.revpar, last.revpar);
    let driver = null;
    if (Math.abs(revparChange) >= 0.5) {
      const main = Math.abs(occLog) >= Math.abs(adrLog) ? "occupancy" : "adr";
      driver = { key: main, up: (main === "occupancy" ? occLog : adrLog) > 0, both: occLog * adrLog > 0 };
    }
    return {
      period: lastYearMonth(input.month),
      availableRooms: lyAvailable,
      occupancy: { last: round1(last.occupancy * 100), now: round1(now.occupancy * 100), diff: round1(now.occupancy * 100 - last.occupancy * 100) },
      adr: { last: Math.round(last.adr), now: Math.round(now.adr), change: pct(now.adr, last.adr) },
      revpar: { last: Math.round(last.revpar), now: Math.round(now.revpar), change: revparChange },
      roomRevenue: { last: input.lyRoomRevenue, now: input.roomRevenue, change: pct(input.roomRevenue, input.lyRoomRevenue) },
      soldRooms: { last: input.lySoldRooms, now: input.soldRooms, change: pct(input.soldRooms, input.lySoldRooms) },
      driver: driver
    };
  }

  // 目標の客室売上（月）から、今の単価・今の稼働率のままなら何が必要かを逆算する。
  function reverse(input, targetRevenue) {
    if (!present(targetRevenue) || targetRevenue <= 0) return null;
    const available = availableRooms(input);
    const adr = input.roomRevenue / input.soldRooms;
    const rooms = Math.ceil(targetRevenue / adr);
    return {
      rooms: rooms,
      occupancy: round1(rooms / available * 100),
      reachable: rooms <= available,
      adr: Math.ceil(targetRevenue / input.soldRooms / 100) * 100
    };
  }

  // 宿泊旅行統計（lodging-monthly.json）から、同じ月の都道府県と全国の客室稼働率を取り出す。
  // 選んだ月がまだ公表されていなければ、同じ暦月のうち最新の月を使う（exact: false）。
  // 施設タイプを選んだときは、そのタイプの稼働率（第8表の右側）も取り出す。
  function benchmark(dataset, month, prefCode, facilityType) {
    if (!dataset || !Array.isArray(dataset.periods) || !/^\d{4}-\d{2}$/.test(month || "")) return null;
    let index = dataset.periods.indexOf(month);
    const exact = index !== -1;
    if (!exact) {
      const calendarMonth = month.slice(5);
      for (let i = dataset.periods.length - 1; i >= 0; i -= 1) {
        if (dataset.periods[i].slice(5) === calendarMonth) { index = i; break; }
      }
    }
    if (index === -1) return null;
    const type = facilityTypes[facilityType] ? facilityType : null;
    const pick = function (record) {
      return record && record.occupancy_rate_by_type && record.occupancy_rate_by_type[type] ? record.occupancy_rate_by_type[type][index] : null;
    };
    const national = dataset.national && dataset.national.occupancy_rate ? dataset.national.occupancy_rate[index] : null;
    const prefecture = prefCode && dataset.prefectures && dataset.prefectures[prefCode] ? dataset.prefectures[prefCode] : null;
    const regional = prefecture && prefecture.occupancy_rate ? prefecture.occupancy_rate[index] : null;
    if (!present(national) && !present(regional)) return null;
    const nationalType = type ? pick(dataset.national) : null;
    const prefectureType = type ? pick(prefecture) : null;
    return {
      period: dataset.periods[index],
      exact: exact,
      basis: dataset.basis ? dataset.basis[index] : null,
      prefectureName: prefecture ? prefecture.prefecture_name : null,
      prefecture: present(regional) ? regional : null,
      national: present(national) ? national : null,
      facilityType: type,
      facilityLabel: type ? facilityTypes[type] : null,
      prefectureType: present(prefectureType) ? prefectureType : null,
      nationalType: present(nationalType) ? nationalType : null
    };
  }

  // 比べる相手は、県のそのタイプ → 全国のそのタイプ → 県の全体 → 全国の全体 の順で、値がある最初のもの。
  function compare(occupancy, bench) {
    if (!bench) return null;
    const candidates = [
      [bench.prefectureType, bench.prefectureName + "の" + bench.facilityLabel, true],
      [bench.nationalType, "全国の" + bench.facilityLabel, true],
      [bench.prefecture, bench.prefectureName, false],
      [bench.national, "全国", false]
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const reference = candidates[i][0];
      if (reference === null || reference === undefined) continue;
      return { reference: reference, label: candidates[i][1], byType: candidates[i][2], gap: round1(occupancy - reference) };
    }
    return null;
  }

  return {
    required: required, optional: optional, sample: sample, facilityTypes: facilityTypes,
    parseNumber: parseNumber, daysInMonth: daysInMonth, availableRooms: availableRooms,
    lastYearMonth: lastYearMonth, validate: validate, calculate: calculate, yearOverYear: yearOverYear, reverse: reverse, benchmark: benchmark, compare: compare
  };
});
