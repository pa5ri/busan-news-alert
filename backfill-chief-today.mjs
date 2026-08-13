// 일회성: 인물 검색 최초 가동(2026-08-13 15:44 KST) 때 백로그로 흘린 '오늘' 기사 소급 발송
// 대상: 오늘 00:00 ~ 15:44 KST 발행, 박홍배/이성권(제목·본문) 또는 시당 조직명(제목) 기사. 실행 후 git rm.
import { tokensOf } from "./insight.mjs";

const { NAVER_ID, NAVER_SECRET, TG_BOT_TOKEN, TG_TOPIC_GROUP } = process.env;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const A = new Date("2026-08-13T00:00:00+09:00");
const B = new Date("2026-08-13T15:44:00+09:00");   // 인물 패스 첫 가동 시각 — 이후분은 루프가 담당

const ROOMS = [
  { topic: "민주당시당",   person: "박홍배", org: /(?:더불어)?민주당\s?부산\s?시당/, orgQ: "민주당 부산시당", emoji: "🔵", label: "민주당 부산시당" },
  { topic: "국민의힘시당", person: "이성권", org: /(?:국민의힘|국힘)\s?부산\s?시당/, orgQ: "국민의힘 부산시당", emoji: "🔴", label: "국민의힘 부산시당" },
];

const PRESS = {
  "yna.co.kr":"연합뉴스","yonhapnewstv.co.kr":"연합뉴스TV","newsis.com":"뉴시스","news1.kr":"뉴스1",
  "news.kbs.co.kr":"KBS","imnews.imbc.com":"MBC","news.sbs.co.kr":"SBS","jtbc.co.kr":"JTBC",
  "tvchosun.com":"TV조선","mbn.co.kr":"MBN","ichannela.com":"채널A","ytn.co.kr":"YTN",
  "chosun.com":"조선일보","joongang.co.kr":"중앙일보","donga.com":"동아일보","hani.co.kr":"한겨레",
  "khan.co.kr":"경향신문","kmib.co.kr":"국민일보","seoul.co.kr":"서울신문","hankookilbo.com":"한국일보",
  "hankyung.com":"한국경제","mk.co.kr":"매일경제","fnnews.com":"파이낸셜뉴스","edaily.co.kr":"이데일리",
  "mt.co.kr":"머니투데이","heraldcorp.com":"헤럴드경제","asiae.co.kr":"아시아경제","etnews.com":"전자신문",
  "busan.com":"부산일보","kookje.co.kr":"국제신문","knn.co.kr":"KNN","busanmbc.co.kr":"부산MBC",
  "nocutnews.co.kr":"노컷뉴스","ohmynews.com":"오마이뉴스","newspim.com":"뉴스핌",
};
const nameOf = url => { const h=String(url).replace(/^https?:\/\//,"").replace(/^www\./,"").split("/")[0];
  const d=Object.keys(PRESS).find(x=>h===x||h.endsWith("."+x)); return d?PRESS[d]:(h||"언론"); };
const strip = s => String(s).replace(/<[^>]+>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&apos;|&#39;/g,"'");
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const keyOf = u => String(u).replace(/^https?:\/\//,"").replace(/#.*$/,"").replace(/\/$/,"");
const normTitle = t => strip(t).replace(/\[(단독|속보|포토|영상|종합|1보|2보|3보|기자수첩|현장|르포)\]/gi,"")
  .replace(/[\[\](){}〈〉<>「」'"'"·…‥,.!?\s-]/g,"").slice(0,30);
const RE_CAPTION = /^[^"'…,·]{0,16}(하는|나눈|나선|만난|둘러보는|참석한)\s?[가-힣]{2,5}\s?(의원|위원장|시장|장관|대표|총리|후보|사장|청장|지사|의장|목사)$/;
const RE_PHOTO = /^\[?(포토|사진|화보|카드뉴스|포토뉴스)\]/;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const naverH = { "X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_SECRET };
const dupToks = a => [...new Set(a.filter(t=>!/^\d+$/.test(t)))];

for (const room of ROOMS) {
  const thread = TOPICS[room.topic];
  if (!thread) { console.log(room.topic, "thread 없음"); continue; }
  const items = []; const seenK = new Set(), seenN = new Set();
  for (const q of [room.person, room.orgQ]) {
    for (let start = 1; start <= 300; start += 100) {
      const u = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=100&start=${start}&sort=date`;
      let r; try { r = await fetch(u, { headers: naverH }); } catch { break; }
      if (!r.ok) break;
      const js = await r.json();
      for (const it of js.items || []) {
        const pub = new Date(it.pubDate);
        if (isNaN(pub) || pub < A || pub >= B) continue;
        const t = strip(it.title), ctx = strip(it.description).slice(0, 300);
        const hit = t.includes(room.person) || ctx.includes(room.person) || room.org.test(t);
        if (!hit) continue;
        if (RE_PHOTO.test(t) || RE_CAPTION.test(t)) continue;    // 의례성 캡션 제외
        const url = it.originallink || it.link;
        const k = keyOf(url); if (seenK.has(k)) continue;
        const n = normTitle(t); if (seenN.has(n)) continue;
        seenK.add(k); seenN.add(n);
        items.push({ t, url, pub, ctx, name: nameOf(url) });
      }
      await sleep(150);
      if ((js.items||[]).length < 100) break;
    }
  }
  // 사안 클러스터(토큰 겹침 0.7) — 대표 1건만
  items.sort((a,b)=>a.pub-b.pub);
  const clusters = [];
  for (const it of items) {
    const toks = dupToks(tokensOf(it.t)); const set = new Set(toks);
    let home = null;
    for (const c of clusters) {
      const m = Math.min(set.size, c.toks.size); if (m < 3) continue;
      let ov = 0; for (const x of c.toks) if (set.has(x)) ov++;
      if (ov / m >= 0.7) { home = c; break; }
    }
    if (home) home.arr.push(it);
    else clusters.push({ toks: set, arr: [it] });
  }
  console.log(`${room.topic}: 오늘 놓친 ${items.length}건 → ${clusters.length}개 사안`);
  let sent = 0;
  for (const c of clusters) {
    const rep = c.arr.find(x=>x.ctx) || c.arr[0];
    const hh = String(new Date(rep.pub.getTime()+9*3600e3).getUTCHours()).padStart(2,"0");
    const mm = String(new Date(rep.pub.getTime()+9*3600e3).getUTCMinutes()).padStart(2,"0");
    let msg = `${room.emoji} <b>[${room.label}]</b> <b>${esc(rep.t)}</b>\n<i>${esc(rep.name)} · 오늘 ${hh}:${mm}</i>\n${rep.url}`;
    if (rep.ctx) msg += `\n\n…${esc(rep.ctx.slice(0,220))}…`;
    if (c.arr.length > 1) msg += `\n\n📎 같은 사안 보도 ${c.arr.length}건`;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, { method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ chat_id: TG_TOPIC_GROUP, message_thread_id: thread, text: msg, parse_mode:"HTML", disable_web_page_preview:true }) });
      if (r.ok) { sent++; break; }
      const js = await r.json().catch(()=>({}));
      if (r.status === 429) { await sleep(((js.parameters?.retry_after)||5)*1000+1000); continue; }
      console.error("send fail", r.status, JSON.stringify(js).slice(0,150)); break;
    }
    await sleep(3500);
  }
  console.log(`${room.topic} 발송: ${sent}/${clusters.length}`);
}
