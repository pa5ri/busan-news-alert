// 일회성: 시당 조직명 기준으로 새로 잡히는 기사(인물명 없어 그동안 누락) 소급 업로드
//  - 7/19~ : archive, 7/1~7/18 : 네이버 API HUB 표적 검색
//  - 기존 방에 이미 올라간 것(제목에 박홍배·이성권)은 제외 → 중복 없음
import { readFileSync, readdirSync } from "node:fs";
import { tokensOf } from "./insight.mjs";

const { NAVER_ID, NAVER_SECRET, TG_BOT_TOKEN, TG_TOPIC_GROUP } = process.env;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const RE_NAME = /박홍배|이성권/;
const ROOMS = [
  { topic: "민주당시당",   re: /(?:더불어)?민주당\s?부산\s?시당/,     emoji: "🔵", label: "민주당 부산시당" },
  { topic: "국민의힘시당", re: /(?:국민의힘|국힘)\s?부산\s?시당/,     emoji: "🔴", label: "국민의힘 부산시당" },
];
const A = new Date("2026-07-01T00:00:00+09:00");
const UNTIL = new Date(process.env.UNTIL || "2026-08-13T15:10:00+09:00");
const NAVER_B = new Date("2026-07-19T00:00:00+09:00");

const PRESS = {
  "yna.co.kr":"연합뉴스","yonhapnewstv.co.kr":"연합뉴스TV","newsis.com":"뉴시스","news1.kr":"뉴스1",
  "news.kbs.co.kr":"KBS","imnews.imbc.com":"MBC","news.sbs.co.kr":"SBS","jtbc.co.kr":"JTBC",
  "tvchosun.com":"TV조선","mbn.co.kr":"MBN","ichannela.com":"채널A","ytn.co.kr":"YTN",
  "chosun.com":"조선일보","joongang.co.kr":"중앙일보","donga.com":"동아일보","hani.co.kr":"한겨레",
  "khan.co.kr":"경향신문","kmib.co.kr":"국민일보","munhwa.com":"문화일보","segye.com":"세계일보",
  "seoul.co.kr":"서울신문","hankookilbo.com":"한국일보","hankyung.com":"한국경제","mk.co.kr":"매일경제",
  "fnnews.com":"파이낸셜뉴스","edaily.co.kr":"이데일리","etoday.co.kr":"이투데이","mt.co.kr":"머니투데이",
  "heraldcorp.com":"헤럴드경제","asiae.co.kr":"아시아경제","ajunews.com":"아주경제","etnews.com":"전자신문",
  "busan.com":"부산일보","kookje.co.kr":"국제신문","knn.co.kr":"KNN","busanmbc.co.kr":"부산MBC",
  "nocutnews.co.kr":"노컷뉴스","ohmynews.com":"오마이뉴스","pressian.com":"프레시안","newspim.com":"뉴스핌",
};
const WIRES = ["yna.co.kr","newsis.com","news1.kr","yonhapnewstv.co.kr"];
const LOCALS = ["부산일보","국제신문","KNN","부산MBC"];
const nameOf = url => { const h=String(url).replace(/^https?:\/\//,"").replace(/^www\./,"").split("/")[0];
  const d=Object.keys(PRESS).find(x=>h===x||h.endsWith("."+x)); return d?PRESS[d]:(h||"언론"); };
const isWire = url => { const h=String(url).replace(/^https?:\/\//,"").replace(/^www\./,"").split("/")[0]; return WIRES.some(w=>h===w||h.endsWith("."+w)); };
const strip = s => String(s).replace(/<[^>]+>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&apos;|&#39;/g,"'");
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const keyOf = u => String(u).replace(/^https?:\/\//,"").replace(/#.*$/,"").replace(/\/$/,"");
const normTitle = t => strip(t).replace(/\[(단독|속보|포토|영상|종합|1보|2보|3보|기자수첩|현장|르포)\]/gi,"")
  .replace(/[\[\](){}〈〉<>「」'"'"·…‥,.!?\s-]/g,"").slice(0,30);
const kstDay = d => new Date(d.getTime()+9*3600*1000).toISOString().slice(0,10);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

for (const room of ROOMS) {
  const thread = TOPICS[room.topic];
  if (!thread) { console.log(room.topic, "thread 없음 — 건너뜀"); continue; }
  const items = []; const seenKey = new Set(), seenNorm = new Set();
  const add = (t, url, pub, ctx) => {
    if (!room.re.test(t) || RE_NAME.test(t)) return;          // 이미 올라간 인물명 기사 제외
    if (!(pub instanceof Date) || isNaN(pub) || pub < A || pub >= UNTIL) return;
    const k = keyOf(url); if (seenKey.has(k)) return;
    const n = normTitle(t); if (seenNorm.has(n)) return;
    seenKey.add(k); seenNorm.add(n);
    items.push({ t: strip(t), url, pub, ctx: strip(ctx||"").trim(), name: nameOf(url), wire: isWire(url) });
  };

  for (const f of readdirSync("archive").sort()) {
    if (!/^2026-0[78]-\d\d\.jsonl$/.test(f)) continue;
    for (const l of readFileSync("archive/"+f, "utf8").split("\n")) {
      if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch { continue; }
      add(r.t, r.url, new Date(r.pub), r.ctx);
    }
  }
  const naverH = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };
  const QS = room.topic === "민주당시당"
    ? ["민주당 부산시당","더불어민주당 부산시당","민주당 부산시당위원장","민주당 부산시당 대회"]
    : ["국민의힘 부산시당","국힘 부산시당","국민의힘 부산시당위원장","국민의힘 부산시당 토론회"];
  for (const q of QS) for (const sort of ["sim","date"]) for (let start=1; start<=500; start+=100) {
    const u = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=100&start=${start}&sort=${sort}`;
    let r; try { r = await fetch(u, { headers: naverH }); } catch { break; }
    if (!r.ok) break;
    const js = await r.json();
    for (const it of js.items || []) {
      const pub = new Date(it.pubDate);
      if (pub < A || pub >= NAVER_B) continue;               // 7/1~18만 (이후는 아카이브가 담당)
      add(strip(it.title), it.originallink || it.link, pub, strip(it.description));
    }
    await sleep(120);
    if ((js.items||[]).length < 100) break;
  }

  items.sort((a,b)=>a.pub-b.pub);
  const clusters = [];
  for (const it of items) {
    const toks = new Set(tokensOf(it.t)); let home = null;
    for (const c of clusters) {
      if (c.day !== kstDay(it.pub)) continue;
      const ov = [...toks].filter(x=>c.toks.has(x)).length;
      if (ov / Math.min(toks.size||1, c.toks.size||1) >= 0.5) { home = c; break; }
    }
    if (home) { home.arr.push(it); for (const x of toks) home.toks.add(x); }
    else clusters.push({ day: kstDay(it.pub), toks, arr: [it] });
  }
  console.log(`${room.topic}: 신규 ${items.length}건 → ${clusters.length}개 사안`);

  const send = async text => {
    for (let i=0;i<5;i++){
      const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ chat_id: TG_TOPIC_GROUP, message_thread_id: thread, text, parse_mode:"HTML", disable_web_page_preview:true }) });
      if (r.ok) return true;
      const js = await r.json().catch(()=>({}));
      if (r.status===429){ await sleep(((js.parameters?.retry_after)||5)*1000+1000); continue; }
      console.error("send fail", r.status, JSON.stringify(js).slice(0,160)); return false;
    }
    return false;
  };
  if (!clusters.length) continue;
  await send(`${room.emoji} <b>수집 기준을 넓혀 보충합니다.</b>\n그동안 위원장 이름이 제목에 없으면 놓쳤던 시당 활동 기사(토론회·시당대회·논평 등)를 7월분부터 시간순으로 올립니다. 이후로는 실시간 수집됩니다.`);
  await sleep(3500);
  let sent = 0;
  for (const c of clusters) {
    const rep = c.arr.find(x=>x.ctx) || c.arr.find(x=>x.wire) || c.arr.find(x=>LOCALS.includes(x.name)) || c.arr[0];
    const d = new Date(rep.pub.getTime()+9*3600*1000);
    const md = `${String(d.getUTCMonth()+1).padStart(2,"0")}/${String(d.getUTCDate()).padStart(2,"0")}`;
    let msg = `${room.emoji} <b>[${room.label}]</b> <b>${esc(rep.t)}</b>\n<i>${esc(rep.name)} · ${md}</i>\n${rep.url}`;
    if (rep.ctx) msg += `\n\n…${esc(rep.ctx.slice(0,220))}…`;
    if (c.arr.length > 1) {
      const others = [...new Set(c.arr.filter(x=>x!==rep).map(x=>x.name))].slice(0,5);
      msg += `\n\n📎 같은 사안 보도 ${c.arr.length}건${others.length?` — ${esc(others.join("·"))}`:""}`;
    }
    if (await send(msg)) sent++;
    await sleep(3500);
  }
  console.log(`${room.topic} 발송 완료: ${sent}/${clusters.length}`);
}
