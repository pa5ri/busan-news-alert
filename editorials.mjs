// 신문 사설 모니터링 — 부산일보·국제신문 사설 목록에서 새 글을 감지해 "사설" 주제로 전송
// 소스 (둘 다 일반 fetch로 파싱 가능, Puppeteer 불필요 — 2026-08-02 실측):
//   부산일보: /opinionmain/1 목록, 제목이 [사설]로 시작하는 것만 (목록에 위젯성 링크가 섞임)
//   국제신문: list.asp?code=1710 목록, 기사 링크의 kid=1710이 사설 표식 (code=1710이 아님!)
//             EUC-KR 디코딩 필수. 사이드바(많이 본 뉴스)는 kid 필터로 자연 배제됨.
// 발행 패턴: 다음날 지면 사설이 전날 저녁부터 올라옴 — 55분 주기 확인이면 충분.
const UA = { "user-agent": "Mozilla/5.0" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export async function fetchEditorials() {
  const out = [];
  try {
    const h = await (await fetch("https://www.busan.com/opinionmain/1", { headers: UA })).text();
    const seen = new Set();
    for (const m of h.matchAll(/href="(\/view\/busan\/view\.php\?code=(\d{10,})[^"]*)"[^>]*>([^<]{8,90})</g)) {
      const t = unesc(m[3].trim());
      if (!/^\[사설\]/.test(t)) continue;
      if (seen.has(m[2])) continue;
      seen.add(m[2]);
      out.push({ src: "부산일보", key: "b" + m[2], paperDate: m[2].slice(0, 8),
                 t: t.replace(/^\[사설\]\s*/, ""), url: "https://www.busan.com" + m[1] });
    }
  } catch (e) { console.error("부산일보 사설 수집 실패:", e.message); }
  try {
    const r = await fetch("http://www.kookje.co.kr/news2011/asp/list.asp?code=1710", { headers: UA });
    const h = new TextDecoder("euc-kr").decode(Buffer.from(await r.arrayBuffer()));
    const seen = new Set();
    for (const m of h.matchAll(/href="([^"]*newsbody\.asp\?[^"]*key=(\d{8}\.\d+)[^"]*kid=1710[^"]*)"[^>]*>([^<]{8,90})</g)) {
      if (seen.has(m[2])) continue;
      seen.add(m[2]);
      const url = m[1].startsWith("http") ? m[1] : "http://www.kookje.co.kr" + m[1];
      out.push({ src: "국제신문", key: "k" + m[2], paperDate: m[2].slice(0, 8),
                 t: unesc(m[3].trim()).replace(/^\[사설\]\s*/, ""), url: url.replace(/&amp;/g, "&") });
    }
  } catch (e) { console.error("국제신문 사설 수집 실패:", e.message); }
  return out;   // 각 목록 최신순
}

/**
 * 새 사설을 감지해 발송한다. send(text)는 "사설" 주제로 보내는 함수.
 * state.edSeen(키 목록)·state.edInit(최초 실행 여부)를 사용— 호출자가 saveState.
 */
export async function checkEditorials(state, send) {
  const list = await fetchEditorials();
  if (!list.length) return 0;
  const seen = new Set(state.edSeen || []);
  const fresh = list.filter(e => !seen.has(e.key));
  let sent = 0;
  if (!state.edInit) {
    // 최초 실행: 백로그 전체를 본 것으로 처리하고, 신문사별 최신 2건만 샘플 발송
    for (const src of ["부산일보", "국제신문"]) {
      for (const e of list.filter(x => x.src === src).slice(0, 2).reverse()) {
        if (await send(fmt(e))) sent++;
      }
    }
    state.edInit = true;
  } else {
    for (const e of fresh.reverse()) {              // 오래된 것부터
      if (await send(fmt(e))) sent++;
    }
  }
  for (const e of list) seen.add(e.key);
  state.edSeen = [...seen].slice(-300);
  return sent;
}

const fmt = e => {
  const d = e.paperDate ? ` <i>(${e.paperDate.slice(4, 6)}/${e.paperDate.slice(6, 8)}자)</i>` : "";
  return `✍️ <b>[${e.src} 사설]</b> ${esc(e.t)}${d}\n${e.url}`;
};
