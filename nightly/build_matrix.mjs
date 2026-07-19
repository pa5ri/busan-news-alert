// 매트릭스형 3탭 xlsx: 중앙방송/부산방송/지면 (매체=열, 기사=세로 셀, 전량)
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("data/broadcasters.json", "utf8"));
const bc = data.sources || data;              // v2({date,sources}) / v1(배열) 겸용
const dataDate = data.date || null;           // "YYYY-MM-DD"

const d = dataDate ? new Date(dataDate + "T12:00:00+09:00") : new Date();
const days = ["일","월","화","수","목","금","토"];
const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}(${days[d.getDay()]})`;
const fstamp = dateStr.slice(0,10).replace(/\./g,"");

const LAYOUT = {
  "중앙방송": ["KBS 뉴스9","MBC 뉴스데스크","SBS 8뉴스","JTBC 뉴스룸","TV조선 뉴스9"],
  "부산방송": ["KBS부산","부산MBC","KNN 뉴스아이","SBS(부산검색)"],
  "지면": ["국제신문","부산일보"],
};
const byName = Object.fromEntries(bc.map(s => [s.source, s]));

const COLORS = {
  "KBS 뉴스9":"FF1A5FB4","MBC 뉴스데스크":"FF1A5FB4","SBS 8뉴스":"FF1A5FB4",
  "JTBC 뉴스룸":"FF6A1B9A","TV조선 뉴스9":"FF6A1B9A",
  "KBS부산":"FF00796B","부산MBC":"FF00796B","KNN 뉴스아이":"FF00796B","SBS(부산검색)":"FF00796B",
  "국제신문":"FF2E7D32","부산일보":"FF2E7D32",
};

const wb = new ExcelJS.Workbook();
for (const [tabName, cols] of Object.entries(LAYOUT)) {
  const ws = wb.addWorksheet(tabName, { views:[{ state:"frozen", ySplit:1 }] });
  ws.columns = cols.map(()=>({ width: 42 }));

  const head = ws.getRow(1);
  cols.forEach((name, ci) => {
    const src = byName[name];
    const c = head.getCell(ci+1);
    c.value = `${name}  (${src?.items.length ?? 0})`;
    c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: COLORS[name]||"FF37474F" } };
    c.font = { bold:true, size:12, color:{ argb:"FFFFFFFF" } };
    c.alignment = { vertical:"middle", horizontal:"center" };
    c.border = { right:{ style:"thin", color:{argb:"FFFFFFFF"} } };
  });
  head.height = 26;

  const maxLen = Math.max(1, ...cols.map(n => byName[n]?.items.length || (byName[n]?.note ? 1 : 0)));
  for (let r = 0; r < maxLen; r++) {
    const row = ws.getRow(r+2);
    cols.forEach((name, ci) => {
      const src = byName[name];
      const it = src?.items[r];
      const c = row.getCell(ci+1);
      if (it) {
        const title = String(it.title).replace(/https?:\/\/\S+/g,"").replace(/\s+/g," ").trim().slice(0,70);
        if (title) {
          // 키워드(전재수) 언급 기사는 ★ + 빨간 굵은 글씨 + 연노랑 배경으로 강조
          c.value = { text: (it.kw ? "★ " : "") + title, hyperlink: String(it.url).replace(/&recCode=.*$/,"").replace(/&invenCode=.*$/,"") };
          c.font = it.kw ? { color:{ argb:"FFB3261E" }, bold:true, size:10 }
                         : { color:{ argb:"FF1155CC" }, size:10 };
        }
      } else if (r === 0 && src?.note && src.items.length === 0) {
        c.value = `— ${src.note} —`;
        c.font = { italic:true, size:9, color:{ argb:"FF999999" } };
      }
      c.alignment = { vertical:"top", wrapText:true };
      c.border = { bottom:{ style:"hair", color:{argb:"FFDDDDDD"} }, right:{ style:"hair", color:{argb:"FFEEEEEE"} } };
      if (it?.kw) c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFFF2CC" } };
      else if (r % 2 === 1 && it) c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFF5F8FC" } };
    });
    row.height = 30;
  }
}

// ===== 키워드 언급 탭 (전재수 등) =====
const KW = data.keywords || [];
if (KW.length) {
  const kwItems = [];
  for (const s of bc) for (const it of s.items) if (it.kw) kwItems.push({ src: it.srcName || s.source, ...it });
  const ws = wb.addWorksheet(`${KW.join("·")} 언급`, { views:[{ state:"frozen", ySplit:1 }] });
  ws.columns = [{ width: 16 }, { width: 80 }];
  const head = ws.getRow(1);
  [["매체"],[`"${KW.join("·")}" 언급 기사  (${kwItems.length}건 — 제목·본문 검색)`]].forEach((v,ci)=>{
    const c = head.getCell(ci+1);
    c.value = v[0];
    c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFB3261E" } };
    c.font = { bold:true, size:12, color:{ argb:"FFFFFFFF" } };
    c.alignment = { vertical:"middle", horizontal: ci===0?"center":"left", indent: ci===0?0:1 };
  });
  head.height = 26;
  kwItems.forEach((it, r) => {
    const row = ws.getRow(r+2);
    row.getCell(1).value = it.src;
    row.getCell(1).font = { size:10, bold:true, color:{ argb:"FF555555" } };
    row.getCell(1).alignment = { vertical:"top", horizontal:"center" };
    const c = row.getCell(2);
    const title = String(it.title).replace(/\s+/g," ").trim().slice(0,80);
    c.value = { text: title, hyperlink: it.url };
    c.font = { color:{ argb:"FF1155CC" }, size:10 };
    c.alignment = { vertical:"top", wrapText:true, indent:1 };
    if (r % 2 === 1) [1,2].forEach(i=>row.getCell(i).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFDF3F2" } });
    row.height = 26;
  });
  if (!kwItems.length) {
    const c = ws.getCell("B2");
    c.value = "— 오늘 수집 기사 중 언급 없음 —";
    c.font = { italic:true, size:10, color:{ argb:"FF999999" } };
  }
  console.log(` [키워드] ${KW.join("·")}: ${kwItems.length}건`);
}

const fname = `부산_뉴스모니터링_${fstamp}.xlsx`;
await wb.xlsx.writeFile(fname);
console.log("생성:", fname, "|", dateStr);
for (const [tab, cols] of Object.entries(LAYOUT))
  console.log(` [${tab}]`, cols.map(n=>`${n}:${byName[n]?.items.length||0}`).join("  "));
