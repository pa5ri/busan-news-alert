// 일회성: 여야 부산시당위원장 방을 새 규칙(인물 키워드)으로 다시 채운다.
// 민주당 방은 이전 규칙으로 올린 내용이 있어 비우고 시작한다.
import { readFileSync, readdirSync } from "node:fs";
import { partyChief } from "./category.mjs";
import { keyTokens } from "./insight.mjs";

const TOKEN = process.env.TG_BOT_TOKEN, GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PRIO = s => /연합뉴스|뉴시스|뉴스1/.test(s) ? 0 : /부산일보|국제신문|KNN|부산MBC|KBS/.test(s) ? 1 : 2;
const api = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());

// 민주당 방 기존 내용 비우기 (이전 규칙으로 올린 안내문+15건)
let del = 0;
for (let id = TOPICS["민주당시당"] + 1; id <= TOPICS["민주당시당"] + 20; id++)
  if ((await api("deleteMessage", { chat_id: GROUP, message_id: id })).ok) del++;
console.log(`민주당 방 기존 ${del}건 삭제`);

const items = [];
for (const f of readdirSync("archive").filter(f => f.endsWith(".jsonl")).sort())
  for (const l of readFileSync("archive/" + f, "utf8").split("\n"))
    if (l.trim()) { try { items.push(JSON.parse(l)); } catch {} }

let last = 0;
async function send(thread, text) {
  const gap = 3500 - (Date.now() - last);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  for (let i = 0; i < 4; i++) {
    last = Date.now();
    const j = await api("sendMessage", { chat_id: GROUP, message_thread_id: thread, text,
                                         parse_mode: "HTML", disable_web_page_preview: true });
    if (j.ok) return true;
    const ra = j.parameters?.retry_after;
    if (ra) { await new Promise(r => setTimeout(r, (ra + 1) * 1000)); continue; }
    console.log("실패:", j.description); return false;
  }
  return false;
}

for (const [topicKey, who, emoji, label] of [["민주당시당","박홍배","🔵","민주당 부산시당"],
                                             ["국민의힘시당","이성권","🔴","국민의힘 부산시당"]]) {
  const hit = items.filter(i => partyChief(i)?.topic === topicKey)
                   .sort((a, b) => new Date(a.pub || 0) - new Date(b.pub || 0));
  // 같은 날 + 제목 토큰 50% 겹침 = 같은 사안 → 대표 1건
  const cl = [];
  for (const it of hit) {
    const day = (it.pub || "").slice(5, 16), toks = keyTokens(it.t);
    let best = null;
    for (const c of cl) {
      if (c.day !== day) continue;
      let sh = 0; for (const w of toks) if (c.toks.has(w)) sh++;
      if (sh / Math.max(1, Math.min(toks.size, c.toks.size)) >= 0.5) { best = c; break; }
    }
    if (best) { best.arr.push(it); for (const w of toks) best.toks.add(w); }
    else cl.push({ day, toks: new Set(toks), arr: [it] });
  }
  const picked = cl.map(c => ({ ...c.arr.slice().sort((a, b) => PRIO(a.src) - PRIO(b.src))[0], n: c.arr.length }));
  console.log(`${label}: 원본 ${hit.length}건 → 사안 ${picked.length}건`);
  await send(TOPICS[topicKey],
    `${emoji} <b>${esc(label)} 아카이브</b>\n<i>시당위원장 ${who} 키워드로 수집합니다. 같은 사안의 전재 기사는 대표 1건으로 묶었습니다. 총 ${picked.length}건.</i>`);
  for (const p of picked) {
    const d = p.pub ? new Date(p.pub) : null;
    const ds = d ? `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` : "";
    const more = p.n > 1 ? ` · 관련 보도 ${p.n}건` : "";
    await send(TOPICS[topicKey], `${emoji} <b>${esc(p.t)}</b>\n<i>${esc(p.src)}${ds ? ` · ${ds}` : ""}${more}</i>\n${p.url}`);
  }
}
console.log("완료");
