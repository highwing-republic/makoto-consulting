/* ホテル翠蓮デモの共有データ（簡易PMSデモ /demo/mini-pms/ と予約エンジンデモ /demo/booking/ で共用）。
   ブラウザの localStorage に1つの状態として保存し、両ページで同じ予約・ブロックを読み書きする。

   サンプルの予約とブロックは「開いた日」を基準に作る。日付が変わってから開くと、サンプルだけを
   その日の基準で作り直し、利用者が登録した予約・ブロックはそのまま残す（サンプルが過去に流れて
   空っぽになるのを防ぐ）。サンプルは予約 id 1〜8・ブロック id 1、利用者の分は 9・2 以降。 */
(function(){
  "use strict";
  const KEY = "mini-pms-v3";
  const SAMPLE_MAX_RES_ID = 8, SAMPLE_MAX_BLOCK_ID = 1;

  const pad = n => String(n).padStart(2,"0");
  const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
  const addDays = (s,n) => { const d = new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return iso(d); };
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return iso(d); };

  /* 部屋マスタ（架空ホテル：2〜5階、各階5室） */
  const ROOMS = [];
  const addRooms = (floor, nos, type, cap) => nos.forEach(no => ROOMS.push({no, floor, type, cap}));
  ["5","4","3","2"].forEach(f => {
    addRooms(f+"階", [f+"01",f+"02"], "ツイン", 2);
    addRooms(f+"階", [f+"03",f+"04"], "シングル", 1);
    addRooms(f+"階", [f+"05"], "和室", 4);
  });

  function seed(){
    const T0 = today();
    return { seedDate: T0, nextId: 9, nextBlockId: 2,
      reservations: [
        { id:1, name:"田中物産 佐藤様", pax:1, inDate:addDays(T0,-3), outDate:addDays(T0,25), typePref:"シングル", memo:"長期法人。請求書は月末まとめ（サンプル）", room:"303", status:"in" },
        { id:2, name:"高橋様", pax:2, inDate:addDays(T0,-1), outDate:addDays(T0,1), typePref:"ツイン", memo:"レンタカー21時返却予定（サンプル）", room:"501", status:"in" },
        { id:3, name:"Smith様", pax:1, inDate:T0, outDate:addDays(T0,1), typePref:"シングル", memo:"英語対応（サンプル）", room:"204", status:"booked" },
        { id:4, name:"山田様", pax:2, inDate:T0, outDate:addDays(T0,2), typePref:"ツイン", memo:"記念日。眺望良い部屋希望（サンプル）", room:null, status:"booked" },
        { id:5, name:"鈴木様ご家族", pax:4, inDate:addDays(T0,1), outDate:addDays(T0,3), typePref:"和室", memo:"お子様2名添い寝（サンプル）", room:null, status:"booked" },
        { id:6, name:"南海電装 中村様", pax:1, inDate:addDays(T0,2), outDate:addDays(T0,12), typePref:"", memo:"工事関係・長期（サンプル）", room:null, status:"booked" },
        { id:7, name:"伊藤様", pax:1, inDate:addDays(T0,3), outDate:addDays(T0,4), typePref:"", memo:"（サンプル）", room:null, status:"booked" },
        { id:8, name:"渡辺様", pax:2, inDate:addDays(T0,1), outDate:addDays(T0,2), typePref:"ツイン", memo:"電話にて取消連絡あり（サンプル）", room:null, status:"cancelled" }
      ],
      blocks: [
        { id:1, room:"405", fromDate:T0, toDate:addDays(T0,5), reason:"空調故障" }
      ]};
  }

  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  function roomBusy(reservations, blocks, roomNo, inD, outD){
    return reservations.some(r => r.status !== "cancelled" && r.room === roomNo && overlaps(inD, outD, r.inDate, r.outDate))
        || blocks.some(b => b.room === roomNo && overlaps(inD, outD, b.fromDate, b.toDate));
  }

  /* 日付が変わった状態：サンプルだけ今日の基準で作り直す */
  function refreshSamples(old){
    const fresh = seed();
    const ownRes = old.reservations.filter(r => !(r.id <= SAMPLE_MAX_RES_ID));
    const ownBlocks = old.blocks.filter(b => !(b.id <= SAMPLE_MAX_BLOCK_ID));
    // 利用者の予約やブロックがある部屋には、サンプルのブロックを置かない
    const blocks = fresh.blocks.filter(b => !roomBusy(ownRes, ownBlocks, b.room, b.fromDate, b.toDate)).concat(ownBlocks);
    // サンプルの割当済み部屋が利用者の予約とぶつかるときは、同じタイプの空き部屋へ移す
    const placed = ownRes.slice();
    fresh.reservations.forEach(r => {
      if(r.room && roomBusy(placed, blocks, r.room, r.inDate, r.outDate)){
        const alt = ROOMS.find(rm => rm.type === r.typePref && rm.cap >= r.pax && !roomBusy(placed, blocks, rm.no, r.inDate, r.outDate));
        r.room = alt ? alt.no : null;
        if(!r.room && r.status === "in") r.status = "booked";
      }
      placed.push(r);
    });
    return { seedDate: fresh.seedDate,
      nextId: Math.max(old.nextId || 0, fresh.nextId), nextBlockId: Math.max(old.nextBlockId || 0, fresh.nextBlockId),
      reservations: fresh.reservations.concat(ownRes), blocks };
  }

  function load(){
    let s = null;
    try{
      const raw = localStorage.getItem(KEY);
      if(raw){ const v = JSON.parse(raw); if(v && Array.isArray(v.reservations) && Array.isArray(v.blocks)) s = v; }
    }catch(e){}
    if(!s) return seed();
    return s.seedDate === today() ? s : refreshSamples(s);
  }

  window.SuirenDemo = { KEY, ROOMS, seed, load };
})();
