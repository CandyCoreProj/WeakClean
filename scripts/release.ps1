<#
.SYNOPSIS
  สร้างรุ่นสำหรับแจกจ่ายของ WeakClean: ทดสอบ → build → (เซ็นโค้ด) → ตรวจลายเซ็น → รวมไฟล์ + SHA256SUMS

.EXAMPLE
  .\scripts\release.ps1                      # ทดสอบ + build ไม่เซ็น
  .\scripts\release.ps1 -SkipTests           # ข้ามการรันเทสต์ (เร็วขึ้น)
  $env:WEAKCLEAN_PFX = "C:\keys\cert.pfx"; $env:WEAKCLEAN_PFX_PASSWORD = "..."
  .\scripts\release.ps1 -Sign                # เซ็นด้วยไฟล์ .pfx
  $env:WEAKCLEAN_CERT_THUMBPRINT = "ABCD..."
  .\scripts\release.ps1 -Sign                # เซ็นด้วยใบรับรองที่อยู่ใน Windows certificate store (เช่น USB token / EV)

.NOTES
  การเซ็นทำผ่าน bundle.windows.signCommand ของ Tauri จึงเซ็นครบทุกชั้น: weakclean.exe ข้างใน, ตัวติดตั้ง .exe/.msi
  ไม่มีการเก็บรหัสผ่านหรือใบรับรองลงไฟล์ในโปรเจกต์ — อ่านจาก environment ตอนรันเท่านั้น
#>
param(
  [switch]$Sign,
  # ยอมรับลายเซ็นจากใบรับรอง self-signed (ลายเซ็นสมบูรณ์ แต่ Windows ยังไม่เชื่อถือผู้เผยแพร่ จนกว่าจะนำใบรับรองไปติดตั้งในเครื่องนั้น)
  [switch]$AllowSelfSigned,
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  # ข้อความที่แสดงในหน้าตั้งค่าตอนมีอัปเดต (เก็บใน latest.json)
  [string]$Notes = "",
  [string]$Repo = "CandyCoreProj/WeakClean"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "apps\desktop"
$conf = Get-Content (Join-Path $desktop "src-tauri\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $conf.version
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) { $env:Path += ";$cargoBin" }

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ───────── 1) เทสต์ ─────────
if (-not $SkipTests) {
  foreach ($c in "weakclean-scanner", "weakclean-cleaner", "weakclean-tweaks") {
    Step "cargo test ($c)"
    Push-Location (Join-Path $root "crates\$c")
    cargo test --quiet
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail "tests failed in $c" }
  }
  Step "type-check หน้าจอ"
  Push-Location $desktop
  npm run build --silent
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Fail "frontend type-check failed" }
}

# ───────── 2) เตรียมการเซ็น (ถ้าขอ) ─────────
$configArgs = @()
$tempConfig = $null
if ($Sign) {
  if (-not ($env:WEAKCLEAN_PFX -or $env:WEAKCLEAN_CERT_THUMBPRINT)) {
    Fail "ตั้ง WEAKCLEAN_PFX (+ WEAKCLEAN_PFX_PASSWORD) หรือ WEAKCLEAN_CERT_THUMBPRINT ก่อนใช้ -Sign"
  }
  if ($env:WEAKCLEAN_PFX -and -not (Test-Path $env:WEAKCLEAN_PFX)) { Fail "ไม่พบไฟล์ใบรับรอง $env:WEAKCLEAN_PFX" }
  $env:WEAKCLEAN_TIMESTAMP_URL = $TimestampUrl
  # ให้ Tauri เรียก sign-file.ps1 กับทุกไฟล์ที่ต้องเซ็น (ไฟล์ config ไม่มีความลับ — รหัสผ่านอยู่ใน environment เท่านั้น)
  $helper = Join-Path $PSScriptRoot "sign-file.ps1"
  $override = @{ bundle = @{ windows = @{ signCommand = @{ cmd = "powershell.exe"; args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $helper, "%1") } } } }
  $tempConfig = Join-Path $env:TEMP "weakclean-sign-config.json"
  $override | ConvertTo-Json -Depth 8 | Set-Content $tempConfig -Encoding UTF8
  $configArgs = @("--config", $tempConfig)
  Step "จะเซ็นผ่าน $helper (timestamp: $TimestampUrl)"
}

# ───────── 2.5) กุญแจเซ็นอัปเดต (แยกจากใบรับรอง Authenticode) ─────────
# tauri.conf.json เปิด createUpdaterArtifacts จึงต้องมีกุญแจนี้ทุกครั้งที่ build — ไฟล์ .key อยู่นอกโปรเจกต์
$updaterKey = if ($env:WEAKCLEAN_UPDATER_KEY) { $env:WEAKCLEAN_UPDATER_KEY } else { Join-Path $env:USERPROFILE ".weakclean-signing\updater.key" }
if (-not $SkipBuild) {
  if (-not (Test-Path $updaterKey)) { Fail "ไม่พบกุญแจเซ็นอัปเดต $updaterKey (ตั้ง WEAKCLEAN_UPDATER_KEY ถ้าเก็บไว้ที่อื่น)" }
  $env:TAURI_SIGNING_PRIVATE_KEY = $updaterKey
  if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $sec = Read-Host "รหัสผ่านของกุญแจเซ็นอัปเดต" -AsSecureString
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
}

# ───────── 3) build ─────────
if (-not $SkipBuild) {
  Step "npm run tauri build"
  Push-Location $desktop
  try { npm run tauri build -- @configArgs; $code = $LASTEXITCODE }
  finally { if ($tempConfig -and (Test-Path $tempConfig)) { Remove-Item $tempConfig -Force } }
  Pop-Location
  if ($code -ne 0) { Fail "tauri build failed" }
}

# ───────── 4) รวมไฟล์ + ตรวจลายเซ็น + checksum ─────────
$bundle = Join-Path $desktop "src-tauri\target\release\bundle"
$files = @(Get-ChildItem $bundle -Recurse -Include "*.msi", "*-setup.exe" | Where-Object { $_.Name -match [regex]::Escape($version) })
if ($files.Count -eq 0) { Fail "ไม่พบตัวติดตั้งเวอร์ชัน $version ใน $bundle" }

$out = Join-Path $root "release\$version"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out -File | Remove-Item -Force

Step "ตรวจไฟล์ผลลัพธ์"
$sums = @()
foreach ($f in $files) {
  $dest = Copy-Item $f.FullName $out -PassThru
  $sig = Get-AuthenticodeSignature $dest.FullName
  $hash = (Get-FileHash $dest.FullName -Algorithm SHA256).Hash.ToLower()
  $sums += "$hash *$($dest.Name)"
  $mb = [math]::Round($dest.Length / 1MB, 2)
  $who = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "-" }
  Write-Host ("  {0,-38} {1,6} MB  signature: {2}  signer: {3}" -f $dest.Name, $mb, $sig.Status, $who)
  # self-signed: ตรวจว่ามีลายเซ็น + มี timestamp + สถานะบอกแค่ว่า "root ไม่ได้รับความเชื่อถือ" (ไม่ใช่ไฟล์ถูกแก้ไข)
  $selfSignedOk = $AllowSelfSigned -and $sig.SignerCertificate -and $sig.TimeStamperCertificate -and $sig.Status -eq "UnknownError"
  if ($Sign -and $sig.Status -ne "Valid" -and -not $selfSignedOk) {
    Fail "ลายเซ็นของ $($dest.Name) ไม่ถูกต้อง ($($sig.Status)) — ถ้าเป็นใบรับรอง self-signed จะขึ้น UnknownError/NotTrusted ซึ่งใช้แจกจริงไม่ได้"
  }
}
# ถ้าเซ็นด้วยใบรับรอง self-signed ให้แนบไฟล์ใบรับรองสาธารณะ (.cer) ไว้ให้ผู้ใช้ที่ไว้ใจเลือกติดตั้งได้
if ($Sign -and $env:WEAKCLEAN_CERT_THUMBPRINT) {
  $c = Get-ChildItem "Cert:\CurrentUser\My\$($env:WEAKCLEAN_CERT_THUMBPRINT)" -ErrorAction SilentlyContinue
  if ($c) { Export-Certificate -Cert $c -FilePath (Join-Path $out "CandyCore.cer") | Out-Null }
}
$sums | Set-Content (Join-Path $out "SHA256SUMS.txt") -Encoding ASCII

# ไฟล์ลายเซ็นอัปเดต (.sig) + latest.json ที่แอปอ่านเพื่อตรวจหาเวอร์ชันใหม่
foreach ($f in $files) {
  $sigFile = "$($f.FullName).sig"
  if (Test-Path $sigFile) { Copy-Item $sigFile $out }
}
$nsisName = ($files | Where-Object { $_.Name -like "*-setup.exe" } | Select-Object -First 1).Name
$nsisSig = Join-Path $out "$nsisName.sig"
if ($nsisName -and (Test-Path $nsisSig)) {
  $manifest = [ordered]@{
    version   = $version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
      "windows-x86_64" = [ordered]@{
        signature = (Get-Content $nsisSig -Raw).Trim()
        url       = "https://github.com/$Repo/releases/download/v$version/$nsisName"
      }
    }
  }
  $json = $manifest | ConvertTo-Json -Depth 6
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $out "latest.json"), $json, $utf8)
  # แอปอ่านไฟล์นี้จาก branch main — commit + push หลังอัปโหลด Release แล้ว
  New-Item -ItemType Directory -Force (Join-Path $root "updates") | Out-Null
  [IO.File]::WriteAllText((Join-Path $root "updates\latest.json"), $json, $utf8)
  Write-Host "  latest.json: v$version -> updates\latest.json (commit + push หลังอัปโหลด Release)"
} else {
  Write-Host "  (ไม่พบไฟล์ .sig ของตัวติดตั้ง — ข้ามการสร้าง latest.json)" -ForegroundColor Yellow
}

Step "เสร็จแล้ว: $out"
if (-not $Sign) { Write-Host "  (ยังไม่ได้เซ็นโค้ด — Windows SmartScreen จะเตือนผู้ใช้ ดู RELEASE_TH.md)" -ForegroundColor Yellow }
