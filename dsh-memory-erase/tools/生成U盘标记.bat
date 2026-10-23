@echo off
chcp 65001 >nul
setlocal
rem 双击即可：给可移动盘写入记忆抹除标记文件
rem 需要 PowerShell 5.1+（Windows 自带）
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-MemoryEraseKey.ps1" %*
echo.
pause
