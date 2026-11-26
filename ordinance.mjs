// 부산시의회 조례안 모니터링 — 입법예고(제안이유 전문) + 의안접수(의안번호·제안자·소관위)
// HWP/HWPX 첨부의 내장 미리보기 텍스트에서 제안이유·주요내용을 추출한다.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const stripHtml = t => String(t)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function get(url) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ac.signal });
    return await r.text();
  } finally { clearTimeout(to); }
}
async function getBuf(url) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 90000);            // 의안 원문이 수 MB인 경우 대비
  try {
    const r = await fetch(encodeURI(url), { headers: { "User-Agent": UA }, signal: ac.signal });
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(to); }
}

// HWPX(신형, ZIP)의 Preview/PrvText.txt — 중앙 디렉터리를 읽어 꺼낸다(외부 모듈 없이 zlib만). 없으면 ""
function zipEntry(buf, want) {
  const zlib = globalThis.__zlib;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return "";
  let p = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < n && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString("utf8");
    if (name === want) {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.slice(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nl + el + cl;
  }
  return "";
}
// HWP(구형 CFB)·HWPX(신형 ZIP) 공통 미리보기 텍스트 추출. PDF·접근 거부(403, HTML 응답)는 "" — 호출부가 다음 첨부로 넘어간다.
async function hwpPreview(url) {
  try {
    // (11/22) 내려받기를 한 번 더 시도 — 11/11 기록에 'HWP 추출 실패: fetch failed' 2건, 그러면 요약 없는 카드가 나간다
    let buf; try { buf = await getBuf(url); } catch { await new Promise(r => setTimeout(r, 4000)); buf = await getBuf(url); }
    // (11/26) 형식 판별 — 10대 의회 의안 재게시 시험에서 요약 누락 42건 중 다수가 HWPX(ZIP)·PDF·403이었다
    if (buf.slice(0, 2).toString("latin1") === "PK") { globalThis.__zlib = globalThis.__zlib || await import("node:zlib"); return zipEntry(buf, "Preview/PrvText.txt").replace(/\r/g, "").trim(); }
    if (buf.readUInt32BE(0) !== 0xd0cf11e0) return "";   // PDF(%PDF)·HTML 오류 화면 등
    const mod = await import("cfb");
    const CFB = mod.default || mod;
    const c = CFB.read(buf, { type: "buffer" });
    let e = CFB.find(c, "Root Entry/Preview/PrvText.txt") || CFB.find(c, "Preview/PrvText.txt");
    if (e) return Buffer.from(e.content).toString("utf8").replace(/\r/g, "").trim();
    e = CFB.find(c, "Root Entry/PrvText") || CFB.find(c, "PrvText");
    if (e) return Buffer.from(e.content).toString("utf16le").replace(/\r/g, "").trim();
  } catch (e) { console.error("HWP 추출 실패:", e.message); }
  return "";
}

// 미리보기 텍스트에서 제안이유~주요내용 구간만
function sectionOf(preview, cap = 2200) {
  if (!preview) return "";
  let s = preview;
  const i = s.search(/제\s*안\s*이\s*유/);
  if (i >= 0) s = s.slice(i);
  const j = s.search(/\d?\.?\s*의\s*견\s*제\s*출/);
  if (j > 0) s = s.slice(0, j);
  s = s.replace(/\n\s*\d+\.\s*(제안이유|주요내용)/g, "\n\n$1")   // "3. 주요내용" → "주요내용"
       .replace(/^\s*\d+\.\s*(제안이유)/, "$1")
       .replace(/\n{3,}/g, "\n\n").trim();
  return s.length > cap ? s.slice(0, cap) + "…" : s;
}
function deadlineOf(preview) {
  // (11/22) 실제 공고문은 「2026. 11. 4.(수) 18:00까지」 꼴이다 — 예전 식(2026년 11월 4일까지)만 보다가 기한이 안 나오고 있었다
  const m = String(preview).match(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:\([^)]*\))?|\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*(?:\([^)]*\))?(?:\s*\d{1,2}:\d{2})?)\s*까지/);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

// ── ① 입법예고 (gosiGbn=P, 조례안) ──
async function checkLawmaking(state, send) {
  const known = state.ordSno || 0;
  // 기준점을 만날 때까지 페이지를 넘긴다(1페이지 10건 — 회기 전 예고가 몰리면 2페이지로 밀린다, 2026-09-19)
  const posts = [];
  for (let page = 1; page <= 10; page++) {
    // (11/26) 게시판의 쪽 번호는 curPage다 — page=만 주면 늘 1쪽이 와서, 한꺼번에 10건 넘게 올라온 날 나머지를 놓칠 수 있었다
    const html = await get(`https://council.busan.go.kr/council/lawmaking?curPage=${page}&page=1`);
    const rows = [...html.matchAll(/href="\/council\/lawmaking\/view\?sno=(\d+)&(?:amp;)?gosiGbn=([A-Z])[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ sno: Number(m[1]), gbn: m[2], title: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));
    if (!rows.length) break;
    for (const r of rows) if (!posts.some(x => x.sno === r.sno)) posts.push(r);
    if (!known || rows.every(r => r.sno <= known)) break;
  }
  // 회기 집회 공고(gosiGbn=A)는 의사일정 신호라 간단히 알린다(2026-09-19). 채용 공고 등 나머지 A는 제외.
  for (const p of posts.filter(p => p.gbn === "A" && p.sno > known && /집회\s?공고/.test(p.title)).sort((a, b) => a.sno - b.sno)) {
    await send(assemblyCard(p));
    console.log(`🗓 집회 공고 발송: ${p.title.slice(0, 30)}`);
  }
  const all = [...posts];
  posts.splice(0, posts.length, ...all.filter(p => p.gbn === "P" && /조례/.test(p.title)));
  if (known && all.length) state.ordSno = Math.max(known, ...all.map(p => p.sno));
  if (!posts.length) return;
  const fresh = posts.filter(p => p.sno > known).sort((a, b) => a.sno - b.sno);
  const firstRun = known === 0;
  const toSend = firstRun ? fresh.slice(-2) : fresh;   // 상한(5건)으로 자르면 기준점이 넘어가 나머지가 유실된다(2026-09-19)
  state.ordSno = Math.max(state.ordSno || 0, known, ...posts.map(p => p.sno));   // 위에서 집회 공고(A)까지 반영해 올린 기준점을 되돌리지 않는다
  for (const p of toSend) {
    const { card } = await buildLawCard(p);
    await send(card);   // (11/22) 의안과 같은 짧은 카드 + 해시태그
    console.log(`📜 입법예고 발송: ${p.title.slice(0, 30)}`);
  }
}
/** 입법예고 1건 → { card, date(공고일 YYYY-MM-DD 또는 "") } — 실시간 확인과 재게시(council-reissue.mjs)가 함께 쓴다 */
export async function buildLawCard(p) {
  const viewUrl = `https://council.busan.go.kr/council/lawmaking/view?sno=${p.sno}&gosiGbn=P`;
  let preview = "";
  try {
    const detail = await get(viewUrl);
    const fm = detail.match(/href="(\/council\/lawmaking\/download\?[^"]+)"/);
    if (fm) preview = await hwpPreview("https://council.busan.go.kr" + fm[1].replace(/&amp;/g, "&"));
  } catch (e) { console.error("입법예고 상세 실패:", e.message); }
  return { card: lawCard({ title: p.title, preview, viewUrl }), date: lawDate(preview) };
}
/** 집회 공고 카드 — 「제○○○회 부산광역시의회(정례회) 집회 공고」 */
export function assemblyCard(p) {
  const n = (String(p.title).match(/제\s*(\d+)\s*회/) || [])[1];
  return [`🗓 <b>부산시의회 집회 공고</b>`, `<a href="https://council.busan.go.kr/council/lawmaking/view?sno=${p.sno}&gosiGbn=A"><b>${esc(p.title)}</b></a>`, ``,
    esc(["#집회공고", n ? `#제${n}회` : "", /정례회/.test(p.title) ? "#정례회" : /임시회/.test(p.title) ? "#임시회" : ""].filter(Boolean).join(" "))].join("\n");
}
/** 입법예고 게시판 전체 목록(최신 → 과거). maxPages까지 */
export async function listLawmaking(maxPages = 60) {
  const posts = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await get(`https://council.busan.go.kr/council/lawmaking?curPage=${page}&page=1`);
    const rows = [...html.matchAll(/href="\/council\/lawmaking\/view\?sno=(\d+)&(?:amp;)?gosiGbn=([A-Z])[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ sno: Number(m[1]), gbn: m[2], title: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));
    const before = posts.length;
    for (const r of rows) if (!posts.some(x => x.sno === r.sno)) posts.push(r);
    if (!rows.length || posts.length === before) break;
  }
  return posts;
}

// ── 의안 카드(2026-11-22 사용자 요청): 국회 「오늘의 법률안」 봇처럼 짧게 + 해시태그(의원·지역구·위원회·주제)로 모아 보기 ──
// 비용 0원 규칙 기반: 첨부 원문(HWP 미리보기)의 발의의원·찬성 인원·제안이유(문제 → "이에 …" 목적)·주요내용에서 뽑는다.
const tag = s => "#" + String(s).replace(/[^0-9A-Za-z가-힣_]/g, "");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const fmtDate = d => { const m = String(d).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); if (!m) return String(d || "");
  const t = new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T12:00:00+09:00`); return `${m[1]}년 ${+m[2]}월 ${+m[3]}일(${DOW[t.getDay()]})`; };
/** 제목 → 주제 해시태그 1개: 기관명·조례 꼬리·흔한 꾸밈말을 떼고 붙여 쓴다(예: 「부산광역시교육청 학생 도박 예방교육 조례 일부개정조례안」 → #학생도박예방교육) */
export function topicTag(title) {
  let s = String(title).replace(/\s*입법예고\s*$/, "").replace(/^부산광역시(교육청|의회)?\s*/, "").replace(/\s*(일부개정|전부개정|폐지)?조례안?$/, "").replace(/\s*조례\s*(일부개정|전부개정|폐지)조례안$/, "")
    .replace(/\s*조례$/, "").trim();
  // 꼬리의 흔한 꾸밈말을 남지 않을 때까지 뗀다(「공영차고지 관리 및 운영」 → 공영차고지, 「주차장 설치 및 관리」 → 주차장)
  for (let i = 0; i < 6; i++) { const t = s.replace(/\s*(에\s*관한|[을를]\s*위한|등|및|의|설치|지정|운영|운용|관리|지원|육성|진흥|활성화|조성|촉진)$/, "").trim(); if (t === s || t.replace(/\s/g, "").length < 2) break; s = t; }
  if (!/조례/.test(title) || /결의안|건의안|동의안|예산안|계획안|변경안/.test(title)) return "";   // 조례안이 아닌 의안은 종류 태그로 충분(11/26: 「…출석요구의 건」·규칙안이 제목째 태그가 되던 것)
  const t = tag(s); return t.length >= 3 && t.length <= 22 ? t : "";
}
// 원문 한 줄 = 한 문단. 문장은 '…함/임/음/다/것' 뒤에서만 나눈다(날짜 속 마침표 「개정(2026. 3. 1.)」에서 자르지 않게). 표 조각(<…>)은 버린다.
const sentences = s => String(s).split(/\n+/).flatMap(line => line.replace(/\s+/g, " ").split(/(?<=(?:함|임|음|다|것)\.?)\s+(?=[가-힣「｢“"(○])/))
  .map(x => x.replace(/^\s*(○|❍|◦|●|□|■|[가-하]\.|\d+\.|▸|-)\s*/, "").trim()).filter(x => x.length >= 8 && !/[<>]/.test(x) && !/^\(?\s*단위\s*:/.test(x));
const cut = (s, n = 80) => { s = String(s).trim(); if (s.length <= n) return s; const c = s.slice(0, n); return c.slice(0, Math.max(c.lastIndexOf(" "), n - 12)) + "…"; };
/** 원문 미리보기 → { lead:대표발의 이름들, count:발의+찬성 인원, why:[문제, 목적] } */
export function readPreview(preview) {
  const p = String(preview || "");
  const flat = p.replace(/[<>]+/g, " ").replace(/\s+/g, " ");
  const lead = ((flat.match(/발의의원\s*:\s*([가-힣\s,]+?)\s*의원/) || [])[1] || "").split(/\s*,\s*/).map(x => x.replace(/\s/g, "")).filter(x => /^[가-힣]{2,4}$/.test(x));
  const count = Number((flat.match(/\((\d+)\s*명\)/) || [])[1] || 0);
  // 구간은 다음 번호 제목(「3. 주요내용」「4. 의견제출」 등) 앞까지
  const sec = (p.match(/(?:제\s*안|개\s*정)\s*이\s*유\s*\n([\s\S]*?)(?:\n\s*\d\.\s*[가-힣]|$)/) || [])[1] || "";
  const main = (p.match(/주\s*요\s*내\s*용\s*\n([\s\S]*?)(?:\n\s*\d\.\s*[가-힣]|$)/) || [])[1] || "";
  const ss = sentences(sec), ms = sentences(main);
  const purpose = ss.find((x, i) => i > 0 && /^(이에|따라서|이를 위해)/.test(x)) || ss[1] || ms[0] || "";
  return { lead, count, why: [ss[0] || "", purpose && purpose !== ss[0] ? purpose : ""].filter(Boolean).map(x => cut(x.replace(/^(이에|따라서)\s*/, ""))) };
}
/** 조례안이 아닌 의안의 종류 태그(11/26 사용자: 동의안·예산안도 해시태그로 따로 관리)
 *  동의안 → #동의안 + 갈래(#사무위탁 #업무협약 #출자출연 #공유재산 #채무부담 #임명동의) + 소관 실국(「관광콘텐츠산업국 소관」 → #관광콘텐츠산업국)
 *  예산 → #예산안 + #본예산/#추경/#기금운용계획, 결산 → #결산 · 교육청 것엔 #부산교육청 */
export function kindTags(title, kind = "") {
  const t = String(title), out = [];
  const edu = /교육청|교육비특별회계/.test(t) ? "#부산교육청" : "";
  if (/동의안/.test(t) || /동의안/.test(kind)) {
    out.push("#동의안");
    const sub = /위탁|대행/.test(t) ? "#사무위탁" : /업무협약|협약/.test(t) ? "#업무협약" : /출자|출연/.test(t) ? "#출자출연" : /공유재산|재산\s*(취득|처분|관리)/.test(t) ? "#공유재산"
      : /채무|보증|의무부담|지급보증/.test(t) ? "#채무부담" : /임명|위촉|선임|선출/.test(t) ? "#임명동의" : "";
    if (sub) out.push(sub);
    const dept = (t.match(/([가-힣]{2,12}(?:국|실|본부|단|청))\s*소관/) || [])[1];
    if (dept) out.push(tag(dept));
  } else if (/결산/.test(t) && !/예산안/.test(t)) out.push("#결산");
  else if (/예산안|기금운용계획|추가경정/.test(t)) {
    out.push("#예산안");
    out.push(/추가경정/.test(t) ? "#추경" : /기금운용계획/.test(t) ? "#기금운용계획" : "#본예산");
  }
  else if (/결의안/.test(t)) out.push("#결의안");
  else if (/건의안/.test(t)) out.push("#건의안");
  else if (/의견청취/.test(t)) out.push("#의견청취");
  else if (/계획안|변경안/.test(t)) out.push(/공유재산/.test(t) ? "#공유재산관리계획" : "#계획안");
  else if (/출석\s*요구/.test(t)) out.push("#출석요구");
  else if (/규칙안/.test(t)) out.push("#회의규칙");
  else if (/징계|윤리/.test(t)) out.push("#윤리징계");
  else if (/(선출|선임|위원\s*선임|위원회\s*구성)/.test(t)) out.push("#원구성");
  else if (kind && kind !== "기타") out.push(tag(kind));
  if (edu) out.push(edu);
  return out.join(" ");
}
/** 의안 1건(sid·title) → 카드 문자열 — 실시간 확인과 재게시(council-reissue.mjs)가 함께 쓴다 */
export async function buildBillCard(b) {
  const viewUrl = `https://council.busan.go.kr/assem/user/assem/bill/view.busan?menuCd=${BILL_MENU}&billSid=${b.sid}`;
  const detail = await get(viewUrl);
  const body = stripHtml(detail);
  const pick = re => (body.match(re) || [])[1]?.trim() || "";
  const kind = pick(/의안종류\s*\n\s*([^\n]+)/);       // 조례안·동의안·결의안 등 전 종류
  const no = pick(/의안번호\s*\n\s*([^\n]+)/);
  const date = pick(/제안일자\s*\n\s*([^\n]+)/);
  let proposer = pick(/제안자\s*\n\s*([^\n]+)/);
  if (/^\(?\s*시\s*장\s*\)?$/.test(proposer)) proposer = "부산광역시장";
  const committee = pick(/소관위원회\s*:?\s*\n?\s*([^\n]+)/);
  // (11/22) 짧은 카드 + 해시태그로 — 세부내용은 첨부 원문(HWP 미리보기) → 페이지의 제안요지 순. 제목을 누르면 상세 페이지.
  // (11/26) 첨부를 차례로 — 첫 파일이 PDF·403이면 다음(심사보고서 등)으로. 요약(제안이유)이 나오는 첫 파일을 쓴다.
  let preview = "";
  const files = [...detail.matchAll(/href="(\/assem\/cms\/assem\/bill\/downloadfile\.busan\?[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"))
    .sort((a, b) => /심사보고서/.test(a) - /심사보고서/.test(b));   // 원안을 먼저
  for (const f of files.slice(0, 4)) {
    const pv = await hwpPreview("https://council.busan.go.kr" + f);
    if (!pv) continue;
    if (!preview) preview = pv;
    if (readPreview(pv).why.length) { preview = pv; break; }
  }
  const jeji = pick(/제안요지\s*\n\s*([^\n]{10,})/);
  return billCard({ title: b.title, no, date, proposer, committee, kind, preview, jeji, viewUrl });
}
/** 의안 카드 문자열(HTML) */
export function billCard({ title, no, date, proposer, committee, kind, preview, jeji, viewUrl }) {
  const r = readPreview(preview);
  const p = String(proposer || "");
  const member = (p.match(/^\s*(?:\d+대\s*)?([가-힣]{2,4})\s*\(/) || p.match(/^\s*(?:\d+대\s*)?([가-힣]{2,4})\s*의원/) || [])[1];
  const gu = (p.match(/\(\s*([가-힣]+(?:구|군))\s*\d*/) || [])[1];
  let who;
  if (member) { const names = r.lead.length ? r.lead : [member]; who = names.map(n => tag(n + "의원")).join(" ") + (r.count > names.length ? ` 등 ${r.count}인` : ""); }
  else if (/시\s*장/.test(p)) who = `${tag("부산시장")} 제출`;
  else if (/교육감/.test(p)) who = `${tag("부산교육감")} 제출`;
  else who = p ? `${tag(p)} 제출` : "-";
  const kindTag = /일부개정조례안/.test(title) ? "#조례개정" : /전부개정조례안/.test(title) ? "#조례전부개정" : /폐지조례안/.test(title) ? "#조례폐지" : /조례안/.test(title) ? "#조례제정"
    : "";
  const tags = [topicTag(title), kindTag || kindTags(title, kind), gu ? tag(gu) : ""].filter(Boolean);
  const why = r.why.length ? r.why : jeji ? [cut(sentences(jeji)[0] || jeji)] : [];
  return [
    `📥 <b>부산시의회 의안접수</b>${kind ? ` · ${esc(kind)}` : ""}`,
    `<a href="${viewUrl}"><b>${esc(title)}</b></a>${no ? ` [${esc(no)}]` : ""}`,
    ``,
    `📅 <b>${esc(fmtDate(date) || "-")}</b>`,
    `👤 ${esc(who)}`,
    committee ? `🏛 ${esc(tag(committee.replace(/\s/g, "")))}` : "",
    ``,
    tags.length ? esc(tags.join(" ")) : "",
    ...why.map(w => `- ${esc(w)}`),
    why.length ? "" : `📎 세부내용은 원문 참조`,
  ].filter((l, i, a) => !(l === "" && (a[i - 1] === "" || i === a.length - 1))).join("\n").trim();
}

/** 입법예고 카드(11/22): 의안 카드와 같은 틀. 공고문엔 발의자가 없어 공고번호·공고일·의견제출 기한·담당 전문위원실(→ 소관위)로 채운다.
 *  주제 태그가 의안 카드와 같아(#공영차고지) 눌러 보면 입법예고 → 의안접수가 한 줄로 이어진다. */
/** 입법예고 공고일(YYYY-MM-DD). 원문 공고일 연도가 공고번호 연도(「공고 제2025-187호」)와 다르면 오타로 보고(73760: 공고일 2028년으로 적힘)
 *  의견제출 기한 날짜를 쓴다. 못 읽으면 "" */
export function lawDate(preview) {
  const p = String(preview || "");
  const noYear = (p.match(/공고\s*제\s*(\d{4})\s*-\s*\d+\s*호/) || [])[1];
  const d1 = p.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  const dl = deadlineOf(p).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  const iso = m => m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
  if (d1 && (!noYear || d1[1] === noYear)) return iso(d1);
  return iso(dl) || (noYear && d1 ? "" : iso(d1));
}
export function lawCard({ title, preview, viewUrl }) {
  const p = String(preview || "");
  const name = String(title).replace(/\s*입법예고\s*$/, "");
  const no = (p.match(/공고\s*제\s*(\d{4}\s*-\s*\d+)\s*호/) || [])[1]?.replace(/\s/g, "");
  const dm = lawDate(p).match(/(\d{4})-(\d{2})-(\d{2})/);
  const committee = (p.match(/부산광역시의회\s*([가-힣]+?)전문위원실/) || [])[1];
  const deadline = deadlineOf(p);
  const r = readPreview(p);
  const kindTag = /일부개정조례안/.test(name) ? "#조례개정" : /전부개정조례안/.test(name) ? "#조례전부개정" : /폐지조례안/.test(name) ? "#조례폐지" : "#조례제정";
  const tags = [topicTag(name), kindTag, "#입법예고"].filter(Boolean);
  return [
    `📜 <b>부산시의회 입법예고</b>`,
    `<a href="${viewUrl}"><b>${esc(name)}</b></a>${no ? ` [공고 ${esc(no)}]` : ""}`,
    ``,
    dm ? `📅 <b>${esc(fmtDate(`${dm[1]}-${dm[2]}-${dm[3]}`))}</b>${lawDate(p) === `${(p.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/) || []).slice(1).map((x, i) => i ? x.padStart(2, "0") : x).join("-")}` ? " 공고" : " (의견제출 기한)"}` : "",
    deadline ? `🗳 의견제출 ${esc(deadline)}까지` : "",
    committee ? `🏛 ${esc(tag(committee + "위원회"))}` : "",
    ``,
    esc(tags.join(" ")),
    ...r.why.map(w => `- ${esc(w)}`),
    r.why.length ? "" : `📎 세부내용은 원문 참조`,
  ].filter((l, i, a) => !(l === "" && (a[i - 1] === "" || i === a.length - 1))).join("\n").trim();
}

// ── ② 의안접수 (의안정보시스템, 조례안만) ──
export const BILL_MENU = "DOM_000000103008000000";
/** 의안 목록 전체(최신 → 과거): [{ sid, title, date:"YYYY.MM.DD" }] */
export async function listBills(maxPages = 80) {
  const bills = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const html = await get(`https://council.busan.go.kr/assem/index.busan?page=${page}&menuCd=${BILL_MENU}`);
    const rows = [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(r => r[0]).filter(r => /billSid=/.test(r));
    const before = bills.size;
    for (const r of rows) {
      const sid = Number((r.match(/billSid=(\d+)/) || [])[1]);
      const title = ((r.match(/<a title="([^"]+)"/) || [])[1] || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
      const date = (r.match(/(\d{4}\.\d{2}\.\d{2})/) || [])[1] || "";
      if (sid && !bills.has(sid)) bills.set(sid, { sid, title, date });
    }
    if (!rows.length || bills.size === before) break;
  }
  return [...bills.values()];
}
async function checkBills(state, send) {
  // ⚠ 2026-09-19: 회기 전 일괄 접수(8/14 하루 130건) 때 1페이지(12건)만 보고 8건만 보낸 뒤 기준점을 최신으로
  //   올려 버려 142건 중 111건이 유실됐다. → ① 기준점(known)을 만날 때까지 페이지를 넘기며 전부 모으고
  //   ② 한 번에 다 못 보낸 상세는 state.ordBillQueue에 남겨 다음 실행에서 이어 보낸다 ③ 12건 넘게 몰리면
  //   전체 목록을 '일괄 접수' 요약으로 먼저 보내고, 상세는 조례안·예산안·결의안 등(동의안 제외)만 보낸다.
  const known = state.ordBill || 0;
  const bills = [];
  for (let page = 1; page <= 30; page++) {
    const html = await get(`https://council.busan.go.kr/assem/index.busan?page=${page}&menuCd=${BILL_MENU}`);
    const rows = [...html.matchAll(/href="\/assem\/user\/assem\/bill\/view\.busan\?[^"]*billSid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ sid: Number(m[1]), title: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));
    if (!rows.length) break;
    for (const r of rows) if (!bills.some(x => x.sid === r.sid)) bills.push(r);
    if (!known || rows.every(r => r.sid <= known)) break;      // 기준점 이전만 남은 페이지면 종료(목록이 sid순이 아니라 페이지 전체로 판단)
  }
  if (!bills.length) return;
  const fresh = bills.filter(b => b.sid > known).sort((a, b) => a.sid - b.sid);
  state.ordBill = Math.max(known, ...bills.map(b => b.sid));
  const viewOf = sid => `https://council.busan.go.kr/assem/user/assem/bill/view.busan?menuCd=${BILL_MENU}&billSid=${sid}`;
  const kindOf = t => /조례안/.test(t) ? "조례안" : /예산안|결산|기금운용/.test(t) ? "예산·결산·기금" : /결의안|건의안/.test(t) ? "결의·건의안"
    : /동의안/.test(t) ? "동의안" : /의견청취/.test(t) ? "의견청취" : "기타";
  const queue = state.ordBillQueue = state.ordBillQueue || [];
  if (fresh.length > 12) {
    // 일괄 접수 요약: 종류별로 묶어 전부 나열(링크 포함), 4096자 제한에 맞춰 분할
    const groups = {};
    for (const b of fresh) (groups[kindOf(b.title)] = groups[kindOf(b.title)] || []).push(b);
    const lines = [];
    for (const k of ["조례안", "예산·결산·기금", "결의·건의안", "의견청취", "기타", "동의안"]) {
      if (!groups[k]) continue;
      lines.push(`\n<b>■ ${k} ${groups[k].length}건</b>`);
      for (const b of groups[k]) lines.push(`· <a href="${viewOf(b.sid)}">${esc(b.title)}</a>`);
    }
    let chunk = `📥 <b>[부산시의회 의안 일괄 접수] 총 ${fresh.length}건</b>\n(건별 카드는 이어서 차례로 발송)`, part = 1;
    for (const l of lines) {
      if (chunk.length + l.length > 3800) { await send(chunk); await new Promise(r => setTimeout(r, 3500)); chunk = `📥 <b>[의안 일괄 접수 — 계속 ${++part}]</b>`; }
      chunk += "\n" + l;
    }
    await send(chunk);
    console.log(`📥 의안 일괄 접수 요약 발송: ${fresh.length}건`);
    for (const b of fresh) queue.push(b);   // (11/26) 동의안도 카드로 — #동의안·#사무위탁 등 해시태그로 따로 모아 본다(사용자)
  } else {
    for (const b of fresh) queue.push(b);
  }
  // 전용봇 첫 가동 시 최근 2건을 형식 샘플로 발송
  if (!state.ordBillSampled) {
    state.ordBillSampled = true;
    if (!queue.length) queue.push(...bills.sort((a, b) => b.sid - a.sid).slice(0, 2).reverse());
  }
  // 상세는 실행당 최대 20건(텔레그램 그룹 분당 20건 한도 — 3.5초 간격), 나머지는 큐에 남겨 다음 실행에서
  const targets = queue.splice(0, 20);
  for (const b of targets) {
    try {
      await new Promise(r => setTimeout(r, 3500));
      await send(await buildBillCard(b));
      console.log(`📥 의안접수 발송: ${b.title.slice(0, 30)}`);
    } catch (e) { console.error(`의안 ${b.sid} 처리 실패:`, e.message); queue.push(b); }   // 실패분은 큐 끝으로 — 다음 실행에서 재시도
  }
}

// sendLaw = 입법예고 봇, sendBill = 의안정보 봇 (분리 운영)
export async function checkOrdinances(state, sendLaw, sendBill) {
  // 성공 여부를 돌려준다 — 호출부가 연속 실패(서버 차단 재발)를 감지해 경보를 낼 수 있게(2026-09-19)
  let ok = true;
  try { await checkLawmaking(state, sendLaw); } catch (e) { ok = false; console.error("입법예고 확인 실패:", e.message); }
  try { await checkBills(state, sendBill || sendLaw); } catch (e) { ok = false; console.error("의안접수 확인 실패:", e.message); }
  return ok;
}
