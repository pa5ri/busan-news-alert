' JTBC newsroom local collector - silent launcher (Task Scheduler, daily 21:40)
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Run "cmd /c cd /d """ & root & """ && node local\jtbc-local.mjs >> local\jtbc-local.log 2>&1", 0, False
