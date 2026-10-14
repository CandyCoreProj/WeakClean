# WeakClean — การปล่อยรุ่น (build · เซ็นโค้ด · อัปเดตอัตโนมัติ)

## 1. สร้างรุ่นสำหรับแจก

```powershell
cd E:\CandyCore\WeClean
.\scripts\release.ps1                  # ทดสอบทุก crate + type-check + build (ไม่เซ็น)
.\scripts\release.ps1 -SkipTests       # ข้ามเทสต์ให้เร็วขึ้น
```

ผลลัพธ์อยู่ที่ `release\<เวอร์ชัน>\` : ตัวติดตั้ง `.msi` และ `-setup.exe` + `SHA256SUMS.txt`
เปลี่ยนเลขเวอร์ชันที่ `apps/desktop/src-tauri/tauri.conf.json` (และ `Cargo.toml` ให้ตรงกัน) ก่อนปล่อยทุกครั้ง

## 2. เซ็นโค้ด

สคริปต์เซ็นผ่าน Tauri จึงเซ็นครบทุกชั้น (`weakclean.exe` ข้างใน, `.msi`, `-setup.exe`) พร้อม timestamp
ใบรับรองและรหัสผ่านอ่านจาก environment ตอนรันเท่านั้น ไม่ถูกเขียนลงไฟล์ในโปรเจกต์

### 2.1 ตอนนี้ใช้อะไรอยู่: ใบรับรอง self-signed ชื่อ "CandyCore"

- อยู่ใน Windows certificate store ของผู้ใช้ปัจจุบัน (`Cert:\CurrentUser\My`) หมดอายุ 2031-10-14
- สำรองไว้ที่ `%USERPROFILE%\.weakclean-signing\CandyCore-signing.pfx` (มีรหัสผ่านป้องกัน — **เก็บไฟล์และรหัสผ่านไว้ที่ปลอดภัย** ถ้าทำหายจะเซ็นให้เป็น "CandyCore" ตัวเดิมไม่ได้อีก) และ `CandyCore.cer` (กุญแจสาธารณะ แจกได้)
- สั่งเซ็น:

```powershell
$env:WEAKCLEAN_CERT_THUMBPRINT = "BA09338D4D6B2B02C8CD7F745FAF194BC938FBCE"
.\scripts\release.ps1 -Sign -AllowSelfSigned
```

**สิ่งที่ลายเซ็นนี้ทำได้/ทำไม่ได้**
- ✅ ไฟล์แสดงชื่อผู้เผยแพร่ "CandyCore" และพิสูจน์ได้ว่าไม่ถูกแก้ไขหลังเซ็น
- ❌ Windows **ไม่เชื่อถือ** เพราะไม่ได้ออกโดยหน่วยงานที่ Windows รู้จัก — SmartScreen ยังเตือน "Unknown publisher"/"Windows protected your PC" บนเครื่องของคนอื่น และ antivirus บางตัวอาจระวังมากขึ้น
- เหมาะกับ: ใช้เองหรือแจกคนที่ไว้ใจ (ให้เขาติดตั้ง `CandyCore.cer` ก่อน — ข้อ 2.2)

### 2.2 ให้เครื่องหนึ่ง "เชื่อถือ" CandyCore (ทำเฉพาะเครื่องที่ไว้ใจ)

เปิด PowerShell **แบบผู้ดูแล** บนเครื่องนั้น แล้วรัน (ปรับ path ของ `.cer`):

```powershell
Import-Certificate -FilePath .\CandyCore.cer -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath .\CandyCore.cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
```

หลังจากนั้นไฟล์ที่เซ็นด้วย CandyCore จะแสดงสถานะ Valid บนเครื่องนั้น (ถอนการเชื่อถือ: ลบใบรับรองออกจากสองที่เดิม)
ห้ามทำบนเครื่องที่ไม่ใช่ของคุณโดยไม่บอกเจ้าของ เพราะเท่ากับให้ใครก็ตามที่มีกุญแจส่วนตัวนี้ออกซอฟต์แวร์ที่เครื่องนั้นเชื่อถือได้

### 2.3 ถ้าจะแจกให้คนทั่วไป (ไม่ต้องให้ใครติดตั้งใบรับรอง)

ต้องใช้ใบรับรองจากหน่วยงานที่ Windows เชื่อถือ — ตัวเลือก:
1. **Azure Trusted Signing** (ราคาถูก ต้องยืนยันตัวตนองค์กร/บุคคล)
2. **OV/EV Code Signing Certificate** จาก CA (เช่น DigiCert, Sectigo) — EV ได้ชื่อเสียงใน SmartScreen เร็วกว่า
3. **SignPath.io** (ฟรีสำหรับโอเพนซอร์ส)

ได้ใบรับรองแล้วใช้สคริปต์เดิม โดยไม่ต้องใส่ `-AllowSelfSigned`:

```powershell
$env:WEAKCLEAN_PFX = "C:\path\to\cert.pfx"; $env:WEAKCLEAN_PFX_PASSWORD = "..."   # หรือ WEAKCLEAN_CERT_THUMBPRINT สำหรับ token/EV
.\scripts\release.ps1 -Sign
```

สคริปต์จะไม่ผ่านถ้าลายเซ็นไม่เป็น `Valid` (จึงกันการแจกไฟล์ที่เซ็นผิดโดยไม่รู้ตัว)

## 3. Auto-update (เปิดใช้แล้ว — โฮสต์ที่ GitHub: CandyCoreProj/WeakClean)

แอปตรวจหาอัปเดต **เฉพาะตอนผู้ใช้กดปุ่ม "ตรวจหาอัปเดต" ในหน้าตั้งค่า** (ไม่ตรวจเองตอนเปิดแอป) แล้วถามก่อนติดตั้งทุกครั้ง
แอปอ่าน `https://raw.githubusercontent.com/CandyCoreProj/WeakClean/main/updates/latest.json` และตรวจลายเซ็นของตัวติดตั้งด้วย public key ใน `tauri.conf.json` ก่อนติดตั้ง

**กุญแจเซ็นอัปเดต** (คนละตัวกับใบรับรอง CandyCore ข้อ 2): `%USERPROFILE%\.weakclean-signing\updater.key` — เก็บไฟล์และรหัสผ่านไว้ให้ดี
ถ้าหายหรือเปลี่ยน แอปที่แจกไปแล้วจะรับอัปเดตต่อไปไม่ได้ (ต้องให้ผู้ใช้ติดตั้งใหม่ด้วยมือ)

### ปล่อยเวอร์ชันใหม่ (ทุกครั้ง)

**ทางลัด (แนะนำ):** เพิ่มเลขเวอร์ชันให้ตรงกัน 3 ที่ (ข้อ 1 ด้านล่าง) แล้วรันคำสั่งเดียว — สคริปต์จะทำข้อ 2–4 ให้ตามลำดับที่ถูกต้อง

```powershell
.\scripts\ship.ps1 -Notes "สิ่งที่เปลี่ยน"
```

ตรวจความพร้อมก่อน (branch main, `gh` ล็อกอินแล้ว, เลขเวอร์ชันตรงกัน, ยังไม่มี Release นี้) → commit + push โค้ด → build + เซ็น → `gh release create` → push `updates/latest.json`

**ทำเองทีละขั้น:**

1. เพิ่มเลขเวอร์ชันให้ตรงกันทั้ง 3 ที่: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/package.json`
2. build + เซ็น + สร้าง `latest.json`:
   ```powershell
   $env:WEAKCLEAN_CERT_THUMBPRINT = "BA09338D4D6B2B02C8CD7F745FAF194BC938FBCE"
   .\scripts\release.ps1 -Sign -AllowSelfSigned -Notes "สิ่งที่เปลี่ยน"
   ```
   (สคริปต์จะถามรหัสผ่านกุญแจอัปเดต หรือตั้ง `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` ไว้ก่อน)
3. อัปโหลด Release: `gh release create v<เวอร์ชัน> release\<เวอร์ชัน>\* --repo CandyCoreProj/WeakClean --prerelease`
4. **หลังอัปโหลด Release สำเร็จแล้ว** ค่อย commit + push `updates/latest.json` (ถ้า push ก่อน แอปจะเห็นเวอร์ชันใหม่ที่ดาวน์โหลดยังไม่ได้)
5. ทดสอบ: เปิดแอปเวอร์ชันเก่า → ตั้งค่า → ตรวจหาอัปเดต

ย้อนเวอร์ชันฉุกเฉิน: แก้ `updates/latest.json` ให้ชี้เวอร์ชันก่อนหน้าไม่ได้ (updater เทียบว่า "ใหม่กว่า" เท่านั้น) — ต้องออกเวอร์ชันที่เลขสูงขึ้นแทน

## 4. เช็กลิสต์ก่อนแจก

- [ ] ทดสอบ tweak ระดับเครื่อง (service, นโยบาย, Restore Point, ปุ่ม "เปิดใหม่แบบผู้ดูแล") บน VM Windows 11 + Windows 10 (ตามแผนหัวข้อ 7)
- [ ] ติดตั้ง/ถอนการติดตั้งตัวติดตั้งบนเครื่องสะอาด (ยังไม่เคยลอง)
- [ ] ตรวจ `SHA256SUMS.txt` ตรงกับไฟล์ที่แจก
- [ ] เซ็นด้วยใบรับรองที่ Windows เชื่อถือ (ข้อ 2.3) ถ้าแจกคนทั่วไป
