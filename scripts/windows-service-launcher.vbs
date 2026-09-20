Option Explicit

' WScript is a GUI host: the login task never starts a CMD/Terminal window.
Dim shell, files, helper, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count <> 1 Then WScript.Quit 2
helper = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "windows-service.ps1")
command = Quote(shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")) _
    & " -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " _
    & Quote(helper) & " -Action Run -NodePath " & Quote(WScript.Arguments(0))

' Wait only for startup, not for the long-lived Node server.
result = shell.Run(command, 0, True)
WScript.Quit result

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
