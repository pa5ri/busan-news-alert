// 일회성: 주간 누적 리포트를 새 형식(대표기사·매체 포함)으로 재발송
import { loadDays, topIssues, formatRanking, kstDate } from "./insight.mjs";
const TOKEN = process.env.TG_BRIEF_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const dest = GROUP && TOPICS["브리핑"] ? { chat_id: GROUP, message_thread_id: TOPICS["브리핑"] } : { chat_id: process.env.TG_CHAT_ID };

const dates = Array.from({ length: 7 }, (_, i) => kstDate(-1 - i)).reverse();  // 지난 일 ~ 어제(토)
const items = loadDays(dates);
const wk = ["일","월","화","수","목","금","토"];
const perDay = dates.map(dt => {
  const n = loadDays([dt]).length, wd = wk[new Date(dt + "T12:00:00Z").getUTCDay()];
  return `· ${dt.slice(5)}(${wd}) ${n.toLocaleString()}건`;
});
const head = `📚 <b>주간 누적 리포트</b> <i>(형식 개선 재발송)</i>\n<b>${dates[0].replace(/-/g, ".")}(일) ~ ${dates[dates.length-1].replace(/-/g, ".")}(토)</b>\n총 <b>${items.length.toLocaleString()}건</b>\n\n<b>[일자별]</b>\n${perDay.join("\n")}`;
const msgs = [head, ...formatRanking(topIssues(items, 20), items.length, 20, "주간 이슈 TOP 20")];
for (const text of msgs) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...dest, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json();
  console.log(j.ok ? `발송 OK (${text.length}자)` : `실패: ${j.description}`);
  await new Promise(r => setTimeout(r, 600));
}
