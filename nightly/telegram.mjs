// 텔레그램 전송 모듈 (봇 API). 환경변수: TG_BOT_TOKEN, TG_CHAT_ID
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const TOKEN = process.env.TG_BOT_TOKEN;
// 쉼표로 여러 방 지정 가능: "8268488349,-5514645704" (개인+그룹)
const CHATS = String(process.env.TG_CHAT_ID || "").split(",").map(s => s.trim()).filter(Boolean);
const API = t => `https://api.telegram.org/bot${TOKEN}/${t}`;

export async function sendMessage(text) {
  let last;
  for (const chat of CHATS) {
    const r = await fetch(API("sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(`sendMessage 실패(${chat}): ` + JSON.stringify(j));
    last = j;
  }
  return last;
}

export async function sendDocument(filePath, caption = "") {
  const buf = readFileSync(filePath);
  let last;
  for (const chat of CHATS) {
    const form = new FormData();
    form.append("chat_id", chat);
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("document", new Blob([buf]), basename(filePath));
    const r = await fetch(API("sendDocument"), { method: "POST", body: form });
    const j = await r.json();
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
