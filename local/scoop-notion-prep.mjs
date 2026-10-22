// [단독] 논리 장표 — 노션 반영 준비(2026-10-23). 비용 0원·로컬 전용.
// 입력: 로컬 본문 DB(부산광역시/단독논리/db/*.jsonl, 전문 보유) + 리포 scoop/*.jsonl(본문 없는 건 발췌만)
// 처리: scoop.mjs extractLogic으로 전문 기준 재추출 → 선별(논리 구조 있음 ∪ 의원실 자료) → 중복 제거
// 출력: ① ../단독논리/notion_queue.json — 아직 노션에 안 올린 행(노션 속성 그대로) ② ../단독논리/패턴_요약.md — 반복 패턴 집계
// 노션 반영은 Claude 예약작업 「scoop-notion-sync」가 queue를 읽어 MCP로 넣고, 넣은 키를 notion_synced.json에 기록한다.
// 실행: node local/scoop-notion-prep.mjs [--all]   (--all: 동기화 기록 무시하고 전부 다시 큐에)
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "..", "단독논리");
const { extractLogic } = await import(pathToFileURL(resolve(ROOT, "scoop.mjs")).href);

const A_NAME = { A1: "의원실 자료", A2: "정보공개·감사", A3: "내부 문건·공문", A4: "전수·통계", A5: "현장·제보", A6: "수사·사법" };
const B_NAME = { B1: "기준 부재", B2: "미이행", B3: "격차·비교", B4: "공백·0건", B5: "역효과", B6: "숨김·축소", B7: "특혜·수익", B8: "보안·안전 공백" };
const PARTIES = new Set(["더불어민주당", "국민의힘", "조국혁신당", "개혁신당", "진보당", "기본소득당", "사회민주당", "무소속"]);
const keyOf = r => (String(r.link || "").match(/article\/(\d+\/\d+)/) || [])[1] || String(r.link || r.t);
const readJsonl = f => readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// 1) 모으기: 본문 DB 우선, 없으면 리포 발췌
const byKey = new Map();
const dbDir = resolve(OUT, "db");
if (existsSync(dbDir)) for (const f of readdirSync(dbDir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)))
  for (const r of readJsonl(resolve(dbDir, f))) byKey.set(keyOf(r), { ...r, day: f.slice(0, 10), full: true });
const scoopDir = resolve(ROOT, "scoop");
if (existsSync(scoopDir)) for (const f of readdirSync(scoopDir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)))
  for (const r of readJsonl(resolve(scoopDir, f))) { const k = keyOf(r); if (!byKey.has(k)) byKey.set(k, { ...r, day: f.slice(0, 10), full: false }); }

// 2) 재추출·선별·제목 중복 제거
const seenT = new Set(); const rows = [];
for (const [k, r] of [...byKey].sort((a, b) => a[1].day.localeCompare(b[1].day))) {
  const tk = String(r.t).replace(/\s/g, "").slice(0, 25); if (seenT.has(tk)) continue; seenT.add(tk);
  const lg = r.full && r.body ? extractLogic(r.body) : { A: r.A || [], B: r.B || [], busan: !!r.busan, lawmaker: r.lawmaker || "", party: r.party || "", agency: r.agency || "", quote: r.quote || "" };
  // 장표에는 '논리'가 있는 것만: 논리 구조(B)가 잡혔거나 의원실 자료(A1)형. 부산 언급만 있는 건(증시·행사 등)은 넣지 않고 태그로만 쓴다.
  if (!(lg.B.length || lg.A.includes("A1"))) continue;
  rows.push({ key: k, day: r.day, t: r.t, src: r.src, link: r.link, ...lg });
}

// 3) 큐(아직 안 올린 것)
const syncedFile = resolve(OUT, "notion_synced.json");
const synced = new Set(process.argv.includes("--all") || !existsSync(syncedFile) ? [] : JSON.parse(readFileSync(syncedFile, "utf8")));
const queue = rows.filter(r => !synced.has(r.key)).map(r => ({
  key: r.key,
  properties: {
    "제목": r.t, "date:날짜:start": r.day, "매체": r.src || "", "링크": r.link || null,
    "근거 출처": r.A.map(c => A_NAME[c]).filter(Boolean), "논리 구조": r.B.map(c => B_NAME[c]).filter(Boolean),
    "부산": r.busan ? "부산 언급" : "-", "의원": r.lawmaker || "", ...(PARTIES.has(r.party) ? { "정당": r.party } : {}),
    "상대 기관": r.agency || "", "근거 문장": (r.quote || "").replace(/\s+/g, " ").slice(0, 160), "키": r.key,
  },
}));
writeFileSync(resolve(OUT, "notion_queue.json"), JSON.stringify(queue, null, 1));

// 4) 패턴 집계(선별 전체 기준)
const cnt = (arr, f) => { const m = {}; for (const x of arr) for (const k of [].concat(f(x)).filter(Boolean)) m[k] = (m[k] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const days = [...new Set(rows.map(r => r.day))].sort();
const matrix = {}; for (const r of rows) for (const a of (r.A.length ? r.A : ["-"])) for (const b of (r.B.length ? r.B : ["-"])) matrix[a + "|" + b] = (matrix[a + "|" + b] || 0) + 1;
const Acols = ["A1", "A2", "A3", "A4", "A5", "A6", "-"], Brows = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"];
const md = [];
md.push(`# 단독 논리 — 반복 패턴 요약`, ``, `기간 ${days[0]} ~ ${days[days.length - 1]} · 선별 ${rows.length}건(논리 구조 있음 ∪ 의원실 자료) · 수집 전체 ${byKey.size}건 · 생성 ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ``);
md.push(`## 근거 출처 × 논리 구조`, ``, `| 논리 구조 \\ 근거 | ${Acols.map(c => A_NAME[c] || "출처 미상").join(" | ")} |`, `|---|${Acols.map(() => "---").join("|")}|`);
for (const b of Brows) md.push(`| ${B_NAME[b]} | ${Acols.map(a => matrix[a + "|" + b] || "").join(" | ")} |`);
md.push(``, `## 의원실 자료 단독을 가장 많이 낸 의원`, ``, ...cnt(rows.filter(r => r.A.includes("A1") && r.lawmaker), r => `${r.party ? r.party + " " : ""}${r.lawmaker}`).slice(0, 15).map(([k, v]) => `- ${k} ${v}건`));
md.push(``, `## 자료를 내준 기관(의원실 자료형)`, ``, ...cnt(rows.filter(r => r.agency), r => r.agency).slice(0, 15).map(([k, v]) => `- ${k} ${v}건`));
md.push(``, `## 정당별 의원실 자료 단독`, ``, ...cnt(rows.filter(r => r.A.includes("A1")), r => r.party || "(미상)").map(([k, v]) => `- ${k} ${v}건`));
md.push(``, `## 부산 언급 단독`, ``, ...rows.filter(r => r.busan).slice(-25).reverse().map(r => `- ${r.day} ${r.src} — ${r.t} [${[...r.A.map(c => A_NAME[c]), ...r.B.map(c => B_NAME[c])].join("·")}]`));
writeFileSync(resolve(OUT, "패턴_요약.md"), md.join("\n"));
console.log(`단독 논리 준비: 수집 ${byKey.size}건 → 선별 ${rows.length}건 → 노션 대기 ${queue.length}건 (이미 반영 ${synced.size}건)`);
