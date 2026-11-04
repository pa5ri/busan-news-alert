// 밤 보고 [지면] = 내일 자 지면 예고(2026-11-05 사용자 결정). 오늘 자는 아침 「부산 지면」 방에서 이미 봤고, 밤 10시에 새로 볼 것은 내일 자다.
// 네이버 신문보기엔 내일 자가 아직 없어(요청하면 직전 발행분을 준다) 신문사 사이트를 읽는다. 이 파일은 HTML → 기사 목록 변환만 한다(가져오기는 scrape.mjs).
const dec = s => String(s).replace(/<[^>]+>/g, "").replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&middot;/g, "·").replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** 국제신문: 기사 key 앞 8자리가 지면 게재일이다. 온라인 기사는 올린 날 날짜를 달아, 내일 날짜 key는 곧 내일 자 지면 기사다.
 *  같은 기사가 사진·요약 링크로 여러 번 나오므로 요약(말줄임)이 아닌 가장 짧은 글을 제목으로 쓴다. */
export function parseKookje(html, ymd, into = new Map()) {
  for (const m of String(html).matchAll(/<a[^>]*href="([^"]*newsbody\.asp\?[^"]*key=(\d{8}\.[\d.]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!m[2].startsWith(ymd)) continue;
    const t = dec(m[3]); if (t.length < 6) continue;
    const cur = into.get(m[2]);
    const summary = x => /(\.\.\.|…)$/.test(x) || x.length > 70;
    if (!cur || (summary(cur.title) && !summary(t)) || (summary(cur.title) === summary(t) && t.length < cur.title.length))
      into.set(m[2], { title: t, url: `https://www.kookje.co.kr/news2011/asp/newsbody.asp?key=${m[2]}&code=0000` });
  }
  return into;
}

/** 부산일보 지면 페이지(busan.com/newspaper/): 최신판 1개의 면별 기사 목록. 목록은 HTML 주석 안에 있다. → { date:"YYYYMMDD", items:[{title:"[01면] …", url}] } */
export function parseBusanPaper(html) {
  const h = String(html);
  const d = (h.match(/class="today">\s*(\d{4})\.(\d{2})\.(\d{2})/) || []);
  const seen = new Set(), items = [];
  for (const b of h.matchAll(/<p>\s*(\d+면)\s*<\/p>\s*<ul>([\s\S]*?)<\/ul>/g))
    for (const a of b[2].matchAll(/<a[^>]*view\.php\?code=(\d+)[^>]*>([\s\S]*?)<\/a>/g)) {
      const t = dec(a[2]); if (t.length < 4 || seen.has(a[1])) continue; seen.add(a[1]);
      items.push({ title: `[${b[1]}] ${t}`, url: `https://www.busan.com/view/busan/view.php?code=${a[1]}` });
    }
  return { date: d[1] ? d[1] + d[2] + d[3] : "", items };
}

/** 부산일보 예비 경로: 지면 페이지가 아직 내일 자가 아니면 홈에서 오늘 올린 기사를 추린다. 코드 = 올린 날짜+시각.
 *  밤 8시 이후 올린 것은 온라인 기사였다(11/4 업로드분 ↔ 11/5 실제 지면 실측: 20시 전 35건 중 32건 일치, 21~22시 3건 중 0건). 온라인이 일부 섞이고 홈에 없는 면은 빠진다. */
export function parseBusanHome(html, ymd, cutHour = 20) {
  const m = new Map();
  for (const a of String(html).matchAll(/<a[^>]*href="[^"]*view\.php\?code=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!a[1].startsWith(ymd) || Number(a[1].slice(8, 10)) >= cutHour) continue;
    const t = dec(a[2]); if (t.length <= 8) continue;
    const cur = m.get(a[1]); if (!cur || t.length < cur.title.length) m.set(a[1], { title: t, url: `https://www.busan.com/view/busan/view.php?code=${a[1]}` });
  }
  return [...m.values()];
}
