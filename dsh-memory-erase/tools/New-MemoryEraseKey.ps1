# 为任意已挂载的存储介质写入 / 更新记忆抹除标记文件
#
# 插件不认盘符、卷标或序列号：任何已挂载介质上只要有这个标记文件就会被识别。
# 本脚本只是把文件写到你想指定的那块介质上。
#
# 用法：
#   .\New-MemoryEraseKey.ps1                        # 扫描所有已挂载盘，列出候选
#   .\New-MemoryEraseKey.ps1 -Drive E:              # 指定盘符写入
#   .\New-MemoryEraseKey.ps1 -Drive E: -Force       # 覆盖已有标记
#   .\New-MemoryEraseKey.ps1 -Drive E: -WhatIfMarker # 只打印内容，不写文件
#
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Drive,
  [switch]$Force,
  [switch]$WhatIfMarker,
  [string]$Id = 'plastic-memories'
)

$ErrorActionPreference = 'Stop'
$MarkerName = '.dsh-memory-erase.key'
$PluginName = 'memory-erase'

# 找出所有「根目录下已有标记文件」的已挂载盘；用于展示当前会被插件识别的介质。
function Get-MarkedVolumes {
  $marked = @()
  $roots = @()
  try {
    $roots = @(Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root })
  } catch {
    $roots = @()
  }
  foreach ($root in $roots) {
    $candidate = [System.IO.Path]::Combine($root, $MarkerName)
    if (-not [System.IO.File]::Exists($candidate)) { continue }
    $drive = [System.IO.DriveInfo]::new($root)
    $label = $null
    $size = 0
    $kind = ''
    try { $label = $drive.VolumeLabel } catch { $label = $null }
    try { $size = $drive.TotalSize } catch { $size = 0 }
    try { $kind = "$($drive.DriveType)" } catch { $kind = '' }
    $marked += [pscustomobject]@{
      DeviceID = $root.TrimEnd('\')
      Label    = $label
      Size     = $size
      Type     = $kind
      Marker   = $candidate
    }
  }
  return $marked
}
$marked = @(Get-MarkedVolumes)
if ($marked.Count -gt 0) {
  Write-Host '当前已能被插件识别的介质：' -ForegroundColor Green
  $marked | ForEach-Object {
    Write-Host ("  {0}  {1}  {2}  {3}" -f $_.DeviceID, $(if ([string]::IsNullOrWhiteSpace($_.Label)) { '(无卷标)' } else { $_.Label }), $_.Type, $_.Marker)
  }
  Write-Host ''
} else {
  Write-Host '当前没有检测到带标记文件的介质。' -ForegroundColor DarkGray
}

if ([string]::IsNullOrWhiteSpace($Drive)) {
  Write-Host '把下面这个文件复制到你想要的存储介质根目录，插件就会识别它：' -ForegroundColor Cyan
  Write-Host "  $MarkerName"
  Write-Host '也可以用 -Drive 指定盘符，让本脚本代写，例如：' -ForegroundColor DarkGray
  Write-Host '  .\New-MemoryEraseKey.ps1 -Drive E:' -ForegroundColor DarkGray
  return
}

$normalized = $Drive.TrimEnd('\')
if ($normalized -notmatch '^[A-Za-z]:$') { throw "盘符格式不正确：$Drive（示例：E:）" }
$disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$($normalized.ToUpperInvariant())'"
if ($null -eq $disk) { throw "找不到盘符 $normalized。" }

$root = "$($disk.DeviceID)\"
$markerPath = Join-Path $root $MarkerName
$label = if ([string]::IsNullOrWhiteSpace($disk.VolumeName)) { $null } else { $disk.VolumeName }

$marker = [ordered]@{
  plugin      = $PluginName
  id          = $Id
  label       = if ($null -ne $label) { $label } else { 'MEMORY ERASE MEDIUM' }
  volumeLabel = $label
  createdAt   = (Get-Date).ToString('o')
}
$json = $marker | ConvertTo-Json -Depth 4

if ($WhatIfMarker) {
  Write-Host "将写入：$markerPath" -ForegroundColor Cyan
  Write-Host $json
  return
}

if ((Test-Path -LiteralPath $markerPath) -and -not $Force) {
  throw "标记文件已存在：$markerPath（加 -Force 覆盖）"
}

if ($PSCmdlet.ShouldProcess($markerPath, '写入记忆抹除标记文件')) {
  # 必须无 BOM：插件按 UTF-8 读取 JSON。
  [System.IO.File]::WriteAllText($markerPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ''
  Write-Host '记忆抹除标记已写入：' -ForegroundColor Green
  Write-Host "  文件      $markerPath"
  Write-Host "  介质      $($disk.DeviceID)  $(if ($null -ne $label) { $label } else { '(无卷标)' })"
  Write-Host ''
  Write-Host '现在只要这块介质插着，打开 DSH Web 就会出现「要删除全部记忆吗？」。' -ForegroundColor Cyan
  Write-Host '插件不校验盘符、卷标或序列号；确认之前不会删除任何内容。' -ForegroundColor DarkGray
}
