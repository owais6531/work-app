Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = "C:\Users\owais\OfficeDashboard\"
pidFile = appDir & "server.pid"

' Avoid launching a second server if one is already running (best-effort check via port)
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://127.0.0.1:8877/api/today", False
http.Send
alreadyRunning = (Err.Number = 0 And http.Status = 200)
On Error Goto 0

If Not alreadyRunning Then
    WshShell.CurrentDirectory = appDir
    ' Pull latest code from GitHub before starting - best-effort: if git isn't found, there
    ' are local uncommitted edits, or there's no network, this just no-ops/fails quietly and
    ' the app still starts on whatever code is already on disk.
    WshShell.Run "cmd /c git pull --ff-only >> update.log 2>&1", 0, True
    WshShell.Run "pythonw.exe app.py", 0, False
    WScript.Sleep 2500
End If

WshShell.Run "http://127.0.0.1:8877/", 1, False
