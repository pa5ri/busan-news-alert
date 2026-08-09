// 일회성: 아카이브 전체에서 인터뷰(시장)·르포·기고를 찾아 각 전용 방에 소급 업로드.
// 오래된 것부터 시간순으로 보내 방 안에서 흐름이 읽히게 한다.
import { readFileSync, readdirSync } from "node:fs";
import { specialKind, SPECIAL_EMOJI } from "./category.mjs";

const TOKEN = process.env.TG_BOT_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const items = [];
for (const f of readdirSync("archive").filter(f => f.endsWith(".jsonl")).sort())
  for (const l of readFileSync("archive/" + f, "utf8").split("\n"))
    if (l.trim()) { try { items.push(JSON.parse(l)); } catch {} }

const seen = new Set(), picked = [];
for (const it of items) {
  const kind = specialKind(it);
  if (!kind) continue;
  const key = (it.url || it.t).replace(/[?#].*$/, "");
  if (seen.has(key)) continue;
  seen.add(key);
  picked.push({ kind, ...it });
}
picked.sort((a, b) => new Date(a.pub || 0) - new Date(b.pub || 0));   // 오래된 것부터
console.log("백필 대상:", picked.length, "건",
  JSON.stringify(picked.reduce((a, p) => (a[p.kind] = (a[p.kind] || 0) + 1, a), {})));

let last = 0;
async function send(kind, text) {
  const gap = 3500 - (Date.now() - last);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  for (let i = 0; i < 4; i++) {
    last = Date.now();
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: GROUP, message_thread_id: TOPICS[kind], text,
                             parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (j.ok) return true;
    const ra = j.parameters?.retry_after;
    if (ra) { console.log(`  속도제한 ${ra}s 대기`); await new Promise(r => setTimeout(r, (ra + 1) * 1000)); continue; }
    console.log("  실패:", j.description); return false;
  }
  return false;
}

let ok = 0;
for (const p of picked) {
  const d = p.pub ? new Date(p.pub) : null;
  const ds = d ? `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` : "";
  const clean = String(p.t).replace(/^\[[^\]]{0,12}(인터뷰|르포|기고)[^\]]{0,12}\]\s*/, "").trim() || p.t;
  const text = `${SPECIAL_EMOJI[p.kind]} <b>[${p.kind}]</b> <b>${esc(clean)}</b>\n<i>${esc(p.src)}${ds ? ` · ${ds}` : ""}</i>\n${p.url}`;
  if (await send(p.kind, text)) ok++;
}
console.log(`백필 완료: ${ok}/${picked.length}건`);
