// 일회성: 더불어민주당 부산시당 관련 보도를 아카이브에서 뽑아 시간순 소급 업로드.
// 같은 사안에 통신사 전재가 20건씩 쏟아지므로 사건 단위로 묶어 대표 기사만 올린다.
import { readFileSync, readdirSync } from "node:fs";
import { isDpBusan } from "./category.mjs";
import { keyTokens } from "./insight.mjs";

const TOKEN = process.env.TG_BOT_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PRIO = s => /연합뉴스|뉴시스|뉴스1/.test(s) ? 0 : /부산일보|국제신문|KNN|부산MBC|KBS/.test(s) ? 1 : 2;

const items = [];
for (const f of readdirSync("archive").filter(f => f.endsWith(".jsonl")).sort())
  for (const l of readFileSync("archive/" + f, "utf8").split("\n"))
    if (l.trim()) { try { items.push(JSON.parse(l)); } catch {} }

const hit = items.filter(isDpBusan);
hit.sort((a, b) => new Date(a.pub || 0) - new Date(b.pub || 0));

// 같은 날 + 제목 토큰 50% 겹침 = 같은 사안 → 대표 1건(통신사·부산지역지 우선)
const clusters = [];
for (const it of hit) {
  const day = (it.pub || "").slice(5, 16), toks = keyTokens(it.t);
  let best = null;
  for (const c of clusters) {
    if (c.day !== day) continue;
    let sh = 0; for (const w of toks) if (c.toks.has(w)) sh++;
    if (sh / Math.max(1, Math.min(toks.size, c.toks.size)) >= 0.5) { best = c; break; }
  }
  if (best) { best.arr.push(it); for (const w of toks) best.toks.add(w); }
  else clusters.push({ day, toks: new Set(toks), arr: [it] });
}
const picked = clusters.map(c => {
  const rep = c.arr.slice().sort((a, b) => PRIO(a.src) - PRIO(b.src))[0];
  return { ...rep, n: c.arr.length };
});
console.log(`원본 ${hit.length}건 → 사안 ${picked.length}건`);

let last = 0;
async function send(text) {
  const gap = 3500 - (Date.now() - last);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  for (let i = 0; i < 4; i++) {
    last = Date.now();
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: GROUP, message_thread_id: TOPICS["민주당시당"], text,
                             parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (j.ok) return true;
    const ra = j.parameters?.retry_after;
    if (ra) { await new Promise(r => setTimeout(r, (ra + 1) * 1000)); continue; }
    console.log("실패:", j.description); return false;
  }
  return false;
}

await send(`🔵 <b>더불어민주당 부산시당 아카이브</b>\n<i>시당 관련 보도를 사안 단위로 정리했습니다(같은 사안 전재 기사는 대표 1건). 총 ${picked.length}건.</i>`);
let ok = 0;
for (const p of picked) {
  const d = p.pub ? new Date(p.pub) : null;
  const ds = d ? `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` : "";
  const more = p.n > 1 ? ` · 관련 보도 ${p.n}건` : "";
  if (await send(`🔵 <b>${esc(p.t)}</b>\n<i>${esc(p.src)}${ds ? ` · ${ds}` : ""}${more}</i>\n${p.url}`)) ok++;
}
console.log(`업로드: ${ok}/${picked.length}건`);
