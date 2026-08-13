// 일회성 진단: 네이버 API에서 7/1~7/18 부산시의회 기사가 잡히는지 확인 (발송 없음)
const naverH = { "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_ID, "X-NCP-APIGW-API-KEY": process.env.NAVER_SECRET };
const RE = /부산시의회|부산광역시의회|부산광역시\s?시의회|부산\s시의회|부산시의원|부산\s시의원/;
const strip = s => String(s).replace(/<[^>]+>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&");
const A = new Date("2026-07-01T00:00:00+09:00"), B = new Date("2026-07-19T00:00:00+09:00");
const sleep = ms => new Promise(r=>setTimeout(r,ms));

for (const q of ["부산시의회","부산시의원","부산시의회 임시회","부산시의회 본회의","부산시의회 조례"]) {
  for (const sort of ["sim","date"]) {
    let minD = null, maxD = null, inWin = 0, inWinTitle = 0, total = 0;
    const samples = [];
    for (let start = 1; start <= 1000; start += 100) {
      const u = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=100&start=${start}&sort=${sort}`;
      const r = await fetch(u, { headers: naverH });
      if (!r.ok) { console.log(q, sort, "HTTP", r.status, (await r.text()).slice(0,120)); break; }
      const js = await r.json();
      for (const it of js.items || []) {
        total++;
        const d = new Date(it.pubDate);
        if (!minD || d < minD) minD = d;
        if (!maxD || d > maxD) maxD = d;
        if (d >= A && d < B) {
          inWin++;
          const t = strip(it.title);
          if (RE.test(t)) { inWinTitle++; if (samples.length < 5) samples.push(d.toISOString().slice(0,10)+" | "+t.slice(0,60)); }
        }
      }
      await sleep(120);
      if ((js.items||[]).length < 100) break;
    }
    console.log(`[${q}|${sort}] total=${total} 범위=${minD?.toISOString().slice(0,10)}~${maxD?.toISOString().slice(0,10)} 창내=${inWin} 창내제목매치=${inWinTitle}`);
    for (const s of samples) console.log("   ", s);
  }
}
