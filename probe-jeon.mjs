// 일회성 진단(검토용, 발송 없음): 네이버 '전재수' 검색 결과를 아카이브와 URL로 대조해 누락 유형을 분류한다.
//  A 아카이브에 있고 '언급'으로 집계됨(제목/요약에 전재수)
//  B 아카이브에 있는데 집계 안 됨(전재수가 본문 깊숙이 → 요약에 없음)
//  C 아카이브에 없음 — C1 제목에 부산 없음+비주요매체(수집 필터), C2 제목·요약 모두 부산 없음(부산 검색에 안 잡힘), C3 그 외(같은 제목 계열 중복 등)
import { readFileSync, existsSync } from "node:fs";
const naverH = { "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_ID, "X-NCP-APIGW-API-KEY": process.env.NAVER_SECRET };
const strip = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const kst = d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const norm = u => String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/#.*$/, "").replace(/\/$/, "");
const DAYS = ["2026-08-16","2026-08-17","2026-08-18","2026-08-19","2026-08-20","2026-08-21","2026-08-22"];
const PRESS_DOMS = ["yna.co.kr","yonhapnewstv.co.kr","newsis.com","news1.kr","news.kbs.co.kr","imnews.imbc.com","news.sbs.co.kr","jtbc.co.kr","tvchosun.com","mbn.co.kr","ichannela.com","ytn.co.kr","chosun.com","joongang.co.kr","donga.com","hani.co.kr","khan.co.kr","kmib.co.kr","munhwa.com","segye.com","seoul.co.kr","hankookilbo.com","hankyung.com","mk.co.kr","fnnews.com","edaily.co.kr","etoday.co.kr","mt.co.kr","heraldcorp.com","asiae.co.kr","ajunews.com","etnews.com","busan.com","kookje.co.kr","knn.co.kr","busanmbc.co.kr","nocutnews.co.kr","ohmynews.com","pressian.com","sisajournal.com","newspim.com","dailian.co.kr","newdaily.co.kr","wowtv.co.kr","biz.chosun.com","gukjenews.com","newsworks.co.kr","kado.net"];
const mapped = u => { const h = norm(u).split("/")[0]; return PRESS_DOMS.some(d => h === d || h.endsWith("." + d)); };

// 아카이브 색인
const arch = new Map();   // normUrl → {day, counted}
for (const d of DAYS) {
  if (!existsSync(`archive/${d}.jsonl`)) continue;
  for (const l of readFileSync(`archive/${d}.jsonl`, "utf8").split("\n")) { if (!l.trim()) continue; try { const r = JSON.parse(l); arch.set(norm(r.url), { day: d, counted: /전재수/.test((r.t || "") + " " + (r.ctx || "")) }); } catch {} }
}
// 네이버 전재수 검색
const seen = new Set(); const cats = { A: [], B: [], C1: [], C2: [], C3: [] };
for (let start = 1; start <= 1000; start += 100) {
  const r = await fetch(`https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent("전재수")}&display=100&start=${start}&sort=date`, { headers: naverH });
  if (!r.ok) break; const js = await r.json();
  for (const it of js.items || []) {
    const url = it.originallink || it.link, k = norm(url); if (seen.has(k)) continue; seen.add(k);
    const day = kst(new Date(it.pubDate)); if (!DAYS.includes(day)) continue;
    const t = strip(it.title), desc = strip(it.description);
    const a = arch.get(k) || arch.get(norm(it.link));
    const rec = { day, t: t.slice(0, 50), src: k.split("/")[0] };
    if (a) (a.counted ? cats.A : cats.B).push(rec);
    else if (!/부산/.test(t) && !/부산/.test(desc)) cats.C2.push(rec);
    else if (!/부산/.test(t) && !mapped(url)) cats.C1.push(rec);
    else cats.C3.push(rec);
  }
  await new Promise(r => setTimeout(r, 120));
  if ((js.items || []).length < 100) break;
}
const tot = Object.values(cats).reduce((s, a) => s + a.length, 0);
console.log(`네이버 '전재수' 8/16~22 고유 ${tot}건 분류`);
const label = { A: "A 아카이브 有·집계 됨", B: "B 아카이브 有·집계 안 됨(요약에 이름 없음)", C1: "C1 아카이브 無·제목에 부산 없음+비주요매체(필터)", C2: "C2 아카이브 無·제목·요약에 부산 없음(부산 검색 밖)", C3: "C3 아카이브 無·기타(제목 계열 중복 등)" };
for (const c of ["A", "B", "C1", "C2", "C3"]) {
  console.log(`\n${label[c]}: ${cats[c].length}건 (${Math.round(cats[c].length / tot * 100)}%)`);
  for (const r of cats[c].slice(0, 5)) console.log(`   ${r.day.slice(5)} ${r.src} | ${r.t}`);
}
