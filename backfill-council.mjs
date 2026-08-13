// 일회성: 부산시의회 방 소급 업로드 (7/1~오늘)
//  - 7/19~ : archive/*.jsonl에서 제목 매칭
//  - 7/1~7/18 : 네이버 API 표적 검색(sim 정렬, pubDate 필터)
//  - 같은 날 + 토큰 겹침 0.5 이상은 한 사안으로 묶고 대표 1건만 발송(대표 = ctx 보유 → 통신사 → 지역지)
// 실행 후 git rm 할 것.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { tokensOf } from "./insight.mjs";

const { NAVER_ID, NAVER_SECRET, TG_BOT_TOKEN, TG_TOPIC_GROUP } = process.env;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const THREAD = TOPICS["시의회"];
if (!THREAD) { console.error("TG_TOPICS에 시의회 없음"); process.exit(1); }

const RE = /부산시의회|부산광역시의회|부산광역시\s?시의회|부산\s시의회|부산시의원|부산\s시의원/;
const UNTIL = new Date(process.env.BACKFILL_UNTIL || "2026-08-13T13:55:00+09:00"); // 실시간 배선 배포 시각 — 이후분은 루프가 담당
const FROM_NAVER = [new Date("2026-07-01T00:00:00+09:00"), new Date("2026-07-19T00:00:00+09:00")]; // [이상, 미만)

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
  "nocutnews.co.kr":"노컷뉴스","ohmynews.com":"오마이뉴스","pressian.com":"프레시안","sisajournal.com":"시사저널",
  "newspim.com":"뉴스핌","dailian.co.kr":"데일리안","newdaily.co.kr":"뉴데일리","wowtv.co.kr":"한국경제TV",
};
const WIRES = ["yna.co.kr","newsis.com","news1.kr","yonhapnewstv.co.kr"];
const LOCALS = ["부산일보","국제신문","KNN","부산MBC"];
const nameOf = url => {
  const host = String(url).replace(/^https?:\/\//,"").replace(/^www\./,"").split("/")[0];
  const dom = Object.keys(PRESS).find(d => host === d || host.endsWith("."+d));
  return dom ? PRESS[dom] : (host || "언론");
};
const isWire = url => { const h=String(url).replace(/^https?:\/\//,"").replace(/^www\./,"").split("/")[0]; return WIRES.some(w=>h===w||h.endsWith("."+w)); };
const strip = s => String(s).replace(/<[^>]+>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&apos;|&#39;/g,"'");
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const keyOf = u => String(u).replace(/^https?:\/\//,"").replace(/#.*$/,"").replace(/\/$/,"");
const normTitle = t => strip(t).replace(/\[(단독|속보|포토|영상|종합|1보|2보|3보|기자수첩|현장|르포)\]/gi,"")
  .replace(/[\[\](){}〈〉<>「」'"'"·…‥,.!?\s-]/g,"").slice(0,30);
const kstDay = d => new Date(d.getTime()+9*3600*1000).toISOString().slice(0,10);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ---- 수집 ----
const items = []; // {t, url, pub:Date, ctx, name, wire}
const seenKey = new Set(), seenNorm = new Set();
function add(t, url, pub, ctx) {
  if (!RE.test(t)) return;
  if (!(pub instanceof Date) || isNaN(pub) || pub >= UNTIL) return;
  const k = keyOf(url); if (seenKey.has(k)) return;
  const n = normTitle(t); if (seenNorm.has(n)) return;
  seenKey.add(k); seenNorm.add(n);
  items.push({ t: strip(t), url, pub, ctx: strip(ctx||"").trim(), name: nameOf(url), wire: isWire(url) });
}

// (A) 아카이브 7/19~
for (const f of readdirSync("archive").sort()) {
  if (!/^2026-0[78]-\d\d\.jsonl$/.test(f)) continue;
  if (f < "2026-07-19") continue;
  for (const line of readFileSync("archive/"+f,"utf8").split("\n")) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    add(r.t, r.url, new Date(r.pub), r.ctx);
  }
}
console.log("아카이브 수집:", items.length);

// (B) 네이버 표적 검색 7/1~7/18
const naverH = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };
const QUERIES = ["부산시의회","부산시의원","부산광역시의회","부산시의회 개원","부산시의회 의장","부산시의회 원구성","부산시의회 임시회","부산시의회 전반기"];
let naverAdded = 0;
for (const q of QUERIES) {
  for (const start of [1, 101, 201]) {
    const u = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=100&start=${start}&sort=sim`;
    let res; try { res = await fetch(u, { headers: naverH }); } catch { break; }
    if (!res.ok) break;
    const js = await res.json();
    for (const it of js.items || []) {
      const pub = new Date(it.pubDate);
      if (pub < FROM_NAVER[0] || pub >= FROM_NAVER[1]) continue;
      const before = items.length;
      add(strip(it.title), it.originallink || it.link, pub, strip(it.description));
      if (items.length > before) naverAdded++;
    }
    await sleep(150);
    if ((js.items||[]).length < 100) break;
  }
}
console.log("네이버 추가(7/1~18):", naverAdded, "| 총:", items.length);

// ---- 사안 클러스터 (같은 날 + 토큰 겹침 0.5) ----
items.sort((a,b)=>a.pub-b.pub);
const clusters = [];
for (const it of items) {
  const toks = new Set(tokensOf(it.t));
  let home = null;
  for (const c of clusters) {
    if (c.day !== kstDay(it.pub)) continue;
    const ov = [...toks].filter(x=>c.toks.has(x)).length;
    if (ov / Math.min(toks.size||1, c.toks.size||1) >= 0.5) { home = c; break; }
  }
  if (home) { home.arr.push(it); for (const x of toks) home.toks.add(x); }
  else clusters.push({ day: kstDay(it.pub), toks, arr: [it] });
}
console.log("클러스터:", clusters.length);

// ---- 발송 ----
async function send(text) {
  const body = { chat_id: TG_TOPIC_GROUP, message_thread_id: THREAD, text, parse_mode: "HTML", disable_web_page_preview: true };
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return true;
    const js = await r.json().catch(()=>({}));
    if (r.status === 429) { await sleep(((js.parameters?.retry_after)||5)*1000+1000); continue; }
    console.error("send fail", r.status, JSON.stringify(js).slice(0,200)); return false;
  }
  return false;
}

await send(`🏛 <b>부산시의회 방 개설 — 취임(7/1) 이후 관련 보도를 소급 정리해 올립니다.</b>\n제목에 부산시의회·부산시의원이 들어간 기사이며, 같은 사안은 대표 기사 1건으로 묶었습니다. 이후로는 실시간으로 올라옵니다.`);
await sleep(3500);

let sent = 0;
for (const c of clusters) {
  const rep = c.arr.find(x=>x.ctx) || c.arr.find(x=>x.wire) || c.arr.find(x=>LOCALS.includes(x.name)) || c.arr[0];
  const d = new Date(rep.pub.getTime()+9*3600*1000);
  const md = `${String(d.getUTCMonth()+1).padStart(2,"0")}/${String(d.getUTCDate()).padStart(2,"0")}`;
  let msg = `🏛 <b>[부산시의회]</b> <b>${esc(rep.t)}</b>\n<i>${esc(rep.name)} · ${md}</i>\n${rep.url}`;
  if (rep.ctx) msg += `\n\n…${esc(rep.ctx.slice(0,220))}…`;
  if (c.arr.length > 1) {
    const others = [...new Set(c.arr.filter(x=>x!==rep).map(x=>x.name))].slice(0,5);
    msg += `\n\n📎 같은 사안 보도 ${c.arr.length}건${others.length?` — ${esc(others.join("·"))}`:""}`;
  }
  if (await send(msg)) sent++;
  await sleep(3500);
}
console.log(`발송 완료: ${sent}/${clusters.length}`);
