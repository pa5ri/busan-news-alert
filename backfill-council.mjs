// 일회성 2차: 부산시의회 방 — 7/1~7/18 보충 (네이버 API HUB 표적 검색, 아카이브 이전 구간)
// 1차(아카이브 7/19~)는 발송 완료. 이 스크립트는 그 이전 구간만 채운다. 실행 후 git rm.
import { tokensOf } from "./insight.mjs";

const { NAVER_ID, NAVER_SECRET, TG_BOT_TOKEN, TG_TOPIC_GROUP } = process.env;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const THREAD = TOPICS["시의회"];
if (!THREAD) { console.error("TG_TOPICS에 시의회 없음"); process.exit(1); }

const RE = /부산시의회|부산광역시의회|부산광역시\s?시의회|부산\s시의회|부산시의원|부산\s시의원/;
const A = new Date("2026-07-01T00:00:00+09:00"), B = new Date("2026-07-19T00:00:00+09:00"); // [이상, 미만)

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

const naverH = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };
const QUERIES = ["부산시의회","부산시의원","부산시의회 임시회","부산시의회 본회의","부산시의회 조례",
  "부산시의회 특위","부산시의회 의장","부산시의회 상임위","부산시의원 재검표","부산시의회 개원"];

const items = []; const seenKey = new Set(), seenNorm = new Set();
for (const q of QUERIES) {
  for (const sort of ["sim","date"]) {
    for (let start = 1; start <= 1000; start += 100) {
      const u = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=100&start=${start}&sort=${sort}`;
      let r; try { r = await fetch(u, { headers: naverH }); } catch { break; }
      if (!r.ok) break;
      const js = await r.json();
      for (const it of js.items || []) {
        const pub = new Date(it.pubDate);
        if (isNaN(pub) || pub < A || pub >= B) continue;
        const t = strip(it.title);
        if (!RE.test(t)) continue;
        const url = it.originallink || it.link;
        const k = keyOf(url); if (seenKey.has(k)) continue;
        const n = normTitle(t); if (seenNorm.has(n)) continue;
        seenKey.add(k); seenNorm.add(n);
        items.push({ t, url, pub, ctx: strip(it.description||"").trim(), name: nameOf(url), wire: isWire(url) });
      }
      await sleep(120);
      if ((js.items||[]).length < 100) break;
    }
  }
}
console.log("수집(7/1~18):", items.length);

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

await send(`🏛 <b>7월 초·중순(7/1~7/18) 보충분입니다.</b>\n아카이브 시작(7/19) 이전 구간을 네이버 검색으로 채웠습니다. 위쪽의 7/20 이후 기사보다 시기가 앞선 점 참고해 주세요.`);
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
