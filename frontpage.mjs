// 조간 신문 모니터링 — 주요 일간지의 1면 머리기사와 사설 제목을 아침에 한 장으로.
// 출처: 네이버 '신문보기'(media.naver.com/press/<코드>/newspaper?date=YYYYMMDD) — 지면(면)별 기사 목록.
// 1면 블록의 첫 기사 = 머리기사(네이버가 지면 배치 순으로 준다), 사설 = 제목에 [사설]/<사설>/사설 말머리.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const PAPERS = [
  { code: "023", name: "조선일보" }, { code: "025", name: "중앙일보" }, { code: "020", name: "동아일보" },
  { code: "028", name: "한겨레" }, { code: "032", name: "경향신문" }, { code: "469", name: "한국일보" },
  { code: "082", name: "부산일보", local: true }, { code: "658", name: "국제신문", local: true },
];

const unesc = s => String(s).replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;|&#034;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&apos;|&#39;|&#039;/g, "'").replace(/\s+/g, " ").trim();
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const RE_ED = /^\s*[\[<〈(【]?\s*사설\s*[\]>〉)】]?\s*|\s*[\[<〈(【]\s*사설\s*[\]>〉)】]?\s*$/;   // 앞 말머리 또는 뒤 꼬리표(문화일보 「…[사설]」, 10/12)

// 지면 전체(면별 기사 목록)를 돌려준다. 다른 모듈(nightly 지면 탭)도 쓴다.
// ⚠ 네이버 신문보기는 아직 안 올라온 날짜를 요청하면 '직전 발행분'을 대신 내준다(2026-09-30 실측: 10/1 요청 → 9/30 지면).
//   기사 링크의 ?date= 값이 요청일과 같은 것만 인정해, 어제 신문을 오늘 자로 오인하지 않게 한다.
export async function fetchEdition(code, ymd) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 25000);
  let html;
  try {
    const r = await fetch(`https://media.naver.com/press/${code}/newspaper?date=${ymd}`, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    html = await r.text();
  } finally { clearTimeout(to); }
  return html.split(/<div class="newspaper_inner"/).slice(1).map(b => {
    const page = unesc((b.match(/page_notation[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "");
    const arts = [...b.matchAll(/<a([^>]*)href="(https:\/\/n\.news\.naver\.com\/article\/newspaper\/\d+\/\d+)\?date=(\d{8})[^"]*"[\s\S]*?<strong>([\s\S]*?)<\/strong>/g)]
      .filter(m => m[3] === ymd)
      .map(m => ({ url: m[2].replace("/article/newspaper/", "/article/"), title: unesc(m[4]), img: !/title_only/.test(m[1]) })).filter(a => a.title);   // img: 썸네일 기사 = 네이버가 둔 머리기사(10/15~17 8개지 실측: 1면에 정확히 1건)
    return { page, arts };
  }).filter(b => b.arts.length);
}


// ---- 중앙일보 토요일 보강(2026-10-17): 네이버 지면보기엔 중앙일보 토요일판이 없다(10/10·10/17 실측). 다른 모니터링 봇이 보여주는
// '중앙일보 토요일 1면·사설'은 중앙SUNDAY(토요일 웹 공개, N호 01면)와 중앙일보 주말 사설(자사 사설 목록)의 조합. 네이버가 비면 자사 사이트로 받는다.
async function jaGet(url, ms = 15000) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
  finally { clearTimeout(to); }
}
export async function fetchJoongangWeekend(ymd) {
  const dot = `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
  // ① 사설: 자사 사설 목록에서 그날 날짜 항목만
  const list = await jaGet("https://www.joongang.co.kr/opinion/editorial");
  const editorials = []; const seenT = new Set();
  for (const m of list.matchAll(/<li class="card"[\s\S]*?<\/li>/g)) {
    const b = m[0]; if (!b.includes(dot)) continue;
    const a = b.match(/<h2 class="headline">\s*<a href="(https:\/\/www\.joongang\.co\.kr\/article\/\d+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const title = unesc(a[2]).replace(RE_ED, "").trim();
    if (title && !seenT.has(title)) { seenT.add(title); editorials.push({ url: a[1], title }); }
  }
  // ② 1면: 최신 기사 사이트맵의 기사마다 '지면 정보'(epaper_layer)를 읽어 'N호 01면'(중앙SUNDAY) 또는 '종합 1면'을 모은다
  const sm = await jaGet("https://www.joongang.co.kr/sitemap/latest-articles");
  const urls = [...sm.matchAll(/<loc>(https:\/\/www\.joongang\.co\.kr\/article\/\d+)<\/loc>/g)].map(x => x[1]).slice(0, 200);
  const tagged = []; let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const h = await jaGet(u, 12000);
        const page = unesc((h.match(/id="epaper_layer"[\s\S]{0,300}?<p>([^<]+)<\/p>/) || [])[1] || "");
        const title = unesc((h.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || "").replace(/\s*\|\s*중앙일보$/, "");
        if (page && title) tagged.push({ url: u, title, page, order: urls.indexOf(u) });
      } catch { /* 기사 1건 실패는 무시 */ }
    }
  }));
  tagged.sort((a, b) => a.order - b.order);
  let note = "";
  let front = tagged.filter(t => /^종합\s*0?1면$/.test(t.page));                   // 일간지 1면이 있으면 우선
  if (!front.length) {
    const issues = tagged.map(t => (t.page.match(/^(\d+)호\s*0?1면$/) || [])[1]).filter(Boolean).map(Number);
    if (issues.length) { const cur = Math.max(...issues); front = tagged.filter(t => t.page.replace(/\s/g, "") === `${cur}호01면`); note = `중앙SUNDAY ${cur}호 1면`; }
  }
  front = front.filter(a => !/^\[(사진|알림|사고|공고|바로잡습니다)\]/.test(a.title) && !RE_ED.test(a.title));
  if (!front.length && !editorials.length) return null;
  return { pages: tagged.length ? 1 : 0, top: front[0] || null, front: front.slice(1, 4), editorials, note };
}

export async function fetchPaper(code, ymd) {
  const blocks = await fetchEdition(code, ymd);
  // 1면: 면 표기가 A1면·1면·01면 등 — 숫자가 1인 첫 블록. 못 찾으면 맨 앞 블록.
  const first = blocks.find(b => /^[A-Z]?0?1면$/.test(b.page.replace(/\s/g, ""))) || blocks[0];
  let front = first ? first.arts.filter(a => !RE_ED.test(a.title) && !/^\[(알림|사고|공고|바로잡습니다)\]/.test(a.title)) : [];
  const lead = front.find(a => a.img);   // 머리기사 = 이미지 기사(10/18). 네이버가 낮에 순서를 재편집해도 이미지 기사를 집는다. 없으면 첫 기사
  if (lead) front = [lead, ...front.filter(a => a !== lead)];
  const seen = new Set();
  const editorials = blocks.flatMap(b => b.arts).filter(a => RE_ED.test(a.title))
    .map(a => ({ ...a, title: a.title.replace(RE_ED, "").trim() }))
    .filter(a => a.title && !seen.has(a.title) && seen.add(a.title));
  if (!blocks.length && code === "025") { const w = await fetchJoongangWeekend(ymd); if (w) return w; }   // 토요일: 네이버에 중앙일보 지면 없음 → 자사(중앙SUNDAY 1면 + 주말 사설)
  return { pages: blocks.length, top: front[0] || null, front: front.slice(1, 4), editorials };
}

const CIRC = ["①", "②", "③", "④", "⑤"];
/** 조간 모니터링 메시지(HTML)와 매체별 수집 상태를 돌려준다. 발행이 없는 날(일요일·연휴)은 pages=0. */
export async function buildFrontpage(ymd) {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00+09:00`);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const results = [];
  for (const p of PAPERS) {
    let r = null, err = "";
    for (let i = 0; i < 3 && !r; i++) {
      try { r = await fetchPaper(p.code, ymd); } catch (e) { err = e.message; await new Promise(x => setTimeout(x, 3000)); }
    }
    results.push({ ...p, ...(r || { pages: 0, top: null, front: [], editorials: [] }), err: r ? "" : err });
  }
  const section = r => {
    const L = [`<b>[ ${r.name} ]</b>`];
    if (!r.top) { L.push(r.err ? `- 수집 실패(${esc(r.err)})` : "- 오늘 자 지면 없음"); return L.join("\n"); }
    L.push(`- 1면 : <a href="${r.top.url}">${esc(r.top.title)}</a>${r.note ? ` <i>(${esc(r.note)})</i>` : ""}`);
    if (r.local || r.note) for (const a of r.front.slice(0, 2)) L.push(`- 1면 : <a href="${a.url}">${esc(a.title)}</a>`);   // 부산 지역지·중앙SUNDAY(머리기사 순서 불명)는 1면 주요 기사 2건 더
    if (!r.editorials.length) L.push("- 사설 : (지면 목록에 없음)");
    r.editorials.slice(0, 5).forEach((a, i) => L.push(`- 사설 ${r.editorials.length > 1 ? CIRC[i] + " " : ""}: <a href="${a.url}">${esc(a.title)}</a>`));
    return L.join("\n");
  };
  const central = results.filter(r => !r.local), local = results.filter(r => r.local);
  const text = [
    `📰 <b>${ymd.slice(0, 4)}년 ${ymd.slice(4, 6)}월 ${ymd.slice(6, 8)}일(${dow}) 조간 신문 모니터링</b>`,
    ...central.map(section),
    `━━ 부산 지역지 ━━`,
    ...local.map(section),
  ].join("\n\n");
  return { text, results, published: results.filter(r => r.top).length };
}

// 단독 실행: node frontpage.mjs [YYYYMMDD]
if (process.argv[1] && process.argv[1].endsWith("frontpage.mjs")) {
  const ymd = process.argv[2] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  const { text, results } = await buildFrontpage(ymd);
  console.log(text.replace(/<a href="[^"]+">|<\/a>|<\/?b>/g, ""));
  console.log("\n", results.map(r => `${r.name}:${r.pages}면/사설${r.editorials.length}`).join("  "), "| 길이", text.length);
}

// ---- 부산 지면 전체(2026-10-01): 부산일보·국제신문의 그날 지면을 면별 전체 목록으로(1면부터 마지막 면까지, 제목마다 링크) ----
// 텔레그램 4096자 제한에 맞춰 여러 장으로 나눈다(면 경계에서 자름). 지면이 아직 없으면 null.
export const LOCAL_PAPERS = [{ code: "082", name: "부산일보" }, { code: "658", name: "국제신문" }];
// mentionKeys: 전재수 언급 기사의 네이버 기사 키("082/0001234567") 집합 — 제목에 이름이 없어도 본문 언급이면 강조한다(전재수 색인 기반).
// 강조(2026-10-05, 사용자 결정 C안): ① 맨 위에 언급 기사만 면 번호와 함께 모아 보여주고 ② 아래 면별 목록에서도 그 줄을 「★ 굵은 제목」으로. 링크는 모두 유지.
export async function buildEditionMessages(code, name, ymd, mentionKeys = new Set()) {
  const blocks = await fetchEdition(code, ymd);
  if (!blocks.length) return null;
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00+09:00`);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const total = blocks.reduce((s, b) => s + b.arts.length, 0);
  const keyOf = url => (String(url).match(/article\/(\d+\/\d+)/) || [])[1] || "";
  const isMention = a => /전재수/.test(a.title) || mentionKeys.has(keyOf(a.url));
  const picked = blocks.flatMap(b => b.arts.filter(isMention).map(a => ({ page: b.page, ...a })));
  let head = `📰 <b>${ymd.slice(4, 6)}월 ${ymd.slice(6, 8)}일(${dow}) ${name} 지면</b> — ${blocks.length}개 면 ${total}건`;
  if (picked.length) head += `\n\n★ <b>전재수 언급 ${picked.length}건</b>\n` + picked.map(a => `★ [${a.page}] <b><a href="${a.url}">${esc(a.title)}</a></b>`).join("\n") + `\n━━━━━━━━━━`;
  const line = a => isMention(a) ? `★ <b><a href="${a.url}">${esc(a.title)}</a></b>` : `· <a href="${a.url}">${esc(a.title)}</a>`;
  const sections = blocks.map(b => [`<b>[${b.page}]</b>`, ...b.arts.map(line)].join("\n"));
  const msgs = []; let cur = head, part = 1;
  for (const sec of sections) {
    if (cur.length + sec.length + 2 > 3900) { msgs.push(cur); cur = `📰 <b>${name} 지면 — 계속 ${++part}</b>`; }
    cur += "\n\n" + sec;
  }
  msgs.push(cur);
  return { msgs, pages: blocks.length, total, mentions: picked.length, picked };
}

// ---- 석간 신문 모니터링 (2026-10-12): 문화일보·내일신문의 1면 머리기사·사설, 조간과 같은 양식으로 「조간/석간 신문」 방에 ----
// 문화일보(021)는 네이버 신문보기(사설 표기가 제목 뒤 '[사설]'). 내일신문은 네이버 지면보기가 없어(086 → 404) 자사 홈을 읽는다:
//   1면 = 홈 메인 기사(section.main-news 첫 기사, 이미지 경로 paper/YYYY/MM/DD로 당일 자 검증), 사설 = /opinion/editorial 목록 중 당일 날짜 항목.
export const EVENING_PAPERS = [{ code: "021", name: "문화일보" }, { code: "naeil", name: "내일신문" }];

async function getText(url) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(to); }
}
export async function fetchNaeil(ymd) {
  const home = await getText("https://www.naeil.com/");
  const main = (home.match(/<section class="main-news">([\s\S]*?)<\/section>/) || [])[1] || "";
  const img = (main.match(/paper\/(\d{4})\/(\d{2})\/(\d{2})\//) || []);
  const edDate = img.length ? img[1] + img[2] + img[3] : "";
  const t = main.match(/<a href="(\/news\/read\/\d+)"[^>]*>\s*<img[^>]*alt="([^"]+)"/) || main.match(/<a href="(\/news\/read\/\d+)"[^>]*>([^<]{6,})<\/a>/);
  const top = (t && edDate === ymd) ? { url: "https://www.naeil.com" + t[1], title: unesc(t[2]) } : null;
  const ed = await getText("https://www.naeil.com/opinion/editorial");
  const want = `${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
  const editorials = [];
  for (const m of ed.matchAll(/<p class="date">([\d.]+)<\/p>\s*<p class="year">(\d{4})<\/p>[\s\S]*?<a href="(\/news\/read\/\d+)">([^<]+)<\/a>/g)) {
    if (m[1] !== want || m[2] !== ymd.slice(0, 4)) continue;
    const url = "https://www.naeil.com" + m[3];
    if (!editorials.some(e => e.url === url)) editorials.push({ url, title: unesc(m[4]).replace(/^\[사설\]\s*/, "") });
  }
  return { pages: top ? 1 : 0, top, front: [], editorials };
}
/** 석간 메시지(HTML). 발행이 없는 날(토·일·연휴)은 published=0 */
export async function buildEvening(ymd) {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00+09:00`);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const results = [];
  for (const p of EVENING_PAPERS) {
    let r = null, err = "";
    for (let i = 0; i < 3 && !r; i++) {
      try { r = p.code === "naeil" ? await fetchNaeil(ymd) : await fetchPaper(p.code, ymd); } catch (e) { err = e.message; await new Promise(x => setTimeout(x, 3000)); }
    }
    results.push({ ...p, ...(r || { pages: 0, top: null, front: [], editorials: [] }), err: r ? "" : err });
  }
  const section = r => {
    const L = [`<b>[ ${r.name} ]</b>`];
    if (!r.top) { L.push(r.err ? `- 수집 실패(${esc(r.err)})` : "- 오늘 자 지면 없음"); return L.join("\n"); }
    L.push(`- 1면 : <a href="${r.top.url}">${esc(r.top.title)}</a>`);
    if (!r.editorials.length) L.push("- 사설 : (목록에 없음)");
    r.editorials.slice(0, 5).forEach((a, i) => L.push(`- 사설 ${r.editorials.length > 1 ? CIRC[i] + " " : ""}: <a href="${a.url}">${esc(a.title)}</a>`));
    return L.join("\n");
  };
  const text = [`📰 <b>${ymd.slice(0, 4)}년 ${ymd.slice(4, 6)}월 ${ymd.slice(6, 8)}일(${dow}) 석간 신문 모니터링</b>`, ...results.map(section)].join("\n\n");
  return { text, results, published: results.filter(r => r.top).length };
}

// 전재수 언급 합본(2026-10-14): 매체별 지면 메시지는 그대로 두고, 두 매체의 ★ 언급 기사만 한 장으로 더 보낸다(사용자 요청).
// byPaper: { 매체명: [{page,title,url}] }
export function buildMentionDigest(ymd, byPaper, label = "전재수 언급 지면 기사", summary = "") {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00+09:00`);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const names = Object.keys(byPaper);
  const total = names.reduce((n, k) => n + byPaper[k].length, 0);
  const head = `★ <b>${ymd.slice(4, 6)}월 ${ymd.slice(6, 8)}일(${dow}) ${label}</b> — ${summary || names.map(k => `${k} ${byPaper[k].length}건`).join(" · ")}`;
  const parts = names.map(k => [`<b>[ ${k} ]</b>`, ...(byPaper[k].length ? byPaper[k].map(a => `★ [${a.page}] <a href="${a.url}">${esc(a.title)}</a>`) : ["· 언급 없음"])].join("\n"));
  return { text: [head, ...parts].join("\n\n"), total };
}

// ---- 전국 지면 전재수 언급(2026-10-15): 네이버 지면보기가 있는 매체 전부를 훑어 전재수 언급 기사만 합본 ----
// 10/14 실측: 지면보기 있는 26개지 중 부산 2개지 외 8개지에서 9건(서울신문·문화일보·매경·한경·머투·파이낸셜·이데일리·경기일보).
// 내일신문·중도일보 등 지면보기 없는 매체는 대상 밖. 판정은 제목에 이름 또는 전재수 색인(네이버 기사 번호) 대조 — 부산 지면과 같은 기준.
export const NATIONAL_PAPERS = [
  ["023", "조선일보"], ["025", "중앙일보"], ["020", "동아일보"], ["028", "한겨레"], ["032", "경향신문"], ["469", "한국일보"], ["081", "서울신문"], ["022", "세계일보"], ["005", "국민일보"],
  ["009", "매일경제"], ["015", "한국경제"], ["011", "서울경제"], ["016", "헤럴드경제"], ["277", "아시아경제"], ["008", "머니투데이"], ["014", "파이낸셜뉴스"], ["030", "전자신문"], ["029", "디지털타임스"], ["018", "이데일리"],
  ["088", "매일신문"], ["087", "강원일보"], ["310", "경인일보"], ["657", "대전일보"], ["666", "경기일보"], ["665", "충청투데이"], ["654", "강원도민일보"],
].map(([code, name]) => ({ code, name }));
export const EVENING_NATIONAL = [{ code: "021", name: "문화일보" }];   // 석간은 오후에 따로

/** 여러 매체의 지면에서 전재수 언급만 모은다 → { byPaper(언급 있는 매체만), total, withEdition, failed } */
export async function scanMentions(papers, ymd, mentionKeys) {
  const keyOf = url => (String(url).match(/article\/(\d+\/\d+)/) || [])[1] || "";
  const byPaper = {}; let total = 0, withEdition = 0; const failed = [];
  for (const p of papers) {
    let blocks = null;
    for (let i = 0; i < 2 && !blocks; i++) { try { blocks = await fetchEdition(p.code, ymd); } catch { await new Promise(r => setTimeout(r, 2000)); } }
    if (!blocks) { failed.push(p.name); continue; }
    if (blocks.length) withEdition++;
    const hits = blocks.flatMap(b => b.arts.filter(a => /전재수/.test(a.title) || mentionKeys.has(keyOf(a.url))).map(a => ({ page: b.page, ...a })));
    if (hits.length) { byPaper[p.name] = hits; total += hits.length; }
  }
  return { byPaper, total, withEdition, failed };
}
