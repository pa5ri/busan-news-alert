// 인터뷰 누락 점검(2026-11-01) — 로컬 PC 전용·비용 0원.
// 저장된 전재수 기사 본문(전재수기사/db)을 현재 판별기(interview.mjs judgeText)로 다시 돌려 '시장 인터뷰'로 판정되는 기사를 뽑는다.
// 실시간 루프는 제목 규칙에 걸린 기사만 본문을 읽기 때문에, 제목이 규칙을 비껴가면 로그도 없이 빠진다(뉴스1 11/1·헤럴드경제 10/28 실측).
// 출력: 전재수기사/인터뷰_점검.json — [{day, src, name, t, link, url, why, route}] (route: 제목[인터뷰] / 발언형 제목 / 확인 안 함)
//       같은 매체·같은 날의 여러 버전은 한 묶음(links)으로. 예약 작업 「interview-daily-audit」이 이 파일과 노션 DB를 대조해 빠진 인터뷰를 수록한다.
// 실행: node local/interview-audit.mjs [--days N]   (기본 8일)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { judgeText, RE_IV_TITLE } from "../interview.mjs";
import { specialKind } from "../category.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "..", "전재수기사");
const args = process.argv.slice(2);
const DAYS = Number((args.join(" ").match(/--days\s+(\d+)/) || [])[1] || 8);

// 도메인 → 매체명(alert.mjs의 표를 그대로 읽는다)
const A = readFileSync(resolve(ROOT, "alert.mjs"), "utf8");
const MAP = {}; for (const m of A.matchAll(/"([a-z0-9.-]+\.(?:kr|com|net|co\.kr|or\.kr))"\s*:\s*"([^"]+)"/g)) MAP[m[1]] = m[2];
const nameOf = d => { for (const k of Object.keys(MAP)) if (d === k || d.endsWith("." + k)) return MAP[k]; return d; };

const files = readdirSync(resolve(OUT, "db")).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-DAYS);
const groups = new Map(); const seenT = new Set();
for (const f of files) for (const l of readFileSync(resolve(OUT, "db", f), "utf8").split("\n")) {
  if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
  if (!r.hasName) continue;
  const k = r.t.replace(/\s/g, "").slice(0, 20); if (seenT.has(k)) continue; seenT.add(k);
  const name = nameOf(r.src || "");
  const c = judgeText(r.body, r.t, name);
  if (!c.ok) continue;
  const route = specialKind({ t: r.t }) === "인터뷰" ? "제목[인터뷰]" : RE_IV_TITLE.test(r.t) ? "발언형 제목" : "확인 안 함";
  const day = f.slice(0, 10), gk = `${name}|${day}`;
  const g = groups.get(gk) || { day, name, src: r.src, items: [] };
  g.items.push({ t: r.t, link: r.link || "", url: r.url || "", why: c.why, route, len: r.len });
  groups.set(gk, g);
}
const list = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day));
writeFileSync(resolve(OUT, "인터뷰_점검.json"), JSON.stringify({ made: new Date().toISOString(), range: [files[0]?.slice(0, 10), files.at(-1)?.slice(0, 10)], groups: list }, null, 1));
const miss = list.flatMap(g => g.items.filter(x => x.route === "확인 안 함").map(x => `${g.day} ${g.name} | ${x.t.slice(0, 50)}`));
console.log(`인터뷰 점검 ${files[0]?.slice(0, 10)}~${files.at(-1)?.slice(0, 10)}: 판정 ${list.length}묶음 · 실시간 경로 밖 ${miss.length}건`);
for (const m of miss) console.log("  확인 안 함:", m);
