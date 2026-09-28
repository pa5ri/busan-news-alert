// 일회성 소급: 전용 검색 패스(여론조사·시당위원장) 기사를 보조 아카이브(archive/poll, archive/chief)에 채운다.
// 2026-09-28 이전에는 이 패스의 기사가 방에만 발송되고 아카이브에 남지 않았다. 네이버 검색이 돌려주는 범위(질의당 최대 1,000건)
// 안에서 최근 45일분을 다시 긁어 분류한다. 발송 여부는 복원할 수 없어 sent:null, via:"소급"으로 표시.
import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { pollKind, specialKind } from "./category.mjs";

const { NAVER_ID, NAVER_SECRET } = process.env;
const H = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };
const strip = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;|&#39;/g, "'");
const MAX_AGE = 45 * 86400e3;

const have = { poll: new Set(), chief: new Set() };
for (const dir of ["poll", "chief"]) {
  if (!existsSync(`archive/${dir}`)) continue;
  for (const f of readdirSync(`archive/${dir}`)) for (const l of readFileSync(`archive/${dir}/${f}`, "utf8").split("\n")) {
    if (!l) continue; try { have[dir].add(JSON.parse(l).url); } catch {}
  }
}
function put(dir, it, extra) {
  const url = it.originallink || it.link;
  if (have[dir].has(url)) return false;
  have[dir].add(url);
  const d = new Date(it.pubDate);
  const day = new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const host = String(url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  mkdirSync(`archive/${dir}`, { recursive: true });
  appendFileSync(`archive/${dir}/${day}.jsonl`, JSON.stringify({
    t: strip(it.title), src: host, pub: it.pubDate, url, link: it.link, ctx: strip(it.description).slice(0, 300), ...extra,
  }) + "\n");
  return true;
}
async function* search(q) {
  for (let start = 1; start <= 901; start += 100) {
    const r = await fetch(`https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=100&start=${start}&sort=date`, { headers: H });
    if (!r.ok) { console.error(`검색 실패(${q}, ${start}):`, r.status); return; }
    const items = (await r.json()).items || [];
    let old = 0;
    for (const it of items) {
      if (Date.now() - new Date(it.pubDate).getTime() > MAX_AGE) { old++; continue; }
      yield it;
    }
    if (items.length < 100 || old === items.length) return;
    await new Promise(r2 => setTimeout(r2, 200));
  }
}

const POLL_Q = [["대통령 지지율", "중앙여론조사"], ["정당 지지도 여론조사", "중앙여론조사"], ["전국지표조사", "중앙여론조사"],
  ["전재수 여론조사", "부산여론조사"], ["부산시장 직무수행", "부산여론조사"], ["부산 여론조사", "부산여론조사"],
  ["K-브랜드지수 광역자치단체장", "부산여론조사"], ["도시 브랜드평판 부산", "부산여론조사"]];
for (const [q, want] of POLL_Q) {
  let n = 0;
  for await (const it of search(q)) {
    const t = strip(it.title), ctx = strip(it.description).slice(0, 300);
    if (specialKind({ t, ctx }) === "기고") continue;
    const p = pollKind({ t, ctx });
    if (!p || p.topic !== want) continue;
    if (put("poll", it, { topic: p.topic, agency: p.agency, index: !!p.index, sent: null, via: "소급" })) n++;
  }
  console.log(`여론조사 소급 [${q}]: ${n}건`);
}
for (const [q, topic] of [["박홍배", "민주당시당"], ["이성권", "국민의힘시당"]]) {
  let n = 0;
  for await (const it of search(q)) {
    const t = strip(it.title), ctx = strip(it.description).slice(0, 300);
    if (!(t.includes(q) || ctx.includes(q))) continue;
    if (put("chief", it, { topic, sent: null, via: "소급" })) n++;
  }
  console.log(`시당위원장 소급 [${q}]: ${n}건`);
}
