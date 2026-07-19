// 부산 뉴스속보 알리미 — 네이버 뉴스 검색(제목에 '부산' 포함)을 폴링해 새 기사를 텔레그램으로 전송
// env: NAVER_ID, NAVER_SECRET (NAVER API HUB), TG_BOT_TOKEN, TG_CHAT_ID
// 상태: state.json (보낸 기사 키 목록) — 워크플로우가 커밋해 다음 실행에 이어짐
import { readFileSync, writeFileSync, existsSync } from "node:fs";

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
const firstRun = seen.size === 0;

// ---- 네이버 검색 ----
const naverH = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };
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
const fresh = [];
for (const [nt, grp] of groups) {
  const wirePick = grp.find(g => pressInfo(g.it.originallink || g.it.link).wire);
  const pick = wirePick || grp[0];
  for (const g of grp) seen.add(g.k);
  seenTitles.add(nt);
  fresh.push(pick.it);
}

// ---- 전송 ----
async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "HTML" }), // 미리보기 카드 유지
  });
  const jj = await res.json();
  if (!jj.ok) console.error("전송 실패:", JSON.stringify(jj).slice(0, 200));
  return jj.ok;
}

const toSend = firstRun ? fresh.slice(-FIRST_RUN_SEND) : fresh.slice(-MAX_PER_RUN);
console.log(`수집 ${items.length}건(제목 전매체+본문 주요매체) | 신규 ${fresh.length}건 | 전송 ${toSend.length}건${firstRun ? " (최초 실행: 최신 일부만)" : ""}`);

for (const it of toSend) {
  const { name } = pressInfo(it.originallink || it.link);
  const title = strip(it.title);
  const link = /n\.news\.naver\.com/.test(it.link || "") ? it.link : (it.originallink || it.link);
  const ctx = strip(it.description).slice(0, 300);
  const msg = `📰 <b>[${esc(name)}]</b> ${esc(title)}\n${link}\n\n…${esc(ctx)}…`;
  await send(msg);
  await new Promise(rr => setTimeout(rr, 400)); // 텔레그램 속도 제한 여유
}
if (!firstRun && fresh.length > MAX_PER_RUN)
  await send(`⚠ 이번 회차 신규 ${fresh.length}건 중 ${MAX_PER_RUN}건만 전송(폭주 방지). 나머지는 생략됨.`);

// ---- 상태 저장 ----
writeFileSync(STATE_FILE, JSON.stringify({
  seen: [...seen].slice(-STATE_CAP),
  titles: [...seenTitles].slice(-STATE_CAP),
  updated: new Date().toISOString(),
}));
console.log("상태 저장 완료");
