// 부산 지면 수동 발송 — 「부산 지면」 방에 지정한 날짜(기본: 오늘 KST)의 부산일보·국제신문 지면을 지금 보낸다.
// 용도: 양식 변경 뒤 재확인, 아침 자동 발송이 빠졌을 때 보충. 자동 발송의 하루 1회 표시(state.editionFor)는 건드리지 않는다.
// 사용: node edition-now.mjs [YYYYMMDD]   (TG_BOT_TOKEN, TG_TOPIC_GROUP, TG_TOPICS 필요)
import { readFileSync, existsSync } from "node:fs";
import { buildEditionMessages, LOCAL_PAPERS } from "./frontpage.mjs";

const { TG_BOT_TOKEN, TG_TOPIC_GROUP, TG_TOPICS } = process.env;
const thread = JSON.parse(TG_TOPICS || "{}")["부산지면"];
if (!TG_BOT_TOKEN || !TG_TOPIC_GROUP || !thread) { console.error("환경변수 부족(TG_BOT_TOKEN / TG_TOPIC_GROUP / TG_TOPICS.부산지면)"); process.exit(1); }
const ymd = (process.argv[2] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)).replace(/-/g, "");
const day = n => { const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// 전재수 색인에서 네이버 기사 키("082/0001234567") — alert.mjs의 jeonArticleKeys와 같은 기준
const keys = new Set();
for (const d of [day(0), day(-1), day(-2)]) {
  const f = `archive/jeon/${d}.jsonl`;
  if (!existsSync(f)) continue;
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l) continue;
    try { const m = String(JSON.parse(l).link || "").match(/article\/(?:mnews\/)?(\d+\/\d+)/); if (m) keys.add(m[1]); } catch {}
  }
}
for (const p of LOCAL_PAPERS) {
  const r = await buildEditionMessages(p.code, p.name, ymd, keys);
  if (!r) { console.log(`${p.name} ${ymd}: 지면 없음`); continue; }
  for (const text of r.msgs) {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_TOPIC_GROUP, message_thread_id: thread, text, parse_mode: "HTML", disable_web_page_preview: true }) });
    const j = await res.json();
    if (!j.ok) { console.error(`${p.name} 전송 실패:`, JSON.stringify(j).slice(0, 200)); process.exit(1); }
    await new Promise(x => setTimeout(x, 3500));
  }
  console.log(`${p.name} ${ymd}: ${r.pages}면 ${r.total}건(${r.msgs.length}장), 전재수 언급 ${r.mentions}건 발송`);
}
