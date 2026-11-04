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
const busan   = ["KBS부산 뉴스9","부산MBC 뉴스데스크","KNN 뉴스아이","SBS 부산관련"];
const paper   = ["부산일보","국제신문"];   // (11/5) 「부산 지면」 방과 같은 그날 자 실제 지면만
const cnt = n => byName[n]?.items.length || 0;
const total = [...central, ...busan, ...paper].reduce((a,n)=>a+cnt(n), 0);
const line = n => {
  const s = byName[n];
  const warn = s?.note && s.items.length === 0 && !/\(정상\)$/.test(s.note) ? " ⚠" : "";
  const kwN = (s?.items || []).filter(it => it.kw).length;   // (2026-10-23) 매체별 전재수 언급 수를 옆에 — 0건이면 생략
  return `· ${s?.label || n}: ${cnt(n)}건${kwN ? ` <b>(언급 ${kwN}건)</b>` : ""}${warn}`;
};
// "(정상)"으로 끝나는 노트는 안내(ℹ️)로, 나머지는 경고(⚠)로 표시
const notes = sources.filter(s => s.note).map(s => `${/\(정상\)$/.test(s.note) ? "ℹ️" : "⚠"} ${s.source}: ${s.note}`).join("\n");
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

// (2026-11-02) 언급 기사 가운데 시장 인터뷰를 〈인터뷰〉 방으로 교차 발송.
// 계기: 10/31 JTBC 뉴스룸 「[인터뷰] '부캉이' 힘입어 전재수…」 — 이 보고엔 '언급 1건'으로 잡혔는데, 실시간 루프는 본문 조회 실패로 인터뷰 방에서 빠뜨림.
// 실시간 루프가 이미 보낸 링크(state.json ivSent)는 건너뛴다. 실패해도 밤 보고에는 영향이 없다.
try { await crossInterview(kwHits); } catch (e) { console.log("인터뷰 교차 확인 실패:", e.message); }
console.log("완료:", file);

async function crossInterview(hits) {
  const group = process.env.TG_TOPIC_GROUP; let topics = {};
  try { topics = JSON.parse(process.env.TG_TOPICS || "{}"); } catch {}
  if (!group || !topics["인터뷰"] || !hits.length) return;
  const { interviewCheck } = await import("../interview.mjs");
  let sent = new Set(); try { sent = new Set(JSON.parse(readFileSync("../state.json", "utf8")).ivSent || []); } catch {}
  // 방송사 원문 링크 → 실시간 루프가 쌓는 전재수 색인(archive/jeon)에서 같은 기사의 네이버 링크를 찾는다(JTBC 등은 원문 본문이 스크립트로 그려져 못 읽음)
  const jeon = [];
  for (const dd of [dDash, new Date(d.getTime() + 86400e3).toISOString().slice(0, 10)])
    try { for (const l of readFileSync(`../archive/jeon/${dd}.jsonl`, "utf8").split("\n")) if (l) jeon.push(JSON.parse(l)); } catch {}
  const ids = u => new Set((String(u).match(/[A-Za-z]{0,3}\d{6,}/g) || []));
  const naverOf = u => { const a = ids(u); if (!a.size) return ""; const r = jeon.find(j => [...ids(j.url)].some(x => a.has(x))); return r && /n\.news\.naver\.com/.test(r.link || "") ? r.link : ""; };
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const seenNow = new Set();
  for (const h of hits) {
    const nv = naverOf(h.url); const link = nv || h.url;
    const key = link.replace(/[?#].*$/, ""), orig = String(h.url || "").replace(/[?#].*$/, "");
    if (!key || seenNow.has(key) || [...sent].some(s => s.replace(/[?#].*$/, "") === key || (orig && s.includes(orig)))) continue;
    seenNow.add(key);
    const c = await interviewCheck(link, String(h.src).split(/[ (]/)[0]);
    console.log(`  인터뷰 교차 확인: ${String(h.title).slice(0, 40)} → ${c.ok ? "인터뷰" : "아님"}(${c.why})`);
    if (!c.ok || process.env.DRY_IV) continue;
    const text = `🎤 <b>[인터뷰 · 밤 보고 교차 확인]</b> <b>${esc(h.title)}</b>\n<i>${esc(h.src)}</i>\n${link}`;
    const r = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: group, message_thread_id: topics["인터뷰"], text, parse_mode: "HTML" }) }).then(r => r.json());
    console.log(`  → 인터뷰 방 ${r.ok ? "발송" : "실패: " + r.description}`);
  }
}
