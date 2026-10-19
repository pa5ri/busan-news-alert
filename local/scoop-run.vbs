' [단독] 논리 DB local collector - silent launcher (Task Scheduler, daily 08:30)
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Run "cmd /c cd /d """ & root & """ && node local\scoop-db.mjs >> local\scoop-db.log 2>&1", 0, False
