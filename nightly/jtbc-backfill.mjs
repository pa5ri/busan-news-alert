// 보충 발송: 로컬 PC가 올린 nightly/jtbc-latest.json(방송일 일치 시)을 TV 방에 보낸다 — 해외 러너는 JTBC 페이지를 못 읽는다.
// 사용: gh workflow run jtbc-backfill.yml -f want=MM-DD   (먼저 로컬 PC에서 node local/jtbc-local.mjs 로 파일을 올려둘 것)
import { readFileSync } from "node:fs";

const WANT = process.env.WANT_DATE || "";
const j = JSON.parse(readFileSync("jtbc-latest.json", "utf8"));
const want = `${new Date().getFullYear()}-${WANT}`;
if (j.date !== want) { console.error(`파일 방송일 ${j.date} ≠ 대상 ${want} — 발송 안 함`); process.exit(2); }
if (!j.items?.length) { console.error("목록 0건 — 발송 안 함"); process.exit(2); }

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const [chat, thread] = String(process.env.TG_CHAT_ID || "").split(",")[0].split(":");
const items = j.items.slice(0, 40);
const head = `📺 <b>JTBC 뉴스룸 ${Number(WANT.slice(0, 2))}/${Number(WANT.slice(3))} 보충</b> — 밤 보고에서 접속 실패로 빠진 분 (${items.length}건)\n`;
const lines = items.map((it, i) => `${i + 1}. <a href="${it.url}">${esc(it.title.slice(0, 60))}</a>`);
const chunks = []; let cur = head;
for (const l of lines) { if ((cur + "\n" + l).length > 3800) { chunks.push(cur); cur = l; } else cur += "\n" + l; }
chunks.push(cur);
for (const text of chunks) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, ...(thread ? { message_thread_id: Number(thread) } : {}), text, parse_mode: "HTML", disable_web_page_preview: true }) });
  const res = await r.json(); if (!res.ok) { console.error("발송 실패:", JSON.stringify(res).slice(0, 200)); process.exit(3); }
  await new Promise(r => setTimeout(r, 3500));
}
console.log(`발송 완료: ${items.length}건, ${chunks.length}개 메시지`);
