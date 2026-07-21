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
  const to = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ac.signal });
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
  const html = await get("https://council.busan.go.kr/council/lawmaking");
  const posts = [...html.matchAll(/href="\/council\/lawmaking\/view\?sno=(\d+)&(?:amp;)?gosiGbn=P[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ sno: Number(m[1]), title: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }))
    .filter(p => /조례/.test(p.title));
  if (!posts.length) return;
  const known = state.ordSno || 0;
  const fresh = posts.filter(p => p.sno > known).sort((a, b) => a.sno - b.sno);
  const firstRun = known === 0;
  const toSend = firstRun ? fresh.slice(-2) : fresh.slice(0, 5);
  state.ordSno = Math.max(known, ...posts.map(p => p.sno));
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
  const html = await get(`http://council.busan.go.kr/assem/index.busan?menuCd=${BILL_MENU}`);
  const bills = [...html.matchAll(/href="\/assem\/user\/assem\/bill\/view\.busan\?[^"]*billSid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ sid: Number(m[1]), title: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));
  if (!bills.length) return;
  const known = state.ordBill || 0;
  const firstRun = known === 0;
  const fresh = bills.filter(b => b.sid > known).sort((a, b) => a.sid - b.sid);
  state.ordBill = Math.max(known, ...bills.map(b => b.sid));
  if (firstRun) return;                                     // 최초엔 기준점만 설정
  for (const b of fresh.slice(0, 8)) {
    const viewUrl = `http://council.busan.go.kr/assem/user/assem/bill/view.busan?menuCd=${BILL_MENU}&billSid=${b.sid}`;
    try {
      const detail = await get(viewUrl);
      const body = stripHtml(detail);
      const pick = re => (body.match(re) || [])[1]?.trim() || "";
      const kind = pick(/의안종류\s*\n\s*([^\n]+)/);
      if (!/조례/.test(kind)) continue;                     // 조례안만
      const no = pick(/의안번호\s*\n\s*([^\n]+)/);
      const date = pick(/제안일자\s*\n\s*([^\n]+)/);
      const proposer = pick(/제안자\s*\n\s*([^\n]+)/);
      const committee = pick(/소관위원회\s*:?\s*\n?\s*([^\n]+)/);
      // 원문 첨부에서 제안이유 추출
      let reason = "";
      const fm = detail.match(/href="(\/assem\/cms\/assem\/bill\/downloadfile\.busan\?[^"]+)"/);
      if (fm) reason = sectionOf(await hwpPreview("http://council.busan.go.kr" + fm[1].replace(/&amp;/g, "&")), 1600);
      const lines = [
        `📥 <b>[부산시의회 의안접수]</b>`,
        `<b>${esc(b.title)}</b>${no ? ` [${esc(no)}]` : ""}`,
        ``,
        `📅 ${esc(date || "-")}   👤 ${esc(proposer || "-")}`,
        committee ? `🏛 ${esc(committee)}` : "",
        reason ? `\n${esc(reason)}` : "",
        `\n🔗 ${viewUrl}`,
      ].filter(l => l !== "").join("\n");
      await send(lines);
      console.log(`📥 의안접수 발송: ${b.title.slice(0, 30)}`);
    } catch (e) { console.error(`의안 ${b.sid} 처리 실패:`, e.message); }
  }
}

export async function checkOrdinances(state, send) {
  try { await checkLawmaking(state, send); } catch (e) { console.error("입법예고 확인 실패:", e.message); }
  try { await checkBills(state, send); } catch (e) { console.error("의안접수 확인 실패:", e.message); }
}
