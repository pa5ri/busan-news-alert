// JTBC 뉴스룸 목록 수집 — 로컬 PC(한국 IP) 전용.
// 해외(GitHub 러너)에서는 프로그램 페이지가 「공지사항」으로 리다이렉트돼(2026-08-23 확인) 목록을 받을 수 없다.
// 이 스크립트가 매일 21:40에 목록을 읽어 nightly/jtbc-latest.json 으로 커밋·푸시하면, 밤 10시 보고가 그 파일을 우선 사용한다.
// 실행: node local/jtbc-local.mjs  (작업 스케줄러 「부산JTBC수집」가 local/jtbc-run.vbs로 호출)
import puppeteer from "puppeteer-core";
import { writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "nightly", "jtbc-latest.json");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p => existsSync(p));
if (!CHROME) { console.error("브라우저 실행파일을 찾을 수 없음"); process.exit(1); }
const log = (...a) => console.log(`[${new Date().toLocaleString("ko-KR")}]`, ...a);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
let result = null, lastErr = null;
for (let attempt = 0; attempt < 3 && !result; attempt++) {
  if (attempt) await new Promise(r => setTimeout(r, 10000));
  const p = await browser.newPage();
  try {
    await p.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36");
    await p.setViewport({ width: 1366, height: 900 });   // 좁은 화면이면 모바일 레이아웃 → 엉뚱한 "더보기" 링크가 먼저 잡힌다
    await p.goto("https://news.jtbc.co.kr/program/NG10000002", { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector('a[href*="/video/NB"]', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    const pageUrl = p.url();
    for (let i = 0; i < 8; i++) {                      // 목록의 「더보기」 <button>만(마지막 것) 눌러 전체 펼치기
      const before = await p.evaluate(() => document.querySelectorAll('a[href*="/video/NB"]').length);
      const clicked = await p.evaluate(() => { const bs = [...document.querySelectorAll("button")].filter(e => /^더\s?보기$/.test((e.textContent || "").trim())); if (!bs.length) return false; bs[bs.length - 1].click(); return true; });
      if (!clicked) break;
      await new Promise(r => setTimeout(r, 1500));
      if (p.url() !== pageUrl) { log("더보기 클릭이 페이지 이동을 일으켜 중단:", p.url()); await p.goBack().catch(() => {}); break; }
      const after = await p.evaluate(() => document.querySelectorAll('a[href*="/video/NB"]').length);
      if (after <= before) break;
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
      const diag = { title: document.title, nbAnchors: as.length, first: as[0] ? as[0].outerHTML.slice(0, 240) : "", text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) };
      return { items: [...m.values()], pageDate: dm ? `${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}` : "", diag };
    });
    if (!result.items.length) { log("진단:", JSON.stringify(result.diag)); result = null; throw new Error("목록 0건"); }
  } catch (e) { lastErr = e; log(`시도 ${attempt + 1} 실패:`, e.message.slice(0, 100)); }
  finally { await p.close(); }
}
await browser.close();
if (!result) { log("최종 실패:", lastErr?.message); process.exit(1); }

const year = new Date().getFullYear();
const out = { date: `${year}-${result.pageDate}`, fetchedAt: new Date().toISOString(), source: "local-pc", items: result.items };
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
log(`수집 ${result.items.length}건 (방송일 ${out.date}) → nightly/jtbc-latest.json`);

// 리포에 반영 — 밤 10시 보고(Actions)가 읽는다. 실패해도 파일은 남으므로 다음 실행 때 함께 올라간다.
try {
  const git = cmd => execSync(`git ${cmd}`, { cwd: ROOT, stdio: "pipe" }).toString().trim();
  git("add nightly/jtbc-latest.json");
  let changed = true;
  try { git("diff --cached --quiet"); changed = false; } catch { changed = true; }   // exit 1 = 변경 있음
  if (changed) git(`commit -q -m "JTBC 뉴스룸 ${out.date} 목록 (로컬 수집 ${result.items.length}건) [skip ci]"`);
  else log("커밋할 변경 없음");
  git("pull --rebase -X theirs origin main -q");
  git("push origin main -q");
  log("푸시 완료");
} catch (e) { log("git 반영 실패:", String(e.message || e).slice(0, 200)); process.exit(1); }
