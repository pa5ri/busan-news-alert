// 방송사 메인뉴스 스크래퍼 v2 — 날짜 지정형
// 사용: node scrape.mjs [YYYYMMDD]  (생략 시 오늘, KST 기준)
// 결과: data/broadcasters.json  [{group, source, items:[{title,url}], note?}]
//
// 날짜 지원 방식 (2026-07-19 검증):
//  KBS 뉴스9            → 공식 API broadCode=0001+broadDate                [프로그램+날짜]
//  KBS부산 뉴스9        → 지역API+클로징~오프닝 구간 절단+21시 이후 필터     [프로그램+날짜]
//  SBS 8뉴스            → programMain.do?broad_date=YYYYMMDD              [완전한 날짜 지정]
//  KNN 뉴스아이          → /news/program/newseye?date=YYYYMMDD             [완전한 날짜 지정]
//  부산MBC 뉴스데스크    → 목록 날짜필터 + 상세 게시시각 20~21시대만(뉴스데스크)  [프로그램+날짜]
//  TV조선 뉴스9         → broadcast 뉴스9 전용판 + URL 날짜 필터            [프로그램+날짜]
//  SBS 부산관련          → keywordList.do?keyword=부산 (프로그램 아님: 부산 태그 기사, 날짜 필터)
//  MBC 뉴스데스크        → 다시보기 인덱스=최신 방송분. 페이지 날짜 검증 후 수집 [최신+검증]
//  JTBC 뉴스룸          → /program/NG10000002 전용판(video/NB), 페이지 날짜 검증 [프로그램+검증]
import puppeteer from "puppeteer";
import { writeFileSync, mkdirSync } from "node:fs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // 부산MBC 등 인증서 문제 사이트 본문 조회용

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// 본문에서 찾을 인물/주제 키워드 (별도 탭으로 정리됨)
const KEYWORDS = ["전재수"];

// ---- 대상 날짜 (KST) ----
const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
const todayKST = kstNow.toISOString().slice(0, 10).replace(/-/g, "");
const D = (process.argv[2] || todayKST).replace(/-/g, "");        // YYYYMMDD
const dayShift = (ymd, n) => { const d = new Date(`${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10).replace(/-/g,""); };
const D_PREV = dayShift(D, -1), D_NEXT = dayShift(D, 1);
const D_DASH = `${D.slice(0,4)}-${D.slice(4,6)}-${D.slice(6,8)}`; // YYYY-MM-DD
const D_DOT  = `${D.slice(0,4)}.${D.slice(4,6)}.${D.slice(6,8)}`; // YYYY.MM.DD
const D_URL  = `${D.slice(0,4)}/${D.slice(4,6)}/${D.slice(6,8)}`; // YYYY/MM/DD
console.log(`대상 날짜: ${D_DASH}`);

const results = [];
const push = (group, source, items, note) => {
  console.log(`${source.padEnd(14)} ${String(items.length).padStart(3)}건${note ? "  ⚠ " + note : ""}`);
  results.push({ group, source, items, ...(note ? { note } : {}) });
};
const cleanTitle = t => String(t).replace(/https?:\/\/\S+/g,"").replace(/\s+/g," ").trim();

// ================= ① KBS (공식 API) =================
const KBS_H = { "User-Agent": UA, "Referer": "https://news.kbs.co.kr/" };
const kbsMap = n => ({ title: cleanTitle(n.newsTitle), url: `https://news.kbs.co.kr/news/view.do?ncd=${n.newsCode}` });
const isMarker = t => /^\[?(오프닝|클로징)|\[(뉴스9|930뉴스|뉴스광장|뉴스7).*(오프닝|클로징)\]|헤드라인\]?$/.test(t);

// 중앙 뉴스9: broadCode=0001 + broadDate (프로그램·날짜 완전 지정)
async function kbs9Central() {
  const u = `https://news.kbs.co.kr/api/getNewsList?currentPageNo=1&rowsPerPage=64&exceptPhotoYn=Y&broadCode=0001&broadDate=${D}&needReporterInfo=Y&orderBy=broadDate_desc%2CbroadOrder_asc`;
  const j = await (await fetch(u, { headers: KBS_H })).json();
  return (j.data || []).map(kbsMap).filter(it => it.title.length > 4 && !isMarker(it.title)).reverse();
}
// KBS부산 뉴스9: 지역 API는 그날 부산 지역 '전 프로그램'(뉴스광장·930뉴스·뉴스7·뉴스9)을
// 시간 역순으로 한꺼번에 준다. 각 방송분은 [클로징] → 리포트들 → [헤드라인/오프닝] 순서이므로,
// 뉴스9 클로징(21~22시대)부터 그 방송분의 시작 마커(헤드라인/오프닝)까지만 잘라낸다.
// ※ 마커가 누락된 날을 대비해 방송 시각(21:00 이후)으로 2차 방어.
async function kbsBusan() {
  const u = `https://news.kbs.co.kr/api/getNewsList?currentPageNo=1&rowsPerPage=80&exceptPhotoYn=Y&datetimeBegin=${D}000000&datetimeEnd=${D}235959&localCode=10&localCodeWithLocalReporterStationCode=10&orderBy=datetime_desc`;
  const j = await (await fetch(u, { headers: KBS_H })).json();
  const rows = (j.data || []).map(n => ({
    ...kbsMap(n),
    time: String(n.serviceTime || n.newsTime || n.broadDate || ""),   // "YYYY-MM-DD HH:mm..."
  }));
  const hhmm = r => { const m = r.time.match(/(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };

  const iClose = rows.findIndex(r => /뉴스9 부산 클로징/.test(r.title));
  let seg;
  if (iClose >= 0) {
    // 클로징 다음부터 이 방송분의 시작 마커(뉴스9 헤드라인/오프닝) 직전까지
    const rest = rows.slice(iClose + 1);
    let end = rest.findIndex(r => /뉴스9 부산 (헤드라인|오프닝)/.test(r.title));
    if (end < 0) {                                   // 시작 마커가 없으면 다른 프로그램 마커 전까지
      end = rest.findIndex(r => /(뉴스7|930뉴스|뉴스광장) 부산/.test(r.title));
    }
    seg = end >= 0 ? rest.slice(0, end) : rest;
  } else {
    seg = rows;                                       // 클로징도 없으면 시간 필터에 위임
  }
  // 2차 방어: 뉴스9 방송 시간대(21:00~23:59)만 — 마커 오류로 타 프로그램이 섞이는 것 차단
  const inNine = seg.filter(r => { const t = hhmm(r); return t < 0 || t >= 21 * 60; });
  const picked = (inNine.length ? inNine : seg);
  // 중복 제거(같은 리포트가 뉴스7·뉴스9에 재방송되는 경우 대비) 후 방송 순서대로
  const seen = new Set();
  return picked
    .filter(it => it.title.length > 4 && !isMarker(it.title))
    .filter(it => { const k = it.title.replace(/\s+/g, ""); if (seen.has(k)) return false; seen.add(k); return true; })
    .reverse();
}

// ================= 브라우저 기반 소스들 =================
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--ignore-certificate-errors"] });
async function withPage(url, fn, wait = 1500) {
  // 느린 응답·간헐 차단(해외 러너) 대비: URL 변형을 돌며 최대 4회, 점증 대기(0/3/8/15초).
  // 부산일보 ERR_EMPTY_RESPONSE·국제신문 ERR_BLOCKED_BY_CLIENT가 하룻밤 걸러 재발해 강화(2026-08-15).
  const urls = Array.isArray(url) ? url : [url];
  const BACKOFF = [0, 3000, 8000, 15000];
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (BACKOFF[attempt]) await new Promise(r => setTimeout(r, BACKOFF[attempt]));
    const p = await browser.newPage();
    try {
      await p.setUserAgent(UA);
      await p.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5" });
      await p.goto(urls[attempt % urls.length], { waitUntil: attempt === 0 ? "networkidle2" : "domcontentloaded", timeout: 60000 });
      await new Promise(r => setTimeout(r, attempt === 0 ? wait : wait + 2000));
      return await fn(p);
    } catch (e) { lastErr = e; }
    finally { await p.close(); }
  }
  throw lastErr;
}

// ---- 메인 ----
try {
  // KBS 중앙 + 부산 (공식 API, 날짜 완전 지정)
  try { push("중앙방송", "KBS 뉴스9", await kbs9Central()); } catch (e) { push("중앙방송","KBS 뉴스9",[],"API 실패: "+e.message); }
  try { push("부산방송", "KBS부산 뉴스9", await kbsBusan()); } catch (e) { push("부산방송","KBS부산 뉴스9",[],"API 실패: "+e.message); }

  // MBC 뉴스데스크 (최신 인덱스 + 날짜 검증)
  try {
    const { pageDate, items } = await withPage("https://imnews.imbc.com/replay/2026/nwdesk/", p => p.evaluate(() => {
      const pageDate = (document.body.innerHTML.match(/20\d{2}-\d{2}-\d{2}/) || [])[0] || "";
      const m = new Map();
      document.querySelectorAll('a[href*="/nwdesk/article/"]').forEach(a => {
        const tit = a.querySelector('.tit');
        const t = (tit ? tit.textContent : a.textContent || '').replace(/\s+/g,' ').trim();
        if (t.length > 6 && !m.has(a.href)) m.set(a.href, { title: t, url: a.href });
      });
      return { pageDate, items: [...m.values()] };
    }));
    if (pageDate === D_DASH) push("중앙방송", "MBC 뉴스데스크", items);
    else push("중앙방송", "MBC 뉴스데스크", [], `사이트 최신분이 ${pageDate||"?"} — 대상(${D_DASH})과 불일치`);
  } catch (e) { push("중앙방송","MBC 뉴스데스크",[],"실패: "+e.message); }

  // SBS 8뉴스 (broad_date)
  try {
    const items = await withPage(`https://news.sbs.co.kr/news/programMain.do?prog_cd=R1&broad_date=${D}`, p => p.evaluate(() => {
      const m = new Map();
      document.querySelectorAll('a[href*="endPage.do?news_id="]').forEach(a => {
        let t = (a.textContent||'').replace(/\s+/g,' ').trim()
          .replace(/^(동영상 기사|알림|속보)\s*/,'').replace(/^\d{1,2}:\d{2}\s*/,'')
          .replace(/^(정치|경제|사회|국제|문화|스포츠|생활)\s*/,'').replace(/^\d+시간 전\s*/,'');
        const id = (a.href.match(/news_id=(N\d+)/)||[])[1];
        if (id && t.length > 8 && !m.has(id)) m.set(id, { title: t, url: `https://news.sbs.co.kr/news/endPage.do?news_id=${id}` });
      });
      return [...m.values()];
    }));
    push("중앙방송", "SBS 8뉴스", items.slice(0, 40));
  } catch (e) { push("중앙방송","SBS 8뉴스",[],"실패: "+e.message); }

  // JTBC 뉴스룸 — 프로그램 전용 페이지(/program/NG10000002). 리포트는 /video/NB… 형태.
  try {
    const { items, pageDate } = await withPage("https://news.jtbc.co.kr/program/NG10000002", async p => {
      // 목록은 첫 11건만 그려지고 「더보기」 버튼으로 펼쳐진다(스크롤로는 안 늘어남 — 2026-08-23 확인:
      // 그동안 매일 정확히 11건만 잡힌 원인). 버튼이 사라질 때까지 최대 8회 클릭(클릭은 네트워크 요청 없음).
      for (let i = 0; i < 8; i++) {
        const more = await p.evaluate(() => {
          const b = [...document.querySelectorAll("button, a")].find(e => /더\s?보기/.test(e.textContent || ""));
          if (!b) return false; b.click(); return true;
        });
        if (!more) break;
        await new Promise(r => setTimeout(r, 1500));
      }
      return p.evaluate(() => {
        const m = new Map();
        document.querySelectorAll('a[href*="/video/NB"]').forEach(a => {
          const t = (a.textContent||'').replace(/\s+/g,' ').trim();
          const id = (a.href.match(/(NB\d+)/)||[])[1];
          if (id && t.length > 8 && !m.has(id)) m.set(id, { title: t, url: `https://news.jtbc.co.kr/article/${id}` });
        });
        const dm = document.body.innerText.match(/(\d{1,2})월\s*(\d{1,2})일/);
        return { items: [...m.values()], pageDate: dm ? `${dm[1].padStart(2,"0")}-${dm[2].padStart(2,"0")}` : "" };
      });
    }, 2000);
    const want = `${D.slice(4,6)}-${D.slice(6,8)}`;
    if (!pageDate || pageDate === want) push("중앙방송", "JTBC 뉴스룸", items.slice(0, 40));
    else push("중앙방송", "JTBC 뉴스룸", [], `사이트 최신 방송분이 ${pageDate} — 대상(${want})과 불일치`);
  } catch (e) { push("중앙방송","JTBC 뉴스룸",[],"실패: "+e.message); }

  // TV조선 뉴스9 — 프로그램 전용 페이지(broadcast 뉴스판) + URL 날짜 필터로 그 방송분만
  try {
    const items = await withPage("https://broadcast.tvchosun.com/news/newspan/ch19.cstv", p => p.evaluate((dUrl) => {
      const m = new Map();
      document.querySelectorAll(`a[href*="html_dir/${dUrl}/"]`).forEach(a => {
        let t = (a.textContent||'').replace(/\s+/g,' ').trim()
          .replace(/^(정치|경제|사회|국제|문화|스포츠|생활|연예|날씨)\s+/, '');   // 앞 카테고리 라벨 제거
        if (t.length > 52) t = t.slice(0, 50) + '…';
        if (t.length > 8 && !m.has(a.href)) m.set(a.href, { title: t, url: a.href });
      });
      return [...m.values()];
    }, D_URL), 2000);
    // 주말 0건은 정상: 뉴스9 게시판(ch19)은 평일 방영분만 게시된다
    // (2026-07-26 일요일 실측 — 게시판에 금요일자 27건만 존재, 주말 뉴스 전용 게시판 자체가 없음)
    const dow = new Date(D_DASH + "T12:00:00Z").getUTCDay();
    const zeroNote = (dow === 0 || dow === 6)
      ? "주말은 뉴스9 미편성 — 게시판에 주말 방영분이 올라오지 않음 (정상)"
      : `뉴스9 페이지에 ${D_DASH}자 리포트 없음`;
    push("중앙방송", "TV조선 뉴스9", items.slice(0, 40), items.length === 0 ? zeroNote : undefined);
  } catch (e) { push("중앙방송","TV조선 뉴스9",[],"실패: "+e.message); }

  // 부산MBC (목록 항목 날짜 필터)
  try {
    const items = await withPage("https://busanmbc.co.kr/01_new/new01.asp", p => p.evaluate((dDash) => {
      const m = new Map();
      document.querySelectorAll('a[href*="NewsViewFunc"]').forEach(a => {
        const idx = ((a.getAttribute('href')||'').match(/NewsViewFunc\((\d+)/)||[])[1];
        const text = (a.textContent||'').replace(/\s+/g,' ').trim();
        if (!idx) return;
        const hasDate = text.includes(dDash);
        let t = text.replace(/20\d{2}-\d{2}-\d{2}/g,'').trim();
        if (hasDate && t.length > 6 && !m.has(idx))
          m.set(idx, { title: t.slice(0, 80), url: `https://busanmbc.co.kr/01_new/new01_view.asp?idx=${idx}` });
      });
      return [...m.values()];
    }, D_DASH), 2500);
    // 부산MBC 목록은 프로그램 구분이 없다(뉴스데스크 리포트 + 아침·낮 기사 혼재).
    // 상세 페이지의 게시 시각으로 판별: 뉴스데스크 방송분 = 20:00~21:59, 아침 기사 = 07시대.
    let deskItems = items;
    if (items.length) {
      const timed = await withPage("https://busanmbc.co.kr/01_new/new01.asp", p => p.evaluate(async (list) => {
        const out = [];
        for (const it of list.slice(0, 40)) {
          const idx = (String(it.url).match(/idx=(\d+)/) || [])[1];
          let hm = "";
          try {
            const h = await (await fetch(`/01_new/new01_view.asp?idx=${idx}`)).text();
            const m = h.replace(/<[^>]+>/g, " ").match(/\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/);
            if (m) hm = `${m[1].padStart(2, "0")}:${m[2]}`;
          } catch {}
          out.push({ ...it, hm });
        }
        return out;
      }, items), 1500);
      const desk = timed.filter(x => /^(20|21):/.test(x.hm));
      if (desk.length) deskItems = desk.map(({ title, url }) => ({ title, url }));
    }
    push("부산방송", "부산MBC 뉴스데스크", deskItems.slice(0, 35),
      deskItems.length === 0 ? `목록에 ${D_DASH}자 기사 없음` : undefined);
  } catch (e) { push("부산방송","부산MBC 뉴스데스크",[],"실패: "+e.message); }

  // KNN 뉴스아이 (?date=)
  try {
    const items = await withPage(`https://news.knn.co.kr/news/program/newseye?date=${D}`, p => p.evaluate(() => {
      const m = new Map();
      document.querySelectorAll('a[href*="/news/article/"]').forEach(a => {
        const tit = a.querySelector('.tit');
        let t = (tit ? tit.textContent : a.textContent||'').replace(/\s+/g,' ').trim();
        t = t.replace(/\s*(사회|정치|경제|사건사고|날씨|문화|스포츠|국제|생활문화)$/,'');
        if (t.length > 6 && !m.has(a.href)) m.set(a.href, { title: t, url: a.href });
      });
      return [...m.values()];
    }));
    push("부산방송", "KNN 뉴스아이", items.slice(0, 40));
  } catch (e) { push("부산방송","KNN 뉴스아이",[],"실패: "+e.message); }

  // SBS 부산 키워드 (부산 관련 SBS 보도 — 항목 날짜 필터)
  // ⚠ SBS 목록은 최근 기사에 절대날짜 대신 상대 표기("방금 전"·"N분 전"·"N시간 전"·"어제")를 섞어 쓴다
  //   (2026-07-26 실측 — 당일 기사가 전부 상대 표기라 0건 오탐). 상대 표기를 날짜로 환산해 함께 매칭한다.
  try {
    const items = await withPage("https://news.sbs.co.kr/news/keywordList.do?keyword=%EB%B6%80%EC%82%B0", p => p.evaluate((dDot, nowKstMs) => {
      const dayOf = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, ".");
      const m = new Map();
      document.querySelectorAll('a[href*="endPage.do?news_id="]').forEach(a => {
        const box = a.closest('li,div') || a;
        const boxText = (box.textContent||'').replace(/\s+/g,' ');
        const id = (a.href.match(/news_id=(N\d+)/)||[])[1];
        let t = (a.textContent||'').replace(/\s+/g,' ').trim().replace(/^(동영상 기사|알림|속보)\s*/,'');
        if (!id || t.length <= 8 || m.has(id)) return;
        let ok = boxText.includes(dDot);                          // 절대 표기 YYYY.MM.DD
        if (!ok) {
          const hr = boxText.match(/(\d+)\s*시간\s*전/);
          if (/방금 전|(\d+)\s*분\s*전|오늘/.test(boxText)) ok = dayOf(nowKstMs) === dDot;
          else if (hr) ok = dayOf(nowKstMs - Number(hr[1]) * 3600000) === dDot;
          else if (/어제/.test(boxText)) ok = dayOf(nowKstMs - 86400000) === dDot;
        }
        if (ok) m.set(id, { title: t, url: `https://news.sbs.co.kr/news/endPage.do?news_id=${id}` });
      });
      return [...m.values()];
    }, D_DOT, Date.now() + 9 * 3600 * 1000));
    push("부산방송", "SBS 부산관련", items.slice(0, 25), items.length === 0 ? `${D_DOT}자 부산 태그 기사 없음` : undefined);
  } catch (e) { push("부산방송","SBS 부산관련",[],"실패: "+e.message); }

  // 지면 (최신 헤드라인 — 날짜 미지정)
  // 신문 홈에는 옛 기획기사가 섞이므로 URL 속 날짜로 최신분만 통과
  // 국제신문 key=YYYYMMDD.xxx 는 지면 게재일(다음날 조간)이라 D·D+1 허용, 부산일보 code=YYYYMMDD... 는 D-1·D 허용
  const paperPick = {
    kookje: (okDates) => {
      const m = new Map();
      document.querySelectorAll('a[href*="newsbody.asp"]').forEach(a => {
        const t = (a.textContent||'').replace(/\s+/g,' ').trim();
        const key = (a.href.match(/key=([\d.]+)/)||[])[1];
        if (!key || !okDates.includes(key.slice(0,8))) return;
        if (t.length > 8 && !m.has(key)) m.set(key, { title: t, url: a.href });
      });
      return [...m.values()];
    },
    busanilbo: (okDates) => {
      const m = new Map();
      document.querySelectorAll('a[href*="view.php?code="]').forEach(a => {
        const t = (a.textContent||'').replace(/\s+/g,' ').trim();
        const code = (a.href.match(/code=(\d+)/)||[])[1];
        if (!code || !okDates.includes(code.slice(0,8))) return;
        if (t.length > 8 && !m.has(code)) m.set(code, { title: t, url: `https://www.busan.com/view/busan/view.php?code=${code}` });
      });
      return [...m.values()];
    },
  };
  try {
    const items = await withPage(["https://www.kookje.co.kr/", "http://www.kookje.co.kr/"], p => p.evaluate(`(${paperPick.kookje.toString()})(${JSON.stringify([D, D_NEXT])})`));
    push("지면", "국제신문", items.slice(0, 40));
  } catch (e) { push("지면","국제신문",[],"실패: "+e.message); }
  try {
    const items = await withPage(["https://www.busan.com/", "https://busan.com/"], p => p.evaluate(`(${paperPick.busanilbo.toString()})(${JSON.stringify([D_PREV, D])})`));
    push("지면", "부산일보", items.slice(0, 40));
  } catch (e) { push("지면","부산일보",[],"실패: "+e.message); }
} finally {
  await browser.close();
}

// ===== 키워드 스캔 1단계: 수집기사 제목 매치 (정확·오탐 없음) =====
// ※ 본문 언급은 아래 네이버 24시간 창 검색이 담당 — 네이버는 기사 '본문만' 색인하므로
//   페이지 사이드바("많이 본 뉴스" 등)로 인한 오탐이 원천적으로 없다.
if (KEYWORDS.length) {
  const all = results.flatMap(s => s.items);
  for (const it of all) if (KEYWORDS.some(k => it.title.includes(k))) it.kw = true;
  console.log(`\n키워드 제목 매치(수집기사): ${all.filter(it => it.kw).length}건`);
}

// ===== 키워드 스캔 2단계: 24시간 창 전체매체 검색 (네이버 뉴스 API) =====
// 전날 22:01 ~ 당일 22:01 사이 발행된, 우리 모니터링 9개 매체의 키워드 언급(제목+본문) 기사 전부.
if (KEYWORDS.length && process.env.NAVER_ID && process.env.NAVER_SECRET) {
  const KW_DOMAINS = [
    { host: "news.kbs.co.kr",  name: "KBS" },
    { host: "imnews.imbc.com", name: "MBC" },
    { host: "news.sbs.co.kr",  name: "SBS" },
    { host: "jtbc.co.kr",      name: "JTBC" },
    { host: "tvchosun.com",    name: "TV조선" },
    { host: "knn.co.kr",       name: "KNN" },
    { host: "busanmbc.co.kr",  name: "부산MBC" },
    { host: "kookje.co.kr",    name: "국제신문" },
    { host: "busan.com",       name: "부산일보" },
  ];
  const end   = new Date(`${D_DASH}T22:01:00+09:00`);
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  // NAVER API HUB (신규 체계, 2026-06 이관): naverapihub.apigw.ntruss.com + X-NCP-APIGW-* 헤더
  const naverH = { "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_ID, "X-NCP-APIGW-API-KEY": process.env.NAVER_SECRET };
  const stripB = s => String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g,"<").replace(/&gt;/g,">");
  const winItems = [];
  try {
    for (const kw of KEYWORDS) {
      for (let startIdx = 1; startIdx <= 901; startIdx += 100) {
        const u = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(kw)}&display=100&start=${startIdx}&sort=date`;
        const j = await (await fetch(u, { headers: naverH })).json();
        const items = j.items || [];
        for (const it of items) {
          const pub = new Date(it.pubDate);
          if (!(pub > start && pub <= end)) continue;
          const dom = KW_DOMAINS.find(d => (it.originallink || it.link || "").includes(d.host));
          if (!dom) continue;
          winItems.push({ title: stripB(it.title), url: it.originallink || it.link, kw: true, srcName: dom.name,
                          time: pub.toISOString() });
        }
        if (items.length < 100) break; // 마지막 페이지
        const oldest = items.length ? new Date(items[items.length-1].pubDate) : null;
        if (oldest && oldest < start) break; // 창 밖으로 벗어남
      }
    }
    // 기사 고유 ID 추출 (같은 기사가 다른 URL 형태로 와도 매칭되도록)
    const keyOf = u => {
      u = String(u);
      const pats = [/ncd=(\d+)/, /news_id=(N\d+)/, /(NB\d{6,})/, /article\/(\d+_\d+)/, /html_dir\/([\d/]+\d+)\.html/,
                    /knn\.co\.kr\/news\/article\/(\d+)/, /idx=(\d+)/, /key=([\d.]+)/, /view\.php\?code=(\d+)/];
      for (const p of pats) { const m = u.match(p); if (m) return m[1]; }
      return u.replace(/^https?:\/\//, "").replace(/\?.*$/, "").replace(/\/$/, "");
    };
    // 창 검색 히트가 이미 수집된 기사면 → 그 기사에 kw 마킹(엑셀 표에서 강조됨), 아니면 신규 목록으로
    const byKey = new Map();
    for (const s of results) for (const it of s.items) byKey.set(keyOf(it.url), it);
    const freshList = [];
    for (const w of winItems) {
      const k = keyOf(w.url);
      if (byKey.has(k)) byKey.get(k).kw = true;
      else freshList.push(w);
    }
    const dedup = [...new Map(freshList.map(it => [keyOf(it.url), it])).values()];
    results.push({ group: "키워드검색", source: `${KEYWORDS.join("·")} 24시간(전체매체)`, items: dedup });
    console.log(`키워드 24시간 창 검색: ${winItems.length}건 (신규 ${dedup.length}건) [${start.toISOString().slice(0,16)} ~ ${end.toISOString().slice(0,16)} UTC]`);
  } catch (e) {
    results.push({ group: "키워드검색", source: `${KEYWORDS.join("·")} 24시간(전체매체)`, items: [], note: "네이버 API 실패: " + e.message });
  }
} else if (KEYWORDS.length) {
  console.log("(네이버 API 키 미설정 — 24시간 창 검색 생략, 수집기사 본문 스캔만 수행)");
}

mkdirSync("data", { recursive: true });
writeFileSync("data/broadcasters.json", JSON.stringify({ date: D_DASH, keywords: KEYWORDS, sources: results }, null, 2));
console.log(`\n저장: data/broadcasters.json (${D_DASH})`);
