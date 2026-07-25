// 일회성 셋업 2단계: 통합 모니터링 주제(TV·브리핑·입법예고·의안정보) 생성 + 봇별 발송 검증
// 주제 생성은 주제관리 권한이 있는 속보봇(TG_BOT_TOKEN)이, 검증 발송은 각 담당 봇 토큰이 수행한다.
const GROUP = process.env.TG_TOPIC_GROUP;
const NEW = [
  { key: "기타", name: "📰 기타/미분류", token: process.env.TG_BOT_TOKEN },
];

async function api(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

const map = {};
for (const t of NEW) {
  try {
    const topic = await api(process.env.TG_BOT_TOKEN, "createForumTopic", { chat_id: GROUP, name: t.name });
    map[t.key] = topic.message_thread_id;
    // 담당 봇이 그 주제에 실제로 쓸 수 있는지 즉시 확인
    await api(t.token, "sendMessage", {
      chat_id: GROUP, message_thread_id: topic.message_thread_id,
      text: `✅ ${t.name} 방 연결 완료 — 앞으로 이 알림은 여기로만 옵니다.`,
    });
    console.log(`  ${t.key} → ${topic.message_thread_id} (발송 OK)`);
  } catch (e) {
    console.log(`  ${t.key} 실패: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 1200));
}
console.log("NEW_TOPICS=" + JSON.stringify(map));
