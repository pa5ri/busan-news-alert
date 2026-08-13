// 일회성 진단: 인물 전용 검색(박홍배·이성권)이 하루 몇 건인지, 무엇이 잡히는지 (발송 없음)
const naverH = { "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_ID, "X-NCP-APIGW-API-KEY": process.env.NAVER_SECRET };
const strip = s => String(s).replace(/<[^>]+>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&");
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const kst = d => new Date(d.getTime()+9*3600*1000).toISOString().slice(0,10);
const today = kst(new Date());

for (const q of ["박홍배", "이성권"]) {
  const byDay = {}; const samples = []; const titleHit = { t: 0, b: 0 };
  for (let start = 1; start <= 300; start += 100) {
    const u = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=100&start=${start}&sort=date`;
    const r = await fetch(u, { headers: naverH });
    if (!r.ok) { console.log(q, "HTTP", r.status); break; }
    const js = await r.json();
    for (const it of js.items || []) {
      const d = kst(new Date(it.pubDate));
      const t = strip(it.title), c = strip(it.description);
      if (!(t.includes(q) || c.includes(q))) continue;
      byDay[d] = (byDay[d] || 0) + 1;
      if (t.includes(q)) titleHit.t++; else titleHit.b++;
      if (d === today && samples.length < 6) samples.push((t.includes(q) ? "[제목] " : "[본문] ") + t.slice(0, 58));
    }
    await sleep(150);
    if ((js.items||[]).length < 100) break;
  }
  const days = Object.keys(byDay).sort().slice(-5);
  console.log(`=== ${q} | 제목매치 ${titleHit.t} · 본문매치 ${titleHit.b}`);
  for (const d of days) console.log(`    ${d}: ${byDay[d]}건`);
  samples.forEach(s => console.log("    ·", s));
}
