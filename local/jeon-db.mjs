// 전재수 언급 기사 본문 전수 저장 — 로컬 PC 비공개(2026-10-25). 비용 0원.
// 입력: 리포 archive/jeon/*.jsonl(클라우드 루프가 쌓는 전재수 색인: 제목·링크·발행시각)
// 출력: 부산광역시/전재수기사/db/YYYY-MM-DD.jsonl (리포 밖) — {key, t, src, pub, url, link, body, method, len, hasName, saved}
//       index.json(저장 완료 키→날짜) · failed.json(실패 키→{n, why, last}) · 실행 로그는 local/jeon-db.log
// 본문 추출 순서: ① 네이버 dic_area ② JSON-LD articleBody ③ 국내 CMS 공통 틀(article-view-content-div 등) ④ <article>/itemprop ⑤ 30자↑ 단락 모음
// 실행: node local/jeon-db.mjs [--all] [--limit N] [--days N]   (기본: 최근 14일 + 실패 재시도. --all: 색인 전체 소급)
// 예약: 작업 스케줄러 「부산단독DB」(local/scoop-run.vbs, 매일 08:30)가 scoop-db 다음에 이어서 실행한다.
import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "..", "전재수기사");
const DB = resolve(OUT, "db");
const args = process.argv.slice(2);
const ALL = args.includes("--all");
const LIMIT = Number((args[args.indexOf("--limit") + 1] || "").match(/^\d+$/) ? args[args.indexOf("--limit") + 1] : 0) || Infinity;
const DAYS = Number((args[args.indexOf("--days") + 1] || "").match(/^\d+$/) ? args[args.indexOf("--days") + 1] : 0) || 14;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const log = (...a) => console.log(`[${new Date().toLocaleString("ko-KR")}]`, ...a);

const decodeEnt = s => String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&hellip;/g, "…").replace(/&middot;/g, "·")
  .replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&bull;|&bullet;/g, "•").replace(/&times;/g, "×").replace(/&copy;/g, "©").replace(/&uarr;/g, "↑").replace(/&darr;/g, "↓").replace(/&amp;/g, "&").replace(/&[a-z]{2,8};/g, " ");
const toText = html => decodeEnt(String(html)
  .replace(/<(script|style|noscript|iframe|figure|figcaption|button|form|aside)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " "))
  .replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();

if (!ALL) { try { execSync("git pull --rebase -q origin main", { cwd: ROOT, stdio: "ignore", timeout: 120000 }); } catch (e) { log("git pull 실패(계속 진행):", e.message.split("\n")[0]); } }
if (!existsSync(DB)) mkdirSync(DB, { recursive: true });
const idxFile = resolve(OUT, "index.json"), failFile = resolve(OUT, "failed.json");
const idx = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, "utf8")) : {};
const failed = existsSync(failFile) ? JSON.parse(readFileSync(failFile, "utf8")) : {};

async function fetchHtml(url) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, redirect: "follow", signal: ac.signal });
    if (!r.ok) return { err: "HTTP " + r.status };
    const buf = new Uint8Array(await r.arrayBuffer());
    let cs = ((r.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [])[1] || "";
    if (!cs) { const head = new TextDecoder("latin1").decode(buf.slice(0, 4000)); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8"; }
    cs = /euc-?kr|ks_c_5601|cp949/i.test(cs) ? "euc-kr" : "utf-8";
    let html; try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder("utf-8").decode(buf); }
    return { html };
  } catch (e) { return { err: e.name === "AbortError" ? "시간 초과" : "조회 실패" }; } finally { clearTimeout(to); }
}

function extract(html, url) {
  if (/n\.news\.naver\.com/.test(url)) {
    const b = (html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1];
    const s = (html.match(/<strong class="media_end_summary">([\s\S]*?)<\/strong>/) || [])[1] || "";
    if (b) return { method: "naver", body: toText((s ? s + "<br>" : "") + b) };
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); const arr = [].concat(j, j["@graph"] || []);
      const a = arr.find(x => x && typeof x.articleBody === "string" && x.articleBody.length > 200);
      if (a) return { method: "jsonld", body: toText(a.articleBody) }; } catch {}
  }
  const ids = /<(div|article|section)[^>]*(?:id|class)="[^"]*(?:article-view-content-div|articleBody|article_body|article-body|news_body|newsContent|news_content|textBody|article_txt|view_con|view_content|cont_view|news_text|art_txt|article_view|articleView|newsct_article|story-news)[^"]*"[^>]*>/i;
  const st = html.search(ids);
  if (st >= 0) {
    // 같은 태그 깊이를 세어 닫는 지점까지 자른다(안쪽 </div>에서 잘리지 않게)
    const tag = html.slice(st).match(/^<(\w+)/)[1].toLowerCase(); const re = new RegExp(`<${tag}\\b|</${tag}>`, "gi"); re.lastIndex = st + 1; let depth = 1, m, end = -1;
    while ((m = re.exec(html))) { depth += m[0][1] === "/" ? -1 : 1; if (depth === 0) { end = m.index; break; } }
    const body = toText(html.slice(st, end > 0 ? end : st + 60000));
    if (body.length > 200) return { method: "cms", body };
  }
  const art = (html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/itemprop="articleBody"[^>]*>([\s\S]*?)<\/(div|section)>/i) || [])[1];
  if (art && toText(art).length > 200) return { method: "article", body: toText(art) };
  // <br>로만 이어진 본문(KNN·지역 방송 등): 20자↑ 텍스트 + <br>가 5번 이상 이어진 가장 긴 덩어리
  const brs = [...html.matchAll(/(?:[^<>]{20,}(?:<br\s*\/?>\s*)+){3,}/gi)].map(m => m[0]).sort((a, b) => b.length - a.length)[0];
  if (brs && toText(brs).length > 120) return { method: "br", body: toText(brs) };   // 단신(KNN 등)은 3줄·120자도 인정
  const ps = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).map(toText).filter(t => t.length >= 30 && !/저작권|무단 ?전재|Copyright|구독|기자 ?=|ⓒ|로그아웃|회원탈퇴|전체기사/.test(t));
  if (ps.join("").length > 200) return { method: "para", body: ps.join("\n") };
  return { method: "none", body: "" };
}

// 대상 목록
const since = Date.now() - DAYS * 86400e3;
const files = readdirSync(resolve(ROOT, "archive", "jeon")).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
const todo = []; const seen = new Set();
for (const f of files) {
  const day = f.slice(0, 10);
  const recent = new Date(day + "T00:00:00+09:00").getTime() >= since;
  for (const l of readFileSync(resolve(ROOT, "archive", "jeon", f), "utf8").split("\n")) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const nv = /n\.news\.naver\.com/.test(r.link || "") ? r.link : "";
    const key = (nv.match(/article\/(\d+\/\d+)/) || [])[1] || String(r.url || r.link || "").replace(/^https?:\/\/(www\.|m\.)?/, "").replace(/[?#].*$/, "");
    if (!key || seen.has(key) || idx[key]) continue; seen.add(key);
    const fl = failed[key];
    if (fl && fl.n >= 3) continue;                       // 3번 실패하면 포기
    if (!ALL && !recent && !fl) continue;                // 평소엔 최근 14일 + 실패 재시도만
    todo.push({ key, day, r, url: nv || r.url || r.link });
  }
}
const list = todo.slice(0, LIMIT);
log(`전재수 본문: 대상 ${list.length}건 (색인 신규·재시도, 전체 미저장 ${todo.length}건)`);

let ok = 0, bad = 0, noName = 0; const meth = {};
let i = 0; let saveTick = 0;
async function worker() {
  while (i < list.length) {
    const it = list[i++];
    let res = await fetchHtml(it.url);
    if (res.err && it.r.url && it.url !== it.r.url) res = await fetchHtml(it.r.url);   // 네이버 실패 시 원문으로
    const ex = res.html ? extract(res.html, it.url) : { method: "none", body: "" };
    // 네이버 본문 틀에서 나온 짧은 글(포토뉴스·단신)은 40자부터 인정, 나머지 방식은 120자부터(메뉴 찌꺼기 방지)
    const minLen = ex.method === "naver" ? 40 : ex.method === "br" ? 120 : 200;
    if (!ex.body || ex.body.length < minLen) {
      bad++; const f0 = failed[it.key] || { n: 0 }; failed[it.key] = { n: f0.n + 1, why: res.err || `본문 추출 실패(${ex.method})`, last: new Date().toISOString(), url: it.url };
    } else {
      const hasName = /전재수/.test(ex.body); if (!hasName) noName++;
      appendFileSync(resolve(DB, `${it.day}.jsonl`), JSON.stringify({ key: it.key, t: it.r.t, src: it.r.src || String(it.r.url || it.url).replace(/^https?:\/\/(www\.|m\.|news\.)?/, "").split("/")[0], pub: it.r.pub || "", url: it.r.url || "", link: it.r.link || "", body: ex.body.slice(0, 20000), method: ex.method, len: ex.body.length, hasName, saved: new Date().toISOString() }) + "\n");
      idx[it.key] = it.day; delete failed[it.key]; ok++; meth[ex.method] = (meth[ex.method] || 0) + 1;
    }
    if (++saveTick % 50 === 0) { writeFileSync(idxFile, JSON.stringify(idx)); writeFileSync(failFile, JSON.stringify(failed)); log(`  진행 ${saveTick}/${list.length} · 성공 ${ok} · 실패 ${bad}`); }
    await new Promise(x => setTimeout(x, 250));
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
writeFileSync(idxFile, JSON.stringify(idx)); writeFileSync(failFile, JSON.stringify(failed));
log(`전재수 본문 완료: 성공 ${ok}건(${Object.entries(meth).map(([k, v]) => k + " " + v).join(", ")}) · 실패 ${bad}건 · 본문에 이름 없음 ${noName}건 · 누적 저장 ${Object.keys(idx).length}건 → ${DB}`);
