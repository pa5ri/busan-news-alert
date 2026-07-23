' Busan council monitor silent launcher (Task Scheduler)
Set sh = CreateObject("Wscript.Shell")
sh.Run "cmd /c cd /d ""C:\Users\user\Desktop\" & ChrW(48512) & ChrW(49328) & ChrW(44305) & ChrW(50669) & ChrW(49884) & "\" & ChrW(48512) & ChrW(49328) & ChrW(50508) & ChrW(47532) & ChrW(48120) & """ && node ord-local.mjs >> ord-local.log 2>&1", 0, False
