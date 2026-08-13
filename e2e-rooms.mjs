// 일회성: 시당위원장·시의회 방 실경로 종단 테스트 (발송 → 즉시 삭제)
// 최근 실제 기사를 category.mjs 판별에 태워 라우팅이 맞는지 + 텔레그램이 실제로 받는지 확인.
import { readFileSync, readdirSync } from "node:fs";
import { partyChief, councilNews } from "./category.mjs";

const { TG_BOT_TOKEN, TG_TOPIC_GROUP } = process.env;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// 최근 아카이브에서 각 방에 해당하는 실제 기사 1건씩 뽑는다
const days = readdirSync("archive").sort().slice(-8).reverse();
const pick = { "민주당시당": null, "국민의힘시당": null, "시의회": null };
for (const f of days) {
  for (const l of readFileSync("archive/"+f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    const c = partyChief(r) || councilNews(r);
    if (c && !pick[c.topic]) pick[c.topic] = { rec: r, info: c };
  }
}

for (const [topic, v] of Object.entries(pick)) {
  const thread = TOPICS[topic];
  if (!v) { console.log(`${topic}: 최근 8일 내 해당 기사 없음 — 전송 테스트 건너뜀 (thread ${thread})`); continue; }
  const { rec, info } = v;
  const text = `${info.emoji} <b>[${info.label}]</b> <b>${esc(rec.t)}</b>\n<i>${esc(rec.src)}</i>\n${rec.url}\n\n…${esc(String(rec.ctx||"").slice(0,150))}…\n\n<i>(경로 점검용 — 곧 삭제됩니다)</i>`;
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_TOPIC_GROUP, message_thread_id: thread, text, parse_mode: "HTML", disable_web_page_preview: true }) });
  const js = await r.json();
  if (!js.ok) { console.log(`${topic}(thread ${thread}): 발송 실패 — ${JSON.stringify(js).slice(0,160)}`); continue; }
  await sleep(1500);
  const d = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/deleteMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_TOPIC_GROUP, message_id: js.result.message_id }) });
  const dj = await d.json();
  console.log(`${topic}(thread ${thread}): 판별 OK [${info.label}] → 발송 OK → 삭제 ${dj.ok ? "OK" : "실패"} | 기사: ${rec.t.slice(0,40)}`);
  await sleep(2000);
}
