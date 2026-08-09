// 이슈 대장(臺帳) — 사건을 하루 단위가 아니라 생애 단위로 추적한다.
// media-watch 스킬의 원칙을 봇에 이식한 것:
//   ① "이슈가 본체, 일간은 뷰" — 매일의 기사는 이슈에 귀속되고, 브리핑은 대장의 파생 뷰다.
//   ② 종결돼도 삭제하지 않는다(팔로우업 원칙) — status만 바뀐다.
//   ③ 씨앗(seeded) 이슈 = 추적 키워드로 집계(스킬의 '추적 쿼리'), 유기(organic) 이슈 = 클러스터에서 자동 생성.
// 저장: issues.json (워크플로우가 state.json과 함께 커밋)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { topStories, keyTokens } from "./insight.mjs";

const FILE = "issues.json";
const NEW_MIN = 5;        // 유기 이슈 신설 최소 보도량(하루 클러스터 크기)
export const QUIET_DAYS = 3;   // 이 날수 이상 보도 없으면 소강
const CLOSE_DAYS = 21;    // 소강 후 이 날수 지나면 종결(씨앗 이슈는 제외 — 수동 관리)

const BUSAN_RE = /부산|해운대|기장|사하|사상|영도|동래|금정|수영|부산진|가덕|벡스코|낙동강|광안|자갈치|센텀|북항|사직|구덕|김해공항|에어부산|BNK|전재수/;
// 이슈가 아닌 정기물(날씨·편성·분양·복권 등) — 대장 신설 차단 (실측: 날씨 묶음이 '계속 이슈' 2위까지 올라옴)
const LEDGER_NOISE = /날씨|기온|폭염특보|미세먼지 농도|주간예보|운세|띠별|로또|당첨번호|분양캘린더|청약 일정|선발투수|중계 채널|편성표|부고\]|인사\]|오늘의 일정|증시|코스피 마감|환율 마감/;

export function loadLedger() {
  if (existsSync(FILE)) { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch {} }
  return { issues: [], updated: "" };
}
export function saveLedger(ledger) {
  ledger.updated = new Date().toISOString();
  writeFileSync(FILE, JSON.stringify(ledger, null, 1));
}

// media-watch 스킬 references/issues-state.md 의 활성 이슈를 초기 씨앗으로 이식
export function seedIssues() {
  const mk = (id, label, keywords) => ({
    id, label, keywords, tokens: [], daily: {}, status: "관찰",
    firstSeen: "", lastSeen: "", labelN: 0, lastHead: "", seeded: true,
  });
  return [
    mk("seed-council", "시의회·기초의회 원 구성 갈등", ["원구성", "원 구성"]),
    mk("seed-aide",    "정무보좌관 인선 검증",         ["정무보좌관"]),
    mk("seed-gwansa",  "시장 관사 사용",               ["시장 관사", "관사 사용"]),
    // ⚠ "생중계" 단독은 스포츠 중계 편성기사를 흡수함(실측) — 반드시 맥락어와 결합
    mk("seed-live",    "회의 생중계·다면평가",         ["회의 생중계", "시정 생중계", "다면평가"]),
    mk("seed-safety",  "급경사지·빈집 안전",           ["급경사지", "축대 붕괴", "빈집"]),
    mk("seed-semi",    "반도체 영남 소외론",           ["반도체 영남", "영남 소외"]),
    mk("seed-jaesoo",  "전재수 시장 관련 보도",        ["전재수"]),
  ];
}

const d2n = s => Math.floor(Date.parse(s + "T00:00:00Z") / 86400000);
const gapDays = (a, b) => d2n(b) - d2n(a);
export const shiftDate = (s, delta) =>
  new Date(Date.parse(s + "T00:00:00Z") + delta * 86400000).toISOString().slice(0, 10);

const kwHit = (it, keywords) => {
  const s = String(it.t || "") + " " + String(it.ctx || "");
  return keywords.some(k => s.includes(k));
};
// 대표 제목: 부산 관련 우선, 설명적인 길이(~40자) 근접 우선
function repTitle(titles) {
  let best = titles[0] || "", score = -1e9;
  for (const t of titles) {
    const clean = String(t).replace(/^\[[^\]]{1,10}\]\s*/, "");
    const s = (BUSAN_RE.test(clean) ? 12 : 0) - Math.abs(clean.length - 40) * 0.4;
    if (s > score) { score = s; best = clean; }
  }
  return best;
}

/**
 * 하루치 기사를 대장에 반영한다 (하루 1회, 그날이 끝난 뒤 호출).
 * 멱등이 아니므로 같은 날짜를 두 번 넣지 말 것 (아침 브리핑의 briefedFor 가드가 보장).
 */
export function updateLedger(ledger, dateStr, items) {
  const seeds = ledger.issues.filter(i => (i.keywords || []).length);
  const organic = ledger.issues.filter(i => !(i.keywords || []).length);

  // ① 씨앗 이슈: 추적 키워드로 직접 집계 (제목+맥락)
  for (const iss of seeds) {
    const hits = items.filter(it => kwHit(it, iss.keywords));
    if (!hits.length) continue;
    iss.daily[dateStr] = hits.length;
    iss.lastHead = repTitle(hits.map(h => h.t));
    if (!iss.firstSeen) iss.firstSeen = dateStr;
    iss.lastSeen = dateStr;
    iss.status = "활성";
  }

  // ② 유기 이슈: 그날 클러스터를 기존 이슈와 대조, 못 찾으면 신설
  const clusters = topStories(items, 40);
  const agg = new Map(); // iss → { count, headline, headN }
  for (const c of clusters) {
    if (LEDGER_NOISE.test(c.headline)) continue;     // 정기물은 매칭·신설 모두 제외
    // 씨앗 키워드에 걸리는 클러스터는 씨앗이 이미 집계했으므로 유기 쪽에서 제외 (이중 집계 방지)
    if (seeds.some(s => c.items.some(it => kwHit(it, s.keywords)))) continue;
    const ctoks = new Set(c.toks || []);
    let best = null, bestShared = 0;
    for (const iss of organic) {
      let shared = 0;
      for (const w of ctoks) if (iss.tokens.includes(w)) shared++;
      const ratio = shared / Math.max(1, Math.min(ctoks.size, iss.tokens.length));
      if (((ratio >= 0.45 && shared >= 2) || shared >= 4) && shared > bestShared) { best = iss; bestShared = shared; }
    }
    if (!best) {
      if (c.count < NEW_MIN) continue;               // 신설 기준 미달 — 소규모 단발성은 대장에 안 올림
      if (LEDGER_NOISE.test(c.headline)) continue;   // 정기물은 이슈가 아님
      best = {
        id: `i-${dateStr}-${(c.labels || [])[0] || "이슈"}`,
        label: c.headline, labelN: 0, keywords: [],
        tokens: [], daily: {}, status: "활성",
        firstSeen: dateStr, lastSeen: "", lastHead: "", seeded: false,
      };
      ledger.issues.push(best);
      organic.push(best);
    }
    const e = agg.get(best) || { count: 0, headline: c.headline, headN: 0 };
    e.count += c.count;
    if (c.count > e.headN) { e.headline = c.headline; e.headN = c.count; }
    agg.set(best, e);
    // 서명 토큰 병합 (상한 40 — 오래된 서명이 무한히 자라 엉뚱한 매칭을 하는 것 방지)
    for (const w of ctoks) if (!best.tokens.includes(w)) best.tokens.push(w);
    if (best.tokens.length > 40) best.tokens = best.tokens.slice(-40);
  }
  for (const [iss, e] of agg) {
    iss.daily[dateStr] = (iss.daily[dateStr] || 0) + e.count;
    iss.lastHead = e.headline;
    iss.lastSeen = dateStr;
    iss.status = "활성";
    if (e.headN >= iss.labelN) { iss.label = e.headline; iss.labelN = e.headN; }
  }

  // ③ 상태 전환 — 소강/종결 (종결돼도 데이터는 남긴다)
  for (const iss of ledger.issues) {
    if (!iss.lastSeen) continue;
    const gap = gapDays(iss.lastSeen, dateStr);
    if (iss.status === "활성" && gap >= QUIET_DAYS) iss.status = "소강";
    else if (iss.status === "소강" && gap >= CLOSE_DAYS && !iss.seeded) iss.status = "종결";
  }
}

// ── 표시 도우미 ──
const BLOCKS = "▁▂▃▄▅▆▇█";
export function sparkline(iss, dateStr, days = 7) {
  const vals = [...Array(days)].map((_, i) => iss.daily[shiftDate(dateStr, i - days + 1)] || 0);
  const max = Math.max(...vals, 1);
  return vals.map(v => v === 0 ? "·" : BLOCKS[Math.min(7, Math.floor((v / max) * 7.99))]).join("");
}
function trendOf(iss, dateStr) {
  const y = iss.daily[dateStr] || 0;
  const prevKeys = Object.keys(iss.daily).filter(k => k < dateStr).sort();
  if (!prevKeys.length) return "";
  const prev = iss.daily[prevKeys[prevKeys.length - 1]] || 0;
  const peak = Math.max(...Object.values(iss.daily));
  if (y >= prev * 1.4 && y >= 5) return "▲ 확산";
  if (y < prev && y <= peak * 0.4 && peak >= 8) return "▼ 잦아듦";
  return "— 유지";
}

/**
 * 이슈에 속하는 기사들 (버튼 딥링크용) — 씨앗은 키워드로, 유기는 토큰 서명으로 매칭.
 * 클러스터를 거치지 않으므로 하루 1건짜리 이슈도 찾는다 (topStories는 2건 미만 클러스터를 버림).
 */
export function issueArticles(iss, items) {
  if ((iss.keywords || []).length) return items.filter(it => kwHit(it, iss.keywords));
  return items.filter(it => {
    const toks = keyTokens(it.t);
    let shared = 0;
    for (const w of toks) if (iss.tokens.includes(w)) shared++;
    return shared >= 3 || (shared >= 2 && shared / Math.max(1, Math.min(toks.size, iss.tokens.length)) >= 0.45);
  });
}

/**
 * 대장 상태만으로 그날의 연속성 브리핑을 만든다 (updateLedger 이후 호출).
 * @returns { msgs: string[], buttons: [{headline, idx}] } — idx = ledger.issues 배열 인덱스(led: 콜백용)
 */
export function composeContextBrief(ledger, dateStr, total, headerLabel) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fresh = [], cont = [], rekindled = [];
  for (const iss of ledger.issues) {
    const y = iss.daily[dateStr];
    if (!y) continue;
    if (LEDGER_NOISE.test(iss.label + " " + (iss.lastHead || ""))) continue;  // 과거에 들어온 정기물 격리
    const prevKeys = Object.keys(iss.daily).filter(k => k < dateStr).sort();
    if (!prevKeys.length) fresh.push(iss);
    else if (gapDays(prevKeys[prevKeys.length - 1], dateStr) >= 4) rekindled.push(iss);
    else cont.push(iss);
  }
  const byY = (a, b) => (b.daily[dateStr] || 0) - (a.daily[dateStr] || 0);
  cont.sort(byY); fresh.sort(byY); rekindled.sort(byY);
  const quiet = ledger.issues.filter(i =>
    i.status === "소강" && i.lastSeen && gapDays(i.lastSeen, dateStr) === QUIET_DAYS);

  const cum = iss => Object.values(iss.daily).reduce((a, b) => a + b, 0);
  const dayN = iss => gapDays(iss.firstSeen, dateStr) + 1;
  const tag = iss => iss.seeded ? " 🔎" : "";   // 🔎 = 시정 추적 이슈(씨앗)

  const parts = [];
  parts.push(`☀️ <b>${esc(headerLabel)}</b>\n<i>어제 보도 ${total.toLocaleString()}건 — 이슈 대장 기준, 하루가 아니라 흐름으로 봅니다</i>`);

  // ⚠ 번호는 세 구획을 관통해 매긴다. 예전엔 본문이 7+5+4를 나열하는데 버튼은 6+3+2만 만들어
  //   "본문 7번"과 "버튼 7번"이 서로 다른 이슈를 가리켰다(2026-08-09 사용자 신고).
  //   이제 본문 번호 = 버튼 번호 = 아래 picked 배열의 순번으로 항상 일치한다.
  const picked = [...cont.slice(0, 7), ...fresh.slice(0, 5), ...rekindled.slice(0, 4)];
  const noOf = iss => picked.indexOf(iss) + 1;

  if (cont.length) {
    const lines = cont.slice(0, 7).map(iss =>
      `<b>${noOf(iss)}. ${esc(String(iss.lastHead || iss.label).slice(0, 48))}</b>${tag(iss)}\n` +
      `    ${dayN(iss)}일째 ${sparkline(iss, dateStr)} 어제 ${iss.daily[dateStr]}건 · 누적 ${cum(iss)}건 ${trendOf(iss, dateStr)}`);
    parts.push(`📌 <b>계속되는 이슈</b>\n\n${lines.join("\n\n")}`);
  }
  if (fresh.length) {
    const lines = fresh.slice(0, 5).map(iss =>
      `<b>${noOf(iss)}.</b> ${esc(String(iss.lastHead || iss.label).slice(0, 48))} — 첫 보도 ${iss.daily[dateStr]}건`);
    parts.push(`🆕 <b>새로 떠오른 이슈</b>\n${lines.join("\n")}`);
  }
  if (rekindled.length) {
    const lines = rekindled.slice(0, 4).map(iss => {
      const prevKeys = Object.keys(iss.daily).filter(k => k < dateStr).sort();
      const gap = gapDays(prevKeys[prevKeys.length - 1], dateStr);
      return `<b>${noOf(iss)}.</b> ${esc(String(iss.lastHead || iss.label).slice(0, 48))}${tag(iss)} — ${gap}일 만에 다시 ${iss.daily[dateStr]}건`;
    });
    parts.push(`🔄 <b>재점화</b>\n${lines.join("\n")}`);
  }
  if (quiet.length) {
    const names = quiet.slice(0, 3).map(i => esc(String(i.label).slice(0, 24))).join(" / ");
    parts.push(`😴 <i>소강 전환: ${names}${quiet.length > 3 ? ` 외 ${quiet.length - 3}건` : ""}</i>`);
  }

  // 4096자 제한 분할
  const msgs = [];
  let cur = "";
  for (const p of parts) {
    if (cur && (cur + "\n\n" + p).length > 3800) { msgs.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) msgs.push(cur);

  // 버튼 = 본문에 실린 항목 그대로, 같은 번호로 (텔레그램 세로 키보드 한도 고려해 12개까지)
  const buttons = picked.slice(0, 12)
    .filter(iss => iss.lastHead)
    .map(iss => ({ headline: iss.lastHead, idx: ledger.issues.indexOf(iss), no: noOf(iss) }));
  return { msgs, buttons };
}
