' [단독] 논리 DB + 전재수 기사 본문 DB local collectors - silent launcher (Task Scheduler, daily 08:30)
' 2026-10-25: jeon-db(전재수 언급 기사 본문 전수 저장)를 scoop-db 다음에 이어서 실행
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Run "cmd /c cd /d """ & root & """ && node local\scoop-db.mjs >> local\scoop-db.log 2>&1 & node local\jeon-db.mjs >> local\jeon-db.log 2>&1", 0, False
