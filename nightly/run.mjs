// 나이틀리 오케스트레이터: 수집 → 엑셀 생성 → 텔레그램 전송
// 사용: node run.mjs [YYYYMMDD]  (생략 시 오늘 KST)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { sendDocument, sendMessage } from "./telegram.mjs";

const dateArg = process.argv[2] || "";

console.log("① 수집…");
execSync(`node scrape.mjs ${dateArg}`.trim(), { stdio: "inherit" });
console.log("② 엑셀 생성…");
execSync("node build_matrix.mjs", { stdio: "inherit" });

const data = JSON.parse(readFileSync("data/broadcasters.json", "utf8"));
const sources = data.sources;                      // v2: {date, sources}
const dDash = data.date;                           // YYYY-MM-DD
const d = new Date(dDash + "T12:00:00+09:00");
const days = ["일","월","화","수","목","금","토"];
const dateStr = `${dDash.replace(/-/g,".")}(${days[d.getDay()]})`;
const fstamp = dDash.replace(/-/g,"");

const byName = Object.fromEntries(sources.map(s => [s.source, s]));
const central = ["KBS 뉴스9","MBC 뉴스데스크","SBS 8뉴스","JTBC 뉴스룸","TV조선 뉴스9"];
const busan   = ["KBS부산","부산MBC","KNN 뉴스아이","SBS(부산검색)"];
const paper   = ["국제신문","부산일보"];
const cnt = n => byName[n]?.items.length || 0;
const total = [...central, ...busan, ...paper].reduce((a,n)=>a+cnt(n), 0);
const line = n => {
  const s = byName[n];
  const warn = s?.note && s.items.length === 0 ? " ⚠" : "";
  return `· ${n}: ${cnt(n)}건${warn}`;
};
const notes = sources.filter(s => s.note).map(s => `⚠ ${s.source}: ${s.note}`).join("\n");
const KW = data.keywords || [];
const kwHits = sources.flatMap(s => s.items.filter(it => it.kw).map(it => ({ src: it.srcName || s.source, ...it })));
const kwLine = KW.length ? `🔎 <b>${KW.join("·")} 언급: ${kwHits.length}건</b>` : "";

const caption = [
  `📡 <b>${dateStr} 뉴스 모니터링</b>  총 ${total}건`,
  kwLine,
  ``,
  `[중앙방송]`, ...central.map(line),
  ``,
  `[부산방송]`, ...busan.map(line),
  ``,
  `[지면]`, ...paper.map(line),
  notes ? `\n${notes}` : "",
].join("\n").trim();

const file = `부산_뉴스모니터링_${fstamp}.xlsx`;
console.log("③ 텔레그램 전송…");
await sendDocument(file, caption);

// 키워드 언급 기사: 제목 목록을 별도 메시지로 (제목 클릭 → 기사)
if (KW.length && kwHits.length) {
  const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const lines = kwHits.slice(0, 25).map((h, i) =>
    `${i+1}. <a href="${h.url}">${esc(String(h.title).slice(0, 60))}</a> — ${h.src}`);
  if (kwHits.length > 25) lines.push(`… 외 ${kwHits.length - 25}건 (엑셀 탭 참조)`);
  await sendMessage(`🔎 <b>${KW.join("·")} 언급 기사 (${kwHits.length}건)</b>\n${lines.join("\n")}`);
}
console.log("완료:", file);
