' [단독] 논리 DB + 전재수 기사 본문 DB local collectors - silent launcher (Task Scheduler, daily 08:30)
' 2026-10-25: jeon-db(전재수 언급 기사 본문 전수 저장)를 scoop-db 다음에 이어서 실행
' 2026-11-01: 이어서 interview-audit(저장 본문으로 인터뷰 누락 점검 → 전재수기사\인터뷰_점검.json)
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Run "cmd /c cd /d """ & root & """ && node local\scoop-db.mjs >> local\scoop-db.log 2>&1 & node local\jeon-db.mjs >> local\jeon-db.log 2>&1 & node local\interview-audit.mjs >> local\interview-audit.log 2>&1", 0, False
