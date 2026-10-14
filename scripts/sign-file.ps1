<#
  ตัวช่วยเซ็นไฟล์เดียว — Tauri เรียกให้ตอน build (bundle.windows.signCommand) ผ่าน scripts\release.ps1 -Sign
  อ่านใบรับรองจาก environment: WEAKCLEAN_PFX (+ WEAKCLEAN_PFX_PASSWORD) หรือ WEAKCLEAN_CERT_THUMBPRINT
  รหัสผ่านไม่ถูกเขียนลงไฟล์ใดๆ
#>
param([Parameter(Mandatory = $true)][string]$File)

$ErrorActionPreference = "Stop"
$timestamp = if ($env:WEAKCLEAN_TIMESTAMP_URL) { $env:WEAKCLEAN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object FullName -match "\\x64\\" | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { Write-Error "signtool.exe not found (install the Windows SDK: Signing Tools for Desktop Apps)"; exit 1 }

$signArgs = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $timestamp)
if ($env:WEAKCLEAN_PFX) {
  $signArgs += @("/f", $env:WEAKCLEAN_PFX)
  if ($env:WEAKCLEAN_PFX_PASSWORD) { $signArgs += @("/p", $env:WEAKCLEAN_PFX_PASSWORD) }
} elseif ($env:WEAKCLEAN_CERT_THUMBPRINT) {
  $signArgs += @("/sha1", $env:WEAKCLEAN_CERT_THUMBPRINT)
} else {
  Write-Error "Set WEAKCLEAN_PFX or WEAKCLEAN_CERT_THUMBPRINT"; exit 1
}
$signArgs += $File

& $signtool @signArgs
exit $LASTEXITCODE
