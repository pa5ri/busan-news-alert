// 본문으로 인터뷰 판별 (2026-10-06, 10-08 보완)
// 배경: 「전재수 부산시장 "되돌릴 수 없는 해양수도 반드시 실현"」(머니투데이 10/6)은 문답체 인터뷰인데 제목·본문에
//       '인터뷰'라는 말이 없어 제목 규칙(specialKind)을 비껴갔다. 시장 발언형 제목(전재수·부산시장 + 직접 인용)은
//       네이버 기사 본문을 한 번 읽어 판별한다.
// 판별(인터뷰 '원문'만): ① 문답 줄(-·―·Q·▶·△·◇·◆로 시작) 5줄 이상  ② '일문일답·대담' 표기  ③ 꼭지 표기 [인터뷰]
//       ④ '인터뷰'가 나오되 "인터뷰에서/인터뷰를 통해/에 출연해" 같은 '받아쓰기' 표현이 아닐 때
//       ⑤ (10/8) 받아쓰기 표현이어도 **그 매체가 자사 방송·유튜브 출연을 쓴 기사**면 인터뷰 — 예: 노컷뉴스가 부산CBS 유튜브 '로컬디스크C' 출연을 보도.
//   라디오 출연 발언을 '다른' 매체가 받아쓴 기사(14일 실측 7건, 「전재수 "부캉이 예뻐죽겠다"」류)는 발언 보도라 제외.
// 비용: 해당 제목만(하루 5~15건), 네이버 링크만, 10초 제한. 실패하면 인터뷰 아님으로 둔다.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 본문을 읽어 볼 가치가 있는 제목인가 — 시장 이름/직함 + 직접 인용 */
export const RE_MAYOR_QUOTE = /(전재수|부산시장)[^"“”']{0,25}["“][^"”]{4,}["”]|["“][^"”]{4,}["”][^"“”']{0,25}(전재수|부산시장)/;
/** 전재수 색인 기사 가운데 본문을 읽어 볼 제목: 시장 이름+인용, 또는 제목 전체가 인용문(「“해양수도 부산 위한 또 하나의 초석”」 서울신문 10/19 — 이름 없이 발언만 뽑은 지면 문답) */
export const RE_IV_TITLE = /(전재수|부산시장)[^"“”']{0,25}["“][^"”]{4,}["”]|["“][^"”]{4,}["”][^"“”']{0,25}(전재수|부산시장)|^\s*["“][^"”]{6,}["”]\s*$/;

// 매체 → 그 매체의 방송·채널 표기(본문에서 "○○ 라디오/유튜브/TV … 출연·인터뷰"로 나오면 자사 인터뷰)
const OWN_CHANNEL = {
  "노컷뉴스": /CBS|노컷/, "KBS": /KBS/, "MBC": /MBC/, "부산MBC": /MBC/, "SBS": /SBS/, "KNN": /KNN/, "YTN": /YTN/,
  "TV조선": /TV조선/, "채널A": /채널A/, "MBN": /MBN/, "JTBC": /JTBC/, "연합뉴스TV": /연합뉴스TV/, "한국경제TV": /한국경제TV/,
  "부산일보": /부산일보|부일/, "국제신문": /국제신문/,
};

/** → { ok, why } */
export async function interviewCheck(naverUrl, srcName = "") {
  // (10/21) 네이버 링크가 없는 자사 기사(국제뉴스 등)도 본문을 읽는다 — 아니면 제목 규칙만으로 통과해 예고 기사가 올라온다.
  const isNaver = /n\.news\.naver\.com\/(mnews\/)?article\//.test(String(naverUrl));
  if (!/^https?:\/\//.test(String(naverUrl))) return { ok: false, why: "링크 없음" };
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 10000);
  let html;
  try {
    const r = await fetch(naverUrl, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
    if (!r.ok) return { ok: false, why: "HTTP " + r.status };
    html = await r.text();
  } catch (e) { return { ok: false, why: "조회 실패" }; } finally { clearTimeout(to); }
  let body = isNaver ? (html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || "" : "";
  const summary = isNaver ? (html.match(/<strong class="media_end_summary">([\s\S]*?)<\/strong>/) || [])[1] || "" : "";
  if (!isNaver) {
    // 자사 CMS 공통 본문 틀(ndsoft article-view-content-div 등) → 없으면 30자 이상 <p> 단락을 이어 붙인다
    body = (html.match(/<article[^>]*id="(?:article-view-content-div|articleBody|article_body|newsContent|textBody)"[^>]*>([\s\S]*?)<\/article>/) || [])[1]
      || (html.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).filter(p => p.replace(/<[^>]+>/g, "").trim().length >= 30).join("\n");   // div 틀은 안쪽 </div>에서 잘리므로 단락 모음으로
    body = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<\/p>/gi, "\n");
    if (!body.trim()) return { ok: false, why: "본문 추출 실패(자사 링크)" };
  }
  const txt = (summary + "\n" + body).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;|&#034;/g, '"').replace(/&nbsp;/g, " ");
  // (10/20) 인터뷰 대상이 시장인지부터 — 본문에 전재수·부산시장이 없으면 누구의 인터뷰든 우리 코너가 아니다.
  // 사례: 국제신문 「“광안리 해변 보행공간 개선…”」(수영구청장 취임 100일 인터뷰)가 '제목 전체 인용문' 가드 + 자사 인터뷰 규칙으로 들어옴.
  if (!/전재수|부산시장/.test(txt)) return { ok: false, why: "시장 인터뷰 아님(본문에 시장 언급 없음)" };
  // 지나가며 언급(타 시도 인터뷰에서 경쟁 도시로 거론 등)도 걸러낸다: 인터뷰 대상이면 앞부분(요약·리드 400자)에 이름이 나오거나, 발언자 표기(◆ 전재수>)가 있거나, 3회 이상 나온다.
  const subject = /전재수|부산시장/.test(txt.slice(0, 400)) || /[◆▶◇■]\s*전재수\s*[>〉:]/.test(txt) || (txt.match(/전재수/g) || []).length >= 3;
  if (!subject) return { ok: false, why: "시장 인터뷰 아님(지나가는 언급)" };
  const lines = txt.split("\n").map(l => l.trim()).filter(Boolean);
  // (10/21) ◇·◆·△·■는 기사 소제목에도 흔히 쓴다(문화일보 국감 기사 「◇생곡소각장 강행 방침…」 5줄이 문답으로 세어짐).
  //  이 기호들은 질문형으로 끝날 때만 질문 줄로 센다. -·―·Q·▶는 그대로.
  const QEND = /(\?|？|는가|나요|까요|까|는지|는데|은데|나|가|은|는|요|란|라면|다면)[.\s]*$/;
  const isQ = l => l.length >= 8 && (/^[-―－Q▶]\s*\S/.test(l) || (/^[◇◆△■]\s*\S/.test(l) && QEND.test(l)));
  const qa = lines.filter(isQ).length;
  if (qa >= 5) return { ok: true, why: `문답 ${qa}줄` };
  // (10/19) 짧은 지면 문답: 질문 줄 바로 다음 줄이 따옴표로 시작하는 답변(40자 이상)인 '문답 쌍'이 3개 이상 — 서울신문 「해양수도 부산 위한 또 하나의 초석」(질문 3개)
  const pairs = lines.filter((l, i) => isQ(l) && i + 1 < lines.length && /^["“]/.test(lines[i + 1]) && lines[i + 1].length >= 40).length;
  if (pairs >= 3) return { ok: true, why: `문답 쌍 ${pairs}개` };
  // (10/21) 인터뷰 '원문'이 실려 있어야 한다 — 예고·행사 기사(연합 「어린이신문 기자단, 전재수 시장 인터뷰」: "대면 인터뷰를 한다고 밝혔다")는 제외.
  // 원문의 증거 = 문답 줄/쌍(위) 또는 시장 발언 인용 덩어리(20자 이상 따옴표)가 충분히 많을 것.
  const quotes = (txt.match(/[“"][^”"\n]{20,}[”"]/g) || []).length;
  const preview = /인터뷰(를|을)?\s?(한다|가진다|진행한다|할 예정|열린다|연다)|인터뷰가 (열|진행)|묻고 답하는 시간을 갖는다|질문할 예정/.test(txt);
  if (preview && quotes < 5) return { ok: false, why: "인터뷰 예고·행사 보도(원문 없음)" };
  if (/일문일답|대담/.test(txt) && quotes >= 3) return { ok: true, why: `일문일답·대담 표기(인용 ${quotes}개)` };
  const n = (txt.match(/인터뷰/g) || []).length;
  const reportish = /인터뷰(에서|를 통해|에 출연|에 나와|서 밝혔)|(출연|나와)\s?(해|서)?[^.]{0,30}(말했|밝혔|강조했)/.test(txt);
  if (n && !reportish && quotes >= 5) return { ok: true, why: `'인터뷰' ${n}회·인용 ${quotes}개` };
  const own = OWN_CHANNEL[srcName];
  if (own) {
    // "부산CBS 유튜브 '로컬디스크C'에 출연해", "KNN 라디오 인터뷰에서" — 자사 채널명 + 출연·인터뷰가 같은 문장에, 발언 인용이 3개 이상
    const re = new RegExp(`(${own.source})[^.\\n]{0,40}(출연|인터뷰|대담|방송)`);
    if (re.test(txt) && quotes >= 3) return { ok: true, why: `자사 방송 출연(${srcName}, 인용 ${quotes}개)` };
  }
  return { ok: false, why: (n || reportish) ? `타 매체 받아쓰기·요약 보도(인용 ${quotes}개)` : `문답 ${qa}줄·표기 없음(인용 ${quotes}개)` };
}
export const isInterviewBody = async (url, srcName) => (await interviewCheck(url, srcName)).ok;
