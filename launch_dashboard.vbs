Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = "C:\Users\owais\OfficeDashboard\"
pidFile = appDir & "server.pid"

' True if the dashboard answers on port 8877. ServerXMLHTTP (not XMLHTTP) so a cached
' response can't make a dead server look alive.
Function ServerUp()
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP")
    http.setTimeouts 2000, 2000, 5000, 5000
    http.Open "GET", "http://127.0.0.1:8877/api/today", False
    http.Send
    ServerUp = (Err.Number = 0 And http.Status = 200)
    Err.Clear
    On Error Goto 0
End Function

' Avoid launching a second server if one is already running
If Not ServerUp() Then
    WshShell.CurrentDirectory = appDir
    ' Pull latest code from GitHub before starting - best-effort: if git isn't found, there
    ' are local uncommitted edits, or there's no network, this just no-ops/fails quietly and
    ' the app still starts on whatever code is already on disk.
    WshShell.Run "cmd /c git pull --ff-only >> update.log 2>&1", 0, True

    ' At login the network is often not up yet, so the startup Turso sync can fail and the
    ' server exits silently. Retry a few times, and send stdout/stderr to server.log so a
    ' crash leaves a traceback behind.
    For attempt = 1 To 6
        WshShell.Run "cmd /c echo ==== start attempt " & attempt & " %DATE% %TIME% ==== >> server.log", 0, True
        WshShell.Run "cmd /c python app.py >> server.log 2>&1", 0, False
        For i = 1 To 10
            WScript.Sleep 1500
            If ServerUp() Then Exit For
        Next
        If ServerUp() Then Exit For
        WScript.Sleep 15000
    Next
End If

WshShell.Run "http://127.0.0.1:8877/", 1, False
