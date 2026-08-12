// 일회성: 시당위원장 방 실시간 배선 종단 테스트 — 배포된 매처(partyChief)로 판별해
// 실제 시크릿의 주제로 발송 → 성공 확인 → 즉시 삭제.
import { partyChief } from "./category.mjs";
const TOKEN = process.env.TG_BOT_TOKEN, GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const api = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());

for (const t of ["박홍배 위원장 배선 점검용 제목", "이성권 위원장 배선 점검용 제목"]) {
  const c = partyChief({ t });
  if (!c) { console.log(`매처 실패: ${t}`); continue; }
  if (!TOPICS[c.topic]) { console.log(`시크릿에 주제 없음: ${c.topic}`); continue; }
  const j = await api("sendMessage", { chat_id: GROUP, message_thread_id: TOPICS[c.topic],
    text: `${c.emoji} [배선 점검] 실시간 경로 정상 — 이 메시지는 자동 삭제됩니다.` });
  if (!j.ok) { console.log(`${c.topic} 발송 실패: ${j.description}`); continue; }
  const d = await api("deleteMessage", { chat_id: GROUP, message_id: j.result.message_id });
  console.log(`${c.topic}(thread ${TOPICS[c.topic]}): 발송 OK → 삭제 ${d.ok ? "OK" : "실패"}`);
  await new Promise(r => setTimeout(r, 1500));
}
