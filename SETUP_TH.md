# WeakClean — คู่มือติดตั้งและรันโปรเจกต์ (Phase 0)

> Stack: **Tauri 2 (Rust) + React 19 + TypeScript + Tailwind CSS 4** · โปรเจกต์อยู่ที่ `E:\CandyCore\WeClean\apps\desktop`

---

## 1. ติดตั้งเครื่องมือ (ทำครั้งเดียว)

1. **Microsoft C++ Build Tools** — Rust บน Windows ต้องใช้ตัว link ของ Microsoft
   1. ดาวน์โหลด: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   2. ตอนติดตั้ง ติ๊ก **"Desktop development with C++"** (จะได้ MSVC + Windows SDK มาด้วย)
   3. ถ้ามี Visual Studio 2022 ที่ติ๊ก workload นี้อยู่แล้ว ข้ามข้อนี้ได้
2. **WebView2** — Windows 11 และ Windows 10 ที่อัปเดตแล้วมีให้อยู่แล้ว ถ้าไม่มีให้ติดตั้ง "Evergreen Bootstrapper" จาก https://developer.microsoft.com/microsoft-edge/webview2/
3. **Rust**
   1. ดาวน์โหลด `rustup-init.exe` จาก https://rustup.rs แล้วกด Enter เลือกค่าเริ่มต้น (toolchain `stable-x86_64-pc-windows-msvc`)
   2. เปิด Terminal ใหม่ แล้วเช็ก:
      ```powershell
      rustc --version
      cargo --version
      ```
4. **Node.js LTS** (เวอร์ชัน 22 ขึ้นไป) จาก https://nodejs.org แล้วเช็ก:
   ```powershell
   node -v
   npm -v
   ```

> ติดตั้งครบแล้วให้ **ปิดแล้วเปิด Terminal ใหม่** หนึ่งครั้ง ไม่งั้นคำสั่งบางตัวจะยังหาไม่เจอ

---

## 2. รันโปรแกรม

```powershell
cd E:\CandyCore\WeClean\apps\desktop
npm install
npm run tauri dev
```

1. `npm install` ติดตั้งแพ็กเกจฝั่งหน้าตา (ครั้งแรกครั้งเดียว)
2. `npm run tauri dev` เปิด Vite + compile Rust แล้วเปิดหน้าต่าง WeakClean
   1. **ครั้งแรกจะนาน 3–10 นาที** เพราะ Rust ต้อง compile Tauri ทั้งหมด ครั้งต่อไปจะเหลือไม่กี่วินาที
   2. แก้ไฟล์ใน `src/` แล้วหน้าต่างจะรีเฟรชเอง (hot reload)
   3. แก้ไฟล์ใน `src-tauri/` แล้วโปรแกรมจะ compile ใหม่และเปิดหน้าต่างใหม่ให้เอง

### เช็กว่า Phase 0 ใช้ได้ครบ

1. หน้าต่างเปิดขึ้นมา ไม่มีกรอบ Windows (ใช้แถบหัวของ WeakClean เอง)
2. ลากแถบหัวเพื่อย้ายหน้าต่างได้ ดับเบิลคลิกแถบหัวเพื่อขยาย/คืนขนาด
3. ปุ่ม ย่อ / ขยาย / ปิด มุมขวาบนทำงาน
4. กดเมนูซ้ายสลับได้ครบ 5 หน้า
5. ปุ่ม TH / EN สลับภาษาได้ และปิดเปิดโปรแกรมใหม่แล้วยังจำภาษาและหน้าล่าสุดไว้
6. มุมล่างซ้ายขึ้น **`v0.1.0 · x86_64`** = ฝั่ง React เรียกคำสั่ง Rust (`app_info`) ได้แล้ว

### ดูแค่หน้าตาในเบราว์เซอร์ (ไม่ต้องรอ Rust)

```powershell
npm run dev
```

เปิด http://localhost:1420 — ปุ่มหน้าต่างจะไม่ทำงาน และมุมล่างซ้ายจะขึ้น `dev · browser`

---

## 3. สร้างไฟล์ติดตั้ง (.msi / .exe)

```powershell
npm run tauri build
```

ไฟล์จะอยู่ที่ `src-tauri\target\release\bundle\msi\` และ `src-tauri\target\release\bundle\nsis\`

---

## 4. โครงสร้างไฟล์

```
apps/desktop/
├─ src/                      # หน้าตา (React)
│  ├─ main.tsx               # จุดเริ่ม + โหลดฟอนต์ Mitr / Prompt
│  ├─ App.tsx                # โครงหน้าต่าง: แถบหัว + เมนูซ้าย + เนื้อหา
│  ├─ index.css              # สี/ฟอนต์/เงา ของธีม Sky Glass (Tailwind @theme)
│  ├─ i18n.tsx               # ข้อความภาษาไทย / อังกฤษ
│  ├─ pages.ts               # รายการเมนู + ไอคอน
│  ├─ lib/tauri.ts           # ปุ่มหน้าต่าง + เรียกคำสั่ง Rust
│  ├─ lib/mock.ts            # ข้อมูลตัวอย่าง (ไดรฟ์, หมวดขยะ) จนกว่า Rust จะส่งข้อมูลจริง
│  ├─ components/            # TitleBar, Sidebar, Hero, Badge, Switch, Dialog, Toast, ResultBanner, Logo
│  └─ pages/                 # HomePage, SpacePage, CleanerPage, BoostPage, SafetyPage
├─ src-tauri/                # ส่วน Rust
│  ├─ src/lib.rs             # คำสั่งที่ React เรียกได้ (ตอนนี้มี app_info)
│  ├─ tauri.conf.json        # ขนาดหน้าต่าง, ชื่อแอป, ไอคอน
│  ├─ capabilities/          # สิทธิ์ที่หน้าเว็บใช้ได้ (ปุ่มหน้าต่าง, ลากหน้าต่าง)
│  └─ icons/                 # ไอคอนแอป (สร้างจาก app-icon.png)
└─ app-icon.png              # ไอคอนต้นฉบับ 1024×1024
```

> เปลี่ยนไอคอน: แทนที่ `app-icon.png` แล้วรัน `npx tauri icon app-icon.png -o src-tauri/icons`

---

## 5. ปัญหาที่เจอบ่อย

1. **`linker 'link.exe' not found`** — ยังไม่ได้ติดตั้ง C++ Build Tools (ข้อ 1.1) หรือยังไม่ได้เปิด Terminal ใหม่
2. **`npm.ps1 cannot be loaded because running scripts is disabled`** (PowerShell) — ใช้ Command Prompt แทน หรือรันครั้งเดียว:
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```
3. **`Port 1420 is already in use`** — มี `npm run dev` ค้างอยู่ ปิด Terminal เก่าก่อน
4. **หน้าต่างเปิดมาเป็นสีขาว** — Vite ยังไม่พร้อม รอสักครู่ หรือดู error ใน Terminal
5. **compile ช้ามาก** — Windows Defender สแกนโฟลเดอร์ `src-tauri\target` อยู่ เพิ่มโฟลเดอร์นี้ในรายการยกเว้นของ Defender จะเร็วขึ้นมาก

---

## 6. ทดสอบ Scanner (Phase 1)

```powershell
cd E:\CandyCore\WeClean\crates\weakclean-scanner
cargo test                                          # เทสต์ 9 ข้อ
cargo run --release --example scan -- C:\           # สแกนจริง + จับเวลา (เพิ่มเลขท้ายเพื่อกำหนดจำนวน thread)
```

1. ผลสแกนบนเครื่องผู้พัฒนา: C: 696,118 ไฟล์ใช้ 7.4 วินาที
2. เทียบตัวเลขกับ TreeSize: เปิด Terminal แบบ Run as administrator แล้วรันคำสั่งข้างบน ดูบรรทัด "ขนาดจริง" เทียบกับ Size ของ TreeSize และ "ขนาดบนดิสก์" เทียบกับ Allocated (เป้า ต่างกันไม่เกิน 1%)

---

## 7. ทดสอบหน้า พื้นที่ดิสก์ (Phase 2)

1. `npm run tauri dev` แล้วเปิดหน้า พื้นที่ดิสก์ กด "สแกนเลย" — เห็นความคืบหน้าสด แล้วได้ treemap ของไดรฟ์จริง
2. คลิกเพื่อเลือก ดับเบิลคลิกเพื่อซูมเข้าโฟลเดอร์ ใช้ breadcrumb ด้านบนเพื่อถอยกลับ
3. เปิดด้วย `npm run dev` (เบราว์เซอร์ธรรมดา) จะใช้ข้อมูลจำลองใน `src/lib/mockScanner.ts` และ `mockCleaner.ts` แทน Rust

---

## 8. ทดสอบ ล้างขยะ + ประวัติ & กู้คืน (Phase 3)

```powershell
cd E:\CandyCore\WeClean\crates\weakclean-cleaner
cargo test      # 18 ข้อ ทำงานในโฟลเดอร์ชั่วคราวทั้งหมด ไม่แตะไฟล์จริงของเครื่อง
```

1. ล้างขยะ = **ย้าย**ไฟล์ไปที่ `%LOCALAPPDATA%\WeakClean\quarantine` ไม่ได้ลบถาวร กู้คืนได้ที่หน้า ประวัติ & กู้คืนภายใน 7 วัน (ฐานข้อมูลอยู่ที่ `%LOCALAPPDATA%\WeakClean\weakclean.db`)
2. แก้รายการหมวดขยะได้ที่ `data/cleaners/catalog.toml` (ไม่ต้องแก้ Rust แต่ต้อง compile ใหม่ เพราะไฟล์ถูกฝังมากับโปรแกรม)
3. หมวดที่ต้องสิทธิ์ผู้ดูแล (แคช Windows Update ฯลฯ) ถ้าเปิดแบบปกติจะข้ามไฟล์ที่ลบไม่ได้และรายงานในแถบสรุป

---

## 9. ทดสอบ เร่งความเร็ว (Phase 4)

```powershell
cd E:\CandyCore\WeClean\crates\weakclean-tweaks
cargo test      # 17 ข้อ — ระบบจำลอง + registry จริงใน key ทดสอบแยกใต้ HKCU ที่ลบทิ้งเอง ไม่แตะการตั้งค่าจริงของเครื่อง
```

1. หน้า เร่งความเร็ว **อ่านสถานะจริง** ของเครื่อง (ตั้งอยู่แล้ว/ยัง/ถูกคืนค่า) โดยไม่แก้อะไร — การกด "ยืนยันและเริ่ม" เท่านั้นที่เปลี่ยนค่าจริง
2. ถ้าเปิดแอปแบบปกติ จะใช้ได้เฉพาะ tweak ระดับผู้ใช้ (HKCU) ส่วนระดับเครื่อง (บริการ, นโยบาย) ต้องกด "เปิดใหม่แบบผู้ดูแล"
3. **ก่อนกดใช้ tweak ระดับเครื่องบนเครื่องจริง ให้ทดสอบบน VM ก่อน** (ตามแผน หัวข้อ 7) — การเปลี่ยน service และการสร้าง Restore Point ยังไม่เคยถูกทดสอบจริง
4. ทุกการเปลี่ยนย้อนกลับได้ที่หน้า ประวัติ & กู้คืน (ทีละรายการ ทั้งชุด หรือทั้งหมด) แก้รายการ tweak ได้ที่ `data/tweaks/catalog.toml` (ต้อง compile ใหม่)

---

## 10. Phase 5 — สร้างรุ่น release

```powershell
cd E:\CandyCore\WeCleanpps\desktop
npm run tauri build -- --no-bundle     # ได้ src-tauri	argetelease\weakclean.exe (~5 MB รันตรงได้เลย)
npm run tauri build                    # สร้างตัวติดตั้ง .msi / .exe (ครั้งแรก Tauri จะดาวน์โหลดเครื่องมือ WiX/NSIS ให้เอง)
```

1. ค่าเริ่มต้นของ Windows Theme (สว่าง/มืด) ตามระบบอัตโนมัติ สลับเองได้ที่ปุ่มดวงอาทิตย์/พระจันทร์/จอภาพ ในแถบหัว
2. **ก่อนแจกจ่ายต้อง:** (1) เซ็นโค้ดด้วยใบรับรอง (ไม่งั้น SmartScreen จะเตือน) (2) ทดสอบบนเครื่องสะอาด Win10/11 และ VM (3) ตั้งค่า auto-update (คู่กุญแจ + endpoint) ถ้าต้องการ
3. ไฟล์ที่แอปสร้างในเครื่องผู้ใช้: `%LOCALAPPDATA%\WeakClean\weakclean.db` (ประวัติ) และ `%LOCALAPPDATA%\WeakClean\quarantine\` (ที่กักกัน)
