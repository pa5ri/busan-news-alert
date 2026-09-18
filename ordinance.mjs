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

// HWP(구형 CFB)·HWPX(신형 ZIP) 공통 미리보기 텍스트 추출
async function hwpPreview(url) {
  try {
    const buf = await getBuf(url);
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
  const m = String(preview).match(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:\([^)]*\))?)\s*까지/);
  return m ? m[1].replace(/\s+/g, " ") : "";
}

// ── ① 입법예고 (gosiGbn=P, 조례안) ──
async function checkLawmaking(state, send) {
  const known = state.ordSno || 0;
  // 기준점을 만날 때까지 페이지를 넘긴다(1페이지 10건 — 회기 전 예고가 몰리면 2페이지로 밀린다, 2026-09-19)
  const posts = [];
  for (let page = 1; page <= 10; page++) {
    const html = await get(`https://council.busan.go.kr/council/lawmaking?page=${page}`);
    const rows = [...html.matchAll(/href="\/council\/lawmaking\/view\?sno=(\d+)&(?:amp;)?gosiGbn=([A-Z])[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ sno: Number(m[1]), gbn: m[2], title: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));
    if (!rows.length) break;
    for (const r of rows) if (!posts.some(x => x.sno === r.sno)) posts.push(r);
    if (!known || rows.every(r => r.sno <= known)) break;
  }
  // 회기 집회 공고(gosiGbn=A)는 의사일정 신호라 간단히 알린다(2026-09-19). 채용 공고 등 나머지 A는 제외.
  for (const p of posts.filter(p => p.gbn === "A" && p.sno > known && /집회\s?공고/.test(p.title)).sort((a, b) => a.sno - b.sno)) {
    await send(`🗓 <b>[부산시의회 집회 공고]</b>\n<b>${esc(p.title)}</b>\n\n🔗 https://council.busan.go.kr/council/lawmaking/view?sno=${p.sno}&gosiGbn=A`);
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
    const viewUrl = `https://council.busan.go.kr/council/lawmaking/view?sno=${p.sno}&gosiGbn=P`;
    let body = "", deadline = "";
    try {
      const detail = await get(viewUrl);
      const fm = detail.match(/href="(\/council\/lawmaking\/download\?[^"]+)"/);
      if (fm) {
        const prev = await hwpPreview("https://council.busan.go.kr" + fm[1].replace(/&amp;/g, "&"));
        body = sectionOf(prev);
        deadline = deadlineOf(prev);
      }
    } catch (e) { console.error("입법예고 상세 실패:", e.message); }
    const title = p.title.replace(/\s*입법예고\s*$/, "");
    const msg = [
      `📜 <b>[부산시의회 입법예고]</b>`,
      `<b>${esc(title)}</b>`,
      deadline ? `\n🗳 의견제출: ${esc(deadline)}까지` : "",
      body ? `\n${esc(body)}` : "",
      `\n🔗 ${viewUrl}`,
    ].filter(Boolean).join("\n");
    await send(msg);
    console.log(`📜 입법예고 발송: ${title.slice(0, 30)}`);
  }
}

// ── ② 의안접수 (의안정보시스템, 조례안만) ──
const BILL_MENU = "DOM_000000103008000000";
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
    let chunk = `📥 <b>[부산시의회 의안 일괄 접수] 총 ${fresh.length}건</b>\n(상세는 조례안·예산안·결의안 등만 이어서 발송, 동의안은 이 목록의 링크 참조)`, part = 1;
    for (const l of lines) {
      if (chunk.length + l.length > 3800) { await send(chunk); await new Promise(r => setTimeout(r, 3500)); chunk = `📥 <b>[의안 일괄 접수 — 계속 ${++part}]</b>`; }
      chunk += "\n" + l;
    }
    await send(chunk);
    console.log(`📥 의안 일괄 접수 요약 발송: ${fresh.length}건`);
    for (const b of fresh) if (kindOf(b.title) !== "동의안") queue.push(b);
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
    const viewUrl = viewOf(b.sid);
    try {
      await new Promise(r => setTimeout(r, 3500));
      const detail = await get(viewUrl);
      const body = stripHtml(detail);
      const pick = re => (body.match(re) || [])[1]?.trim() || "";
      const kind = pick(/의안종류\s*\n\s*([^\n]+)/);       // 조례안·동의안·결의안 등 전 종류
      const no = pick(/의안번호\s*\n\s*([^\n]+)/);
      const date = pick(/제안일자\s*\n\s*([^\n]+)/);
      let proposer = pick(/제안자\s*\n\s*([^\n]+)/);
      if (/^\(?\s*시\s*장\s*\)?$/.test(proposer)) proposer = "부산광역시장";
      const committee = pick(/소관위원회\s*:?\s*\n?\s*([^\n]+)/);
      // 세부내용 확보: ① 첨부(HWP/HWPX) 미리보기 → ② 페이지의 제안요지 필드 → ③ 원문 바로보기 안내
      let reason = "";
      const fm = detail.match(/href="(\/assem\/cms\/assem\/bill\/downloadfile\.busan\?[^"]+)"/);
      if (fm) reason = sectionOf(await hwpPreview("https://council.busan.go.kr" + fm[1].replace(/&amp;/g, "&")), 1600);
      if (!reason) {
        const jeji = pick(/제안요지\s*\n\s*([^\n]{10,})/);
        if (jeji) reason = jeji.slice(0, 1600);
      }
      let viewerNote = "";
      if (!reason) {
        const vm = detail.match(/href="(\/assem\/index\.busan\?contentsSid=\d+&(?:amp;)?filemask=[^"]+)"/);
        viewerNote = vm
          ? `📎 세부내용은 원문 참조: https://council.busan.go.kr${vm[1].replace(/&amp;/g, "&")}`
          : `📎 세부내용은 상세 페이지의 첨부 원문 참조`;
      }
      const lines = [
        `📥 <b>[부산시의회 의안접수${kind ? "·" + esc(kind) : ""}]</b>`,
        `<b>${esc(b.title)}</b>${no ? ` [의안번호 ${esc(no)}]` : ""}`,
        ``,
        `📅 ${esc(date || "-")}   👤 ${esc(proposer || "-")}`,
        committee ? `🏛 ${esc(committee)}` : "",
        reason ? `\n${esc(reason)}` : "",
        viewerNote ? `\n${viewerNote}` : "",
        `\n🔗 ${viewUrl}`,
      ].filter(l => l !== "").join("\n");
      await send(lines);
      console.log(`📥 의안접수 발송: ${b.title.slice(0, 30)}`);
    } catch (e) { console.error(`의안 ${b.sid} 처리 실패:`, e.message); queue.push(b); }   // 실패분은 큐 끝으로 — 다음 실행에서 재시도
  }
}

// sendLaw = 입법예고 봇, sendBill = 의안정보 봇 (분리 운영)
export async function checkOrdinances(state, sendLaw, sendBill) {
  try { await checkLawmaking(state, sendLaw); } catch (e) { console.error("입법예고 확인 실패:", e.message); }
  try { await checkBills(state, sendBill || sendLaw); } catch (e) { console.error("의안접수 확인 실패:", e.message); }
}
