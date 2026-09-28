// 일회성·재실행 가능: 여론조사 보조 아카이브(archive/poll)를 7/19부터 이어지는 원본으로 만든다(2026-09-28).
// ① 본 아카이브(archive/*.jsonl)에서 pollKind로 판정되는 기사 중 poll/에 없는 것을 via:"모집단"으로 합친다
//    (날짜 파일은 발행일 기준, 발송 여부는 복원할 수 없어 sent:null).
// ② 소급분(via:"소급")의 src가 도메인으로 적힌 것을 매체명으로 바꾼다(실시간 기록과 같은 PRESS 맵).
// 여러 번 돌려도 결과가 같다. --check 는 파일을 쓰지 않고 바뀔 건수만 출력.
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { pollKind, specialKind } from "./category.mjs";

const CHECK = process.argv.includes("--check");
// PRESS 맵은 alert.mjs 안에 있다(모듈을 import하면 봇이 돌아가므로 객체 리터럴만 읽는다)
const PRESS = Function("return " + readFileSync("alert.mjs", "utf8").match(/const PRESS = (\{[\s\S]*?\n\});/)[1])();
function pressName(url) {
  const host = String(url).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const dom = Object.keys(PRESS).find(d => host === d || host.endsWith("." + d) || d.endsWith(host));
  return dom ? PRESS[dom] : host;
}
const DIR = "archive/poll";
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

// ② 소급분 매체명 정리 + 기존 URL 수집
const have = new Set();
let fixed = 0;
for (const f of readdirSync(DIR).filter(f => f.endsWith(".jsonl"))) {
  const lines = readFileSync(`${DIR}/${f}`, "utf8").split("\n");
  let changed = false;
  const out = lines.map(l => {
    if (!l) return l;
    let r; try { r = JSON.parse(l); } catch { return l; }
    have.add(r.url);
    if (r.via === "소급" && /\./.test(r.src || "")) {
      const n = pressName(r.url);
      if (n !== r.src) { r.src = n; changed = true; fixed++; return JSON.stringify(r); }
    }
    return l;
  });
  if (changed && !CHECK) writeFileSync(`${DIR}/${f}`, out.join("\n"));
}

// ① 본 아카이브 합치기
let added = 0;
const byDay = {};
for (const f of readdirSync("archive").filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()) {
  for (const l of readFileSync(`archive/${f}`, "utf8").split("\n")) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (have.has(r.url)) continue;
    if (specialKind(r) === "기고") continue;
    const p = pollKind(r);
    if (!p) continue;
    have.add(r.url);
    const d = new Date(r.pub);
    const day = isNaN(d) ? f.slice(0, 10) : new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    (byDay[day] ??= []).push(JSON.stringify({
      t: r.t, src: r.src, pub: r.pub, url: r.url, ctx: r.ctx,
      topic: p.topic, agency: p.agency, index: !!p.index, sent: null, via: "모집단",
    }));
    added++;
  }
}
if (!CHECK) for (const [day, rows] of Object.entries(byDay)) appendFileSync(`${DIR}/${day}.jsonl`, rows.join("\n") + "\n");
console.log(`${CHECK ? "[점검] " : ""}소급분 매체명 정리 ${fixed}건 · 본 아카이브에서 합침 ${added}건 (${Object.keys(byDay).length}개 날짜)`);
