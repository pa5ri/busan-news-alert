// 시의회 입법예고·의안 재게시(2026-11-26, 일회성): 10대 의회(2026-07-01~) 의안과 입법예고를 새 카드로 오래된 순서대로 새 방에 다시 올린다.
// 사용자 결정: 기존 「입법예고」「의안정보」 방은 통째로 지우고 새 방에 다시 올린다. 동의안·예산안도 해시태그로 관리.
// 실행: node council-reissue.mjs [--since 2026-07-01] [--only bill|law] [--send] [--bill-after SID] [--law-after SNO] [--limit N]
//   --send 없으면 시험(카드만 출력·reissue-preview.txt에 저장, 텔레그램 발송 없음).
//   --send: env TG_BOT_TOKEN · TG_TOPIC_GROUP · LAW_THREAD · BILL_THREAD 필요. 알림 없이 3.3초 간격(그룹 분당 20건 한도), 429면 retry_after만큼 쉼.
//   도중에 끊기면 마지막으로 보낸 번호를 --bill-after / --law-after로 넘겨 이어서.
import { writeFileSync, appendFileSync } from "node:fs";
import { listBills, buildBillCard, listLawmaking, buildLawCard, assemblyCard } from "./ordinance.mjs";

const args = process.argv.slice(2);
const arg = (k, d = "") => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SINCE = arg("--since", "2026-07-01"), ONLY = arg("--only"), SEND = args.includes("--send");
const BILL_AFTER = Number(arg("--bill-after", 0)), LAW_AFTER = Number(arg("--law-after", 0)), LIMIT = Number(arg("--limit", 0)) || Infinity;
const { TG_BOT_TOKEN, TG_TOPIC_GROUP, LAW_THREAD, BILL_THREAD } = process.env;
if (SEND && !(TG_BOT_TOKEN && TG_TOPIC_GROUP && (ONLY !== "bill" ? LAW_THREAD : true) && (ONLY !== "law" ? BILL_THREAD : true))) { console.error("발송 모드엔 TG_BOT_TOKEN·TG_TOPIC_GROUP·LAW_THREAD·BILL_THREAD가 필요"); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PREVIEW = "reissue-preview.txt";
if (!SEND) writeFileSync(PREVIEW, "");

let sent = 0, failed = 0;
async function post(thread, text, label) {
  if (!SEND) { appendFileSync(PREVIEW, `\n────────── ${label}\n${text.replace(/<a href="[^"]+">/g, "").replace(/<\/?[ab]>/g, "").replace(/<\/?i>/g, "")}\n`); sent++; return true; }
  for (let i = 0; i < 5; i++) {
    const j = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_TOPIC_GROUP, message_thread_id: Number(thread), text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: true }) }).then(r => r.json()).catch(e => ({ ok: false, description: e.message }));
    if (j.ok) { sent++; await sleep(3300); return true; }
    const wait = j.parameters?.retry_after;
    if (wait) { console.log(`  429 — ${wait}초 대기`); await sleep((wait + 1) * 1000); continue; }
    console.log(`  발송 실패(${label}): ${j.description}`); await sleep(3000);
  }
  failed++; return false;
}
const retry = async (fn, label) => { for (let i = 0; i < 3; i++) { try { return await fn(); } catch (e) { console.log(`  ${label} 읽기 실패(${i + 1}/3): ${e.message}`); await sleep(4000 * (i + 1)); } } return null; };

// ① 입법예고(조례) + 집회 공고 — 공고일이 since 이후인 것. 집회 공고엔 날짜가 없어, since 이후 첫 조례 입법예고보다 번호가 큰 것만.
if (ONLY !== "bill") {
  const posts = (await listLawmaking()).sort((a, b) => a.sno - b.sno).filter(p => p.sno > LAW_AFTER);
  const laws = posts.filter(p => p.gbn === "P" && /조례/.test(p.title));
  console.log(`입법예고 게시판 ${posts.length}건 중 조례 입법예고 ${laws.length}건 — 공고일 확인하며 ${SINCE} 이후만`);
  // 공고일은 첨부 원문에서 읽는다. 못 읽은 공고는 번호(sno, 게시 순서)로 판단: 공고일을 읽은 것 중 SINCE 이후 첫 공고의 번호 이상이면 포함.
  //   (11/26 시험: 공고일을 못 읽은 9대 의회 공고 71832 등이 '포함'으로 섞여 들어왔다)
  const read = [];
  for (const p of laws) {
    const r = await retry(() => buildLawCard(p), `입법예고 ${p.sno}`);
    if (!r) { console.log(`  ✗ 입법예고 ${p.sno} 건너뜀: ${p.title.slice(0, 30)}`); continue; }
    read.push({ p, ...r });
  }
  const firstSno = Math.min(...read.filter(x => x.date && x.date >= SINCE).map(x => x.p.sno));
  const cards = [];
  for (const x of read) {
    if (x.date ? x.date < SINCE : x.p.sno < firstSno) continue;
    if (!x.date) console.log(`  ⚠ 공고일 못 읽음(번호로 포함): ${x.p.sno} ${x.p.title.slice(0, 30)}`);
    cards.push({ sno: x.p.sno, card: x.card, label: `입법예고 ${x.p.sno} ${x.p.title.slice(0, 24)}` });
  }
  console.log(`  10대 의회 첫 입법예고 번호: ${firstSno}`);
  for (const p of posts.filter(p => p.gbn === "A" && /집회\s?공고/.test(p.title) && p.sno > firstSno)) cards.push({ sno: p.sno, card: assemblyCard(p), label: `집회공고 ${p.sno}` });
  cards.sort((a, b) => a.sno - b.sno);
  const head = `📜 <b>부산시의회 입법예고 — 10대 의회 다시 올림</b>\n${SINCE} 이후 ${cards.length}건을 오래된 순서로 올립니다(새 카드 형식). 해시태그를 누르면 같은 주제·위원회끼리 모아 볼 수 있습니다.`;
  if (!LAW_AFTER) await post(LAW_THREAD, head, "입법예고 머리글");
  for (const c of cards.slice(0, LIMIT)) { if (await post(LAW_THREAD, c.card, c.label)) console.log(`📜 ${c.label} (마지막 번호 ${c.sno})`); }
  console.log(`입법예고 끝: ${Math.min(cards.length, LIMIT)}건`);
}

// ② 의안 — 목록의 접수일이 since 이후, 의안번호(sid) 오름차순
if (ONLY !== "law") {
  const since = SINCE.replace(/-/g, ".");
  const bills = (await listBills()).filter(b => b.date >= since && b.sid > BILL_AFTER).sort((a, b) => a.sid - b.sid);
  const kinds = {}; for (const b of bills) { const k = /조례안/.test(b.title) ? "조례안" : /동의안/.test(b.title) ? "동의안" : /예산안|결산|기금운용|추가경정/.test(b.title) ? "예산·결산" : "기타"; kinds[k] = (kinds[k] || 0) + 1; }
  console.log(`의안 ${bills.length}건`, kinds);
  const head = `📥 <b>부산시의회 의안접수 — 10대 의회 다시 올림</b>\n${SINCE} 이후 ${bills.length}건(${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(" · ")})을 오래된 순서로 올립니다. #동의안 #예산안 #조례개정 같은 해시태그로 갈래별로, #○○○의원 #○○위원회로 사람·위원회별로 모아 볼 수 있습니다.`;
  if (!BILL_AFTER) await post(BILL_THREAD, head, "의안 머리글");
  for (const b of bills.slice(0, LIMIT)) {
    const card = await retry(() => buildBillCard(b), `의안 ${b.sid}`);
    if (!card) { console.log(`  ✗ 의안 ${b.sid} 건너뜀: ${b.title.slice(0, 30)}`); failed++; continue; }
    if (await post(BILL_THREAD, card, `의안 ${b.sid} ${b.title.slice(0, 24)}`)) console.log(`📥 의안 ${b.sid} ${b.date} ${b.title.slice(0, 30)}`);
  }
  console.log(`의안 끝: ${Math.min(bills.length, LIMIT)}건`);
}
console.log(`\n${SEND ? "발송" : "시험"} 완료: ${sent}건${failed ? ` · 실패 ${failed}건` : ""}${SEND ? "" : ` → ${PREVIEW}`}`);
if (failed) process.exitCode = 1;
