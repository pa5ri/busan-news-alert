// 일회성: 시정 핵심공약 방 소급(최근 7일, 메이저 기준, 같은 날 토큰 겹침 0.7 = 한 사안 대표 1건). 실행 후 git rm.
import { readFileSync, readdirSync } from "node:fs";
import { isAgenda } from "./category.mjs";
import { tokensOf } from "./insight.mjs";

const { TG_BOT_TOKEN, TG_TOPIC_GROUP } = process.env;
const THREAD = JSON.parse(process.env.TG_TOPICS || "{}")["핵심공약"];
if (!THREAD) { console.error("TG_TOPICS에 핵심공약 없음"); process.exit(1); }
const MAJOR = new Set(["연합뉴스","뉴시스","뉴스1","연합뉴스TV","KBS","MBC","SBS","JTBC","TV조선","채널A","MBN","YTN","한국경제TV","조선일보","중앙일보","동아일보","한겨레","경향신문","국민일보","문화일보","세계일보","서울신문","한국일보","매일경제","한국경제","머니투데이","이데일리","아시아경제","헤럴드경제","파이낸셜뉴스","전자신문","조선비즈","부산일보","국제신문","KNN","부산MBC","노컷뉴스","오마이뉴스"]);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dupToks = a => [...new Set(a.filter(t => !/^\d+$/.test(t)))];

const items = []; const seen = new Set();
for (const f of readdirSync("archive").filter(f => /^2026-08-2[3-9]\.jsonl$/.test(f)).sort()) {
  for (const l of readFileSync("archive/" + f, "utf8").split("\n")) {
    if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (!MAJOR.has(r.src) || !isAgenda(r.t)) continue;
    const k = String(r.url).replace(/#.*$/, ""); if (seen.has(k)) continue; seen.add(k);
    items.push({ ...r, day: f.slice(0, 10) });
  }
}
items.sort((a, b) => new Date(a.pub) - new Date(b.pub));
const clusters = [];
for (const it of items) {
  const toks = dupToks(tokensOf(it.t)); const set = new Set(toks);
  let home = null;
  for (const c of clusters) {
    if (c.day !== it.day) continue;
    const m = Math.min(set.size, c.toks.size); if (m < 3) continue;
    let ov = 0; for (const x of c.toks) if (set.has(x)) ov++;
    if (ov / m >= 0.7) { home = c; break; }
  }
  if (home) home.arr.push(it); else clusters.push({ day: it.day, toks: set, arr: [it] });
}
console.log(`소급 대상: ${items.length}건 → ${clusters.length}개 사안`);

async function send(text) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_TOPIC_GROUP, message_thread_id: THREAD, text, parse_mode: "HTML", disable_web_page_preview: true }) });
    if (r.ok) return true;
    const js = await r.json().catch(() => ({}));
    if (r.status === 429) { await sleep(((js.parameters?.retry_after) || 5) * 1000 + 1000); continue; }
    console.error("send fail", r.status, JSON.stringify(js).slice(0, 150)); return false;
  }
  return false;
}
await send(`🎯 <b>시정 핵심공약 방 개설 — 최근 7일(8/23~29) 소급분</b>\n돔구장·글로벌허브도시·산업은행 이전·2차 공공기관 이전·북극항로·가덕신공항·북항재개발 관련 보도. 같은 사안은 대표 1건으로 묶었고, 이후로는 실시간으로 올라옵니다.`);
await sleep(3500);
let n = 0;
for (const c of clusters) {
  const rep = c.arr.find(x => x.ctx) || c.arr[0];
  const md = `${Number(rep.day.slice(5, 7))}/${Number(rep.day.slice(8, 10))}`;
  let msg = `🎯 <b>[핵심공약]</b> <b>${esc(rep.t)}</b>\n<i>${esc(rep.src)} · ${md}</i>\n${rep.url}`;
  if (rep.ctx) msg += `\n\n…${esc(String(rep.ctx).slice(0, 200))}…`;
  if (c.arr.length > 1) msg += `\n\n📎 같은 사안 보도 ${c.arr.length}건`;
  if (await send(msg)) n++;
  await sleep(3500);
}
console.log(`발송 완료: ${n}/${clusters.length}`);
