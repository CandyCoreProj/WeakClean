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

## 3. Auto-update (ยังไม่ได้เปิดใช้ — ต้องตัดสินใจที่โฮสต์ก่อน)

ตั้งใจไม่ใส่ปลั๊กอินอัปเดตในแอปตอนนี้ เพราะต้องมี 2 อย่างที่เป็นของคุณ: **กุญแจเซ็นอัปเดต** (ไม่ใช่ตัวเดียวกับใบรับรองข้อ 2 และห้ามหาย — แอปที่แจกไปแล้วจะรับอัปเดตจากกุญแจอื่นไม่ได้) กับ **ที่เก็บไฟล์อัปเดต**

ขั้นตอนเมื่อพร้อม:
1. สร้างกุญแจ (เก็บไฟล์ `.key` นอกโปรเจกต์ + รหัสผ่านในที่ปลอดภัย):
   ```powershell
   cd apps\desktop; npx tauri signer generate -w $env:USERPROFILE\.weakclean-signing\updater.key
   ```
2. ติดตั้งปลั๊กอิน: `npm i @tauri-apps/plugin-updater` และ `cargo add tauri-plugin-updater` (ใน `src-tauri`), ใส่ `.plugin(tauri_plugin_updater::Builder::new().build())` ใน `lib.rs`, เพิ่มสิทธิ์ `updater:default` ใน `capabilities/default.json`
3. ใส่ใน `tauri.conf.json`: `bundle.createUpdaterArtifacts: true` และ
   ```json
   "plugins": { "updater": { "pubkey": "<เนื้อหา updater.key.pub>", "endpoints": ["https://<ที่โฮสต์ของคุณ>/latest.json"] } }
   ```
4. ตอน build ตั้ง `TAURI_SIGNING_PRIVATE_KEY` (และ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) จะได้ไฟล์ `.sig` ข้างตัวติดตั้ง
5. อัปโหลดตัวติดตั้ง + `latest.json` (เวอร์ชัน, วันที่, URL, เนื้อหา `.sig`) ไปที่ endpoint — GitHub Releases ใช้ได้ฟรี
6. ฝั่งหน้าจอ: เรียก `check()` จาก `@tauri-apps/plugin-updater` เมื่อผู้ใช้กด "ตรวจหาอัปเดต" ในหน้า ตั้งค่า (ปุ่มตั้งค่ายังไม่มีหน้า) และ**ถามผู้ใช้ก่อนติดตั้งทุกครั้ง**

## 4. เช็กลิสต์ก่อนแจก

- [ ] ทดสอบ tweak ระดับเครื่อง (service, นโยบาย, Restore Point, ปุ่ม "เปิดใหม่แบบผู้ดูแล") บน VM Windows 11 + Windows 10 (ตามแผนหัวข้อ 7)
- [ ] ติดตั้ง/ถอนการติดตั้งตัวติดตั้งบนเครื่องสะอาด (ยังไม่เคยลอง)
- [ ] ตรวจ `SHA256SUMS.txt` ตรงกับไฟล์ที่แจก
- [ ] เซ็นด้วยใบรับรองที่ Windows เชื่อถือ (ข้อ 2.3) ถ้าแจกคนทั่วไป
