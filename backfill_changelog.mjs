// 일회성: CHANGELOG.md 전체를 「변경 이력」 방에 시간순(오래된 것부터)으로 업로드.
// 자동 중계로 먼저 올라간 최신 1건은 순서가 어긋나므로 지우고 시작한다(봇은 자기 메시지 삭제 가능).
import { readFileSync } from "node:fs";
const TOKEN = process.env.TG_BOT_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const THREAD = TOPICS["변경이력"];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const api = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
}).then(r => r.json());

// 주제 개설 직후 몇 개 id 범위에서 봇이 보낸 중계 메시지를 정리
for (let id = THREAD + 1; id <= THREAD + 6; id++) {
  const r = await api("deleteMessage", { chat_id: GROUP, message_id: id });
  if (r.ok) console.log(`기존 메시지 ${id} 삭제`);
}

const md = readFileSync("CHANGELOG.md", "utf8");
const blocks = [...md.matchAll(/^## [\s\S]*?(?=\n## |$)/gm)].map(m => m[0].trim()).reverse();  // 오래된 것부터
console.log("항목", blocks.length, "건");

let last = 0;
async function send(text) {
  const gap = 3500 - (Date.now() - last);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  for (let i = 0; i < 4; i++) {
    last = Date.now();
    const j = await api("sendMessage", { chat_id: GROUP, message_thread_id: THREAD, text,
                                         parse_mode: "HTML", disable_web_page_preview: true });
    if (j.ok) return true;
    const ra = j.parameters?.retry_after;
    if (ra) { await new Promise(r => setTimeout(r, (ra + 1) * 1000)); continue; }
    console.log("실패:", j.description); return false;
  }
  return false;
}

await send(`📋 <b>시스템 변경 이력 아카이브</b>\n<i>원본은 리포의 CHANGELOG.md이고 이 방은 사본입니다. 앞으로 수정이 있을 때마다 자동으로 이 방에 올라옵니다. 아래는 2026.7.19. 가동 이후 주요 변경 ${blocks.length}건.</i>`);
let ok = 0;
for (const b of blocks) {
  const lines = b.split("\n");
  const title = lines[0].replace(/^##\s*/, "");
  const body = lines.slice(1).join("\n")
    .replace(/^- \*\*(.+?)\*\*:/gm, "▸ <b>$1</b>:")
    .replace(/\*\*(.+?)\*\*/g, "$1");
  if (await send(`📋 <b>${esc(title)}</b>\n\n${esc(body)}`.slice(0, 3800))) ok++;
}
console.log(`업로드: ${ok}/${blocks.length}건`);
