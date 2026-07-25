// 일회성: 주제 이름 정리 + 공식 아이콘(커스텀 이모지) 지정
// 이모지 ID는 getForumTopicIconStickers가 돌려주는 공식 세트(112종)에서 고른 값이다.
// ⚠ 발송 라우팅은 주제 번호(thread id) 기준이므로 이름을 바꿔도 코드/시크릿은 그대로 둔다.
const TOKEN = process.env.TG_BOT_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;

// ⚠ editForumTopic은 그룹당 분당 호출 제한이 빡빡하다(13건 연속 시 마지막 2건이 429).
//   그래서 남은 항목만 넣고 간격을 넉넉히 두고 재실행한다.
const PLAN = [
  { id: 73, name: "시의회 입법예고",   icon: "5373251851074415873" }, // 📝
  { id: 75, name: "시의회 의안정보",   icon: "5350548830041415279" }, // 🏛
];

for (const t of PLAN) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/editForumTopic`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: GROUP, message_thread_id: t.id, name: t.name, icon_custom_emoji_id: t.icon }),
  });
  const j = await r.json();
  console.log(`  ${t.id} ${t.name}: ${j.ok ? "OK" : "실패 — " + j.description}`);
  await new Promise(r => setTimeout(r, 45000));
}
