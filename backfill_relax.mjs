// 일회성: 수집 원칙 완화(제목 타 지역 가드)로 새로 포함된 르포·기고를 방에 보충.
// 기존에 올라간 것과 겹치지 않도록, '완화 전 규칙으로는 탈락했던 것'만 고른다.
import { readFileSync, readdirSync } from "node:fs";
import { specialKind, SPECIAL_EMOJI, isBusanRelevant } from "./category.mjs";

const TOKEN = process.env.TG_BOT_TOKEN, GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LOCAL = /부산일보|국제신문|KNN|부산MBC/;
const oldPass = it => LOCAL.test(String(it.src || "")) || isBusanRelevant(it);   // 완화 전 조건

const items = [];
for (const f of readdirSync("archive").filter(f => f.endsWith(".jsonl")).sort())
  for (const l of readFileSync("archive/" + f, "utf8").split("\n"))
    if (l.trim()) { try { items.push(JSON.parse(l)); } catch {} }

const seen = new Set(), picked = [];
for (const it of items) {
  const kind = specialKind(it);
  if (kind !== "르포" && kind !== "기고") continue;
  if (oldPass(it)) continue;                                  // 이미 방에 있음
  const key = (it.url || it.t).replace(/#.*$/, "");           // ⚠ 쿼리 보존(기사번호가 쿼리에 있는 CMS)
  if (seen.has(key)) continue;
  seen.add(key);
  picked.push({ kind, ...it });
}
picked.sort((a, b) => new Date(a.pub || 0) - new Date(b.pub || 0));
console.log("보충 대상:", picked.length, "건", JSON.stringify(picked.reduce((a,p)=>(a[p.kind]=(a[p.kind]||0)+1,a),{})));

let last = 0;
async function send(thread, text) {
  const gap = 3500 - (Date.now() - last);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  for (let i = 0; i < 4; i++) {
    last = Date.now();
    const j = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: GROUP, message_thread_id: thread, text,
                             parse_mode: "HTML", disable_web_page_preview: true }),
    }).then(r => r.json());
    if (j.ok) return true;
    const ra = j.parameters?.retry_after;
    if (ra) { await new Promise(r => setTimeout(r, (ra + 1) * 1000)); continue; }
    console.log("실패:", j.description); return false;
  }
  return false;
}

let ok = 0;
for (const p of picked) {
  const d = p.pub ? new Date(p.pub) : null;
  const ds = d ? `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` : "";
  const clean = String(p.t).replace(/^\[[^\]]*(르포|기고)[^\]]*\]\s*/, "").trim() || p.t;
  const ctx = (p.ctx || "").trim();
  if (await send(TOPICS[p.kind],
      `${SPECIAL_EMOJI[p.kind]} <b>[${p.kind}]</b> <b>${esc(clean)}</b>\n<i>${esc(p.src)}${ds ? ` · ${ds}` : ""}</i>\n${p.url}`
      + (ctx ? `\n\n…${esc(ctx)}…` : ""))) ok++;
}
console.log(`보충 완료: ${ok}/${picked.length}건`);
