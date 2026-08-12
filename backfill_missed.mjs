// 일회성: 괄호 길이 제한 때문에 놓쳤던 르포·기고를 각 방에 보충한다(맥락 단락 포함).
// 이미 올라간 것과 겹치지 않도록, '옛 정규식으로는 안 잡히고 새 정규식으로만 잡히는' 것만 고른다.
import { readFileSync, readdirSync } from "node:fs";
import { specialKind, SPECIAL_EMOJI } from "./category.mjs";

const TOKEN = process.env.TG_BOT_TOKEN, GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const OLD_REP = /\[[^\]]{0,12}르포[^\]]{0,12}\]/, OLD_CON = /\[[^\]]{0,8}기고[^\]]{0,8}\]/;

const items = [];
for (const f of readdirSync("archive").filter(f => f.endsWith(".jsonl")).sort())
  for (const l of readFileSync("archive/" + f, "utf8").split("\n"))
    if (l.trim()) { try { items.push(JSON.parse(l)); } catch {} }

const seen = new Set(), picked = [];
for (const it of items) {
  const kind = specialKind(it);
  if (kind !== "르포" && kind !== "기고") continue;
  if (kind === "르포" && OLD_REP.test(it.t)) continue;      // 이미 올라간 것
  if (kind === "기고" && OLD_CON.test(it.t)) continue;
  const key = (it.url || it.t).replace(/#.*$/, "");   // ⚠ 쿼리 보존(국제신문 key=…가 기사번호)
  if (seen.has(key) || ALREADY.has(it.url)) continue;
  seen.add(key);
  picked.push({ kind, ...it });
}
picked.sort((a, b) => new Date(a.pub || 0) - new Date(b.pub || 0));
console.log("보충 대상:", picked.length, "건",
  JSON.stringify(picked.reduce((a, p) => (a[p.kind] = (a[p.kind] || 0) + 1, a), {})));

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
  const text = `${SPECIAL_EMOJI[p.kind]} <b>[${p.kind}]</b> <b>${esc(clean)}</b>\n<i>${esc(p.src)}${ds ? ` · ${ds}` : ""}</i>\n${p.url}`
    + (ctx ? `\n\n…${esc(ctx)}…` : "");
  if (await send(TOPICS[p.kind], text)) ok++;
}
console.log(`보충 완료: ${ok}/${picked.length}건`);
