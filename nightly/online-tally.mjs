// 온라인 결산(2026-11-05 사용자 요청): 부산일보·국제신문이 그날 네이버로 송고한 기사 수와, 그중 전재수 언급 수.
// 지나간 일을 세는 것이라 예고와 달리 확실하다. 목록 = 네이버 언론사별 날짜 목록, 언급 = 기사마다 본문을 열어 이름 확인(색인에 기대지 않는다).
// 신문사 자사 사이트에만 올리고 네이버로 보내지 않은 기사는 세지 못한다.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const ONLINE_PAPERS = [{ code: "082", name: "부산일보" }, { code: "658", name: "국제신문" }];
const clean = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&middot;/g, "·").replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function get(url, ms = 15000) {
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise(r => setTimeout(r, 2000 * i));
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Referer: "https://news.naver.com/" }, signal: ac.signal });
      if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); return new TextDecoder(/euc-kr/i.test(r.headers.get("content-type") || "") ? "euc-kr" : "utf-8").decode(b); }
    } catch {} finally { clearTimeout(to); }
  }
  return null;
}

/** 그날 목록의 기사 번호들. 쪽을 넘겨도 새 번호가 없으면 끝. 첫 쪽을 못 읽으면 null. */
async function listIds(code, ymd) {
  const ids = new Set();
  for (let p = 1; p <= 60; p++) {
    const h = await get(`https://news.naver.com/main/list.naver?mode=LPOD&mid=sec&oid=${code}&date=${ymd}&page=${p}`);
    if (h === null) { if (p === 1) return null; break; }
    const before = ids.size;
    for (const m of h.matchAll(new RegExp(`(?:article/|oid=)${code}(?:/|&(?:amp;)?aid=)(\\d{10})`, "g"))) ids.add(m[1]);
    if (ids.size === before) break;
  }
  return ids;
}

/** → { total, mentions:[{title,url}], unread, other } total=그날 기사 수(게재일이 다른 곁가지 제외), unread=본문을 못 읽은 수. 목록 실패면 null. */
export async function tallyOnline(code, ymd, concurrency = 6) {
  const ids = await listIds(code, ymd); if (!ids) return null;
  const dash = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  const queue = [...ids]; const mentions = []; let total = 0, unread = 0, other = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const id = queue.shift(); const url = `https://n.news.naver.com/mnews/article/${code}/${id}`;
      const h = await get(url);
      if (h === null) { total++; unread++; continue; }
      const when = (h.match(/data-date-time="(\d{4}-\d{2}-\d{2})/) || [])[1];
      if (when && when !== dash) { other++; continue; }
      total++;
      const title = clean((h.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || "");
      const body = (h.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1];
      if (body === undefined && !title) { unread++; continue; }
      if (/전재수/.test(title) || (body && body.includes("전재수"))) mentions.push({ title, url, id });
    }
  }));
  mentions.sort((a, b) => a.id.localeCompare(b.id));
  return { total, mentions: mentions.map(({ title, url }) => ({ title, url })), unread, other };
}
