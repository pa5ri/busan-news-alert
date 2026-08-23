// 부산 뉴스속보 알리미 — 네이버 뉴스 검색(제목에 '부산' 포함)을 폴링해 새 기사를 텔레그램으로 전송
// env: NAVER_ID, NAVER_SECRET (NAVER API HUB), TG_BOT_TOKEN, TG_CHAT_ID
// 상태: state.json (보낸 기사 키 목록) — 워크플로우가 커밋해 다음 실행에 이어짐
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { loadDays, topIssues, formatRanking, articlesForLabel, topStories, formatStories, kstDate, tokensOf } from "./insight.mjs";
import { loadLedger, saveLedger, updateLedger, composeContextBrief, issueArticles, sparkline } from "./issues.mjs";
import { checkOrdinances } from "./ordinance.mjs";
import { checkEditorials } from "./editorials.mjs";
import { categorize, CAT_EMOJI, isScoop, isExclusive, isBusanRelevant, specialKind, SPECIAL_EMOJI, partyChief, councilNews, BUSAN_PLACE, BUSAN_ORG } from "./category.mjs";

const KEYWORD = "부산";
// 1회 실행당 최대 전송 — 사실상 제한이 아니다(관측된 최대 폭주가 48건).
// 실제 처리량을 정하는 것은 텔레그램 그룹 한도(분당 20건)를 지키는 SEND_GAP_MS 페이싱이고,
// 이 값은 한 회차가 지나치게 길어져 명령 응답·밤10시 트리거가 밀리지 않게 막는 backstop이다.
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 60);
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
// ---- 전송 매체 필터 (2026-07-27 도입) ----
// 실시간 방에는 메이저 매체만 전송하고, 나머지는 아카이브에만 기록한다(인사이트·브리핑·이슈대장은 전량 사용).
// 실측: 전송량의 33%가 비메이저 — 필터로 하루 1,000건대 → 600~700건대.
// 예외: 부산 관련 [단독]/[속보]는 매체 불문 통과(군소·전문지 단독 유실 방지).
// 명단은 PRESS 맵의 한글 표기와 정확히 일치해야 한다.
const MAJOR = new Set([
  "연합뉴스", "뉴시스", "뉴스1", "연합뉴스TV",                                    // 통신
  "KBS", "MBC", "SBS", "JTBC", "TV조선", "채널A", "MBN", "YTN", "한국경제TV",      // 방송
  "조선일보", "중앙일보", "동아일보", "한겨레", "경향신문", "국민일보",             // 중앙지
  "문화일보", "세계일보", "서울신문", "한국일보",
  "매일경제", "한국경제", "머니투데이", "이데일리", "아시아경제",                   // 경제지
  "헤럴드경제", "파이낸셜뉴스", "전자신문", "조선비즈",
  "부산일보", "국제신문", "KNN", "부산MBC",                                        // 부산 지역
  "노컷뉴스", "오마이뉴스",                                                        // 기타 주요
]);
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
// 시당위원장 방 전용 중복 방지 — 인물 전용 검색(2차 패스)과 부산 검색(본 패스)이 같은 기사를 각각 집어올 수 있다
const chiefSeen = new Set(state.chiefSeen || []);
const chiefTitles = new Set(state.chiefTitles || []);   // 같은 사건의 타 매체 재전송 억제(제목 계열)
let firstRunChief = chiefSeen.size === 0;   // 최초 1회는 과거 백로그를 흘려보낸다

// ---- 사안 중복 억제 (전 방 공통) ----
// 제목 계열(normTitle) 비교는 헤드라인이 다르면 뚫린다. 최근 12시간 내 '실제 전송된' 기사와
// 토큰 겹침이 크면(기본 0.7) 같은 사안의 재탕으로 보고 기록만 한다 — 먼저 온 매체(대개 통신사) 우선.
// 단독·속보는 예외(새 사실 확률). 시당 방은 별도 24시간 창(chiefRecent)으로 추가 차단.
let sentStories = (state.sentStories || []).filter(e => Date.now() - e.ts < 12 * 3600e3);
let chiefRecent = (state.chiefRecent || []).filter(e => Date.now() - e.ts < 24 * 3600e3);
const DUP_OVERLAP = Number(process.env.DUP_OVERLAP || 0.7);
// 숫자 토큰 제외(여론조사류 수치 오탐 방지) + 중복 토큰 제거(같은 단어 2회 등장 시 이중 계산 방지)
const dupToks = toks => [...new Set(toks.filter(t => !/^\d+$/.test(t)))];
function storyDup(toks, list, thr = DUP_OVERLAP) {
  const set = new Set(dupToks(toks));
  for (const e of list) {
    const et = dupToks(e.toks || []);
    const m = Math.min(set.size, et.length);
    if (m < 3) continue;                       // 토큰이 너무 적으면 판단 보류(오탐 방지)
    let ov = 0; for (const x of et) if (set.has(x)) ov++;
    if (ov / m >= thr) return true;
  }
  return false;
}
const chiefDup = (room, toks) => storyDup(toks, chiefRecent.filter(e => e.room === room));
// 날씨 안내(온도·예보)는 하루 1건만 — 재해·사고성 제목은 제외
const isWeatherInfo = t => /날씨|(아침|낮|오늘|내일|주말)\s?(최저|최고)?\s?기온/.test(t)
  && !/태풍|경보|피해|침수|정전|사고|호우/.test(t);
// 의례성 기사(전송 생략, 아카이브만): 포토 캡션·운세·오늘의 일정·부고/인사/동정.
// 캡션체는 "짧은 수식구 + ~하는 + 인명 + 직함"으로 끝나는 제목만(실기사 오탐 방지, 7일 전수검수 37/37 적중).
const RE_PHOTO = /^\[?(포토|사진|화보|카드뉴스|포토뉴스)\]/;
const RE_CAPTION = /^[^"'…,·]{0,16}(하는|나눈|나선|만난|둘러보는|참석한)\s?[가-힣]{2,5}\s?(의원|위원장|시장|장관|대표|총리|후보|사장|청장|지사|의장|목사)$/;
const RE_ROUTINE = /오늘의\s?운세|띠별\s?운세|^\[?오늘의\s?주요\s?일정|^\[?(부고|인사|동정)\]/;
const isCeremonial = t => RE_PHOTO.test(t) || RE_CAPTION.test(t) || RE_ROUTINE.test(t);
let firstRun = seen.size === 0;

const naverH = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };

// 쉼표로 여러 방 지정 가능: "8268488349,-5514645704" (개인+그룹)
const CHAT_IDS = String(TG_CHAT_ID).split(",").map(s => s.trim()).filter(Boolean);
// ---- 분야별 토픽 발송 ----
// 포럼(토픽) 그룹 하나에서 분야별 토픽으로 나눠 보낸다. TG_TOPIC_GROUP=그룹ID,
// TG_TOPICS='{"정치":2,"경제":3,...}' (분야→message_thread_id). 미설정이면 기존 단일 방으로.
const TOPIC_GROUP = process.env.TG_TOPIC_GROUP || "";
let TOPICS = {};
try { TOPICS = JSON.parse(process.env.TG_TOPICS || "{}"); } catch { TOPICS = {}; }

// 기능별 목적지 — 통합 그룹의 주제가 설정돼 있으면 그 주제로, 없으면 기존 방으로.
// 반환값은 sendMessage 본문에 그대로 펼쳐 쓴다: { chat_id, message_thread_id? }
function destFor(key, fallbackChat) {
  if (TOPIC_GROUP && TOPICS[key]) return { chat_id: TOPIC_GROUP, message_thread_id: TOPICS[key] };
  return { chat_id: fallbackChat };
}
// 기능별 목적지 목록(주제가 있으면 그 한 곳, 없으면 기존 방 전체)
const destsFor = key => (TOPIC_GROUP && TOPICS[key]) ? [destFor(key)] : CHAT_IDS.map(c => ({ chat_id: c }));

// ---- 텔레그램 속도 제한 대응 ----
// 텔레그램은 같은 그룹에 분당 약 20건까지만 허용한다. 토픽을 여러 개로 나눠도
// 결국 같은 그룹(chat) 하나이므로 한도는 그대로 공유된다.
// 그래서 ①최소 간격을 지켜 보내고 ②429가 오면 retry_after만큼 기다렸다 재시도한다.
// (2026-07-25 실측: 400ms 간격으로 30건 연속 발송 → 10건이 429로 유실됨)
const SEND_GAP_MS = Number(process.env.SEND_GAP_MS || 3500);   // ≈17건/분 (한도 20건/분 대비 여유)
let lastSentAt = 0;
async function pace() {
  const wait = SEND_GAP_MS - (Date.now() - lastSentAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSentAt = Date.now();
}
// 성공하면 true. 429는 기다렸다 재시도하고, 그 외 오류는 재시도해도 같으므로 바로 false.
async function tgSend(body, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await pace();
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (j.ok) return true;
    const ra = j.parameters?.retry_after;
    if (ra) {
      console.error(`속도제한(${label}) — ${ra}초 대기 후 재시도 ${attempt}/4`);
      await new Promise(r => setTimeout(r, (ra + 1) * 1000));
      lastSentAt = Date.now();
      continue;
    }
    console.error(`전송 실패(${label}):`, JSON.stringify(j).slice(0, 200));
    return false;
  }
  console.error(`전송 포기(${label}) — 4회 재시도 실패, 다음 회차에 다시 시도`);
  return false;
}

// 분야를 지정해 발송 (토픽 설정이 있으면 그 토픽으로, 없으면 기본 방으로)
async function sendCat(cat, text) {
  if (TOPIC_GROUP && TOPICS[cat])
    return tgSend({ chat_id: TOPIC_GROUP, message_thread_id: TOPICS[cat], text, parse_mode: "HTML" }, cat);
  return send(text);
}
async function send(text) {
  let ok = true;
  for (const chat of CHAT_IDS)                                  // 미리보기 카드 유지
    if (!await tgSend({ chat_id: chat, text, parse_mode: "HTML" }, String(chat))) ok = false;
  return ok;
}

// ---- 보도 급증 감지 (사안 단위, 2026-08-21 재설계) ----
// 이전 방식(단어·2어절 키마다 알림)은 같은 사안에서 단어 조각마다 문턱을 따로 넘겨 한 사안에 11건이 나갔다.
// 지금은 ① 최근 1시간 기사를 토큰 겹침으로 '사안' 묶음 → ② 묶음이 SURGE_MIN건↑ && 평소 하루치 절반↑이면 알림
//        ③ 같은 사안은 하루 1회, 건수가 2배로 불어날 때만 "확산 갱신" → ④ 주기당 최대 1건
// 메시지에는 해석 블록(평소 대비 배수·매체군·부산 관련성·이슈 대장 연결·기준)을 붙인다.
const SURGE_MIN = Number(process.env.SURGE_MIN || 8);
const SURGE_WINDOW = 3600e3;
let recentSent = (state.recentSent || []).filter(r => Date.now() - r.ts < SURGE_WINDOW);   // {ts,title,name,link,toks,sent}
let surgeBase = null;     // 키 → 최근 7일 하루 평균 보도량
function initSurgeBase() {
  surgeBase = new Map();
  try {
    const its = loadDays([...Array(7)].map((_, i) => kstDate(-1 - i)));
    for (const it of its) {
      const toks = tokensOf(it.t), seenK = new Set();
      const add = k => { if (seenK.has(k)) return; seenK.add(k); surgeBase.set(k, (surgeBase.get(k) || 0) + 1); };
      toks.forEach(add);
      for (let i = 0; i < toks.length - 1; i++) add(toks[i] + " " + toks[i + 1]);
    }
    for (const [k, v] of surgeBase) surgeBase.set(k, v / 7);
  } catch (e) { console.error("급증 기준선 계산 실패:", e.message); }
}
const TIER = [
  ["통신", new Set(["연합뉴스", "뉴시스", "뉴스1", "연합뉴스TV"])],
  ["방송", new Set(["KBS", "MBC", "SBS", "JTBC", "TV조선", "채널A", "MBN", "YTN", "한국경제TV"])],
  ["부산지역", new Set(["부산일보", "국제신문", "KNN", "부산MBC"])],
];
function tierLine(rs) {
  const names = new Set(rs.map(r => r.name));
  const c = { 통신: 0, 방송: 0, 부산지역: 0, "중앙·경제지": 0, 기타: 0 };
  const locals = [];
  for (const n of names) {
    const t = TIER.find(([, s]) => s.has(n));
    if (t) { c[t[0]]++; if (t[0] === "부산지역") locals.push(n); }
    else if (MAJOR.has(n)) c["중앙·경제지"]++;
    else c.기타++;
  }
  const parts = Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`);
  // 해석: 주요 매체(통신·방송·중앙·부산지역)가 절반 이상이면 의제화된 사안, 아니면 보도자료 일괄 배포 양상
  const majorN = names.size - c.기타;
  const read = names.size >= 4
    ? (majorN / names.size >= 0.5 ? " → 주요 매체가 주도하는 의제" : " → 군소·전문지 위주, 보도자료 일괄 배포 양상")
    : "";
  return `🗞 매체 ${names.size}곳 — ${parts.join(" · ")}${locals.length ? ` (${locals.join("·")})` : ""}${read}`;
}
const hm = ts => { const d = new Date(ts + 9 * 3600e3); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const ovl = (a, b) => { const s = new Set(a); let n = 0; for (const x of b) if (s.has(x)) n++; return n / Math.max(1, Math.min(s.size, new Set(b).size)); };
// 최근 기사들을 사안으로 묶는다 — 첫 기사(씨앗)의 토큰과 0.5 이상 겹치면 같은 사안 (눈덩이 병합 방지)
function clusterRecent(rs) {
  const cl = [];
  for (const r of rs) {
    const t = dupToks(r.toks || []);
    if (t.length < 2) continue;
    const home = cl.find(c => ovl(c.seed, t) >= 0.5);
    if (home) home.items.push(r); else cl.push({ seed: t, items: [r] });
  }
  return cl;
}
// 사안 서명(상위 빈도 토큰 12개)·대표 제목·기준 키
function describeCluster(c) {
  const freq = new Map();
  for (const r of c.items) for (const w of new Set(dupToks(r.toks || []))) freq.set(w, (freq.get(w) || 0) + 1);
  const sig = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
  // 대표 = 다른 기사와 토큰을 가장 많이 공유하는 기사(동률이면 통신사·먼저 온 것)
  let rep = c.items[0], best = -1;
  for (const r of c.items) {
    // 공유 토큰 수 + 주요 매체 가산(+1) + 통신사 가산(+0.5) + 속보 말머리 감점(-0.5: 대표 제목은 정제된 본기사가 낫다)
    const score = dupToks(r.toks || []).filter(w => (freq.get(w) || 0) >= 2).length
      + (MAJOR.has(r.name) ? 1 : 0) + (TIER[0][1].has(r.name) ? 0.5 : 0) - (isScoop(r.title) ? 0.5 : 0);
    if (score > best) { best = score; rep = r; }
  }
  // 기준선 키: 가장 많이 공유된 2어절, 없으면 1어절
  const bi = new Map();
  for (const r of c.items) { const t = r.toks || []; const seenB = new Set(); for (let i = 0; i < t.length - 1; i++) { const k = t[i] + " " + t[i + 1]; if (seenB.has(k)) continue; seenB.add(k); bi.set(k, (bi.get(k) || 0) + 1); } }
  const topBi = [...bi.entries()].sort((a, b) => b[1] - a[1])[0];
  const key = topBi && topBi[1] >= 3 ? topBi[0] : sig[0];
  return { sig, rep, key, first: c.items.reduce((a, b) => a.ts < b.ts ? a : b) };
}
// 부산 관련성 한 줄 해석
function busanNote(items) {
  const titled = items.filter(r => BUSAN_PLACE.test(r.title) || BUSAN_ORG.test(r.title));
  if (titled.length) {
    const m = titled[0].title.match(BUSAN_ORG) || titled[0].title.match(BUSAN_PLACE);
    return `📍 부산 사안 — ${items.length}건 중 ${titled.length}건이 제목에 부산 언급${m ? ` ('${m[0]}')` : ""}`;
  }
  return `📍 제목엔 부산 없음 — 전국 사안에 부산이 본문으로 걸린 묶음(지역 영향은 본문 확인 필요)`;
}
// 이슈 대장 연결 — 30분 캐시
let ledgerCache = { ts: 0, l: null };
function ledgerNote(sig) {
  if (Date.now() - ledgerCache.ts > 1800e3) { try { ledgerCache = { ts: Date.now(), l: loadLedger() }; } catch { ledgerCache.ts = Date.now(); } }
  const l = ledgerCache.l; if (!l) return "";
  let best = null, bs = 0;
  for (const iss of l.issues) {
    if (iss.status === "종결" || !(iss.tokens || []).length) continue;
    let shared = 0; for (const w of sig) if (iss.tokens.includes(w)) shared++;
    const ratio = shared / Math.max(1, Math.min(sig.length, iss.tokens.length));
    if (((ratio >= 0.45 && shared >= 2) || shared >= 4) && shared > bs) { best = iss; bs = shared; }
  }
  if (!best) return "🆕 이슈 대장에 없던 새 사안 — 오늘 물량이면 내일 아침 브리핑에 신규 이슈로 올라올 가능성이 큽니다";
  const total = Object.values(best.daily || {}).reduce((a, b) => a + b, 0);
  const days = Math.round((Date.parse(kstDate(0)) - Date.parse(best.firstSeen)) / 864e5) + 1;
  const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  return `🗂 이슈 대장: 「${esc(String(best.label).slice(0, 34).trim())}」 ${md(best.firstSeen)}부터 추적 · 오늘 ${days}일째 · 어제까지 누적 ${total}건 (${best.status})`;
}
function surgeMessage(c, d, avg, prev) {
  const n = c.items.length;
  const ratio = avg >= 0.5 ? (n / avg) : 0;
  const scale = avg >= 1 ? `📊 평소 이 주제는 하루 ${Math.round(avg)}건 → 지금은 1시간에 ${n}건 (하루치의 ${ratio.toFixed(1)}배)`
                         : `📊 평소 거의 보도되지 않던 주제가 1시간에 ${n}건 — 새로 떠오른 사안`;
  const head = prev ? `📈 <b>확산 갱신</b> — ${prev.count}건 → ${n}건` : `📈 <b>보도 급증</b> — 1시간 ${n}건`;
  const firstTag = isExclusive(d.first.title) ? "(단독으로 시작) " : isScoop(d.first.title) ? "(속보로 시작) " : "";
  const picks = [];
  // 대표 기사 3건 — 매체가 겹치지 않게(같은 매체의 속보 재탕이 목록을 채우는 것 방지)
  const pushPick = r => { if (picks.length < 3 && !picks.some(p => p === r || p.name === r.name)) picks.push(r); };
  pushPick(d.rep);
  c.items.filter(r => TIER[2][1].has(r.name)).forEach(pushPick);     // 부산지역지 우선
  c.items.filter(r => TIER[0][1].has(r.name)).forEach(pushPick);     // 통신사
  c.items.forEach(pushPick);
  const list = picks.map((r, i) => `${i + 1}. <b>[${esc(r.name)}]</b> ${esc(String(r.title).slice(0, 60))}\n${r.link}`).join("\n");
  return [
    head,
    `<b>${esc(String(d.rep.title).slice(0, 80))}</b>`,
    "",
    `⏱ 첫 보도 ${hm(d.first.ts)} ${esc(d.first.name)} ${firstTag}→ 1시간 ${n}건`,
    scale,
    tierLine(c.items),
    busanNote(c.items),
    ledgerNote(d.sig),
    "",
    list,
    "",
    `<i>ℹ️ 기준: 1시간 안에 같은 사안 ${SURGE_MIN}건↑이면서 평소 하루치의 절반을 넘을 때. 같은 사안은 건수가 2배로 불어날 때만 다시 알립니다.</i>`,
  ].filter(s => s !== null && s !== undefined).join("\n");
}
async function checkSurge() {
  if (!surgeBase) initSurgeBase();
  const now = Date.now();
  recentSent = recentSent.filter(r => now - r.ts < SURGE_WINDOW);
  const today = kstDate(0);
  if (state.surgedDate !== today) { state.surgedDate = today; state.surged = []; }
  state.surged = state.surged || [];
  const clusters = clusterRecent(recentSent).filter(c => c.items.length >= SURGE_MIN).sort((a, b) => b.items.length - a.items.length);
  let fired = false;
  for (const c of clusters) {
    const d = describeCluster(c);
    const avg = surgeBase.get(d.key) || 0;
    if (c.items.length < Math.max(SURGE_MIN, avg * 0.5)) continue;
    const prev = state.surged.find(s => ovl(s.sig, d.sig) >= 0.5);
    if (prev && c.items.length < prev.count * 2) continue;     // 이미 알린 사안 — 2배 전엔 침묵
    if (fired) continue;                                        // 주기당 1건
    await sendCat("단독·속보", surgeMessage(c, d, avg, prev));
    if (prev) { prev.count = c.items.length; prev.ts = now; }
    else state.surged.push({ sig: d.sig, label: String(d.rep.title).slice(0, 60), count: c.items.length, ts: now });
    fired = true;
    console.log(`📈 급증 감지(${prev ? "갱신" : "신규"}): ${d.rep.title.slice(0, 40)} — ${c.items.length}건/시간`);
  }
  await trackScoopSpread();
  if (fired) saveState();
}

// ---- 단독 확산 추적 ----
// [단독]이 방에 올라간 뒤 6시간 안에 타 매체(주요 매체 전송분 기준) 3곳 이상이 같은 사안을 받아쓰면 알린다.
// "단독이 먹혔는가"는 그 자체로 신호 — 받아쓴 매체 수·첫 후속까지 걸린 시간을 함께 적는다.
async function trackScoopSpread() {
  const now = Date.now();
  state.scoopTrack = (state.scoopTrack || []).filter(s => now - s.ts < 6 * 3600e3);
  for (const s of state.scoopTrack) {
    if (s.reported || now - s.ts < 15 * 60e3) continue;
    const fol = sentStories.filter(e => e.ts > s.ts && e.name && e.name !== s.name && ovl(s.toks, e.toks || []) >= 0.5);
    const names = [...new Set(fol.map(e => e.name))];
    if (names.length < 3) continue;
    const firstFol = fol.reduce((a, b) => a.ts < b.ts ? a : b);
    const mins = Math.round((firstFol.ts - s.ts) / 60e3);
    await sendCat("단독·속보",
      `🔁 <b>단독 확산</b> — ${esc(s.name)} 단독을 ${names.length}개 매체가 받아썼습니다\n` +
      `<b>${esc(s.title)}</b>\n${s.link}\n\n` +
      `⏱ 단독 ${hm(s.ts)} → 첫 후속 ${hm(firstFol.ts)} (${mins}분 뒤, ${esc(firstFol.name)}) → 지금까지 ${fol.length}건\n` +
      `🗞 받아쓴 매체: ${esc(names.slice(0, 8).join("·"))}${names.length > 8 ? " 외" : ""}\n\n` +
      `<i>ℹ️ 단독 보도 뒤 6시간 안에 주요 매체 3곳 이상이 같은 사안을 다루면 알립니다. 확산 속도가 빠를수록 의제화 가능성이 큽니다.</i>`);
    s.reported = true;
    console.log(`🔁 단독 확산: ${s.title.slice(0, 40)} — ${names.length}개 매체`);
  }
}

// ---- 아카이브 (인사이트 분석용 축적 — archive/YYYY-MM-DD.jsonl, KST 날짜 기준) ----
function archive(it, pressName, cat) {
  try {
    const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    mkdirSync("archive", { recursive: true });
    const strip2 = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    appendFileSync(`archive/${kst}.jsonl`, JSON.stringify({
      t: strip2(it.title),                       // 제목
      src: pressName,                            // 매체
      cat: cat || "",                            // 분야
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
    chiefSeen: [...chiefSeen].slice(-2000),
    chiefTitles: [...chiefTitles].slice(-2000),
    sentStories: sentStories.slice(-800),
    chiefRecent: chiefRecent.slice(-300),
    wxDate: state.wxDate || "",
    jeonSeen: [...jeonSeen].slice(-4000),
    jeonInit: !!state.jeonInit,
    jeonLast,
    tgOffset: state.tgOffset || 0,
    briefOffset: state.briefOffset || 0,
    briefedFor: state.briefedFor || "",
    surgedDate: state.surgedDate || "",
    surged: (state.surged || []).slice(-50),
    scoopTrack: (state.scoopTrack || []).slice(-50),
    recentSent: recentSent.filter(r => Date.now() - r.ts < SURGE_WINDOW).map(r => ({ ts: r.ts, title: r.title, name: r.name, link: r.link, toks: r.toks })),
    edSeen: state.edSeen || [],
    edInit: state.edInit || false,
    ordSno: state.ordSno || 0,
    ordBill: state.ordBill || 0,
    ordBillSampled: state.ordBillSampled || false,
    updated: new Date().toISOString(),
  }));
}
// 의정 알림 전송 — 입법예고 봇(TG_ORD_TOKEN)·의안정보 봇(TG_BILL_TOKEN) 분리 운영
const ORD_TOKEN = process.env.TG_ORD_TOKEN || TG_BOT_TOKEN;
const BILL_TOKEN = process.env.TG_BILL_TOKEN || ORD_TOKEN;
const sendVia = (token, topicKey) => async text => {
  for (const dest of destsFor(topicKey)) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...dest, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (!j.ok) console.error("의정 전송 실패:", JSON.stringify(j).slice(0, 150));
  }
};
const sendLaw = sendVia(ORD_TOKEN, "입법예고");
const sendBill = sendVia(BILL_TOKEN, "의안정보");

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
  // ⚠ 최초 실행만 미리 '봤음' 처리(과거 백로그를 흘려보내는 용도).
  //   평시에는 전송 성공 후에 표시한다 — 미리 표시하면 429 등으로 실패한 기사가 영구 유실된다.
  if (firstRun) for (const { nt, grp } of freshGroups) {
    for (const g of grp) seen.add(g.k);
    seenTitles.add(nt);
  }
  const carry = freshGroups.length - sendGroups.length;
  console.log(`[${new Date().toISOString().slice(11,19)}] 수집 ${items.length} | 신규 ${freshGroups.length} | 전송예정 ${sendGroups.length}${carry > 0 && !firstRun ? ` | 이월 ${carry}` : ""}${firstRun ? " (최초 실행)" : ""}`);

  let sent = 0, recorded = 0, dups = 0;
  for (const sg of sendGroups) {
    const it = sg.pick;
    const { name } = pressInfo(it.originallink || it.link);
    const title = strip(it.title);
    const link = /n\.news\.naver\.com/.test(it.link || "") ? it.link : (it.originallink || it.link);
    const ctx = strip(it.description).slice(0, 300);
    // 분야 판별 → 해당 분야 전용 봇으로 발송 (미설정 분야는 통합봇)
    const cat = categorize({ t: title, ctx, nlink: it.link, url: it.originallink });
    const rec = { t: title, ctx, nlink: it.link, url: it.originallink, src: name };
    const scoopPass = isScoop(title) && isBusanRelevant(rec);
    const special = specialKind(rec);          // 인터뷰(시장)·르포·기고 — 전용 방 추가 발송
    const chief = partyChief(rec);             // 여야 시당위원장(박홍배·이성권) — 전용 방 추가 발송
    const council = councilNews(rec);          // 부산시의회·시의원 — 전용 방 추가 발송
    const toks = tokensOf(title);

    // 매체 필터: 비메이저는 전송 없이 기록만 (아카이브·급증 감지·이슈 대장에는 전량 반영)
    // 단독·속보와 별도 관리 유형은 매체 불문 통과 (군소 매체 비중이 높은 유형)
    if (!MAJOR.has(name) && !scoopPass && !special && !chief && !council) {
      for (const g of sg.grp) seen.add(g.k);
      seenTitles.add(sg.nt);
      recentSent.push({ ts: Date.now(), title, name, link, toks });
      archive(it, name, cat);
      recorded++;
      continue;
    }

    // 사안 중복 억제: 12시간 내 이미 보낸 사안의 재탕(헤드라인만 다른 타 매체 버전)은 기록만.
    // 날씨 안내는 하루 1건만(state.wxDate), 의례성(포토 캡션·운세·일정·부고류)은 상시 기록만.
    // 단독·속보는 모든 억제에서 예외.
    const wxCapped = isWeatherInfo(title) && state.wxDate === kstDate(0);
    // 단독·속보도 '거의 같은 제목'(0.8↑)의 재탕은 막는다 — 2026-08-21 실측: 속보 21건 중 8건이 동일 속보의 매체별 재전송
    const dupHit = storyDup(toks, sentStories, scoopPass ? 0.8 : DUP_OVERLAP);
    if (dupHit || (!scoopPass && (wxCapped || isCeremonial(title)))) {
      for (const g of sg.grp) seen.add(g.k);
      seenTitles.add(sg.nt);
      recentSent.push({ ts: Date.now(), title, name, link, toks });
      archive(it, name, cat);
      dups++;
      continue;
    }

    const msg = `${CAT_EMOJI[cat] || "📰"} <b>[${esc(name)}]</b> ${esc(title)}\n${link}\n\n…${esc(ctx)}…`;
    // 부산시의회 기사는 분야방(정치 등)에 보내지 않고 시의회방에만 — 두 방 중복 제거(2026-08-23 사용자 요청).
    // 아카이브의 분야 태그(cat)는 그대로라 브리핑·통계에는 영향 없음.
    // 기고·칼럼도 분야방 대신 기고방에만(2026-08-24 사용자 요청, 중복 제거). 말머리 괄호는 떼되 제목 뒤 괄호([○○의 시론])는 그대로.
    const primary = council
      ? [council.topic, `${council.emoji} <b>[${council.label}]</b> <b>${esc(title)}</b>\n<i>${esc(name)}</i>\n${link}\n\n…${esc(ctx)}…`]
      : special === "기고"
        ? ["기고", `${SPECIAL_EMOJI["기고"]} <b>[기고·칼럼]</b> <b>${esc(title.replace(/^\[[^\]]*\]\s*/, "").trim() || title)}</b>\n<i>${esc(name)}</i>\n${link}\n\n…${esc(ctx)}…`]
        : [cat, msg];
    if (!await sendCat(primary[0], primary[1])) {   // 실패분은 미표시로 남겨 다음 회차에 재시도
      console.error(`이번 회차 중단 — 잔여분은 다음 회차로 이월`);
      break;
    }
    // 전송이 확인된 뒤에 '보낸 기사'로 기록 (같은 제목 계열 전체를 함께 표시)
    for (const g of sg.grp) seen.add(g.k);
    seenTitles.add(sg.nt);
    sent++;
    recentSent.push({ ts: Date.now(), title, name, link, toks });   // 급증 감지용
    sentStories.push({ ts: Date.now(), toks, name, t: title.slice(0, 60) });   // 사안 중복 억제(12h) + 단독 확산 추적
    if (isWeatherInfo(title)) state.wxDate = kstDate(0);            // 오늘의 날씨 슬롯 소진
    // 단독·속보 중 '부산 사안'만 별도 토픽에도 (중요 기사 전용 방)
    if (scoopPass) {
      const tag = isExclusive(title) ? "단독" : "속보";
      const clean = title.replace(/\[(단독|속보)\]\s*/g, "").trim();
      // 건별 해석 블록은 붙이지 않는다(2026-08-22 사용자 결정: 해석은 급증·확산 알림에만). 단독은 확산 추적만 조용히 등록.
      await sendCat("단독·속보",
        `⚡ <b>[${tag}]</b> <b>${esc(clean)}</b>\n<i>${esc(name)} · ${CAT_EMOJI[cat] || ""}${esc(cat)}</i>\n${link}\n\n…${esc(ctx)}…`);
      if (tag === "단독") {
        state.scoopTrack = state.scoopTrack || [];
        state.scoopTrack.push({ ts: Date.now(), title: clean.slice(0, 70), name, link, toks: dupToks(toks), reported: false });
      }
    }
    // 인터뷰(시장)·르포 전용 방 (기고·칼럼은 위에서 기고방으로 '대신' 발송됨 — 분야방 중복 없음)
    if (special && special !== "기고") {
      const clean2 = title.replace(/^\[[^\]]{0,12}(인터뷰|르포|기고)[^\]]{0,12}\]\s*/, "").trim() || title;
      await sendCat(special,
        `${SPECIAL_EMOJI[special]} <b>[${special}]</b> <b>${esc(clean2)}</b>\n<i>${esc(name)}</i>\n${link}\n\n…${esc(ctx)}…`);
    }
    // 여야 부산시당위원장 전용 방 (박홍배·이성권) — 분야 방과 같은 형식(맥락 단락 포함)
    if (chief && !sg.grp.some(g => chiefSeen.has(g.k)) && !chiefTitles.has(sg.nt) && !chiefDup(chief.topic, toks)) {
      for (const g of sg.grp) chiefSeen.add(g.k);   // 같은 제목 계열 전체 — 인물 패스가 다른 매체 버전을 다시 집지 않게
      chiefTitles.add(sg.nt);
      chiefRecent.push({ ts: Date.now(), room: chief.topic, toks });
      await sendCat(chief.topic,
        `${chief.emoji} <b>[${chief.label}]</b> <b>${esc(title)}</b>\n<i>${esc(name)}</i>\n${link}\n\n…${esc(ctx)}…`);
    }
    // (부산시의회 기사는 위에서 시의회방으로 '대신' 발송됨 — 분야방 중복 없음)
    archive(it, name, cat);
    if ((sent + recorded) % 10 === 0) saveState();   // 대량 처리 중 잡이 죽어도 중복 재전송을 최소화
  }
  if (recorded || dups) console.log(`  매체 필터: 전송 ${sent} · 기록만 ${recorded}${dups ? ` · 재탕 억제 ${dups}` : ""}`);
  if (!firstRun && carry > 0)
    await send(`⏳ 신규 ${freshGroups.length}건 중 ${sent}건 전송 — 나머지는 이어서 처리됩니다.`);

  firstRun = false;
  await runChiefPass();
  saveState();
}

// ---- 2차 패스: 시당위원장 인물 전용 검색 ----
// 본 패스는 query=부산이라 "박홍배·이성권이 본문에만 나오고 부산이 없는" 기사를 놓친다.
// 인물명을 직접 질의해 제목·본문 어디에 나오든 잡는다(네이버가 전문 검색). 결과는 해당 시당 방에만
// 보낸다 — 분야 방·아카이브에 넣으면 부산과 무관한 기사가 섞이기 때문. 중복은 chiefSeen으로 막는다.
const CHIEF_QUERIES = [
  { q: "박홍배", topic: "민주당시당", emoji: "🔵", label: "민주당 부산시당" },
  { q: "이성권", topic: "국민의힘시당", emoji: "🔴", label: "국민의힘 부산시당" },
];
async function runChiefPass() {
  for (const { q, topic, emoji, label } of CHIEF_QUERIES) {
    let j;
    try {
      const r = await fetch(`https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=100&start=1&sort=date`, { headers: naverH });
      if (!r.ok) { console.error(`인물 검색 실패(${q}):`, r.status); continue; }
      j = await r.json();
    } catch (e) { console.error(`인물 검색 오류(${q}):`, e.message); continue; }

    const fresh = [];
    for (const it of (j.items || []).reverse()) {          // 오래된 것부터
      if (isEnt(it)) continue;
      const k = keyOf(it);
      if (chiefSeen.has(k)) continue;
      const title = strip(it.title), ctx = strip(it.description).slice(0, 300);
      if (!(title.includes(q) || ctx.includes(q))) continue;   // 질의어가 실제로 들어간 기사만
      const nt = normTitle(it.title);
      if (chiefTitles.has(nt)) { chiefSeen.add(k); continue; } // 같은 사건의 타 매체 버전
      if (chiefDup(topic, tokensOf(title))) { chiefSeen.add(k); chiefTitles.add(nt); continue; } // 헤드라인만 다른 재탕
      fresh.push({ k, nt, it, title, ctx });
    }
    // 최초 1회: 어제까지의 백로그만 흘리고, '오늘' 기사는 발송 대상으로 남긴다
    // (2026-08-13 교훈: 전량 흘리면 가동 당일 아침 기사가 통째로 증발 — 박홍배 방이 하루 비었다)
    if (firstRunChief) {
      const today = kstDate(0);
      for (let i = fresh.length - 1; i >= 0; i--) {
        const d = new Date(fresh[i].it.pubDate);
        if (isNaN(d) || new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10) !== today) {
          chiefSeen.add(fresh[i].k); chiefTitles.add(fresh[i].nt); fresh.splice(i, 1);
        }
      }
    }

    let n = 0;
    for (const f of fresh.slice(0, 20)) {
      const { name } = pressInfo(f.it.originallink || f.it.link);
      const link = /n\.news\.naver\.com/.test(f.it.link || "") ? f.it.link : (f.it.originallink || f.it.link);
      const ok = await sendCat(topic,
        `${emoji} <b>[${label}]</b> <b>${esc(f.title)}</b>\n<i>${esc(name)}</i>\n${link}\n\n…${esc(f.ctx)}…`);
      if (!ok) break;                                       // 실패분은 다음 회차로 이월
      chiefSeen.add(f.k); chiefTitles.add(f.nt);
      chiefRecent.push({ ts: Date.now(), room: topic, toks: tokensOf(f.title) });
      n++;
    }
    if (n) console.log(`  인물 검색 ${q}: ${n}건 발송`);
  }
  firstRunChief = false;
}

// ---- "TOP n" 명령 응답 / 아침 브리핑 (봇별 토큰으로 발송) ----
// 아침 브리핑 전용 봇(TG_BRIEF_TOKEN). 미설정 시 속보봇으로 폴백.
const BRIEF_TOKEN = process.env.TG_BRIEF_TOKEN || TG_BOT_TOKEN;
const tg = (token, method, body) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const TG = (method, body) => tg(TG_BOT_TOKEN, method, body);   // 속보봇 기본
// 콜백 데이터: "iss:<날짜>|<라벨>" (64바이트 제한 → UTF-8 기준 라벨만 절단, 날짜로 정확한 아카이브 조회)
function labelToData(label, dateStr) {
  const prefix = "iss:" + dateStr + "|";
  let s = prefix + label;
  while (Buffer.from(s, "utf8").length > 60) { label = label.slice(0, -1); s = prefix + label; }
  return s;
}
// 이슈별 버튼(누르면 링크 모음) — 상위 12개까지 세로 배열, dateStr=순위표 기준일
function issueKeyboard(list, dateStr) {
  const rows = list.slice(0, 12).map((c, i) => [{ text: `${i + 1}. ${c.label} (${c.count})`, callback_data: labelToData(c.label, dateStr) }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

// dest = { chat_id, message_thread_id? } — 통합 그룹의 주제 또는 기존 방
async function replyRanking(token, dest, n, dates, headerLabel) {
  const items = loadDays(dates);
  if (!items.length) {
    await tg(token, "sendMessage", { ...dest, text: "아직 집계할 아카이브가 없습니다. (축적 시작 직후이거나 해당 날짜 데이터 없음)" });
    return;
  }
  const list = topIssues(items, n);
  const msgs = formatRanking(list, items.length, n, headerLabel);
  for (let i = 0; i < msgs.length; i++) {
    const body = { ...dest, text: msgs[i], parse_mode: "HTML", disable_web_page_preview: true };
    if (i === msgs.length - 1) {                          // 버튼은 마지막 메시지에 부착
      const kb = issueKeyboard(list, dates[0]);           // dates[0] = 이 순위표의 기준일
      if (kb) { body.reply_markup = kb; body.text += "\n\n👇 이슈를 누르면 관련 기사 링크가 옵니다"; }
    }
    await tg(token, "sendMessage", body);
    await new Promise(r => setTimeout(r, 300));
  }
}

// 버튼 클릭 → 그 이슈의 기사 링크 모음 회신 (해당 이슈의 아카이브 날짜 = 순위표 발송일 기준)
async function replyIssueLinks(token, dest, label, dates) {
  const arts = articlesForLabel(loadDays(dates), label).slice(0, 15);
  if (!arts.length) { await tg(token, "sendMessage", { ...dest, text: `"${label}" 관련 기사를 찾지 못했습니다.` }); return; }
  const lines = arts.map((a, i) => `${i + 1}. <b>[${esc(a.src || "")}]</b> ${esc(String(a.t).slice(0, 55))}\n${a.url}`);
  await tg(token, "sendMessage", {
    ...dest, parse_mode: "HTML", disable_web_page_preview: true,
    text: `🔗 <b>${esc(label)}</b> 관련 기사 ${arts.length}건\n\n${lines.join("\n\n")}`,
  });
}
// 사건(스토리) 버튼 → 그 사건 기사 링크 모음. 헤드라인 앞부분으로 클러스터를 되찾는다.
// ⚠ 하루 1건짜리 사건은 클러스터(2건↑만 생성)에 없다 — 제목 부분일치 폴백으로 회수 (2026-08-02 버그 수정)
async function replyStoryLinks(token, dest, headPrefix, dateStr) {
  const items = loadDays([dateStr]);
  const list = topStories(items, 100);
  const hit = list.find(s => String(s.headline).startsWith(headPrefix))
           || list.find(s => String(s.headline).slice(0, 12) === headPrefix.slice(0, 12));
  let arts = (hit ? hit.items : []).slice(0, 15);
  let head = hit ? hit.headline : headPrefix;
  if (!arts.length) {
    // 폴백: 원문 제목에서 앞 10자 부분일치 (콜백 절단·[말머리] 제거를 견디는 최소 검색)
    const chunk = String(headPrefix).slice(0, 10);
    const seenU = new Set();
    arts = items.filter(it => {
      if (!String(it.t).includes(chunk)) return false;
      const k = (it.url || it.t).replace(/[?#].*$/, "");
      if (seenU.has(k)) return false;
      seenU.add(k);
      return true;
    }).slice(0, 15);
    if (arts.length) head = arts[0].t;
  }
  if (!arts.length) { await tg(token, "sendMessage", { ...dest, text: "해당 이슈의 기사를 찾지 못했습니다." }); return; }
  const lines = arts.map((a, i) => `${i + 1}. <b>[${esc(a.src || "")}]</b> ${esc(String(a.t).slice(0, 55))}\n${a.url}`);
  await tg(token, "sendMessage", {
    ...dest, parse_mode: "HTML", disable_web_page_preview: true,
    text: `🔗 <b>${esc(String(head).slice(0, 50))}</b>\n관련 기사 ${arts.length}건 (${dateStr})\n\n${lines.join("\n\n")}`,
  });
}

// 이슈 대장 버튼(led:<날짜>|<대장 인덱스>) → 그 이슈의 기사 링크 + 흐름 요약
// 헤드라인 재검색이 아니라 대장을 직접 참조하므로 1건짜리 이슈도 항상 찾는다.
async function replyLedgerLinks(token, dest, idxStr, dateStr) {
  const ledger = loadLedger();
  const iss = ledger.issues[Number(idxStr)];
  if (!iss) { await tg(token, "sendMessage", { ...dest, text: "이슈 대장에서 항목을 찾지 못했습니다." }); return; }
  let arts = issueArticles(iss, loadDays([dateStr]));
  let day = dateStr;
  if (!arts.length && iss.lastSeen && iss.lastSeen !== dateStr) {   // 그날 기사가 없으면 마지막 보도일로
    arts = issueArticles(iss, loadDays([iss.lastSeen]));
    day = iss.lastSeen;
  }
  const cum = Object.values(iss.daily).reduce((a, b) => a + b, 0);
  const flow = `${sparkline(iss, day)} 누적 ${cum}건 · 상태 ${iss.status}`;
  if (!arts.length) {
    await tg(token, "sendMessage", {
      ...dest, parse_mode: "HTML",
      text: `<b>${esc(iss.label)}</b>\n${flow}\n\n${day}자 관련 기사를 찾지 못했습니다.`,
    });
    return;
  }
  arts.sort((a, b) => new Date(b.pub || 0) - new Date(a.pub || 0));
  const lines = arts.slice(0, 15).map((a, i) => `${i + 1}. <b>[${esc(a.src || "")}]</b> ${esc(String(a.t).slice(0, 55))}\n${a.url}`);
  await tg(token, "sendMessage", {
    ...dest, parse_mode: "HTML", disable_web_page_preview: true,
    text: `🔗 <b>${esc(String(iss.label).slice(0, 50))}</b>\n${flow}\n\n${lines.join("\n\n")}`,
  });
}
// 명령·버튼을 받아줄 방: 기존 개인방 + 통합 그룹
const allowedChat = id => CHAT_IDS.includes(String(id)) || (TOPIC_GROUP && String(id) === String(TOPIC_GROUP));
// 봇별 명령·버튼 처리 (offsetKey로 봇마다 getUpdates 오프셋 분리)
async function pollCommands(token, offsetKey) {
  try {
    const off = state[offsetKey] || 0;
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${off + 1}&timeout=0`);
    const j = await r.json();
    for (const u of j.result || []) {
      state[offsetKey] = u.update_id;
      if (u.callback_query) {
        const cq = u.callback_query;
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id });
        const chatId = cq.message?.chat?.id;
        const data = cq.data || "";
        if (chatId && allowedChat(chatId) && (data.startsWith("iss:") || data.startsWith("sty:") || data.startsWith("led:"))) {
          // 통합 그룹에서 눌렀으면 그 주제 안에서 답한다
          const dest = { chat_id: chatId };
          if (cq.message?.message_thread_id) dest.message_thread_id = cq.message.message_thread_id;
          const rest = data.slice(4);
          const bar = rest.indexOf("|");
          const dateStr = bar > 0 ? rest.slice(0, bar) : kstDate(0);   // 콜백에 담긴 기준일
          const label = bar > 0 ? rest.slice(bar + 1) : rest;
          console.log(`버튼(${offsetKey}): ${data.slice(0, 4)} ${dateStr} / ${label}`);
          if (data.startsWith("led:")) await replyLedgerLinks(token, dest, label, dateStr);
          else if (data.startsWith("sty:")) await replyStoryLinks(token, dest, label, dateStr);
          else await replyIssueLinks(token, dest, label, [dateStr]);
        }
        continue;
      }
      const m = u.message;
      if (!m || !m.text) continue;
      if (!allowedChat(m.chat.id)) continue;
      if (Date.now() / 1000 - m.date > 600) continue;
      const mt = m.text.match(/(?:top|톱)\s*(\d{1,3})/i);
      if (mt) {
        const n = Math.min(100, Math.max(1, Number(mt[1])));
        console.log(`명령 수신(${offsetKey}): TOP ${n}`);
        const dest = { chat_id: m.chat.id };
        if (m.message_thread_id) dest.message_thread_id = m.message_thread_id;   // 물어본 주제에서 답장
        await replyRanking(token, dest, n, [kstDate(0)], `오늘 부산 이슈 TOP ${n} — ${kstDate(0)} 현재`);
      }
    }
  } catch (e) { console.error(`명령 확인 실패(${offsetKey}):`, e.message); }
}

// ---- 스토리형 브리핑: 사건 단위 대표 헤드라인 + 전재수 섹션 ----
// 버튼 콜백: "sty:<날짜>|<대표헤드라인 앞부분>" → 그 사건 관련 기사 링크
function storyKeyboard(list, dateStr) {
  const rows = list.slice(0, 10).map((s, i) => {
    let cd = `sty:${dateStr}|${s.headline}`;
    while (Buffer.from(cd, "utf8").length > 60) cd = cd.slice(0, -1);
    return [{ text: `${i + 1}. ${String(s.headline).slice(0, 28)}…`, callback_data: cd }];
  });
  return rows.length ? { inline_keyboard: rows } : undefined;
}
async function sendStoryBrief(dest, dateStr, headerLabel) {
  const items = loadDays([dateStr]);
  if (!items.length) {
    await tg(BRIEF_TOKEN, "sendMessage", { ...dest, text: "해당 날짜의 아카이브가 없습니다." });
    return;
  }
  const list = topStories(items, 10);
  const msgs = formatStories(list, items.length, headerLabel);
  for (let i = 0; i < msgs.length; i++) {
    const body = { ...dest, text: msgs[i], parse_mode: "HTML", disable_web_page_preview: true };
    if (i === msgs.length - 1) {
      const kb = storyKeyboard(list, dateStr);
      if (kb) { body.reply_markup = kb; body.text += "\n\n👇 이슈를 누르면 관련 기사 링크가 옵니다"; }
    }
    await tg(BRIEF_TOKEN, "sendMessage", body);
    await new Promise(r => setTimeout(r, 300));
  }
  await sendJaesooSection(dest, dateStr, items);
}

// 전재수 시장 관련 별도 섹션 (연속성 브리핑·폴백 브리핑 공용)
async function sendJaesooSection(dest, dateStr, items) {
  const jjs = topStories(items, 5, { focus: "전재수" });
  if (!jjs.length) return;
  const lines = jjs.map((s, i) => `<b>${i + 1}. ${esc(String(s.headline).slice(0, 60))}</b>\n    📰 ${s.count}건`);
  const jeonSet = loadJeonUrls([kstDate(-2), kstDate(-1), kstDate(0)]);   // 색인 기준(발행일)과 아카이브 날짜의 경계 차이 흡수
  const cnt = items.filter(it => isJeon(it, jeonSet)).length;
  await tg(BRIEF_TOKEN, "sendMessage", {
    ...dest, parse_mode: "HTML", disable_web_page_preview: true,
    text: `🔎 <b>전재수 시장 관련</b> (어제 ${cnt}건)\n\n${lines.join("\n\n")}`,
    reply_markup: storyKeyboard(jjs, dateStr),
  });
}

// 연속성 브리핑 발송 (이슈 대장 기반) — 마지막 메시지에 이슈 버튼 부착
// 버튼은 led:<날짜>|<대장 인덱스> — 헤드라인 재검색(sty:)과 달리 1건짜리 이슈도 확실히 되찾는다
function ledgerKeyboard(buttons, dateStr) {
  // 버튼 라벨의 번호는 본문 번호(b.no)를 그대로 쓴다 — 순번을 다시 매기면 어긋난다
  const rows = buttons.map(b =>
    [{ text: `${b.no}. ${String(b.headline).slice(0, 28)}…`, callback_data: `led:${dateStr}|${b.idx}` }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}
async function sendContextBrief(dest, msgs, buttons, dateStr) {
  for (let i = 0; i < msgs.length; i++) {
    const body = { ...dest, text: msgs[i], parse_mode: "HTML", disable_web_page_preview: true };
    if (i === msgs.length - 1 && buttons.length) {
      const kb = ledgerKeyboard(buttons, dateStr);
      if (kb) { body.reply_markup = kb; body.text += "\n\n👇 이슈를 누르면 관련 기사 링크가 옵니다"; }
    }
    await tg(BRIEF_TOKEN, "sendMessage", body);
    await new Promise(r => setTimeout(r, 300));
  }
}

// ---- 아침 7시(KST = 22:00 UTC) 전날 TOP 10 브리핑 → 브리핑 전용 봇 ----
async function maybeMorningBrief() {
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const today = kstDate(0);
  // BRIEF_NOW=1 이면 시간대 무시하고 1회 발송 — 러너 장애로 7시대를 놓쳤을 때 수동 복구용
  const force = process.env.BRIEF_NOW === "1";
  if (!force && (utcMins < 22 * 60 || utcMins >= 23 * 60)) return;       // 22:00~22:59 UTC = 아침 7시대 KST
  if (state.briefedFor === today) return;                                // 이미 보냈으면 강제여도 재발송 안 함
  state.briefedFor = today;
  saveState();
  const yesterday = kstDate(-1);
  const d = new Date(today + "T12:00:00Z");
  const days = ["일","월","화","수","목","금","토"];
  const header = `${today.slice(5).replace("-", "/")}(${days[d.getUTCDay()]}) 아침 브리핑 — 어제 부산 이슈 흐름`;
  const items = loadDays([yesterday]);
  // 이슈 대장 갱신(하루 1회, briefedFor 가드가 중복 방지) → 연속성 브리핑. 실패 시 기존 스토리 브리핑으로 폴백.
  let ctx = null;
  try {
    const ledger = loadLedger();
    updateLedger(ledger, yesterday, items);
    saveLedger(ledger);
    ctx = composeContextBrief(ledger, yesterday, items.length, header);
  } catch (e) { console.error("이슈 대장 갱신 실패 — 스토리 브리핑으로 폴백:", e.message); }
  for (const dest of destsFor("브리핑")) {
    if (ctx && ctx.msgs.length) {
      await sendContextBrief(dest, ctx.msgs, ctx.buttons, yesterday);
      await sendJaesooSection(dest, yesterday, items);
    } else {
      await sendStoryBrief(dest, yesterday, `☀️ ${header}`);
    }
  }
  console.log("☀️ 아침 브리핑 발송 완료 (연속성 브리핑)");
  // 일요일 아침엔 주간 누적 리포트도 함께 (직전 한 주: 지난 일~토)
  if (d.getUTCDay() === 0) await sendWeeklyReport();
}

// ---- 전재수 언급 색인 (모집단은 그대로, 꼬리표만) ----
// 문제(2026-08-23 실측): 수집 기사 486건 중 212건(36%)이 전재수를 본문 깊숙이 언급해 요약문(200자)엔 없어서 집계에서 빠졌다.
// 해법: 10분마다 네이버에 '전재수'를 직접 검색(본문 색인)해 URL을 archive/jeon/YYYY-MM-DD.jsonl 에 쌓고,
//       집계 시 "제목·요약에 전재수 OR 색인에 URL"을 언급으로 본다. 총 건수(모집단)는 변하지 않는다.
// 첫 실행은 1,000건 한도까지 거슬러 올라가 지난 열흘치를 채운다(state.jeonInit).
const JEON_INTERVAL_MS = 10 * 60e3;
const normUrl = u => String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/#.*$/, "").replace(/\/$/, "");
const jeonSeen = new Set(state.jeonSeen || []);
let jeonLast = state.jeonLast || 0;
async function runJeonIndex() {
  if (Date.now() - jeonLast < JEON_INTERVAL_MS) return;
  jeonLast = Date.now();
  const pages = state.jeonInit ? [1] : [1, 101, 201, 301, 401, 501, 601, 701, 801, 901];
  let added = 0;
  for (const start of pages) {
    let j;
    try {
      const r = await fetch(`https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent("전재수")}&display=100&start=${start}&sort=date`, { headers: naverH });
      if (!r.ok) { console.error("전재수 색인 검색 실패:", r.status); break; }
      j = await r.json();
    } catch (e) { console.error("전재수 색인 오류:", e.message); break; }
    for (const it of j.items || []) {
      const url = it.originallink || it.link, k = normUrl(url);
      if (!k || jeonSeen.has(k)) continue;
      jeonSeen.add(k);
      const day = new Date(new Date(it.pubDate).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
      try {
        mkdirSync("archive/jeon", { recursive: true });
        appendFileSync(`archive/jeon/${day}.jsonl`, JSON.stringify({ url, link: it.link, t: strip(it.title), pub: it.pubDate }) + "\n");
        added++;
      } catch (e) { console.error("전재수 색인 기록 실패:", e.message); }
    }
    if ((j.items || []).length < 100) break;
    await new Promise(r => setTimeout(r, 150));
  }
  if (!state.jeonInit) { state.jeonInit = true; console.log(`전재수 색인 초기 적재: ${added}건`); }
  else if (added) console.log(`  전재수 색인 +${added}`);
}
// 해당 날짜들의 전재수 URL 집합
function loadJeonUrls(dates) {
  const s = new Set();
  for (const d of dates) {
    const f = `archive/jeon/${d}.jsonl`;
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) { if (!line.trim()) continue; try { const r = JSON.parse(line); s.add(normUrl(r.url)); if (r.link) s.add(normUrl(r.link)); } catch {} }
  }
  return s;
}
// 기사가 전재수 언급인가: 제목·요약에 이름 OR 색인에 URL  (jeonSet은 loadJeonUrls(해당 날짜들))
const isJeon = (it, jeonSet) => /전재수/.test(`${it.t || ""} ${it.ctx || ""}`) || (jeonSet && (jeonSet.has(normUrl(it.url)) || jeonSet.has(normUrl(it.nlink))));

// ---- 주간 누적 리포트 (직전 한 주 일~토, 일요일 아침 브리핑에 동봉) ----
async function sendWeeklyReport() {
  const dates = Array.from({ length: 7 }, (_, i) => kstDate(-1 - i)).reverse();  // 지난 일요일 ~ 어제(토)
  const items = loadDays(dates);
  if (!items.length) return;
  const wk = ["일","월","화","수","목","금","토"];
  // 전재수 언급 = 제목·요약에 이름 OR 전재수 색인(archive/jeon)에 URL — 모집단은 그대로, 본문 깊숙한 언급까지 집계
  const jeonSet = loadJeonUrls(dates);
  const mentions = arr => arr.filter(it => isJeon(it, jeonSet)).length;
  const perDay = dates.map(dt => {
    const day = loadDays([dt]), wd = wk[new Date(dt + "T12:00:00Z").getUTCDay()];
    return `· ${dt.slice(5)}(${wd}) ${day.length.toLocaleString()}건 (전재수 언급 ${mentions(day).toLocaleString()}건)`;
  });
  const list = topIssues(items, 20);
  const head = `📚 <b>주간 누적 리포트</b>\n<b>${dates[0].replace(/-/g, ".")}(일) ~ ${dates[dates.length-1].replace(/-/g, ".")}(토)</b>\n총 <b>${items.length.toLocaleString()}건</b> (전재수 언급 총 <b>${mentions(items).toLocaleString()}건</b>)\n\n<b>[일자별]</b>\n${perDay.join("\n")}`;
  // 키워드 아래에 대표 기사·매체를 함께 (formatRanking이 맥락 줄까지 만들어 준다)
  const rankMsgs = formatRanking(list, items.length, 20, `주간 이슈 TOP 20`);
  for (const dest of destsFor("브리핑")) {
    await tg(BRIEF_TOKEN, "sendMessage", { ...dest, text: head, parse_mode: "HTML", disable_web_page_preview: true });
    for (const m of rankMsgs) {
      await tg(BRIEF_TOKEN, "sendMessage", { ...dest, text: m, parse_mode: "HTML", disable_web_page_preview: true });
      await new Promise(r => setTimeout(r, 400));
    }
  }
  console.log("📚 주간 누적 리포트 발송 완료");
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
  let lastOrdCheck = 0, lastEdCheck = 0;
  while (Date.now() < until) {
    try { await runOnce(); } catch (e) { console.error("폴링 오류:", e.message); }
    try { await checkSurge(); } catch (e) { console.error("급증 감지 오류:", e.message); }
    try { await runJeonIndex(); } catch (e) { console.error("전재수 색인 오류:", e.message); }
    // 신문 사설 확인 (55분 간격 — 다음날 지면 사설이 저녁부터 올라옴)
    if (Date.now() - lastEdCheck > 55 * 60 * 1000) {
      lastEdCheck = Date.now();
      try {
        const n = await checkEditorials(state, text => sendCat("사설", text));
        if (n) console.log(`✍️ 사설 ${n}건 발송`);
        saveState();
      } catch (e) { console.error("사설 확인 오류:", e.message); }
    }
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
      await pollCommands(TG_BOT_TOKEN, "tgOffset");                        // 속보봇: TOP 명령·버튼
      if (BRIEF_TOKEN !== TG_BOT_TOKEN) await pollCommands(BRIEF_TOKEN, "briefOffset"); // 브리핑봇: 버튼
      saveState();
      const left = waitEnd - Date.now();
      if (left <= 500) break;
      await new Promise(r2 => setTimeout(r2, Math.min(20000, left)));
    }
  }
  console.log("반복 종료");
} else {
  await runOnce();
}
