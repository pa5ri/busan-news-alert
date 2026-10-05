// 조간 신문 모니터링 — 주요 일간지의 1면 머리기사와 사설 제목을 아침에 한 장으로.
// 출처: 네이버 '신문보기'(media.naver.com/press/<코드>/newspaper?date=YYYYMMDD) — 지면(면)별 기사 목록.
// 1면 블록의 첫 기사 = 머리기사(네이버가 지면 배치 순으로 준다), 사설 = 제목에 [사설]/<사설>/사설 말머리.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const PAPERS = [
  { code: "023", name: "조선일보" }, { code: "025", name: "중앙일보" }, { code: "020", name: "동아일보" },
  { code: "028", name: "한겨레" }, { code: "032", name: "경향신문" }, { code: "469", name: "한국일보" },
  { code: "082", name: "부산일보", local: true }, { code: "658", name: "국제신문", local: true },
];

const unesc = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;|&#034;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&apos;|&#39;|&#039;/g, "'").replace(/\s+/g, " ").trim();
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const RE_ED = /^\s*[\[<〈(【]?\s*사설\s*[\]>〉)】]?\s*/;

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
    const arts = [...b.matchAll(/<a[^>]*href="(https:\/\/n\.news\.naver\.com\/article\/newspaper\/\d+\/\d+)\?date=(\d{8})[^"]*"[\s\S]*?<strong>([\s\S]*?)<\/strong>/g)]
      .filter(m => m[2] === ymd)
      .map(m => ({ url: m[1].replace("/article/newspaper/", "/article/"), title: unesc(m[3]) })).filter(a => a.title);
    return { page, arts };
  }).filter(b => b.arts.length);
}

export async function fetchPaper(code, ymd) {
  const blocks = await fetchEdition(code, ymd);
  // 1면: 면 표기가 A1면·1면·01면 등 — 숫자가 1인 첫 블록. 못 찾으면 맨 앞 블록.
  const first = blocks.find(b => /^[A-Z]?0?1면$/.test(b.page.replace(/\s/g, ""))) || blocks[0];
  const front = first ? first.arts.filter(a => !RE_ED.test(a.title) && !/^\[(알림|사고|공고|바로잡습니다)\]/.test(a.title)) : [];
  const seen = new Set();
  const editorials = blocks.flatMap(b => b.arts).filter(a => RE_ED.test(a.title))
    .map(a => ({ ...a, title: a.title.replace(RE_ED, "").trim() }))
    .filter(a => a.title && !seen.has(a.title) && seen.add(a.title));
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
    L.push(`- 1면 : <a href="${r.top.url}">${esc(r.top.title)}</a>`);
    if (r.local) for (const a of r.front.slice(0, 2)) L.push(`- 1면 : <a href="${a.url}">${esc(a.title)}</a>`);   // 부산 지역지는 1면 주요 기사 2건 더
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
// 강조 표기: 「★ 굵은 제목」 + 머리말에 건수. 링크는 그대로 유지.
export async function buildEditionMessages(code, name, ymd, mentionKeys = new Set()) {
  const blocks = await fetchEdition(code, ymd);
  if (!blocks.length) return null;
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00+09:00`);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const total = blocks.reduce((s, b) => s + b.arts.length, 0);
  const keyOf = url => (String(url).match(/article\/(\d+\/\d+)/) || [])[1] || "";
  const isMention = a => /전재수/.test(a.title) || mentionKeys.has(keyOf(a.url));
  const mentions = blocks.reduce((s, b) => s + b.arts.filter(isMention).length, 0);
  const head = `📰 <b>${ymd.slice(4, 6)}월 ${ymd.slice(6, 8)}일(${dow}) ${name} 지면</b> — ${blocks.length}개 면 ${total}건`
    + (mentions ? `\n★ <b>전재수 언급 ${mentions}건</b> (굵게 표시)` : "");
  const line = a => isMention(a) ? `★ <b><a href="${a.url}">${esc(a.title)}</a></b>` : `· <a href="${a.url}">${esc(a.title)}</a>`;
  const sections = blocks.map(b => [`<b>[${b.page}]</b>`, ...b.arts.map(line)].join("\n"));
  const msgs = []; let cur = head, part = 1;
  for (const sec of sections) {
    if (cur.length + sec.length + 2 > 3900) { msgs.push(cur); cur = `📰 <b>${name} 지면 — 계속 ${++part}</b>`; }
    cur += "\n\n" + sec;
  }
  msgs.push(cur);
  return { msgs, pages: blocks.length, total, mentions };
}
