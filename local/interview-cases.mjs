// 인터뷰 판별 고정 사례(2026-11-04) — 규칙을 고칠 때마다 돌린다. 사용자가 짚었던 기사를 실제 네이버 본문으로 판별한다. 발송 없음.
// 실행: node local/interview-cases.mjs   (틀린 것이 있으면 종료코드 1). 새로 지적받은 기사는 여기에 한 줄 추가한다.
import { interviewCheck } from "../interview.mjs";
const N = "https://n.news.naver.com/mnews/article/";
const yes = [
  ["JTBC 뉴스룸 10/31", N + "437/0000518527", "JTBC"],
  ["뉴스1 초대석 11/1(서술형)", N + "421/0009262391", "뉴스1"],
  ["시사IN 10/27(물음표 문답)", N + "308/0000038903", "시사IN"],
  ["서울신문 10/19(짧은 문답)", N + "081/0003690082", "서울신문"],
  ["머니투데이 10/6", N + "008/0005422455", "머니투데이"],
  ["뉴시스 취임 100일 10/6", N + "003/0014235167", "뉴시스"],
  ["시사저널 10/25", N + "586/0000140801", "시사저널"],
  ["헤럴드경제 10/27", N + "016/0002714975", "헤럴드경제"],
  ["YTN 라디오 10/27", N + "052/0002424373", "YTN"],
  ["CBS 한판승부 10/30", N + "079/0004204658", "노컷뉴스"],
  ["동아일보 11/1", N + "020/0003759167", "동아일보"],
];
const no = [
  ["뉴시스 주간정책회의 11/4(자료사진 설명에만 '인터뷰')", N + "003/0014300757", "뉴시스"],
];
let bad = 0;
for (const [n, u, s] of yes) { const c = await interviewCheck(u, s); if (!c.ok) bad++; console.log(c.ok ? "OK  " : "틀림", "인터뷰 |", n, "→", c.why); }
for (const [n, u, s] of no) { const c = await interviewCheck(u, s); if (c.ok) bad++; console.log(!c.ok ? "OK  " : "틀림", "아님   |", n, "→", c.why); }
console.log(bad ? `틀린 것 ${bad}건` : `전부 기대대로(${yes.length + no.length}건)`);
process.exit(bad ? 1 : 0);
