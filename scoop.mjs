// ---- [단독] 논리 수집(2026-10-19, 1단계: 비용 0원·규칙 기반) ----
// 목적: 네이버에 송고된 전국 [단독] 기사를 전수로 훑어, 기사가 "무엇을 근거로(A) 어떤 논리로(B) 문제를 세웠는지"를 규칙으로 뽑고
//       부산 대입 가능성(C)을 붙여 저장한다. 국정감사 자료요구·정치 메시지·단독 후보 발굴용(설계안: 부산광역시/단독논리/설계안_20261019.md).
// 저장: scoop/YYYY-MM-DD.jsonl — 제목·링크·매체·A/B/C·의원·기관·근거 문장 발췌(200자). 리포가 공개라 **본문 전체는 저장하지 않는다**(링크로 재조회).
// 출처: 네이버 뉴스 검색 API(여론조사 패스와 같은 키), 검색어 '[단독]' 최신순 300건. 2시간 간격. 본문은 n.news.naver.com의 dic_area.
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const strip = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;|&#034;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;|&#39;/g, "'").replace(/\s+/g, " ").trim();
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const isScoopTitle = t => /^\s*([\[【]\s*단독[^\]】]*[\]】]|단독\s)/.test(String(t));   // [단독]·[단독 인터뷰]·[단독입수]·【단독】 (공개 봇 jhyun12345/naver-exclusive-news 와 같은 기준)
// 1차 제외: 연예·스포츠·홍보성 — 제목어 + 연예·스포츠 매체
const RE_ENT = /팬미팅|컴백|앨범|음원|드라마|예능|출연 확정|캐스팅|배우|가수|아이돌|걸그룹|보이그룹|열애|결혼설|화보|OST|예고편|뮤직비디오|콘서트|시구|이적|영입|감독 선임|FA|프로야구 .*계약|방송 출연|유튜버|BJ|웹툰/;
const ENT_PRESS = /osen|sportschosun|starnews|tenasia|xportsnews|mydaily|spotv|sports\.donga|sportsseoul|isplus|tvreport|joynews24|dispatch|singlelist|thepublic|newsen|topstarnews|stardailynews|mk\.co\.kr\/star|sports\.khan|sportsworldi|mbn.*star|ytn.*star|sedaily.*star|biz\.heraldcorp.*ent|sportalkorea|goal\.com|interfootball/i;

// A. 근거 출처
const A_RULES = [
  ["A1", "의원실 자료", /(의원|의원실)[^.]{0,60}(제출\s?받|받은|입수|확보|제출한|넘겨받)[^.]{0,20}(자료|문건|답변|현황)|(자료|문건)[^.]{0,20}에 따르면[^.]{0,30}(의원|의원실)/],
  ["A2", "정보공개·감사", /정보공개|감사원|감사 결과|감사보고서|감사에서|국민권익위[^.]{0,20}(조사|결과)/],
  ["A3", "내부 문건·공문", /(입수한|확보한|단독 입수)[^.]{0,30}(문건|문서|공문|보고서|회의록|답변서|서면|계획서|내부)|내부 (문건|문서|보고서|지침)|공문[^.]{0,20}(보낸|발송|확인)/],
  ["A4", "전수·통계", /전수\s?(조사|분석|확인)|전국 \d+[개곳]|\d+개 (기관|지자체|병원|학교|구장|시도)[^.]{0,20}(조사|분석|확인)|통계[^.]{0,15}(분석|따르면)/],
  ["A5", "현장·제보", /제보(자|에 따르면|를 받)|직접 (확인|찾아|가 보|방문)|현장 (확인|취재)|취재진이 (확인|찾)/],
  ["A6", "수사·사법", /(경찰|검찰|특검|공수처)[^.]{0,30}(수사|조사|입건|송치|기소|압수수색|영장)|구속영장|재판부/],
];
// B. 논리 구조
const B_RULES = [
  ["B1", "기준 부재", /기준(이|도|은|을)? (없|부재|전무)|평가 기준[^.]{0,10}없|지표[^.]{0,10}없|기준 없이|근거 없이/],
  ["B2", "미이행", /미조치|미이행|이행률|이행하지 않|지적(받|을 받)[^.]{0,30}(않|안 했|방치)|권고[^.]{0,20}(무시|미이행|따르지)|시정[^.]{0,10}않/],
  ["B3", "격차·비교", /(보다|비해) (늦|적|낮|높|많)|\d+년 ?\d*개월 (늦|늑장)|늑장|꼴찌|최하위|전국 평균[^.]{0,10}(밑|아래|못)|유일하게/],
  ["B4", "공백·0건", /(0명|0건|0곳|한 명도|한 곳도|전무|없는 것으로|아예 없|배치되지 않|두지 않|점검도 (안|하지)|한 번도)/],
  ["B5", "역효과", /오히려 (늘|증가|악화|더)|되레|역효과|거꾸로|효과 없|목표[^.]{0,10}(미달|못 미)/],
  ["B6", "숨김·축소", /은폐|숨기|축소|공개하지 않|비공개|알리지 않|누락|2차 가해|부적절한 (표현|서면|발언)/],
  ["B7", "특혜·수익", /특혜|수의계약|몰아주|수수료[^.]{0,20}(챙|수억|수십억)|리베이트|일감|셀프/],
  ["B8", "보안·안전 공백", /보안[^.]{0,10}(공백|구멍|허술|뚫)|안전[^.]{0,10}(공백|사각|허술)|자유 출입|무단 (출입|접근|반출|촬영)|출입[^.]{0,10}(통제|관리)[^.]{0,10}(없|안)/],
];
const RE_BUSAN = /부산|BNK|해운대|사직구장|북항|가덕|해작사|해군작전사|동래|사하|영도|기장|강서구청|부산대|부경대|동아대|부산항/;

/** 본문(네이버) → 규칙 추출. 본문은 돌려주지 않는다(저장 금지). */
export function extractLogic(txt) {
  const A = [], B = [];
  for (const [c, , re] of A_RULES) if (re.test(txt)) A.push(c);
  for (const [c, , re] of B_RULES) if (re.test(txt)) B.push(c);
  // 의원·기관(A1일 때): "○○당 ○○○ 의원(실)이 ○○부(청·공사)로부터 받은"
  let lawmaker = "", agency = "", party = "";
  // (10/23) 정당명이 이름 자리에 잡히던 문제(국민의힘·더불어민주당 → "국민의힘"·"어민주당") — 정당을 따로 떼고 이름은 2~3자로
  // 두 어순 모두: "국민의힘 서천호 의원실이" / "전진숙 더불어민주당 의원이". 정당 없는 "최 의원은"류는 2자 이상 + 앞 글자가 한글이 아닐 때만.
  const RE_PN = /(더불어민주당|민주당|국민의힘|조국혁신당|개혁신당|진보당|기본소득당|사회민주당|무소속)\s*(?:소속\s*)?([가-힣]{2,3})\s?의원/;
  const RE_NP = /(?<![가-힣])([가-힣]{2,3})\s(더불어민주당|민주당|국민의힘|조국혁신당|개혁신당|진보당|기본소득당|사회민주당|무소속)\s?의원/;
  const RE_N = /(?<![가-힣])([가-힣]{2,3})\s?의원(?:실)?(?:이|은|측|에게|의|실이|실은|실에)/;
  const NOT_NAME = /^(국회|소속|해당|같은|관련|당시|일부|여당|야당|여야|간사|위원|상임|국민|민주|정의|무소속|병|의)$/;
  const a = txt.match(RE_PN), b = txt.match(RE_NP);
  const pick = [a && { i: a.index, name: a[2], party: a[1] }, b && { i: b.index, name: b[1], party: b[2] }].filter(Boolean).sort((x, y) => x.i - y.i)[0];
  if (pick && !NOT_NAME.test(pick.name)) { lawmaker = pick.name; party = pick.party.replace(/^민주당$/, "더불어민주당"); }
  else { const c = txt.match(RE_N); if (c && !NOT_NAME.test(c[1])) lawmaker = c[1]; }
  const ag = txt.match(/([가-힣A-Za-z·]{2,20}(?:부|청|처|원|공사|공단|위원회|진흥원|재단|은행|거래소|공항|병원|법원|경찰청|교육청|시청|도청|구청|군청|센터|협회|연구원))(?:으로부터|로부터|에서|이|가)\s?(?:제출\s?받은|받은|제출한|제출받은|낸)/);
  if (ag) agency = ag[1];
  // 근거 문장: A 규칙 중 첫 매치가 든 문장(200자 한도)
  let quote = "";
  const sents = txt.split(/(?<=[.다])\s+(?=[가-힣"“'(\[])/);
  for (const [, , re] of A_RULES) { const s = sents.find(x => re.test(x)); if (s) { quote = s.trim().slice(0, 200); break; } }
  if (!quote) for (const [, , re] of B_RULES) { const s = sents.find(x => re.test(x)); if (s) { quote = s.trim().slice(0, 200); break; } }
  // (10/23) 지나가는 한 번(증시·전국 나열 기사)은 빼고 본문에 2회 이상일 때만 '부산 언급'
  const busan = (txt.match(new RegExp(RE_BUSAN.source, "g")) || []).length >= 2;
  return { A, B, lawmaker, party, agency, quote, busan };
}

async function naverBody(url) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
    if (!r.ok) return "";
    const html = await r.text();
    const body = (html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || "";
    const summary = (html.match(/<strong class="media_end_summary">([\s\S]*?)<\/strong>/) || [])[1] || "";
    return strip((summary + "\n" + body).replace(/<br\s*\/?>/g, "\n"));
  } catch { return ""; } finally { clearTimeout(to); }
}

const keyOf = it => (String(it.link || "").match(/article\/(\d+\/\d+)/) || [])[1] || strip(it.title).replace(/\s/g, "").slice(0, 30);

/**
 * 수집 패스: 검색 API 3페이지(300건) → 신규 [단독]만 본문 읽고 규칙 추출 → scoop/날짜.jsonl 에 기록.
 * @param {{naverH:object, state:object, pressInfo:(u:string)=>{name:string}, log?:(s:string)=>void}} ctx
 * @returns {{ seen:number, added:number, bodies:number }}
 */
export async function runScoopPass({ naverH, state, pressInfo, log = console.log }) {
  state.scoopSeen = Array.isArray(state.scoopSeen) ? state.scoopSeen : [];
  const seen = new Set(state.scoopSeen);
  const items = [];
  for (const start of [1, 101, 201]) {
    try {
      const r = await fetch(`https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent("[단독]")}&display=100&start=${start}&sort=date`, { headers: naverH });
      if (!r.ok) { log(`단독 검색 실패(${start}): ${r.status}`); break; }
      const j = await r.json(); items.push(...(j.items || []));
      if ((j.items || []).length < 100) break;
    } catch (e) { log(`단독 검색 오류: ${e.message}`); break; }
  }
  let added = 0, bodies = 0, skippedEnt = 0;
  const maxAge = (state.scoopInit ? 2 : 3) * 86400e3;
  for (const it of items.reverse()) {   // 오래된 것부터
    const title = strip(it.title);
    if (!isScoopTitle(title)) continue;
    const k = keyOf(it); if (seen.has(k)) continue;
    const age = Date.now() - new Date(it.pubDate).getTime(); if (age > maxAge) continue;
    seen.add(k); state.scoopSeen.push(k);
    const link = /n\.news\.naver\.com/.test(it.link || "") ? it.link : "";
    const { name } = pressInfo(it.originallink || it.link);
    if (RE_ENT.test(title) || ENT_PRESS.test(it.originallink || "")) { skippedEnt++; continue; }
    let txt = "";
    if (link) { txt = await naverBody(link); if (txt) bodies++; }
    const lg = extractLogic(txt || strip(it.description));
    const kst = new Date(new Date(it.pubDate).getTime() + 9 * 3600e3);
    const day = kst.toISOString().slice(0, 10);
    const rec = { t: title.replace(/^\s*([\[【]\s*단독[^\]】]*[\]】]|단독\s)\s*/, ""), src: name, link: link || it.originallink || it.link, pub: it.pubDate, A: lg.A, B: lg.B, busan: lg.busan, lawmaker: lg.lawmaker, party: lg.party, agency: lg.agency, quote: lg.quote, body: txt ? txt.length : 0 };
    if (!existsSync("scoop")) mkdirSync("scoop");
    appendFileSync(`scoop/${day}.jsonl`, JSON.stringify(rec) + "\n");
    added++;
  }
  state.scoopSeen = state.scoopSeen.slice(-6000);
  state.scoopInit = true;
  log(`📰 단독 수집: 검색 ${items.length}건 → 신규 ${added}건(본문 ${bodies}건, 연예·스포츠 제외 ${skippedEnt}건)`);
  return { seen: items.length, added, bodies };
}

const A_NAME = Object.fromEntries(A_RULES.map(([c, n]) => [c, n]));
const B_NAME = Object.fromEntries(B_RULES.map(([c, n]) => [c, n]));

/** 하루치 요약 메시지(HTML) — 의원실 자료(A1)·부산 언급 건을 앞세운다. 4096자 넘으면 나눈다. */
export function buildScoopDaily(day) {
  const f = `scoop/${day}.jsonl`;
  if (!existsSync(f)) return null;
  const rows = []; const seenT = new Set();
  for (const l of readFileSync(f, "utf8").split("\n")) { if (!l) continue; try { const r = JSON.parse(l); const k = r.t.replace(/\s/g, "").slice(0, 25); if (seenT.has(k)) continue; seenT.add(k); rows.push(r); } catch {} }
  if (!rows.length) return null;
  const logic = rows.filter(r => r.A.length || r.B.length);
  const a1 = rows.filter(r => r.A.includes("A1"));
  const bus = rows.filter(r => r.busan);
  const d = new Date(day + "T12:00:00+09:00"); const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const head = `🧩 <b>${day.slice(5, 7)}월 ${day.slice(8, 10)}일(${dow}) 전국 [단독] 논리 수집</b> — ${rows.length}건 · 논리 추출 ${logic.length}건 · 의원실 자료 ${a1.length}건 · 부산 언급 ${bus.length}건`;
  const line = r => {
    const tags = [...r.A.map(c => A_NAME[c] || c), ...r.B.map(c => B_NAME[c] || c)].slice(0, 3).join("·");
    const who = r.lawmaker ? ` <i>${esc(r.lawmaker)} 의원${r.agency ? "←" + esc(r.agency) : ""}</i>` : "";
    return `${r.busan ? "★ " : "· "}<a href="${r.link}">${esc(r.t.slice(0, 60))}</a> <code>${esc(r.src)}</code>${tags ? ` [${esc(tags)}]` : ""}${who}`;
  };
  const sections = [];
  if (bus.length) sections.push(`<b>[ 부산 언급 ]</b>\n` + bus.slice(0, 15).map(line).join("\n"));
  const a1Only = a1.filter(r => !r.busan);
  if (a1Only.length) sections.push(`<b>[ 의원실 자료 입수형 ]</b> — 자료요구 문안으로 바로 쓸 수 있는 것\n` + a1Only.slice(0, 25).map(line).join("\n"));
  const rest = logic.filter(r => !r.busan && !r.A.includes("A1"));
  if (rest.length) sections.push(`<b>[ 그 밖의 논리 후보 ]</b>\n` + rest.slice(0, 20).map(line).join("\n"));
  // B 유형 집계 한 줄
  const bc = {}; for (const r of rows) for (const c of r.B) bc[c] = (bc[c] || 0) + 1;
  const tail = Object.keys(bc).length ? `\n\n<i>논리 구조: ${Object.entries(bc).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${B_NAME[c]} ${n}`).join(" · ")}</i>` : "";
  const full = [head, ...sections].join("\n\n") + tail;
  // 분할
  const parts = []; let cur = "";
  for (const chunk of full.split("\n")) { if ((cur + "\n" + chunk).length > 4000) { parts.push(cur); cur = chunk; } else cur = cur ? cur + "\n" + chunk : chunk; }
  if (cur) parts.push(cur);
  return { parts, total: rows.length, logic: logic.length, a1: a1.length, busan: bus.length };
}
