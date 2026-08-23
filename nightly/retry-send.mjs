// 밤 10시 보고에서 실패한 매체의 보충 발송 — 재수집(scrape.mjs) 후 호출.
// 사용: node retry-send.mjs <YYYYMMDD> "<매체1>,<매체2>"   → 이번에 잡힌 매체만 TV 방에 보충 메시지, 아직 실패면 종료코드 2
import { readFileSync } from "node:fs";
import { sendMessage } from "./telegram.mjs";

const [dateArg, srcArg] = process.argv.slice(2);
const wanted = String(srcArg || "").split(",").map(s => s.trim()).filter(Boolean);
const data = JSON.parse(readFileSync("data/broadcasters.json", "utf8"));
if (data.date.replace(/-/g, "") !== dateArg) { console.error(`수집 날짜 ${data.date} ≠ 대상 ${dateArg}`); process.exit(1); }

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = `${Number(data.date.slice(5, 7))}/${Number(data.date.slice(8, 10))}`;
let still = [];
for (const name of wanted) {
  const s = data.sources.find(x => x.source === name);
  if (!s || !s.items.length) { still.push(name); continue; }
  const items = s.items.slice(0, 40);
  const kw = items.filter(it => it.kw).length;
  const lines = items.map((it, i) => `${i + 1}. <a href="${it.url}">${esc(String(it.title).slice(0, 60))}</a>${it.kw ? " 🔎" : ""}`);
  const text = `📺 <b>${esc(name)} ${md} 보충</b> — 밤 보고 당시 접속 실패분을 재수집했습니다 (${items.length}건${kw ? `, ${(data.keywords || []).join("·")} 언급 ${kw}건` : ""})\n${lines.join("\n")}`;
  const chunks = []; let cur = "";
  for (const l of text.split("\n")) { if ((cur + "\n" + l).length > 3800) { chunks.push(cur); cur = l; } else cur = cur ? cur + "\n" + l : l; }
  chunks.push(cur);
  for (const c of chunks) { await sendMessage(c); await new Promise(r => setTimeout(r, 3500)); }
  console.log(`보충 발송: ${name} ${items.length}건`);
}
if (still.length) { console.log("아직 실패:", still.join(", ")); process.exit(2); }
