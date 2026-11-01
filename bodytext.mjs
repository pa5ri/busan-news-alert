// 기사 본문 추출 공용 모듈(2026-11-01) — local/jeon-db.mjs(전재수 기사 본문 DB)에서 떼어 냄.
// interview.mjs도 같은 추출기를 쓴다: 자사 링크 판별이 <article>·<p>만 보다가 뉴스1(본문이 <div id="articleBodyContent"> 안에 <br>로만 이어짐)을 못 읽었다.
// 순서: 네이버 dic_area → JSON-LD articleBody → 본문 틀(id/class, 태그 깊이 세기) → <article> → <br> 덩어리 → <p> 단락
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const decodeEnt = s => String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&hellip;/g, "…").replace(/&middot;/g, "·")
  .replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&bull;|&bullet;/g, "•").replace(/&times;/g, "×").replace(/&copy;/g, "©").replace(/&uarr;/g, "↑").replace(/&darr;/g, "↓").replace(/&amp;/g, "&").replace(/&[a-z]{2,8};/g, " ");
export const toText = html => decodeEnt(String(html)
  .replace(/<(script|style|noscript|iframe|figure|figcaption|button|form|aside)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " "))
  .replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();

export async function fetchHtml(url, ms = 15000) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, redirect: "follow", signal: ac.signal });
    if (!r.ok) return { err: "HTTP " + r.status };
    const buf = new Uint8Array(await r.arrayBuffer());
    let cs = ((r.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [])[1] || "";
    if (!cs) { const head = new TextDecoder("latin1").decode(buf.slice(0, 4000)); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8"; }
    cs = /euc-?kr|ks_c_5601|cp949/i.test(cs) ? "euc-kr" : "utf-8";
    let html; try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder("utf-8").decode(buf); }
    return { html };
  } catch (e) { return { err: e.name === "AbortError" ? "시간 초과" : "조회 실패" }; } finally { clearTimeout(to); }
}

export function extract(html, url) {
  if (/n\.news\.naver\.com/.test(url)) {
    const b = (html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1];
    const s = (html.match(/<strong class="media_end_summary">([\s\S]*?)<\/strong>/) || [])[1] || "";
    if (b) return { method: "naver", body: toText((s ? s + "<br>" : "") + b) };
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); const arr = [].concat(j, j["@graph"] || []);
      const a = arr.find(x => x && typeof x.articleBody === "string" && x.articleBody.length > 200);
      if (a) return { method: "jsonld", body: toText(a.articleBody) }; } catch {}
  }
  // 화면 그리기형(뉴스1): 본문이 HTML 본문 틀에 없고 스크립트 속 JSON 배열 contentArrange [{"type":"text","content":"…"}]에만 있다(11/1 실측).
  //   스크립트 문자열 안의 JSON이라 한 겹 더 이스케이프돼 있다(\"type\") → 한 겹 벗긴 뒤 읽는다.
  const ci = html.indexOf("contentArr");
  if (ci >= 0) {
    let seg = html.slice(ci, ci + 200000); const parts = [];
    if (seg.slice(0, 40).includes('\\"')) seg = seg.replace(/\\(["\\/])/g, "$1");
    for (const m of seg.matchAll(/\{"type":"text","content":("(?:[^"\\]|\\.)*")/g)) { try { parts.push(JSON.parse(m[1])); } catch {} }
    const body = toText(parts.join("<br>"));
    if (body.length > 200) return { method: "contentArr", body };
  }
  const ids = /<(div|article|section)[^>]*(?:id|class)="[^"]*(?:article-view-content-div|articleBody|article_body|article-body|news_body|newsContent|news_content|textBody|article_txt|view_con|view_content|cont_view|news_text|art_txt|article_view|articleView|newsct_article|story-news)[^"]*"[^>]*>/i;
  const st = html.search(ids);
  if (st >= 0) {
    // 같은 태그 깊이를 세어 닫는 지점까지 자른다(안쪽 </div>에서 잘리지 않게)
    const tag = html.slice(st).match(/^<(\w+)/)[1].toLowerCase(); const re = new RegExp(`<${tag}\\b|</${tag}>`, "gi"); re.lastIndex = st + 1; let depth = 1, m, end = -1;
    while ((m = re.exec(html))) { depth += m[0][1] === "/" ? -1 : 1; if (depth === 0) { end = m.index; break; } }
    const body = toText(html.slice(st, end > 0 ? end : st + 60000));
    if (body.length > 200) return { method: "cms", body };
  }
  const art = (html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/itemprop="articleBody"[^>]*>([\s\S]*?)<\/(div|section)>/i) || [])[1];
  if (art && toText(art).length > 200) return { method: "article", body: toText(art) };
  // <br>로만 이어진 본문(KNN·지역 방송 등): 20자↑ 텍스트 + <br>가 5번 이상 이어진 가장 긴 덩어리
  const brs = [...html.matchAll(/(?:[^<>]{20,}(?:<br\s*\/?>\s*)+){3,}/gi)].map(m => m[0]).sort((a, b) => b.length - a.length)[0];
  if (brs && toText(brs).length > 120) return { method: "br", body: toText(brs) };   // 단신(KNN 등)은 3줄·120자도 인정
  const ps = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).map(toText).filter(t => t.length >= 30 && !/저작권|무단 ?전재|Copyright|구독|기자 ?=|ⓒ|로그아웃|회원탈퇴|전체기사/.test(t));
  if (ps.join("").length > 200) return { method: "para", body: ps.join("\n") };
  return { method: "none", body: "" };
}
