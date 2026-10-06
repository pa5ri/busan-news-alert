// 본문으로 인터뷰 판별 (2026-10-06)
// 배경: 「전재수 부산시장 "되돌릴 수 없는 해양수도 반드시 실현"」(머니투데이 10/6)은 문답체 인터뷰인데 제목·본문에
//       '인터뷰'라는 말이 없어 제목 규칙(specialKind)을 비껴갔다. 시장 발언형 제목(전재수·부산시장 + 직접 인용)은
//       네이버 기사 본문을 한 번 읽어 판별한다.
// 판별(인터뷰 '원문'만): ① 문답 줄(-·―·Q·▶·△·◇·◆로 시작) 5줄 이상  ② '일문일답·대담' 표기  ③ 꼭지 표기 [인터뷰]
//       ④ '인터뷰'가 나오되 "인터뷰에서/인터뷰를 통해/에 출연해" 같은 '받아쓰기' 표현이 아닐 때.
//   라디오 출연 발언을 다른 매체가 받아쓴 기사(14일 실측 8건, 「전재수 "부캉이 예뻐죽겠다"」류)는 발언 보도이지 인터뷰가 아니라 제외.
// 비용: 해당 제목만(하루 5~15건), 네이버 링크만, 10초 제한. 실패하면 인터뷰 아님으로 둔다.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 본문을 읽어 볼 가치가 있는 제목인가 — 시장 이름/직함 + 직접 인용 */
export const RE_MAYOR_QUOTE = /(전재수|부산시장)[^"“”']{0,25}["“][^"”]{4,}["”]|["“][^"”]{4,}["”][^"“”']{0,25}(전재수|부산시장)/;

/** → { ok, why } */
export async function interviewCheck(naverUrl) {
  if (!/n\.news\.naver\.com\/(mnews\/)?article\//.test(String(naverUrl))) return { ok: false, why: "네이버 링크 아님" };
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 10000);
  let html;
  try {
    const r = await fetch(naverUrl, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
    if (!r.ok) return { ok: false, why: "HTTP " + r.status };
    html = await r.text();
  } catch (e) { return { ok: false, why: "조회 실패" }; } finally { clearTimeout(to); }
  const body = (html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || "";
  const summary = (html.match(/<strong class="media_end_summary">([\s\S]*?)<\/strong>/) || [])[1] || "";
  const txt = (summary + "\n" + body).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;|&#034;/g, '"').replace(/&nbsp;/g, " ");
  const qa = txt.split("\n").map(l => l.trim()).filter(l => /^[-―－▶△Q◇◆]\s*\S/.test(l) && l.length >= 8).length;
  if (qa >= 5) return { ok: true, why: `문답 ${qa}줄` };
  if (/일문일답|대담/.test(txt)) return { ok: true, why: "일문일답·대담 표기" };
  if (/\[\s?인터뷰\s?\]|^\s*인터뷰\s*[|│·]/m.test(txt)) return { ok: true, why: "꼭지 표기" };
  const n = (txt.match(/인터뷰/g) || []).length;
  if (n && !/인터뷰(에서|를 통해|에 출연|에 나와|서 밝혔)/.test(txt)) return { ok: true, why: `'인터뷰' ${n}회(받아쓰기 표현 없음)` };
  return { ok: false, why: n ? "받아쓰기 보도(인터뷰에서…)" : `문답 ${qa}줄·표기 없음` };
}
export const isInterviewBody = async url => (await interviewCheck(url)).ok;
