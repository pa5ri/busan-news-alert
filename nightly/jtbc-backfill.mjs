// 일회성: 2026-08-22 JTBC 뉴스룸 누락분 보충 — 프로그램 페이지를 「더보기」로 끝까지 펼쳐 목록을 TV 방에 보낸다.
// 실행 후 git rm. 환경변수: TG_BOT_TOKEN(야간봇), TG_CHAT_ID("그룹:스레드")
import puppeteer from "puppeteer";

const WANT = process.env.WANT_DATE || "08-22";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
const BACKOFF = [0, 5000, 15000, 30000, 45000, 60000];
let result = null, lastErr = null;
for (let attempt = 0; attempt < BACKOFF.length && !result; attempt++) {
  if (BACKOFF[attempt]) await new Promise(r => setTimeout(r, BACKOFF[attempt]));
  const p = await browser.newPage();
  try {
    await p.setUserAgent(UA);
    await p.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5" });
    await p.goto("https://news.jtbc.co.kr/program/NG10000002", { waitUntil: attempt === 0 ? "networkidle2" : "domcontentloaded", timeout: 60000 });
    // 목록이 실제로 그려질 때까지 대기 — 해외 러너는 빈 껍데기만 받고 networkidle이 끝나는 경우가 있다(2026-08-23: 0건 '성공')
    await p.waitForSelector('a[href*="/video/NB"]', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    for (let i = 0; i < 8; i++) {
      const more = await p.evaluate(() => { const b = [...document.querySelectorAll("button, a")].find(e => /더\s?보기/.test(e.textContent || "")); if (!b) return false; b.click(); return true; });
      if (!more) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    result = await p.evaluate(() => {
      const m = new Map();
      document.querySelectorAll('a[href*="/video/NB"]').forEach(a => {
        const t = (a.textContent || "").replace(/\s+/g, " ").trim();
        const id = (a.href.match(/(NB\d+)/) || [])[1];
        if (id && t.length > 8 && !m.has(id)) m.set(id, { title: t, url: `https://news.jtbc.co.kr/article/${id}` });
      });
      const dm = document.body.innerText.match(/(\d{1,2})월\s*(\d{1,2})일/);
      const as = [...document.querySelectorAll('a[href*="/video/NB"]')];
      const diag = { title: document.title, nbAnchors: as.length, firstAnchor: as[0] ? as[0].outerHTML.slice(0, 300) : "", textHead: document.body.innerText.replace(/\s+/g, " ").slice(0, 300) };
      return { items: [...m.values()], pageDate: dm ? `${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}` : "", diag };
    });
    console.log(`시도 ${attempt + 1} 성공: ${result.items.length}건, 페이지 날짜 ${result.pageDate}`);
    if (!result.items.length) { console.log("진단:", JSON.stringify(result.diag)); result = null; throw new Error("목록 0건 — 재시도"); }
  } catch (e) { lastErr = e; console.log(`시도 ${attempt + 1} 실패: ${e.message.slice(0, 80)}`); }
  finally { await p.close(); }
}
await browser.close();
if (!result) { console.error("최종 실패:", lastErr?.message); process.exit(1); }
if (!result.items.length) { console.error("목록 0건 — 빈 메시지를 보내지 않고 종료"); process.exit(2); }
if (result.pageDate !== WANT) { console.error(`페이지 최신 방송분이 '${result.pageDate}' — 대상 ${WANT}과 불일치, 발송 안 함`); process.exit(2); }

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const [chat, thread] = String(process.env.TG_CHAT_ID || "").split(",")[0].split(":");
const items = result.items.slice(0, 40);
const head = `📺 <b>JTBC 뉴스룸 ${Number(WANT.slice(0, 2))}/${Number(WANT.slice(3))} 보충</b> — 어젯밤 보고에서 접속 실패로 빠진 분 (${items.length}건)\n`;
const lines = items.map((it, i) => `${i + 1}. <a href="${it.url}">${esc(it.title.slice(0, 60))}</a>`);
const chunks = []; let cur = head;
for (const l of lines) { if ((cur + "\n" + l).length > 3800) { chunks.push(cur); cur = l; } else cur += "\n" + l; }
chunks.push(cur);
for (const text of chunks) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, ...(thread ? { message_thread_id: Number(thread) } : {}), text, parse_mode: "HTML", disable_web_page_preview: true }) });
  const j = await r.json(); if (!j.ok) { console.error("발송 실패:", JSON.stringify(j).slice(0, 200)); process.exit(3); }
  await new Promise(r => setTimeout(r, 3500));
}
console.log(`발송 완료: ${items.length}건, ${chunks.length}개 메시지`);
