// [단독] 논리 DB — 로컬 PC 비공개 본문 저장(2026-10-19).
// 클라우드 루프(scoop.mjs)는 공개 리포에 제목·링크·규칙 추출만 남긴다. 이 스크립트가 그 목록을 받아 네이버 본문 전문을
// 읽어 **리포 밖** 비공개 폴더(부산광역시/단독논리/db/YYYY-MM-DD.jsonl)에 쌓는다. PC가 꺼져 있던 날은 다음 실행 때 최근 14일을 소급한다.
// 실행: node local/scoop-db.mjs   (작업 스케줄러 「부산단독DB」가 local/scoop-run.vbs로 매일 08:30 호출)
import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");          // 부산알리미
const DB = resolve(ROOT, "..", "단독논리", "db");                              // 비공개 저장소(리포 밖)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const log = (...a) => console.log(`[${new Date().toLocaleString("ko-KR")}]`, ...a);
const strip = s => String(s).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;|&#034;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

// 1) 클라우드가 쌓은 목록 받기
try { execSync("git pull --rebase -q origin main", { cwd: ROOT, stdio: "ignore", timeout: 120000 }); } catch (e) { log("git pull 실패(계속 진행):", e.message); }

if (!existsSync(DB)) mkdirSync(DB, { recursive: true });
const idxFile = resolve(DB, "index.json");
const idx = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, "utf8")) : {};   // key → 날짜

async function body(url) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
    if (!r.ok) return "";
    const html = await r.text();
    const art = (html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || "";
    const summary = (html.match(/<strong class="media_end_summary">([\s\S]*?)<\/strong>/) || [])[1] || "";
    const title = (html.match(/<h2[^>]*id="title_area"[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "";
    const when = (html.match(/data-date-time="([^"]+)"/) || [])[1] || "";
    return { title: strip(title), when, text: strip((summary ? summary + "\n" : "") + art) };
  } catch { return ""; } finally { clearTimeout(to); }
}

const since = Date.now() - 14 * 86400e3;
const days = existsSync(resolve(ROOT, "scoop")) ? readdirSync(resolve(ROOT, "scoop")).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map(f => f.slice(0, 10)).filter(d => new Date(d + "T00:00:00+09:00").getTime() >= since).sort() : [];
let added = 0, failed = 0, skipped = 0;
for (const d of days) {
  for (const l of readFileSync(resolve(ROOT, "scoop", `${d}.jsonl`), "utf8").split("\n")) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const key = (String(r.link).match(/article\/(\d+\/\d+)/) || [])[1] || r.link;
    if (idx[key]) { skipped++; continue; }
    if (!/n\.news\.naver\.com/.test(r.link)) { idx[key] = d; continue; }   // 네이버 본문 없는 건은 목록만
    const b = await body(r.link);
    if (!b || !b.text) { failed++; continue; }
    appendFileSync(resolve(DB, `${d}.jsonl`), JSON.stringify({ ...r, naverTitle: b.title, when: b.when, body: b.text, saved: new Date().toISOString() }) + "\n");
    idx[key] = d; added++;
    await new Promise(x => setTimeout(x, 300));
  }
}
writeFileSync(idxFile, JSON.stringify(idx));
log(`단독 DB: 대상 ${days.length}일, 본문 추가 ${added}건, 실패 ${failed}건, 기존 ${skipped}건 → ${DB}`);
