// 일회성: 봇 표시이름 최소화 (알림 미리보기에서 "봇이름: " 접두사가 본문을 잡아먹는 문제)
// ⚠ 텔레그램 제약: 빈 이름·스페이스·투명문자(U+2800)는 BOT_TITLE_INVALID. 최소 1글자 필요.
const PLAN = [
  { token: process.env.TG_BOT_TOKEN,     name: "." },   // 실시간 속보봇(분야별 8방 — 물량 대부분)
  { token: process.env.TG_NIGHTLY_TOKEN, name: "TV" },  // 밤10시 TV 보고(하루 1건, 파일 구분용으로 2자 유지)
];
for (const p of PLAN) {
  const api = (m, b) => fetch(`https://api.telegram.org/bot${p.token}/${m}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}),
  }).then(r => r.json());
  const before = await api("getMyName");
  const r = await api("setMyName", { name: p.name });
  const after = await api("getMyName");
  console.log(`  ${JSON.stringify(before.result?.name)} → ${JSON.stringify(after.result?.name)} ${r.ok ? "OK" : "실패: " + r.description}`);
}
