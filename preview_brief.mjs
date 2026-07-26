// 일회성: 연속성 브리핑 새 형식을 브리핑 방에 미리보기 발송 (대장은 이미 커밋된 상태를 사용, 갱신 없음)
import { loadDays } from "./insight.mjs";
import { loadLedger, composeContextBrief } from "./issues.mjs";
const TOKEN = process.env.TG_BRIEF_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const dest = GROUP && TOPICS["브리핑"] ? { chat_id: GROUP, message_thread_id: TOPICS["브리핑"] } : { chat_id: process.env.TG_CHAT_ID };

const dateStr = "2026-07-25";
const items = loadDays([dateStr]);
const ledger = loadLedger();
const { msgs, buttons } = composeContextBrief(ledger, dateStr, items.length,
  "연속성 브리핑 미리보기 — 어제(7/25) 부산 이슈 흐름");

function kb(list) {
  const rows = list.slice(0, 10).map((s, i) => {
    let cd = `sty:${dateStr}|${s.headline}`;
    while (Buffer.byteLength(cd, "utf8") > 60) cd = cd.slice(0, -1);
    return [{ text: `${i + 1}. ${String(s.headline).slice(0, 28)}…`, callback_data: cd }];
  });
  return rows.length ? { inline_keyboard: rows } : undefined;
}
for (let i = 0; i < msgs.length; i++) {
  const body = { ...dest, text: msgs[i], parse_mode: "HTML", disable_web_page_preview: true };
  if (i === msgs.length - 1 && buttons.length) {
    body.reply_markup = kb(buttons);
    body.text += "\n\n👇 이슈를 누르면 관련 기사 링크가 옵니다";
  }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json());
  console.log(r.ok ? `발송 OK (${body.text.length}자)` : `실패: ${r.description}`);
  await new Promise(r => setTimeout(r, 500));
}
