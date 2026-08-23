// 일회성 진단: 네이버 '전재수' 직접 검색(본문 색인) 일자별 건수 vs 우리 아카이브의 전재수 언급 건수 (발송 없음). 실행 후 git rm.
import { readFileSync, existsSync } from "node:fs";
const naverH = { "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_ID, "X-NCP-APIGW-API-KEY": process.env.NAVER_SECRET };
const strip = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const kst = d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const DAYS = ["2026-08-16","2026-08-17","2026-08-18","2026-08-19","2026-08-20","2026-08-21","2026-08-22"];
const seen = new Set(); const naver = {}; const titleOnly = {};
for (let start = 1; start <= 1000; start += 100) {
  const u = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent("전재수")}&display=100&start=${start}&sort=date`;
  const r = await fetch(u, { headers: naverH }); if (!r.ok) { console.log("HTTP", r.status); break; }
  const js = await r.json();
  for (const it of js.items || []) {
    const k = (it.originallink || it.link).replace(/#.*$/, ""); if (seen.has(k)) continue; seen.add(k);
    const d = kst(new Date(it.pubDate)); naver[d] = (naver[d] || 0) + 1;
    if (/전재수/.test(strip(it.title))) titleOnly[d] = (titleOnly[d] || 0) + 1;
  }
  await new Promise(r => setTimeout(r, 120));
  if ((js.items || []).length < 100) break;
}
const oldest = Object.keys(naver).sort()[0];
console.log(`네이버 직접 검색: 고유 ${seen.size}건, 가장 오래된 날 ${oldest} (1,000건 한도 내)`);
console.log("날짜       | 네이버 전재수(본문포함) | 제목에 전재수 | 우리 아카이브 언급(제목+요약)");
for (const d of DAYS) {
  let ours = 0;
  if (existsSync(`archive/${d}.jsonl`)) for (const l of readFileSync(`archive/${d}.jsonl`, "utf8").split("\n")) { if (!l.trim()) continue; try { const r = JSON.parse(l); if (/전재수/.test((r.t || "") + " " + (r.ctx || ""))) ours++; } catch {} }
  console.log(`${d} | ${String(naver[d] || 0).padStart(6)}${oldest > d ? "(한도 밖)" : "        "} | ${String(titleOnly[d] || 0).padStart(6)} | ${String(ours).padStart(6)}`);
}
