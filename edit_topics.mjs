// 일회성: 주제 이름 정리 + 공식 아이콘(커스텀 이모지) 지정
// 이모지 ID는 getForumTopicIconStickers가 돌려주는 공식 세트(112종)에서 고른 값이다.
// ⚠ 발송 라우팅은 주제 번호(thread id) 기준이므로 이름을 바꿔도 코드/시크릿은 그대로 둔다.
const TOKEN = process.env.TG_BOT_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;

const PLAN = [
  { id: 4,  name: "정치",             icon: "5350387571199319521" }, // 🗳
  { id: 5,  name: "경제",             icon: "5348227245599105972" }, // 💼
  { id: 6,  name: "사회",             icon: "5377494501373780436" }, // 👮
  { id: 7,  name: "문화·생활",        icon: "5350658016700013471" }, // 🎭
  { id: 8,  name: "IT·과학",          icon: "5350554349074391003" }, // 💻
  { id: 9,  name: "국제",             icon: "5348436127038579546" }, // ✈️
  { id: 10, name: "스포츠",           icon: "5375159220280762629" }, // ⚽
  { id: 11, name: "단독·속보",        icon: "5312016608254762256" }, // ⚡
  { id: 79, name: "기타",             icon: "5434144690511290129" }, // 📰
  { id: 69, name: "TV 뉴스 22:01",    icon: "5350513667144163474" }, // 📺
  { id: 71, name: "아침 브리핑 07:00", icon: "5350424168615649565" }, // ⛅
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
  await new Promise(r => setTimeout(r, 900));
}
