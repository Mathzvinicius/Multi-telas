Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c node """ & Replace(WScript.ScriptFullName, "launcher.vbs", "index-silent.js") & """", 0, False
