// 부산시의회 의정 모니터링 — 로컬 실행판
// 배경: 시의회 서버가 해외 IP(GitHub 러너)를 차단해, 이 체크만 사용자 PC(한국 IP)에서 수행한다.
// 실행: node ord-local.mjs  (작업 스케줄러가 평일 업무시간에 주기 실행)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkOrdinances } from "./ordinance.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(DIR, ".env.local");
const STATE_FILE = join(DIR, "ord-state.json");

// .env.local 로드
for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const { TG_ORD_TOKEN, TG_BILL_TOKEN, TG_CHAT_ID } = process.env;
const CHAT_IDS = String(TG_CHAT_ID).split(",").map(s => s.trim()).filter(Boolean);

const sendVia = token => async text => {
  for (const chat of CHAT_IDS) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (!j.ok) console.error("전송 실패:", JSON.stringify(j).slice(0, 150));
  }
};

// 상태: 없으면 클라우드가 마지막으로 알던 지점에서 시작(그 이후분을 따라잡음)
let state = { ordSno: 78748, ordBill: 16758, ordBillSampled: true };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }

console.log(`[${new Date().toLocaleString("ko-KR")}] 의정 확인 시작 (기준: 예고 ${state.ordSno} / 의안 ${state.ordBill})`);
await checkOrdinances(state, sendVia(TG_ORD_TOKEN), sendVia(TG_BILL_TOKEN));
writeFileSync(STATE_FILE, JSON.stringify(state));
console.log("완료:", JSON.stringify(state));
