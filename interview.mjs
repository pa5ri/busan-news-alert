// 본문으로 인터뷰 판별 (2026-10-06, 10-08 보완)
// 배경: 「전재수 부산시장 "되돌릴 수 없는 해양수도 반드시 실현"」(머니투데이 10/6)은 문답체 인터뷰인데 제목·본문에
//       '인터뷰'라는 말이 없어 제목 규칙(specialKind)을 비껴갔다. 시장 발언형 제목(전재수·부산시장 + 직접 인용)은
//       네이버 기사 본문을 한 번 읽어 판별한다.
// 판별(인터뷰 '원문'만): ① 문답 줄(-·―·Q·▶·△·◇·◆로 시작) 5줄 이상  ② '일문일답·대담' 표기  ③ 꼭지 표기 [인터뷰]
//       ④ '인터뷰'가 나오되 "인터뷰에서/인터뷰를 통해/에 출연해" 같은 '받아쓰기' 표현이 아닐 때
//       ⑤ (10/8) 받아쓰기 표현이어도 **그 매체가 자사 방송·유튜브 출연을 쓴 기사**면 인터뷰 — 예: 노컷뉴스가 부산CBS 유튜브 '로컬디스크C' 출연을 보도.
//   라디오 출연 발언을 '다른' 매체가 받아쓴 기사(14일 실측 7건, 「전재수 "부캉이 예뻐죽겠다"」류)는 발언 보도라 제외.
// 비용: 해당 제목만(하루 5~15건), 네이버 링크만, 10초 제한. 실패하면 인터뷰 아님으로 둔다.
import { extract } from "./bodytext.mjs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 본문을 읽어 볼 가치가 있는 제목인가 — 시장 이름/직함 + 직접 인용 */
export const RE_MAYOR_QUOTE = /(전재수|부산시장)[^"“”']{0,25}["“][^"”]{4,}["”]|["“][^"”]{4,}["”][^"“”']{0,25}(전재수|부산시장)/;
/** 전재수 색인 기사 가운데 본문을 읽어 볼 제목: 시장 이름+인용, 또는 제목 전체가 인용문(「“해양수도 부산 위한 또 하나의 초석”」 서울신문 10/19 — 이름 없이 발언만 뽑은 지면 문답) */
// (11/1) 네이버 검색 API는 긴 제목을 '...'로 잘라 닫는 따옴표가 사라진다 — 뉴스1 「전재수 "170만 명 불러모은 부캉이 보고 5만 석 돔아레나 자신감 얻었죠...」 → 잘린 인용도 인정
export const RE_IV_TITLE = /(전재수|부산시장)[^"“”']{0,25}["“][^"”]{4,}["”]|(전재수|부산시장)[^"“”']{0,25}["“][^"”]{8,}(\.{3}|…)\s*$|["“][^"”]{4,}["”][^"“”']{0,25}(전재수|부산시장)|^\s*["“][^"”]{6,}["”]\s*(\.{3}|…|\[[^\]]{1,8}\])?\s*$/;   // 11/1: 인용 뒤 '...'·[人터뷰] 꼬리(헤럴드경제 10/28)

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
  // (11/1) 한 번 실패로 끝내지 않는다 — JTBC 「[인터뷰] '부캉이' 힘입어 전재수…」(10/31)가 러너의 일시 조회 실패 한 번에 '인터뷰 아님'으로 버려짐. 15초 × 최대 3회.
  let html, lastWhy = "조회 실패";
  for (let i = 0; i < 3 && html === undefined; i++) {
    if (i) await new Promise(r => setTimeout(r, 3000 * i));
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(naverUrl, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
      if (r.ok) html = await r.text();
      else { lastWhy = "HTTP " + r.status; if (r.status < 500 && r.status !== 429) break; }
    } catch (e) { lastWhy = "조회 실패"; } finally { clearTimeout(to); }
  }
  if (html === undefined) return { ok: false, why: lastWhy, fetchFail: true };
  let body = isNaver ? (html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || "" : "";
  const summary = isNaver ? (html.match(/<strong class="media_end_summary">([\s\S]*?)<\/strong>/) || [])[1] || "" : "";
  if (!isNaver) {
    // (11/1) 자사 링크는 본문 DB와 같은 공용 추출기(bodytext.mjs)로 — 예전 <article>·<p> 방식은 뉴스1(스크립트 속 본문)을 못 읽었다
    body = extract(html, naverUrl).body.replace(/\n/g, "<br>");
    if (!body.trim()) return { ok: false, why: "본문 추출 실패(자사 링크)" };
  }
  const txt = (summary + "\n" + body).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  const pageTitle = ((html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || (html.match(/<title>([^<]+)/) || [])[1] || "");
  return judgeText(txt, pageTitle, srcName);
}

/** 본문 텍스트만으로 판별(저장 본문 DB 회귀·소급에도 쓴다) → { ok, why } */
export function judgeText(txt, pageTitle = "", srcName = "") {
  // (11/4) 자료사진 설명을 먼저 지운다 — 뉴시스 「전재수 "북항돔아레나 반드시 유치…"」(주간정책회의 발언 기사)가
  //   한 달 전 인터뷰 사진 설명("…뉴시스와 부산시청 집무실에서 인터뷰를 하고 있다. 2026.10.06.")의 '인터뷰' 한 단어로 인터뷰 판정됨.
  //   사진 설명 꼴: "…인터뷰를 하고 있다. 2026.10.06.", "…인터뷰 중인 박형준 전 부산시장 [부산시 제공]", "…뉴스1과 인터뷰를 하고 있다. ⓒ 뉴스1"
  //   사진 설명 바로 뒤에 기사 첫 문장이 이어 붙는 경우가 많아(뉴시스) 설명 꼬리(날짜·ⓒ·이메일·[사진=…])까지만 지운다.
  txt = String(txt)
    .replace(/[^.\n]*인터뷰\s?(를|을)?\s?(하고 있다|하고 있는 모습|중이다)\.?(\s*[ⓒ©][^\n]{0,20}?기자)?(\s*\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}\.?)?(\s*\/?\s*\S+@\S+)?(\s*\[[^\]\n]{1,20}\])?/g, " ")
    .replace(/[^.\n]*인터뷰\s?중인[^.\n[]{0,30}(\[[^\]\n]{1,20}\])?/g, " ");
  const titleMayor = /전재수|부산시장/.test(pageTitle);
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
  // (10/27) 시사주간지형 문답: 질문이 기호 없이 '?'로 끝나는 짧은 한 줄이고, 바로 다음 줄이 따옴표 없는 긴 답변 문단(60자↑)인 쌍이 4개↑
  //   사례: 시사IN 「“산업은행 오면 뭐가 달라지나?” 전재수 부산시장의 답변」(10/27, 질문 12개) — 기존 규칙에선 '받아쓰기 보도'로 빠짐
  const qmark = lines.filter((l, i) => l.length >= 8 && l.length <= 160 && /\?\s*$/.test(l) && i + 1 < lines.length && !/\?\s*$/.test(lines[i + 1]) && lines[i + 1].length >= 60).length;
  // 라디오 대담·패널 토론(타인이 답하는 문답)도 같은 모양이라, 이 형식은 제목에 시장이 있을 때만 인정(저장본 5,034건 회귀: 5건 중 시장 아닌 4건 제외)
  if (qmark >= 4 && /전재수|부산시장/.test(pageTitle)) return { ok: true, why: `물음표 문답 ${qmark}쌍` };
  // (10/21) 인터뷰 '원문'이 실려 있어야 한다 — 예고·행사 기사(연합 「어린이신문 기자단, 전재수 시장 인터뷰」: "대면 인터뷰를 한다고 밝혔다")는 제외.
  // 원문의 증거 = 문답 줄/쌍(위) 또는 시장 발언 인용 덩어리(20자 이상 따옴표)가 충분히 많을 것.
  const quotes = (txt.match(/[“"][^”"\n]{20,}[”"]/g) || []).length;
  const preview = /인터뷰(를|을)?\s?(한다|가진다|진행한다|할 예정|열린다|연다)|인터뷰가 (열|진행)|묻고 답하는 시간을 갖는다|질문할 예정/.test(txt);
  if (preview && quotes < 5) return { ok: false, why: "인터뷰 예고·행사 보도(원문 없음)" };
  // (11/4) 제목에 시장이 있을 때만, '대담'은 발언자 표기(대담 : 전재수)일 때만 — '대담'이라는 낱말만으로는 북콘서트·컨퍼런스가 걸렸다.
  if (titleMayor && (/일문일답/.test(txt) || /대담\s?[:：]?\s?[^\n]{0,12}전재수/.test(txt)) && quotes >= 3) return { ok: true, why: `일문일답·대담 표기(인용 ${quotes}개)` };
  // (11/4) 제목에 꼭지 표기 [인터뷰]와 시장이 함께 있으면 인터뷰(「[인터뷰] 전재수 "부산병…"」 조선비즈처럼 매체명이 사이트명과 다른 경우)
  if (titleMayor && /[\[〈<【]\s*(인터뷰|人터뷰)/.test(pageTitle) && quotes >= 3) return { ok: true, why: `제목 [인터뷰] 표기(인용 ${quotes}개)` };
  // (11/1) 서술형 자사 인터뷰: "전 시장은 30일 뉴스1과의 인터뷰에서 …"(뉴스1 초대석) — '인터뷰에서'라 받아쓰기로 빠지던 것.
  //   그 매체 이름(또는 본지)과의 인터뷰라고 스스로 밝히고 시장 발언 인용이 5개 이상이면 인터뷰. 다른 매체 인터뷰를 받아쓴 기사는 매체명이 달라 걸리지 않는다.
  //   주어가 시장인 문장이어야 한다("전 시장은 30일 뉴스1과의 인터뷰에서") — 저장본 회귀에서 박형준·시의원·부시장 인터뷰가 같은 표현으로 걸림.
  const srcRe = String(srcName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  //   '부산시장 후보'·'박 전 시장'·'전 부산시장'(박형준)은 주어로 치지 않는다.
  if (srcName && quotes >= 5 && new RegExp(`(전재수|(?<![가-힣] )전 시장|(?<!전 )부산시장(?! ?후보))[^.\\n"“]{0,40}(${srcRe}|본지|본사)\\s?(와|과)의?\\s?(단독\\s?|신년\\s?|특별\\s?|취임\\s?\\S+\\s?)?(인터뷰|대담)`).test(txt)) return { ok: true, why: `자사 서술형 인터뷰(${srcName}, 인용 ${quotes}개)` };
  // (11/4) 회의·행사 발언 기사 제외: 앞부분에서 발언 자리가 회의·회견·행사라고 밝히면 인터뷰가 아니다(문답 형식·자사 인터뷰 표기는 위에서 이미 통과).
  const lead = txt.slice(0, 500);
  if (/(주간정책회의|정책회의|간부회의|대책회의|회의|기자회견|기자설명회|브리핑|조회|토론회|간담회|설명회|기념식|개회식|발대식|협약식|행사|국정감사|시정질문|시정연설|본회의)(을|를)?\s?(에서|주재|열고|열어)/.test(lead)) return { ok: false, why: `회의·행사 발언 보도(인용 ${quotes}개)` };
  const n = (txt.match(/인터뷰/g) || []).length;
  const reportish = /인터뷰(에서|를 통해|에 출연|에 나와|서 밝혔)|(출연|나와)\s?(해|서)?[^.]{0,30}(말했|밝혔|강조했)/.test(txt);
  // (11/4) 제목에 시장이 있고 '인터뷰'가 2번 이상일 때만 — 1번은 사진 설명·지나가는 언급이었다
  if (titleMayor && n >= 2 && !reportish && quotes >= 5) return { ok: true, why: `'인터뷰' ${n}회·인용 ${quotes}개` };
  const own = OWN_CHANNEL[srcName];
  if (own && titleMayor) {
    // "부산CBS 유튜브 '로컬디스크C'에 출연해", "KNN 라디오 인터뷰에서" — 자사 채널명 + 출연·인터뷰가 같은 문장에, 발언 인용이 3개 이상
    // (11/4) 그 문장의 주인공이 시장이어야 한다 — 위원장·교수·국힘 의원의 자사 인터뷰·출연이 걸렸다(국제신문 8/18, KNN 10/28, 노컷 11/2)
    const M = "(전재수|(?<![가-힣] )전 시장|(?<!전 )부산시장(?! ?후보))", O = `(${own.source})[^.\\n]{0,40}(출연|인터뷰|대담|방송)`;
    //   "CBS와의 인터뷰에서 "전 시장이 결정하면…"(국힘 의원 발언)처럼 인용문 안의 시장 호칭은 치지 않는다.
    if (new RegExp(`${M}[^.\\n]{0,60}${O}|${O}[^.\\n"“]{0,30}${M}`).test(txt) && quotes >= 3) return { ok: true, why: `자사 방송 출연(${srcName}, 인용 ${quotes}개)` };
  }
  return { ok: false, why: (n || reportish) ? `타 매체 받아쓰기·요약 보도(인용 ${quotes}개)` : `문답 ${qa}줄·표기 없음(인용 ${quotes}개)` };
}
export const isInterviewBody = async (url, srcName) => (await interviewCheck(url, srcName)).ok;
