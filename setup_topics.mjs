// 일회성 셋업: 포럼 그룹의 chat id를 찾고, 분야별 주제(topic) 8개를 만들어 매핑을 출력한다.
// 토큰은 GitHub Secrets에만 있으므로 Actions에서 실행하고, 출력은 chat id와 thread id뿐이다.
const TOKEN = process.env.TG_BOT_TOKEN;
const GROUP_TITLE = process.env.GROUP_TITLE || "부산뉴스 분야별";
const CATS = ["정치", "경제", "사회", "생활/문화", "IT/과학", "세계", "스포츠", "단독·속보"];
const ICON = {
  "정치": 0x1F5F3, "경제": 0x1F4BC, "사회": 0x1F46E, "생활/문화": 0x1F3E1,
  "IT/과학": 0x1F52C, "세계": 0x2708, "스포츠": 0x26BE, "단독·속보": 0x26A1,
};

async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

// ① 그룹 chat id 찾기 — 우선 환경변수, 없으면 getUpdates에서 제목으로 탐색
let chatId = process.env.GROUP_CHAT_ID || "";
if (!chatId) {
  const ups = await api("getUpdates", { timeout: 0, limit: 100 });
  for (const u of ups) {
    const c = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat;
    if (c && c.title === GROUP_TITLE) { chatId = String(c.id); break; }
  }
  if (!chatId) {
    console.log("업데이트에서 그룹을 찾지 못했습니다. 후보 목록:");
    for (const u of ups) {
      const c = u.message?.chat || u.my_chat_member?.chat;
      if (c) console.log(`  - ${c.id} / ${c.type} / ${c.title || c.username || ""}`);
    }
    process.exit(1);
  }
}
console.log(`GROUP=${chatId}`);

// ② 이미 만들어진 주제가 있으면 중복 생성하지 않도록, 실패 시 계속 진행
const map = {};
for (const cat of CATS) {
  try {
    const t = await api("createForumTopic", {
      chat_id: chatId,
      name: cat,
      icon_color: 0x6FB9F0,
    });
    map[cat] = t.message_thread_id;
    console.log(`  ${cat} → ${t.message_thread_id}`);
  } catch (e) {
    console.log(`  ${cat} 실패: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 1200));
}
console.log("TOPICS=" + JSON.stringify(map));
