// 일회성: 전재수 시장 인터뷰를 취임(2026-07-01) 이후 시간순으로 전량 재업로드.
// 7월분은 우리 아카이브(7/19 시작) 이전이라 네이버 뉴스 검색으로 별도 수집한 목록을 사용한다.
const TOKEN = process.env.TG_BOT_TOKEN;
const GROUP = process.env.TG_TOPIC_GROUP;
const TOPICS = JSON.parse(process.env.TG_TOPICS || "{}");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LIST = [
  ["2026-07-01 08:01", "노컷뉴스[한판승부]", "\"메가 프로젝트, 와 우리는 없노? 野 정쟁대상 아냐\"", "https://www.nocutnews.co.kr/news/6541049"],
  ["2026-07-01 09:58", "SK브로드밴드[THE인터뷰]", "취임 첫날 대담 — \"1호 결재는 민생 100일 비상조치\"", "https://news.skbroadband.com/news/articleView.html?idxno=230800"],
  ["2026-07-08 05:01", "서울신문", "\"민생 100일 비상조치, 부산 다시 뛰게 할 것… 해양수도 꼭 완성\"", "https://www.seoul.co.kr/news/publicnews/local_govern/today_local/2026/07/08/20260708008001"],
  ["2026-07-13 21:06", "경향신문", "\"부산·경남, 공통사업 예산 위해 행정통합보다 '특별연합'\"", "https://www.khan.co.kr/article/202607132106025"],
  ["2026-07-15 13:10", "내일신문", "\"대한민국 미래 먹거리, 북극항로 선점할 것\"", "https://www.naeil.com/news/read/595462"],
  ["2026-07-20 19:11", "한국경제", "\"대형 해운기업 본사, 부산으로 통째 이전\"", "https://www.hankyung.com/article/2026072050021"],
  ["2026-07-22 20:04", "경남일보", "\"부울경은 운명공동체…'해양수도권' 완성해 수도권 일극 극복\"", "https://www.gnnews.co.kr/news/articleView.html?idxno=641537"],
  ["2026-07-23 17:00", "한국일보[민선9기 新동남권]", "\"민생은 즉시, 미래는 확실하게\"", "https://www.hankookilbo.com/news/article/A2026071516590000746"],
  ["2026-07-28 02:16", "국민일보", "\"해양수도 부산, 되돌릴 수 없는 수준으로 인프라 구축하겠다\"", "https://www.kmib.co.kr/article/view.asp?arcid=1785142105"],
  ["2026-07-31 16:12", "스카이데일리", "\"해양수도 완성으로 부산의 100년 성장동력 만들겠다\"", "https://m.skyedaily.com/news_view.html?ID=308908"],
  ["2026-08-03 12:23", "부산일보TV[영상]", "\"대통령과 3번 독대…해수부 산하기관 곧 '부산행'\"", "https://www.busan.com/view/busan/view.php?code=2026080311210048691"],
  ["2026-08-03 22:36", "포인트경제", "\"대한민국 넘어 글로벌 해양수도로 도약시키겠다\"", "https://www.pointe.co.kr/news/articleView.html?idxno=82734"],
  ["2026-08-04 13:08", "내외경제TV", "\"시민의 삶을 최우선 가치로 시정 운영할 터\"", "https://www.nbntv.co.kr/news/articleView.html?idxno=4023514"],
  ["2026-08-04 16:18", "신아일보", "\"민생 회복 최우선…해양수도 완성\"", "https://www.shinailbo.co.kr/news/articleView.html?idxno=5047880"],
  ["2026-08-05 07:02", "천지일보", "\"말보다 성과로 시민이 체감하게… '해양수도 부산'\"", "https://www.newscj.com/news/articleView.html?idxno=3422359"],
  ["2026-08-05 09:46", "전국매일[파워인터뷰]", "\"민생 100일 승부…해양수도 성과로 증명하겠다\"", "https://www.jeonmae.co.kr/news/articleView.html?idxno=1281050"],
  ["2026-08-10 15:50", "인더스트리뉴스", "[전국본부 출범 인터뷰] 취임 100일 앞두고 성과·향후 시정 운영", "https://www.industrynews.co.kr/news/articleView.html?idxno=83997"],
  ["2026-08-10 17:11", "아이뉴스24", "\"해양수도 완성·AI 대전환…성과로 증명하겠다\"", "http://www.inews24.com/view/1993539"],
];

let last = 0;
async function send(text) {
  const gap = 3500 - (Date.now() - last);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  for (let i = 0; i < 4; i++) {
    last = Date.now();
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: GROUP, message_thread_id: TOPICS["인터뷰"], text,
                             parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (j.ok) return true;
    const ra = j.parameters?.retry_after;
    if (ra) { await new Promise(r => setTimeout(r, (ra + 1) * 1000)); continue; }
    console.log("실패:", j.description); return false;
  }
  return false;
}

await send(`🎤 <b>전재수 시장 인터뷰 아카이브</b>\n<i>민선 9기 취임(2026.7.1.) 이후 시장 직접 인터뷰를 시간순으로 정리했습니다. 총 ${LIST.length}건.</i>`);
let ok = 0;
for (const [dt, src, title, url] of LIST) {
  const [d, t] = dt.split(" ");
  const [, m, dd] = d.split("-");
  if (await send(`🎤 <b>[${esc(src)}]</b> <b>${esc(title)}</b>\n<i>${m}/${dd} ${t}</i>\n${url}`)) ok++;
}
console.log(`인터뷰 업로드: ${ok}/${LIST.length}건`);
