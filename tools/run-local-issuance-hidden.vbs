Option Explicit

Dim shell, fileSystem, mode, command, exitCode
Dim scriptDirectory, projectDirectory, nodePath, powershellPath, gatewayPath, wranglerPath
Dim cloudflaredPath, tunnelId, powershellCommand

If WScript.Arguments.Count < 1 Then
  WScript.Quit 64
End If

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

mode = LCase(WScript.Arguments(0))
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
projectDirectory = fileSystem.GetParentFolderName(scriptDirectory)
shell.CurrentDirectory = projectDirectory
nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")

If Not fileSystem.FileExists(nodePath) Then
  WScript.Quit 66
End If

If mode = "gateway" Then
  gatewayPath = fileSystem.BuildPath(scriptDirectory, "serve-local-issuance-ai.mjs")
  If Not fileSystem.FileExists(gatewayPath) Then
    WScript.Quit 66
  End If

  command = QuoteArgument(nodePath) & " " & QuoteArgument(gatewayPath)
ElseIf mode = "tunnel" Then
  If WScript.Arguments.Count < 2 Then
    WScript.Quit 64
  End If

  tunnelId = WScript.Arguments(1)
  powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
  wranglerPath = shell.ExpandEnvironmentStrings("%APPDATA%\npm\wrangler.ps1")
  cloudflaredPath = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\cloudflared\cloudflared.exe")

  If Not fileSystem.FileExists(powershellPath) Or Not fileSystem.FileExists(wranglerPath) _
    Or Not fileSystem.FileExists(cloudflaredPath) Then
    WScript.Quit 66
  End If

  powershellCommand = "$env:CLOUDFLARED_PATH='" & cloudflaredPath & "'; " & _
    "& '" & wranglerPath & "' tunnel run '" & tunnelId & "' --log-level warn"
  command = QuoteArgument(powershellPath) & _
    " -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command " & _
    QuoteArgument(powershellCommand)
Else
  WScript.Quit 64
End If

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
  QuoteArgument = Chr(34) & value & Chr(34)
End Function
