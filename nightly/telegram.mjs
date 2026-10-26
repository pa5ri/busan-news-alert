// 텔레그램 전송 모듈 (봇 API). 환경변수: TG_BOT_TOKEN, TG_CHAT_ID
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const TOKEN = process.env.TG_BOT_TOKEN;
// 쉼표로 여러 방 지정 가능: "8268488349,-5514645704" (개인+그룹)
// 통합 그룹의 주제로 보낼 땐 "그룹ID:주제ID" 형식: "-1004297621610:69"
const CHATS = String(process.env.TG_CHAT_ID || "").split(",").map(s => s.trim()).filter(Boolean)
  .map(s => { const [chat, thread] = s.split(":"); return { chat, thread: thread || "" }; });
const API = t => `https://api.telegram.org/bot${TOKEN}/${t}`;
// (2026-10-27) 봇을 실시간 봇 하나로 합치면서 22시대에 상시 루프와 같은 봇으로 동시에 보낸다 → 429면 retry_after만큼 기다렸다 재시도(최대 3회)
async function post(method, makeBody, headers) {
  for (let i = 0; ; i++) {
    const r = await fetch(API(method), { method: "POST", ...(headers ? { headers } : {}), body: makeBody() });
    const j = await r.json();
    if (j.ok || j.error_code !== 429 || i >= 3) return j;
    await new Promise(res => setTimeout(res, ((j.parameters?.retry_after || 5) + 1) * 1000));
  }
}

export async function sendMessage(text) {
  let last;
  for (const { chat, thread } of CHATS) {
    const j = await post("sendMessage", () => JSON.stringify({
        chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true,
        ...(thread ? { message_thread_id: Number(thread) } : {}),
      }), { "Content-Type": "application/json" });
    if (!j.ok) throw new Error(`sendMessage 실패(${chat}): ` + JSON.stringify(j));
    last = j;
  }
  return last;
}

export async function sendDocument(filePath, caption = "") {
  const buf = readFileSync(filePath);
  let last;
  for (const { chat, thread } of CHATS) {
    const j = await post("sendDocument", () => {
      const form = new FormData();
      form.append("chat_id", chat);
      if (thread) form.append("message_thread_id", thread);
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
      form.append("document", new Blob([buf]), basename(filePath));
      return form;
    });
    if (!j.ok) throw new Error(`sendDocument 실패(${chat}): ` + JSON.stringify(j));
    last = j;
  }
  return last;
}

// 단독 실행 시 연결 테스트: node telegram.mjs "테스트 메시지"
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g,"/")}`) {
  if (!TOKEN || !CHATS.length) { console.error("TG_BOT_TOKEN / TG_CHAT_ID 환경변수를 먼저 설정하세요."); process.exit(1); }
  await sendMessage(process.argv[2] || "✅ 부산 뉴스 모니터링 봇 연결 테스트 성공");
  console.log("전송 완료");
}
