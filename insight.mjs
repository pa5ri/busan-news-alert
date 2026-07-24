// 이슈 순위 엔진 — archive/*.jsonl 에서 제목 키워드를 추출·집계해 TOP n 산출
import { readFileSync, existsSync } from "node:fs";

// 이슈로서 의미 없는 일반어(부산은 모든 기사에 있으므로 제외)
const STOP = new Set([
  "부산","부산시","부산서","부산발","울산","경남","오늘","내일","어제","이번","지난","최근","올해","내년","지난해",
  "뉴스","속보","단독","종합","영상","포토","사진","인터뷰","현장","르포","기자","보도","기사",
  "발표","예정","진행","확인","추진","계획","마련","실시","개최","운영","지원","강화","확대",
  "관련","대해","대한","위한","위해","이후","통해","함께","까지","부터","전국","지역","네이버",
  "명이","명의","것으","하나","무슨","어떻게","왜","살펴","눈길","화제","논란","입장","반응",
  // 일반 수식·시점·순위어 (특정 이슈가 아님)
  "1분기","2분기","3분기","4분기","상반기","하반기","올상반기","연간","월간","분기",
  "최대","최고","최다","최소","최저","최초","역대","돌파","기록","이상","이하","미만","초과",
  "1위","2위","3위","4위","5위","연속","또래","이번주","다음주","지난주","금주","내달","지난달",
  "억원","만원","천원","달러","퍼센트","포인트","가량","안팎","여명","여건","이내",
]);
// 조사 제거 (긴 것부터)
const JOSA = ["에서는","에서도","으로는","으로도","이라고","에서","으로","라고","에는","에도","에게","까지","부터","와의","과의","은","는","이","가","을","를","의","에","와","과","도","만","로"];

function normToken(w) {
  if (/^\d+$/.test(w)) return null;
  for (const j of JOSA) {
    if (w.length > j.length + 1 && w.endsWith(j)) { w = w.slice(0, -j.length); break; }
  }
  if (w.length < 2 || STOP.has(w)) return null;
  // 동사/형용사 활용형 파편 제거 (예: 대화하는→대화하, 참석한→참석) — 어간이 이런 어미로 끝나면 이슈어로 부적합
  if (/(하|되|해|드|르|았|었|였|는|던|린|은|운|같|없|있)$/.test(w)) return null;
  return w;
}

function tokensOf(title) {
  const t = String(title).replace(/\[[^\]]*\]/g, " ").replace(/["'"'…·]/g, " ");
  const raw = t.split(/[^0-9A-Za-z가-힣]+/).filter(Boolean);
  const toks = [];
  for (const w of raw) { const n = normToken(w); if (n) toks.push(n); }
  return toks;
}

export function loadDays(kstDates) {
  const items = [];
  for (const d of kstDates) {
    const f = `archive/${d}.jsonl`;
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { items.push(JSON.parse(line)); } catch {}
    }
  }
  return items;
}

// items -> [{label, count, ex}] (빈도순, 2건 이상만)
export function topIssues(items, n = 10) {
  const uni = new Map(), bi = new Map();
  const bump = (map, key, title) => {
    if (!map.has(key)) map.set(key, { count: 0, ex: title });
    map.get(key).count++;
  };
  for (const it of items) {
    const toks = tokensOf(it.t);
    const seenU = new Set(), seenB = new Set();
    toks.forEach(w => { if (!seenU.has(w)) { seenU.add(w); bump(uni, w, it.t); } });
    for (let i = 0; i < toks.length - 1; i++) {
      const b = toks[i] + " " + toks[i + 1];
      if (!seenB.has(b)) { seenB.add(b); bump(bi, b, it.t); }
    }
  }
  // 강한 2어절 이슈가 있으면 그 구성 단어(비슷한 빈도)는 중복이므로 숨김
  const suppressed = new Set();
  const biTop = [...bi.entries()].filter(([, v]) => v.count >= 3);
  for (const [b, v] of biTop) {
    for (const part of b.split(" ")) {
      const u = uni.get(part);
      if (u && u.count <= v.count + 2) suppressed.add(part);
    }
  }
  const cands = [
    ...biTop.map(([k, v]) => ({ label: k, ...v })),
    ...[...uni.entries()].filter(([k]) => !suppressed.has(k)).map(([k, v]) => ({ label: k, ...v })),
  ].filter(c => c.count >= 2);
  cands.sort((a, b) => b.count - a.count);
  // 상위 항목끼리 정리: 포함관계(돔구장⊂북항 돔구장) 또는 같은 대표기사에서 나온 파편은 1개만
  const out = [];
  const usedEx = new Set();
  for (const c of cands) {
    if (out.some(o => o.label.includes(c.label) || c.label.includes(o.label))) continue;
    if (usedEx.has(c.ex)) continue;
    usedEx.add(c.ex);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

// 텔레그램 메시지 문자열 배열(4096자 제한 대응 분할)
export function formatRanking(list, total, n, headerLabel) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const withEx = n <= 10;
  const lines = list.map((c, i) => {
    const base = `${i + 1}. <b>${esc(c.label)}</b> — ${c.count}건`;
    return withEx ? `${base}\n    └ ${esc(String(c.ex).slice(0, 44))}` : base;
  });
  const header = `📊 <b>${headerLabel}</b> (기사 ${total}건 기준)`;
  const msgs = [];
  let cur = header;
  for (const l of lines) {
    if ((cur + "\n" + l).length > 3800) { msgs.push(cur); cur = l; }
    else cur += "\n" + l;
  }
  msgs.push(cur);
  return msgs;
}

// 특정 이슈(라벨)에 해당하는 기사들 — 제목이 라벨의 모든 어절을 포함하면 매칭, 최신순
export function articlesForLabel(items, label) {
  const parts = String(label).split(/\s+/).filter(Boolean);
  const seen = new Set(), out = [];
  for (const it of items) {
    const t = String(it.t || "");
    if (!parts.every(p => t.includes(p))) continue;
    const key = (it.url || t).replace(/[?#].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => new Date(b.pub || 0) - new Date(a.pub || 0));
  return out;
}

export const kstDate = (offsetDays = 0) =>
  new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
