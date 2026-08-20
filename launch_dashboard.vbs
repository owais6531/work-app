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
    WshShell.Run "pythonw.exe app.py", 0, False
    WScript.Sleep 2500
End If

WshShell.Run "http://127.0.0.1:8877/", 1, False
