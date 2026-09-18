import puppeteer from "puppeteer";
process.env.NODE_TLS_REJECT_UNAUTHORIZED="0";
const b = await puppeteer.launch({ headless: true, args:["--no-sandbox","--disable-dev-shm-usage","--ignore-certificate-errors"] });
for (const wu of ["networkidle2","domcontentloaded"]) {
  const p = await b.newPage();
  await p.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36");
  await p.setViewport({width:1366,height:900});
  await p.setExtraHTTPHeaders({"Accept-Language":"ko-KR,ko;q=0.9,en;q=0.5"});
  try {
    const r = await p.goto("https://busanmbc.co.kr/01_new/new01.asp",{waitUntil:wu,timeout:60000});
    await new Promise(r=>setTimeout(r,2500));
    const o = await p.evaluate(()=>({url:location.href,title:document.title,n:document.querySelectorAll('a[href*="NewsViewFunc"]').length,
      dates:(document.body.innerText.match(/20\d{2}-\d{2}-\d{2}/g)||[]).slice(0,8),len:document.documentElement.outerHTML.length,body:document.body.innerText.slice(0,300)}));
    console.log(wu, r && r.status(), JSON.stringify(o));
  } catch(e){ console.log(wu,"ERR",e.message); }
  await p.close();
}
await b.close();
