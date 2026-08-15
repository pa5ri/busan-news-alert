// 일회성: 부산일보·국제신문 지면 스크랩만 검증 (텔레그램 발송 없음). 실행 후 git rm.
import puppeteer from "puppeteer";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const kst = d => new Date(d.getTime() + 9 * 3600e3);
const ymd = d => kst(d).toISOString().slice(0, 10).replace(/-/g, "");
const now = new Date();
const D = ymd(now), D_PREV = ymd(new Date(now.getTime() - 864e5)), D_NEXT = ymd(new Date(now.getTime() + 864e5));

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--ignore-certificate-errors"] });
async function withPage(url, fn, wait = 1500) {
  const urls = Array.isArray(url) ? url : [url];
  const BACKOFF = [0, 3000, 8000, 15000];
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (BACKOFF[attempt]) await new Promise(r => setTimeout(r, BACKOFF[attempt]));
    const p = await browser.newPage();
    try {
      await p.setUserAgent(UA);
      await p.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5" });
      await p.goto(urls[attempt % urls.length], { waitUntil: attempt === 0 ? "networkidle2" : "domcontentloaded", timeout: 60000 });
      await new Promise(r => setTimeout(r, attempt === 0 ? wait : wait + 2000));
      const out = await fn(p);
      console.log(`  (시도 ${attempt + 1}회차 성공: ${urls[attempt % urls.length]})`);
      return out;
    } catch (e) { lastErr = e; console.log(`  (시도 ${attempt + 1} 실패: ${e.message.slice(0, 80)})`); }
    finally { await p.close(); }
  }
  throw lastErr;
}

const paperPick = {
  kookje: (okDates) => {
    const m = new Map();
    document.querySelectorAll('a[href*="newsbody.asp"]').forEach(a => {
      const t = (a.textContent||'').replace(/\s+/g,' ').trim();
      const key = (a.href.match(/key=([\d.]+)/)||[])[1];
      if (!key || !okDates.includes(key.slice(0,8))) return;
      if (t.length > 8 && !m.has(key)) m.set(key, { title: t, url: a.href });
    });
    return [...m.values()];
  },
  busanilbo: (okDates) => {
    const m = new Map();
    document.querySelectorAll('a[href*="view.php?code="]').forEach(a => {
      const t = (a.textContent||'').replace(/\s+/g,' ').trim();
      const code = (a.href.match(/code=(\d+)/)||[])[1];
      if (!code || !okDates.includes(code.slice(0,8))) return;
      if (t.length > 8 && !m.has(code)) m.set(code, { title: t, url: `https://www.busan.com/view/busan/view.php?code=${code}` });
    });
    return [...m.values()];
  },
};

try {
  console.log("국제신문:");
  const k = await withPage(["https://www.kookje.co.kr/", "http://www.kookje.co.kr/"], p => p.evaluate(`(${paperPick.kookje.toString()})(${JSON.stringify([D, D_NEXT])})`));
  console.log(`  → ${k.length}건`, k.slice(0, 3).map(x => x.title.slice(0, 30)));
} catch (e) { console.log("  국제신문 최종 실패:", e.message); }
try {
  console.log("부산일보:");
  const b = await withPage(["https://www.busan.com/", "https://busan.com/"], p => p.evaluate(`(${paperPick.busanilbo.toString()})(${JSON.stringify([D_PREV, D])})`));
  console.log(`  → ${b.length}건`, b.slice(0, 3).map(x => x.title.slice(0, 30)));
} catch (e) { console.log("  부산일보 최종 실패:", e.message); }
await browser.close();
