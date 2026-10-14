<#
.SYNOPSIS
  ปล่อยเวอร์ชันใหม่ของ WeakClean ครบในคำสั่งเดียว:
  ตรวจความพร้อม → commit + push โค้ด → build + เซ็น (release.ps1) → GitHub Release → commit + push updates/latest.json

.EXAMPLE
  .\scripts\ship.ps1 -Notes "ปรับหน้าพื้นที่ดิสก์ให้ใช้ง่ายขึ้น"
  .\scripts\ship.ps1 -Notes "..." -SkipTests

.NOTES
  ก่อนรัน: เพิ่มเลขเวอร์ชันให้ตรงกัน 3 ที่ (tauri.conf.json, Cargo.toml, package.json)
  ระหว่างรันจะถามรหัสผ่านกุญแจเซ็นอัปเดต (ถ้ายังไม่ได้ตั้ง TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
  ลำดับนี้ตั้งใจ: push latest.json หลังอัปโหลด Release เสร็จเท่านั้น ไม่งั้นแอปจะเห็นเวอร์ชันที่ยังดาวน์โหลดไม่ได้
#>
param(
  [Parameter(Mandatory = $true)][string]$Notes,
  [string]$Message = "",
  [string]$Repo = "CandyCoreProj/WeakClean",
  # ใบรับรอง self-signed "CandyCore" (ไม่ใช่ความลับ — ดู RELEASE_TH.md ข้อ 2.1)
  [string]$Thumbprint = "BA09338D4D6B2B02C8CD7F745FAF194BC938FBCE",
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) { $env:Path += ";$cargoBin" }
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }
# รันคำสั่งภายนอก ถ้าล้มเหลวให้หยุดทันที
function Run([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($argv -join ' ') ล้มเหลว (exit $LASTEXITCODE)" }
}
# รันแบบเงียบเพื่อดูแค่ exit code (PowerShell 5.1 จะโยน error ถ้า stderr ของคำสั่งภายนอกถูก redirect ตอน Stop)
function ExitCodeOf([scriptblock]$b) {
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { & $b *> $null; return $LASTEXITCODE } finally { $ErrorActionPreference = $old }
}
function Commit([string]$text) {
  $tmp = Join-Path $env:TEMP "weakclean-commit-msg.txt"
  $trailer = "`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`nClaude-Session: https://claude.ai/code/session_016pWX1MzpRQnKHyfYJM3RAL"
  [IO.File]::WriteAllText($tmp, $text + $trailer + "`n", $utf8)
  try { Run git @("commit", "-F", $tmp) } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# ───────── 0) ตรวจความพร้อม (ก่อน build ที่ใช้เวลานาน) ─────────
$version = (Get-Content "apps\desktop\src-tauri\tauri.conf.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
$tag = "v$version"
Step "ตรวจความพร้อมสำหรับ $tag"
foreach ($cmd in "git", "gh", "npm", "cargo") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "ไม่พบคำสั่ง $cmd ใน PATH" }
}
$pkg = (Get-Content "apps\desktop\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
$cargoVer = (Select-String -Path "apps\desktop\src-tauri\Cargo.toml" -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
if ($pkg -ne $version -or $cargoVer -ne $version) {
  Fail "เลขเวอร์ชันไม่ตรงกัน: tauri.conf.json=$version, package.json=$pkg, Cargo.toml=$cargoVer"
}
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") { Fail "ต้องอยู่บน branch main (ตอนนี้: $branch)" }
if ((ExitCodeOf { gh auth status }) -ne 0) { Fail "gh ยังไม่ได้ล็อกอิน — รัน: gh auth login" }
if ((ExitCodeOf { gh release view $tag --repo $Repo }) -eq 0) { Fail "มี Release $tag อยู่แล้วบน GitHub — เพิ่มเลขเวอร์ชันก่อน" }
Write-Host "  พร้อม: $tag · branch main · gh ล็อกอินแล้ว"

# ───────── 1) commit + push โค้ด ─────────
Step "commit + push โค้ด"
Run git @("add", "--", "apps/desktop", "crates", "data", "scripts", "README.md", "RELEASE_TH.md", "SETUP_TH.md", "WeClean_Plan.md")
if ((ExitCodeOf { git diff --cached --quiet }) -ne 0) {
  $msg = if ($Message) { $Message } else { "WeakClean ${tag}: $Notes" }
  Commit $msg
} else {
  Write-Host "  (ไม่มีโค้ดที่เปลี่ยน — ข้ามการ commit)"
}
Run git @("push", "origin", "main")

# ───────── 2) build + เซ็น + latest.json ─────────
Step "build + เซ็น (release.ps1)"
$env:WEAKCLEAN_CERT_THUMBPRINT = $Thumbprint
$relArgs = @{ Sign = $true; AllowSelfSigned = $true; Notes = $Notes; Repo = $Repo }
if ($SkipTests) { $relArgs.SkipTests = $true }
& (Join-Path $PSScriptRoot "release.ps1") @relArgs
if ($LASTEXITCODE -ne 0) { Fail "release.ps1 ล้มเหลว — ยังไม่ได้อัปโหลดอะไรขึ้น GitHub" }

$out = Join-Path $root "release\$version"
$assets = @(Get-ChildItem $out -File | ForEach-Object { $_.FullName })
if ($assets.Count -eq 0) { Fail "ไม่พบไฟล์ใน $out" }
if (-not (Test-Path (Join-Path $root "updates\latest.json"))) { Fail "ไม่พบ updates\latest.json (กุญแจเซ็นอัปเดตมีปัญหา?)" }

# ───────── 3) GitHub Release ─────────
Step "สร้าง GitHub Release $tag"
Run gh (@("release", "create", $tag) + $assets + @("--repo", $Repo, "--target", "main", "--title", "WeakClean $version", "--notes", $Notes, "--prerelease"))

# ───────── 4) push latest.json (หลังอัปโหลดเสร็จเท่านั้น) ─────────
Step "เผยแพร่ updates\latest.json"
Run git @("add", "--", "updates/latest.json")
if ((ExitCodeOf { git diff --cached --quiet }) -ne 0) {
  Commit "Publish update manifest for $tag"
  Run git @("push", "origin", "main")
}

Step "เสร็จแล้ว: https://github.com/$Repo/releases/tag/$tag"
Write-Host "  ทดสอบ: เปิด WeakClean เวอร์ชันเก่า → ตั้งค่า → ตรวจหาอัปเดต" -ForegroundColor Green
