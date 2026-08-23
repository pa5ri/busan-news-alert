// 일회성: 기고·칼럼 판별 확장(2026-08-24) 전에 분야방에만 갔던 칼럼류를 기고방에 소급 발송. 실행 후 git rm.
import { readFileSync, readdirSync } from "node:fs";
import { specialKind, SPECIAL_EMOJI } from "./category.mjs";

const { TG_BOT_TOKEN, TG_TOPIC_GROUP } = process.env;
const THREAD = JSON.parse(process.env.TG_TOPICS || "{}")["기고"];
if (!THREAD) { console.error("TG_TOPICS에 기고 없음"); process.exit(1); }
const OLD = /\[[^\]]*기고[^\]]*\]/;                       // 확장 전 규칙 — 이미 기고방에 간 것은 제외
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const items = []; const seen = new Set();
for (const f of readdirSync("archive").filter(f => /^2026-08-(09|1\d|2\d)\.jsonl$/.test(f)).sort()) {
  for (const l of readFileSync("archive/" + f, "utf8").split("\n")) {
    if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (specialKind(r) !== "기고" || OLD.test(r.t)) continue;
    const k = String(r.url).replace(/#.*$/, ""); if (seen.has(k)) continue; seen.add(k);
    items.push({ ...r, day: f.slice(0, 10) });
  }
}
items.sort((a, b) => new Date(a.pub) - new Date(b.pub));
console.log("소급 대상:", items.length);

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
await send(`🖋 <b>칼럼류 소급분(8/9~8/23)</b> — 그동안 [칼럼]·[시론]·[기자수첩]·[세상읽기] 등이 분야방에만 가고 이 방엔 안 들어왔습니다(판별 규칙이 '기고'만 봄). 규칙을 넓혀 이제부터는 전부 이 방에만 옵니다. 빠졌던 ${items.length}건을 시간순으로 올립니다.`);
await sleep(3500);
let n = 0;
for (const it of items) {
  const md = `${Number(it.day.slice(5, 7))}/${Number(it.day.slice(8, 10))}`;
  const clean = it.t.replace(/^\[[^\]]*\]\s*/, "").trim() || it.t;
  let msg = `${SPECIAL_EMOJI["기고"]} <b>[기고·칼럼]</b> <b>${esc(clean)}</b>\n<i>${esc(it.src)} · ${md}</i>\n${it.url}`;
  if (it.ctx) msg += `\n\n…${esc(String(it.ctx).slice(0, 200))}…`;
  if (await send(msg)) n++;
  await sleep(3500);
}
console.log(`발송 완료: ${n}/${items.length}`);
