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

export function tokensOf(title) {
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

// items -> [{label, count, ex, srcs, head}] (빈도순, 2건 이상만)
//   ex   = 처음 등장한 제목 (파편 정리용 키)
//   head = 대표 제목 — 부산 관련을 우선하고 길이가 적당한 것 (맥락 표시용)
//   srcs = 보도한 매체 목록
export function topIssues(items, n = 10) {
  const uni = new Map(), bi = new Map();
  const bump = (map, key, it) => {
    if (!map.has(key)) map.set(key, { count: 0, ex: it.t, titles: [], srcs: new Set() });
    const v = map.get(key);
    v.count++;
    if (v.titles.length < 40) v.titles.push(String(it.t || ""));   // 대표 제목 후보
    if (it.src) v.srcs.add(it.src);
  };
  for (const it of items) {
    const toks = tokensOf(it.t);
    const seenU = new Set(), seenB = new Set();
    toks.forEach(w => { if (!seenU.has(w)) { seenU.add(w); bump(uni, w, it); } });
    for (let i = 0; i < toks.length - 1; i++) {
      const b = toks[i] + " " + toks[i + 1];
      if (!seenB.has(b)) { seenB.add(b); bump(bi, b, it); }
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
  const usedEx = new Set(), usedHead = new Set();
  for (const c of cands) {
    if (out.some(o => o.label.includes(c.label) || c.label.includes(o.label))) continue;
    if (usedEx.has(c.ex)) continue;
    if (/^\d+$/.test(c.label)) continue;                       // "37"(낮 최고 37도) 같은 숫자 토큰은 이슈가 아님
    const head = pickHeadline(c.titles || [], c.label);
    if (usedHead.has(head)) continue;                          // 대표기사가 같으면 같은 사건 — 한 번만
    usedEx.add(c.ex); usedHead.add(head);
    out.push({
      label: c.label, count: c.count, ex: c.ex, head,
      srcs: [...(c.srcs || [])],
    });
    if (out.length >= n) break;
  }
  return out;
}

// 대표 제목 선택 — ①그 키워드를 실제로 담고 있고 ②부산 관련이면 가점 ③길이 40자 근처
// (키워드만 보면 무슨 일인지 모른다는 피드백 반영: 순위표에 이 한 줄을 함께 보여준다)
function pickHeadline(titles, label) {
  const parts = String(label).split(/\s+/).filter(Boolean);
  const has = t => parts.every(p => t.includes(p));
  const pool = titles.filter(has).length ? titles.filter(has) : titles;
  let best = pool[0] || "", bestScore = -1e9;
  for (const t of pool) {
    const clean = t.replace(/^\[[^\]]{1,10}\]\s*/, "");           // 말머리 [단독] 등 제거
    const score = (BUSAN_RE.test(clean) ? 12 : 0) - Math.abs(clean.length - 40) * 0.4;
    if (score > bestScore) { bestScore = score; best = clean; }
  }
  return best;
}

// 스토리형 브리핑 메시지 (대표 헤드라인 중심)
export function formatStories(list, total, headerLabel, focusNote = "") {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = list.map((s, i) => {
    const head = esc(String(s.headline).slice(0, 60));
    const srcs = s.srcs.slice(0, 3).join("·") + (s.srcs.length > 3 ? ` 외 ${s.srcs.length - 3}곳` : "");
    return `<b>${i + 1}. ${head}</b>\n    📰 ${s.count}건 · ${esc(srcs)}`;
  });
  const header = `📊 <b>${headerLabel}</b>\n<i>어제 부산 관련 보도 ${total.toLocaleString()}건을 사건 단위로 묶었습니다</i>${focusNote}`;
  const msgs = [];
  let cur = header;
  for (const l of lines) {
    if ((cur + "\n\n" + l).length > 3800) { msgs.push(cur); cur = l; }
    else cur += "\n\n" + l;
  }
  msgs.push(cur);
  return msgs;
}

// 텔레그램 메시지 문자열 배열(4096자 제한 대응 분할)
export function formatRanking(list, total, n, headerLabel) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 키워드만으론 맥락을 알 수 없다는 피드백 반영 — 대표 기사 한 줄과 매체를 함께.
  // TOP 50 이상은 줄 수가 너무 많아지므로 키워드만(순위 확인 용도).
  const withEx = n <= 30;
  const lines = list.map((c, i) => {
    const rank = String(i + 1).padStart(2);
    const base = `${rank}. <b>${esc(c.label)}</b> — ${c.count}건`;
    if (!withEx) return base;
    const head = esc(String(c.head || c.ex || "").slice(0, 52));
    // 매체명은 한글 이름(도메인맵 등재처)을 먼저 보여준다 — 도메인 그대로면 읽기 나쁨
    const all = (c.srcs || []).slice().sort((a, b) => (a.includes(".") ? 1 : 0) - (b.includes(".") ? 1 : 0));
    const srcs = all.slice(0, 2).join("·") + (all.length > 2 ? ` 외 ${all.length - 2}곳` : "");
    return `${base}\n     └ ${head}${srcs ? `\n        <i>📰 ${esc(srcs)}</i>` : ""}`;
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

// ── 이슈 = 대표 헤드라인 (키워드 나열 대신 "무슨 일인지" 보여주는 방식) ──
// 부산 지명·기관 (연관도 판정용)
const BUSAN_RE = /부산|해운대|기장|사하구|사상구|영도|동래|금정|수영구|부산진|가덕|벡스코|낙동강|광안|자갈치|센텀|북항|사직|구덕|김해공항|에어부산|BNK/;
// 같은 사건이면 한 덩어리로: 제목의 의미 토큰 집합이 많이 겹치면 동일 클러스터
export function keyTokens(title) {
  return new Set(tokensOf(title).filter(w => w.length >= 2));
}
function overlap(a, b) {
  let n = 0; for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
}
/**
 * 기사들을 사건 단위로 묶어 상위 n개 반환
 * @returns [{ headline, count, srcs, busan, ex, labels }]
 */
export function topStories(items, n = 10, opts = {}) {
  const focus = opts.focus ? new RegExp(opts.focus) : null;   // 예: /전재수/
  const pool = focus ? items.filter(it => focus.test(it.t + " " + (it.ctx || ""))) : items;
  const clusters = [];
  for (const it of pool) {
    const toks = keyTokens(it.t);
    if (!toks.size) continue;
    let best = null, bestScore = 0;
    for (const c of clusters) {
      const s = overlap(toks, c.toks);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (best && bestScore >= 0.5) {                 // 절반 이상 겹치면 같은 사건
      best.items.push(it);
      for (const w of toks) best.toks.add(w);
    } else {
      clusters.push({ toks, items: [it] });
    }
  }
  const scored = clusters.map(c => {
    // 대표 헤드라인: 부산 관련 우선 → 그중 가장 설명적인(적당히 긴) 제목
    const busanFirst = c.items.filter(x => BUSAN_RE.test(x.t));
    const cand = (busanFirst.length ? busanFirst : c.items)
      .slice().sort((a, b) => Math.abs(38 - a.t.length) - Math.abs(38 - b.t.length));
    const srcs = [...new Set(c.items.map(x => x.src))];
    const busan = c.items.filter(x => BUSAN_RE.test(x.t + " " + (x.ctx || ""))).length;
    return {
      headline: cand[0].t,
      count: c.items.length,
      srcs,
      busan,                                        // 부산 직접 연관 기사 수
      items: c.items,
      labels: [...c.toks].slice(0, 3),
      toks: [...c.toks],                            // 이슈 대장(issues.mjs) 매칭용 전체 서명
    };
  });
  // 정렬: 보도량 × 부산 연관 비중
  scored.sort((a, b) => (b.count * (0.5 + b.busan / b.count)) - (a.count * (0.5 + a.busan / a.count)));
  return scored.filter(s => s.count >= 2 || focus).slice(0, n);
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
