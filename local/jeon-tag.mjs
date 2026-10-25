// 전재수 언급 기사 의제·지역·논조 태깅 + 주간 의제 지형 1장(2026-10-25). 비용 0원·로컬 전용.
// 입력: 부산광역시/전재수기사/db/*.jsonl (local/jeon-db.mjs가 쌓는 본문) · 사전 local/jeon-tags.json
// 출력: 전재수기사/tags.jsonl(기사별 태그) · 전재수기사/주간_의제지형.md(노션 「주간 의제 지형」 원고) · 전재수기사/검수표본.md(무작위 30건)
// 규칙: 의제·지역은 제목 1회↑ 또는 본문 2회↑일 때만 태그(스치는 언급 제외). 본문에 '전재수'가 없는 기사(hasName=false)는 뺀다.
//       논조: 비판어 본문 2회↑ 또는 제목 1회↑ → 비판형, 시정 발신 문형이 있으면 발신형, 둘 다면 혼합, 둘 다 없으면 중립.
// 주간: 기준일이 속한 주의 '직전 완결 주'(월~일, KST)를 이번 주로, 그 앞 주를 지난주로 비교한다.
// 실행: node local/jeon-tag.mjs [--date YYYY-MM-DD]
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "..", "전재수기사");
const DICT = JSON.parse(readFileSync(resolve(ROOT, "local", "jeon-tags.json"), "utf8"));
const argDate = (process.argv.slice(2).join(" ").match(/--date\s+(\d{4}-\d{2}-\d{2})/) || [])[1];

const cnt = (re, s) => (String(s).match(re) || []).length;
const AG = DICT.agenda.map(a => ({ ...a, re: new RegExp(a.pattern, "g") }));
const RG = DICT.region.map(a => ({ ...a, re: new RegExp(a.pattern, "g") }));
const T_CRIT = new RegExp(DICT.tone.비판, "g"), T_SEND = new RegExp(DICT.tone.발신, "g");
const kstDay = pub => { const t = new Date(pub); if (isNaN(t)) return ""; return new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };

// 1) 태깅
const rows = [];
for (const f of readdirSync(resolve(OUT, "db")).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()) {
  for (const l of readFileSync(resolve(OUT, "db", f), "utf8").split("\n")) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (!r.hasName) continue;
    const t = r.t || "", b = r.body || "";
    const hit = x => cnt(x.re, t) >= 1 || cnt(x.re, b) >= 2;
    const agenda = AG.filter(hit).map(a => a.id), region = RG.filter(hit).map(a => a.id);
    const crit = cnt(T_CRIT, t) >= 1 || cnt(T_CRIT, b) >= 2, send = T_SEND.test(b) || T_SEND.test(t); T_SEND.lastIndex = 0;
    const tone = crit && send ? "혼합" : crit ? "비판" : send ? "발신" : "중립";
    rows.push({ key: r.key, day: kstDay(r.pub) || f.slice(0, 10), t, src: r.src, link: r.link || r.url, agenda, region, tone });
  }
}
writeFileSync(resolve(OUT, "tags.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");

// 2) 주간 비교 구간
const base = argDate ? new Date(argDate + "T12:00:00+09:00") : new Date(Date.now() + 9 * 3600e3);
const dow = (base.getUTCDay() + 6) % 7;                                   // 월=0
const thisMon = new Date(base); thisMon.setUTCDate(base.getUTCDate() - dow - 7);   // 직전 완결 주의 월요일
const ymd = d => d.toISOString().slice(0, 10);
const addD = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const W1 = [ymd(thisMon), ymd(addD(thisMon, 6))], W0 = [ymd(addD(thisMon, -7)), ymd(addD(thisMon, -1))];
const inW = (r, w) => r.day >= w[0] && r.day <= w[1];
const cur = rows.filter(r => inW(r, W1)), prev = rows.filter(r => inW(r, W0));
const share = (arr, id, k = "agenda") => arr.length ? 100 * arr.filter(r => r[k].includes(id)).length / arr.length : 0;
const pct = x => `${Math.round(x)}%`, pp = x => `${x >= 0 ? "+" : ""}${Math.round(x)}%p`;

const agRows = AG.map(a => {
  const inA = cur.filter(r => r.agenda.includes(a.id));
  return { id: a.id, label: a.label, s1: share(cur, a.id), s0: share(prev, a.id), n: inA.length,
    crit: inA.length ? 100 * inA.filter(r => r.tone === "비판" || r.tone === "혼합").length / inA.length : 0,
    send: inA.length ? 100 * inA.filter(r => r.tone === "발신" || r.tone === "혼합").length / inA.length : 0, arts: inA };
}).map(x => ({ ...x, d: x.s1 - x.s0 })).sort((a, b) => b.s1 - a.s1);
const rgRows = RG.map(g => { const inG = cur.filter(r => r.region.includes(g.id)); const inP = prev.filter(r => r.region.includes(g.id));
  return { id: g.id, n: inG.length, n0: inP.length, crit: inG.length ? 100 * inG.filter(r => r.tone === "비판" || r.tone === "혼합").length / inG.length : 0 }; })
  .filter(x => x.n || x.n0).sort((a, b) => b.n - a.n);

const up = [...agRows].filter(x => x.n >= 3).sort((a, b) => b.d - a.d).slice(0, 3);
const down = [...agRows].filter(x => x.s0 > 0).sort((a, b) => a.d - b.d).slice(0, 3);
const hotCrit = [...agRows].filter(x => x.n >= 5).sort((a, b) => b.crit - a.crit)[0];
const minsaeng = agRows.find(x => x.id === "민생");
const toneAll = arr => { const c = { 비판: 0, 발신: 0, 혼합: 0, 중립: 0 }; for (const r of arr) c[r.tone]++; return c; };
const tc1 = toneAll(cur), tc0 = toneAll(prev);

const md = [];
md.push(`> 매주 월요일 자동 갱신 · 전재수 언급 기사(본문에 이름 있는 것) 기준 · 규칙 기반 태그라 방향을 보는 용도이며 단정의 근거가 아닙니다. 언론 비중이지 시민 인식이 아닙니다.`, ``);
md.push(`**이번 주** ${W1[0]} ~ ${W1[1]} · ${cur.length}건 　**지난주** ${W0[0]} ~ ${W0[1]} · ${prev.length}건`, ``);
md.push(`## 이번 주 판단 질문`, ``);
if (up[0]) md.push(`- 가장 많이 오른 의제는 **${up[0].label}**(${pct(up[0].s0)} → ${pct(up[0].s1)}, ${pp(up[0].d)})입니다. 우리가 민 결과인가, 상대가 끌고 온 판인가?`);
if (minsaeng) md.push(`- **민생·소상공인·일자리** 비중은 ${pct(minsaeng.s0)} → ${pct(minsaeng.s1)}(${pp(minsaeng.d)})입니다. 시정 메시지의 무게중심이 생활 의제에 있는가?`);
if (hotCrit) md.push(`- 비판형 비중이 가장 높은 의제는 **${hotCrit.label}**(${pct(hotCrit.crit)}, ${hotCrit.n}건)입니다. 대응 메시지가 필요한가, 지나가게 둘 것인가?`);
md.push(`- 논조 분포: 비판 ${tc1.비판} · 발신 ${tc1.발신} · 혼합 ${tc1.혼합} · 중립 ${tc1.중립}건 (지난주 비판 ${tc0.비판} · 발신 ${tc0.발신} · 혼합 ${tc0.혼합} · 중립 ${tc0.중립})`, ``);
md.push(`## 의제 지형`, ``, `| 의제 | 이번 주 | 지난주 | 변화 | 건수 | 비판형 | 발신형 |`, `|---|---|---|---|---|---|---|`);
for (const x of agRows.filter(x => x.n || x.s0)) md.push(`| ${x.label} | ${pct(x.s1)} | ${pct(x.s0)} | ${pp(x.d)} | ${x.n} | ${pct(x.crit)} | ${pct(x.send)} |`);
md.push(``, `*한 기사에 의제가 여럿 붙을 수 있어 비중 합은 100%가 넘습니다. 비판형·발신형은 그 의제 기사 중 비율입니다.*`, ``);
md.push(`## 오른 의제의 대표 기사`, ``);
const relevance = (a, id) => { const re = AG.find(g => g.id === id).re; return cnt(re, a.t) * 10 + (a.agenda.length === 1 ? 3 : 0) - a.agenda.length; };   // 제목에 그 의제가 있고 의제가 하나뿐인 기사를 앞에
for (const x of up) { md.push(`**${x.label}** (${pp(x.d)})`); for (const a of [...x.arts].sort((p, q) => relevance(q, x.id) - relevance(p, x.id)).slice(0, 3)) md.push(`- [${a.t}](${a.link}) — ${a.src} · ${a.tone}`); md.push(``); }
if (down.length) md.push(`**내린 의제**: ${down.map(x => `${x.label} ${pp(x.d)}`).join(" · ")}`, ``);
md.push(`## 구·군`, ``, `| 구·군 | 이번 주 | 지난주 | 비판형 |`, `|---|---|---|---|`);
for (const g of rgRows) md.push(`| ${g.id} | ${g.n} | ${g.n0} | ${pct(g.crit)} |`);
md.push(``, `*구·군은 본문에 그 지역 이름·동네·명소가 2번 이상(제목이면 1번) 나온 기사 수입니다. 시 전체 정책 기사는 어느 구·군에도 붙지 않습니다.*`);
writeFileSync(resolve(OUT, "주간_의제지형.md"), md.join("\n"));

// 3) 검수 표본(무작위 30, 고정 시드 — 같은 날 다시 돌려도 같은 표본)
let seed = Number(ymd(base).replace(/-/g, "")) % 2147483647; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
const sample = [...rows].sort(() => rnd() - 0.5).slice(0, 30);
writeFileSync(resolve(OUT, "검수표본.md"), sample.map((r, i) => `${i + 1}. [${r.t}](${r.link}) — ${r.src}\n   의제: ${r.agenda.join(", ") || "-"} · 지역: ${r.region.join(", ") || "-"} · 논조: ${r.tone}`).join("\n"));

const agCover = rows.filter(r => r.agenda.length).length, rgCover = rows.filter(r => r.region.length).length;
console.log(`태깅: ${rows.length}건 · 의제 붙음 ${agCover}(${Math.round(100 * agCover / rows.length)}%) · 지역 붙음 ${rgCover}(${Math.round(100 * rgCover / rows.length)}%) · 주간 ${W1[0]}~${W1[1]} ${cur.length}건 vs ${W0[0]}~${W0[1]} ${prev.length}건`);
