// 부산 뉴스속보 알리미 — 네이버 뉴스 검색(제목에 '부산' 포함)을 폴링해 새 기사를 텔레그램으로 전송
// env: NAVER_ID, NAVER_SECRET (NAVER API HUB), TG_BOT_TOKEN, TG_CHAT_ID
// 상태: state.json (보낸 기사 키 목록) — 워크플로우가 커밋해 다음 실행에 이어짐
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { loadDays, topIssues, formatRanking, articlesForLabel, kstDate } from "./insight.mjs";
import { checkOrdinances } from "./ordinance.mjs";

const KEYWORD = "부산";
const MAX_PER_RUN = 30;          // 1회 실행당 최대 전송(폭주 방지)
const FIRST_RUN_SEND = 5;        // 최초 실행 시엔 최신 5건만
const STATE_FILE = "state.json";
const STATE_CAP = 3000;          // 보관하는 기존 키 수

const { NAVER_ID, NAVER_SECRET, TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
if (!NAVER_ID || !NAVER_SECRET || !TG_BOT_TOKEN || !TG_CHAT_ID) {
  console.error("환경변수(NAVER_ID/NAVER_SECRET/TG_BOT_TOKEN/TG_CHAT_ID)가 필요합니다."); process.exit(1);
}

// ---- 매체명 (originallink 도메인 → 이름, 없으면 도메인 표기) ----
const PRESS = {
  "yna.co.kr":"연합뉴스","yonhapnewstv.co.kr":"연합뉴스TV","newsis.com":"뉴시스","news1.kr":"뉴스1",
  "news.kbs.co.kr":"KBS","imnews.imbc.com":"MBC","news.sbs.co.kr":"SBS","jtbc.co.kr":"JTBC",
  "tvchosun.com":"TV조선","mbn.co.kr":"MBN","ichannela.com":"채널A","ytn.co.kr":"YTN",
  "chosun.com":"조선일보","joongang.co.kr":"중앙일보","donga.com":"동아일보","hani.co.kr":"한겨레",
  "khan.co.kr":"경향신문","kmib.co.kr":"국민일보","munhwa.com":"문화일보","segye.com":"세계일보",
  "seoul.co.kr":"서울신문","hankookilbo.com":"한국일보","hankyung.com":"한국경제","mk.co.kr":"매일경제",
  "fnnews.com":"파이낸셜뉴스","edaily.co.kr":"이데일리","etoday.co.kr":"이투데이","mt.co.kr":"머니투데이",
  "heraldcorp.com":"헤럴드경제","asiae.co.kr":"아시아경제","ajunews.com":"아주경제","etnews.com":"전자신문",
  "busan.com":"부산일보","kookje.co.kr":"국제신문","knn.co.kr":"KNN","busanmbc.co.kr":"부산MBC",
  "nocutnews.co.kr":"노컷뉴스","ohmynews.com":"오마이뉴스","pressian.com":"프레시안","sisajournal.com":"시사저널",
  "newspim.com":"뉴스핌","dailian.co.kr":"데일리안","newdaily.co.kr":"뉴데일리","wowtv.co.kr":"한국경제TV",
  "biz.chosun.com":"조선비즈","gukjenews.com":"국제뉴스","newsworks.co.kr":"뉴스웍스","kado.net":"강원도민일보",
};
// 통신사(중복 시 대표로 우선 선택)
const WIRES = ["yna.co.kr", "newsis.com", "news1.kr", "yonhapnewstv.co.kr"];
// 기계적 소음(날씨 묶음·운세·로또·부고·시황 등) — 본문매치 기사에만 적용
const NOISE = /오늘의 날씨|날씨예보|\[날씨|운세|로또|\[?부고\]?|\[인사\]|주요 ?일정|코스피|코스닥|환율 마감|부동산 시황/;
// 연예 카테고리 제외: 네이버 연예판 링크·연예 섹션코드(sid=106)·연예 전문매체
const ENT_LINK = /entertain\.naver\.com|[?&]sid=106\b/;
const ENT_DOMAINS = ["osen.co.kr","xportsnews.com","topstarnews.net","starnewskorea.com","mydaily.co.kr",
  "tenasia.co.kr","newsen.com","celuvmedia.com","bntnews.co.kr","tvreport.co.kr","spotvnews.co.kr",
  "joynews24.com","sportschosun.com","sportsseoul.com","sportsw.kr","stardailynews.co.kr","topdaily.co.kr"];
const isEnt = it => ENT_LINK.test(it.link || "") ||
  ENT_DOMAINS.some(d => { const h = String(it.originallink||"").replace(/^https?:\/\/(www\.)?/,"").split("/")[0]; return h === d || h.endsWith("." + d); });

function pressInfo(url) {
  const host = String(url).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const dom = Object.keys(PRESS).find(d => host === d || host.endsWith("." + d) || d.endsWith(host));
  if (dom) return { name: PRESS[dom], mapped: true, wire: WIRES.some(w => host === w || host.endsWith("." + w)) };
  return { name: host || "언론", mapped: false, wire: false };
}

const strip = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;|&#39;/g, "'");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// 기사 키: 네이버 링크 ID 우선, 없으면 원문 URL 정규화
const keyOf = it => {
  const nv = (it.link || "").match(/article\/(?:mnews\/)?(\d+\/\d+)/);
  if (nv) return "nv:" + nv[1];
  // 쿼리스트링에 기사번호가 있는 CMS(articleView.html?idxno=)가 많으므로 쿼리는 보존, 프래그먼트만 제거
  return (it.originallink || it.link || "").replace(/^https?:\/\//, "").replace(/#.*$/, "").replace(/\/$/, "");
};
// 재전송(통신사 받아쓰기) 억제용 제목 정규화 — 매체별 말머리([단독]·[속보] 등)를 떼고 비교
const normTitle = t => strip(t)
  .replace(/\[(단독|속보|포토|영상|종합|1보|2보|3보|기자수첩|현장|르포)\]/gi, "")
  .replace(/[\[\](){}〈〉<>「」'"'"·…‥,.!?\s-]/g, "").slice(0, 30);

// ---- 상태 로드 ----
let state = { seen: [], titles: [] };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const seen = new Set(state.seen || []);
const seenTitles = new Set(state.titles || []);
let firstRun = seen.size === 0;

const naverH = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };

// 쉼표로 여러 방 지정 가능: "8268488349,-5514645704" (개인+그룹)
const CHAT_IDS = String(TG_CHAT_ID).split(",").map(s => s.trim()).filter(Boolean);
async function send(text) {
  let ok = true;
  for (const chat of CHAT_IDS) {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }), // 미리보기 카드 유지
    });
    const jj = await res.json();
    if (!jj.ok) { console.error(`전송 실패(${chat}):`, JSON.stringify(jj).slice(0, 200)); ok = false; }
  }
  return ok;
}

// ---- 아카이브 (인사이트 분석용 축적 — archive/YYYY-MM-DD.jsonl, KST 날짜 기준) ----
function archive(it, pressName) {
  try {
    const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    mkdirSync("archive", { recursive: true });
    const strip2 = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    appendFileSync(`archive/${kst}.jsonl`, JSON.stringify({
      t: strip2(it.title),                       // 제목
      src: pressName,                            // 매체
      pub: it.pubDate,                           // 발행 시각
      url: it.originallink || it.link,           // 원문
      ctx: strip2(it.description).slice(0, 200), // 키워드 맥락
    }) + "\n");
  } catch (e) { console.error("아카이브 실패:", e.message); }
}

function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify({
    seen: [...seen].slice(-STATE_CAP),
    titles: [...seenTitles].slice(-STATE_CAP),
    tgOffset: state.tgOffset || 0,
    briefedFor: state.briefedFor || "",
    ordSno: state.ordSno || 0,
    ordBill: state.ordBill || 0,
    ordBillSampled: state.ordBillSampled || false,
    updated: new Date().toISOString(),
  }));
}
// 의정 알림 전송 — 입법예고 봇(TG_ORD_TOKEN)·의안정보 봇(TG_BILL_TOKEN) 분리 운영
const ORD_TOKEN = process.env.TG_ORD_TOKEN || TG_BOT_TOKEN;
const BILL_TOKEN = process.env.TG_BILL_TOKEN || ORD_TOKEN;
const sendVia = token => async text => {
  for (const chat of CHAT_IDS) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (!j.ok) console.error("의정 전송 실패:", JSON.stringify(j).slice(0, 150));
  }
};
const sendLaw = sendVia(ORD_TOKEN);
const sendBill = sendVia(BILL_TOKEN);

// ---- 1회 폴링 ----
async function runOnce() {
  const r = await fetch(`https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(KEYWORD)}&display=100&start=1&sort=date`, { headers: naverH });
  const j = await r.json();
  // 수집 범위: ①제목에 부산(전 매체) ②본문에만 부산(주요 매체=도메인맵 등재처, 소음성 제목 제외)
  const items = (j.items || []).filter(it => {
    if (isEnt(it)) return false;                       // 연예 카테고리 제외
    const titleHit = strip(it.title).includes(KEYWORD);
    if (titleHit) return true;
    const p = pressInfo(it.originallink || it.link);
    return p.mapped && !NOISE.test(strip(it.title));
  });

  // 오래된 것부터 처리(통신사가 대개 먼저 발행 → 자연스럽게 통신사 버전이 선점)
  items.reverse();

  // 같은 제목 계열은 통신사 버전을 대표로 1건만 전송
  const groups = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (seen.has(k)) continue;
    const nt = normTitle(it.title);
    if (seenTitles.has(nt)) { seen.add(k); continue; }   // 이미 보낸 계열의 재전송
    if (!groups.has(nt)) groups.set(nt, []);
    groups.get(nt).push({ it, k });
  }
  const freshGroups = [];
  for (const [nt, grp] of groups) {
    const wirePick = grp.find(g => pressInfo(g.it.originallink || g.it.link).wire);
    freshGroups.push({ nt, grp, pick: (wirePick || grp[0]).it });
  }

  // 회차당 상한 초과분은 버리지 않고 '미표시'로 남겨 다음 회차(2분 뒤)에 이어서 전송 (이월)
  const sendGroups = firstRun ? freshGroups.slice(-FIRST_RUN_SEND) : freshGroups.slice(0, MAX_PER_RUN);
  const markGroups = firstRun ? freshGroups : sendGroups;   // 최초 실행은 과거 백로그 전체를 본 것으로 처리
  for (const { nt, grp } of markGroups) {
    for (const g of grp) seen.add(g.k);
    seenTitles.add(nt);
  }
  const carry = freshGroups.length - sendGroups.length;
  console.log(`[${new Date().toISOString().slice(11,19)}] 수집 ${items.length} | 신규 ${freshGroups.length} | 전송 ${sendGroups.length}${carry > 0 && !firstRun ? ` | 이월 ${carry}` : ""}${firstRun ? " (최초 실행)" : ""}`);

  const toSend = sendGroups.map(sg => sg.pick);
  for (const it of toSend) {
    const { name } = pressInfo(it.originallink || it.link);
    const title = strip(it.title);
    const link = /n\.news\.naver\.com/.test(it.link || "") ? it.link : (it.originallink || it.link);
    const ctx = strip(it.description).slice(0, 300);
    const msg = `📰 <b>[${esc(name)}]</b> ${esc(title)}\n${link}\n\n…${esc(ctx)}…`;
    await send(msg);
    archive(it, name);
    await new Promise(rr => setTimeout(rr, 400)); // 텔레그램 속도 제한 여유
  }
  if (!firstRun && carry > 0)
    await send(`⏳ 신규 ${freshGroups.length}건 중 ${sendGroups.length}건 전송 — 나머지 ${carry}건은 2분 뒤 이어서 전송됩니다.`);

  firstRun = false;
  saveState();
}

// ---- "TOP n" 명령 응답 (지정 채팅방에서 "TOP 10"이라고 치면 그 시점 이슈 순위표 회신) ----
let tgOffset = state.tgOffset || 0;
const TG = (method, body) => fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
// 콜백에 담을 이슈 라벨 (64바이트 제한 → UTF-8 기준 안전 절단)
function labelToData(label) {
  let s = "iss:" + label, b = Buffer.from(s, "utf8");
  while (b.length > 60) { label = label.slice(0, -1); s = "iss:" + label; b = Buffer.from(s, "utf8"); }
  return s;
}
// 이슈별 버튼(누르면 링크 모음) — 상위 12개까지 세로 배열
function issueKeyboard(list) {
  const rows = list.slice(0, 12).map((c, i) => [{ text: `${i + 1}. ${c.label} (${c.count})`, callback_data: labelToData(c.label) }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

async function replyRanking(chatId, n, dates, headerLabel) {
  const items = loadDays(dates);
  if (!items.length) {
    await TG("sendMessage", { chat_id: chatId, text: "아직 집계할 아카이브가 없습니다. (축적 시작 직후이거나 해당 날짜 데이터 없음)" });
    return;
  }
  const list = topIssues(items, n);
  const msgs = formatRanking(list, items.length, n, headerLabel);
  for (let i = 0; i < msgs.length; i++) {
    const body = { chat_id: chatId, text: msgs[i], parse_mode: "HTML", disable_web_page_preview: true };
    if (i === msgs.length - 1) {                          // 버튼은 마지막 메시지에 부착
      const kb = issueKeyboard(list);
      if (kb) { body.reply_markup = kb; body.text += "\n\n👇 이슈를 누르면 관련 기사 링크가 옵니다"; }
    }
    await TG("sendMessage", body);
    await new Promise(r => setTimeout(r, 300));
  }
}

// 버튼 클릭 → 그 이슈의 기사 링크 모음 회신
async function replyIssueLinks(chatId, label) {
  const arts = articlesForLabel(loadDays([kstDate(0)]), label).slice(0, 15);
  if (!arts.length) { await TG("sendMessage", { chat_id: chatId, text: `"${label}" 관련 기사를 찾지 못했습니다.` }); return; }
  const lines = arts.map((a, i) => `${i + 1}. <b>[${esc(a.src || "")}]</b> ${esc(String(a.t).slice(0, 55))}\n${a.url}`);
  await TG("sendMessage", {
    chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true,
    text: `🔗 <b>${esc(label)}</b> 관련 기사 ${arts.length}건\n\n${lines.join("\n\n")}`,
  });
}
async function pollCommands() {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getUpdates?offset=${tgOffset + 1}&timeout=0`);
    const j = await r.json();
    for (const u of j.result || []) {
      tgOffset = u.update_id;
      // 버튼 클릭(콜백) 처리
      if (u.callback_query) {
        const cq = u.callback_query;
        await TG("answerCallbackQuery", { callback_query_id: cq.id });   // 로딩 스피너 종료
        const chatId = cq.message?.chat?.id;
        if (chatId && CHAT_IDS.includes(String(chatId)) && (cq.data || "").startsWith("iss:")) {
          const label = cq.data.slice(4);
          console.log(`버튼: ${label}`);
          await replyIssueLinks(chatId, label);
        }
        continue;
      }
      const m = u.message;
      if (!m || !m.text) continue;
      if (!CHAT_IDS.includes(String(m.chat.id))) continue;               // 지정된 방에서만
      if (Date.now() / 1000 - m.date > 600) continue;                    // 10분 지난 메시지 무시
      const mt = m.text.match(/(?:top|톱)\s*(\d{1,3})/i);
      if (mt) {
        const n = Math.min(100, Math.max(1, Number(mt[1])));
        console.log(`명령 수신: TOP ${n}`);
        await replyRanking(m.chat.id, n, [kstDate(0)], `오늘 부산 이슈 TOP ${n} — ${kstDate(0)} 현재`);
      }
    }
    state.tgOffset = tgOffset;
  } catch (e) { console.error("명령 확인 실패:", e.message); }
}

// ---- 아침 7시(KST = 22:00 UTC) 전날 TOP 10 브리핑 ----
async function maybeMorningBrief() {
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const today = kstDate(0);
  if (utcMins < 22 * 60 || utcMins >= 23 * 60) return;                   // 22:00~22:59 UTC = 아침 7시대 KST
  if (state.briefedFor === today) return;
  state.briefedFor = today;
  saveState();
  const yesterday = kstDate(-1);
  const d = new Date(today + "T12:00:00Z");
  const days = ["일","월","화","수","목","금","토"];
  for (const chat of CHAT_IDS)
    await replyRanking(chat, 10, [yesterday], `☀️ ${today.slice(5).replace("-", "/")}(${days[d.getUTCDay()]}) 아침 브리핑 — 어제 부산 이슈 TOP 10`);
  console.log("☀️ 아침 브리핑 발송 완료");
}

// ---- 밤 10시 1분(KST=13:01 UTC) 정리보고 트리거 ----
// GitHub 크론이 이 계정에서 발화하지 않는 문제 대응: 상시 도는 이 루프가 시계를 보고 직접 깨운다.
// nightly.yml 쪽 가드가 당일 중복 실행을 걸러주므로 여러 번 쏘여도 안전.
let nightlyFired = false;
async function maybeTriggerNightly() {
  if (nightlyFired || !process.env.GH_TOKEN || !process.env.REPO) return;
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();      // UTC 기준
  if (mins >= 13 * 60 + 1 && mins < 14 * 60) {                    // 13:01 ~ 13:59 UTC = 22:01 ~ 22:59 KST
    nightlyFired = true;
    try {
      const { execSync } = await import("node:child_process");
      execSync(`gh workflow run nightly.yml -R ${process.env.REPO} -f auto=true`, { stdio: "inherit" });
      console.log("🌙 밤10시 정리보고 트리거 완료");
    } catch (e) { console.error("nightly 트리거 실패:", e.message); }
  }
}

// ---- 실행: 단발 또는 반복 모드 ----
// POLL_INTERVAL_SEC(기본 0=1회 실행), POLL_DURATION_MIN(반복 총 시간)
const intervalSec = Number(process.env.POLL_INTERVAL_SEC || 0);
const durationMin = Number(process.env.POLL_DURATION_MIN || 0);
if (intervalSec > 0 && durationMin > 0) {
  const until = Date.now() + durationMin * 60 * 1000;
  console.log(`반복 모드: ${intervalSec}초 간격, ${durationMin}분간`);
  let lastOrdCheck = 0;
  while (Date.now() < until) {
    try { await runOnce(); } catch (e) { console.error("폴링 오류:", e.message); }
    await maybeTriggerNightly();
    await maybeMorningBrief();
    // 부산시의회 의정 체크는 로컬 PC(ord-local.mjs)로 이관됨 — 시의회 서버가 해외 IP(GitHub 러너)를 차단하기 때문.
    // 차단이 풀리면 아래 주석을 해제해 클라우드로 복귀 가능.
    // if (Date.now() - lastOrdCheck > 55 * 60 * 1000) {
    //   lastOrdCheck = Date.now();
    //   await checkOrdinances(state, sendLaw, sendBill);
    //   saveState();
    // }
    const remain = until - Date.now();
    if (remain <= intervalSec * 1000) break;
    // 다음 뉴스 확인까지 대기하는 동안 20초마다 "TOP n" 명령 확인 (빠른 응답)
    const waitEnd = Date.now() + intervalSec * 1000;
    while (Date.now() < waitEnd - 500) {
      await pollCommands();
      const left = waitEnd - Date.now();
      if (left <= 500) break;
      await new Promise(r2 => setTimeout(r2, Math.min(20000, left)));
    }
  }
  console.log("반복 종료");
} else {
  await runOnce();
}
