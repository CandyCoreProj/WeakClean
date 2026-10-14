# WeakClean — แผนพัฒนาโปรแกรม (Disk Analyzer + PC Optimizer)

> เวอร์ชันแผน: v0.2 (ธีม Sky Glass + ศึกษา TreeSize เพิ่ม) · 14 ต.ค. 2026 · เจ้าของโปรเจกต์: ArmZ (CandyCore)
> ต้นแบบที่ศึกษา: **TreeSize** (ดูว่าพื้นที่ดิสก์ไปไหน) + **VantageOS Tweaker** (ปรับแต่ง Windows ให้ลื่น)
> หน้าตาโปรแกรม: ดูไฟล์ดีไซน์ใน Claude Design (ลิงก์อยู่ในหัวข้อ 10)

---

## 0. สรุปสั้นๆ (TL;DR)

1. **WeakClean** = โปรแกรมเดียวที่ตอบ 2 คำถาม: "พื้นที่ดิสก์หายไปไหน?" และ "ทำให้คอมเร็วขึ้นได้ไหม?"
2. จุดขายคือ **กดง่าย + ปลอดภัย + ย้อนกลับได้ทุกอย่าง** — ต่างจาก TreeSize ที่ ribbon เยอะ และต่างจาก VantageOS ที่กด 1 ครั้งแล้วเปลี่ยนเครื่องทั้งเครื่องแบบย้อนทีละอย่างไม่ได้
3. Stack ที่แนะนำ: **Tauri 2 (Rust) + React + TypeScript** → ไฟล์ติดตั้งเล็ก (~10 MB), สแกนดิสก์เร็วระดับ native, ใช้ทักษะ React เดิมทำ UI ได้เลย
4. แบ่งเป็น 5 หน้าหลัก: **หน้าแรก · พื้นที่ดิสก์ · ล้างขยะ · เร่งความเร็ว · ประวัติ & กู้คืน**
5. ทำเป็น 6 เฟส เริ่มจากตัวสแกน (หัวใจของโปรแกรม) ก่อน แล้วค่อยเพิ่ม Optimizer ทีหลัง

---

## 1. วิเคราะห์ต้นแบบ

### 1.1 TreeSize (จากภาพหน้าจอ)

1. **สิ่งที่ดี**
   1. Tree ซ้ายมือ เรียงโฟลเดอร์จากใหญ่ → เล็ก พร้อมแถบสีแสดงสัดส่วน — อ่านง่ายมาก
   2. กราฟ Pie / Bar / Treemap ด้านขวา แสดง Users 88.7 GB, Program Files 65.1 GB ฯลฯ
   3. แท็บมุมมองเสริม: Details, Extensions, Users, Age of Files, Top Files, History
   4. ตารางไดรฟ์ทั้งหมด (C:, I:, R:, T:) พร้อม % ว่าง
   5. แสดงทั้ง **Size** (368.5 GB) และ **Allocated** (251.5 GB) แยกกัน
2. **จุดที่ทำให้ใช้ยาก (เราจะแก้)**
   1. Ribbon แบบ Office มีปุ่มเยอะเกิน — ผู้ใช้ทั่วไปไม่รู้จะกดอะไร
   2. Pie chart ที่มี Free Space 73% กินพื้นที่กราฟเกือบหมด ส่วนที่ผู้ใช้สนใจ (โฟลเดอร์ที่ใช้พื้นที่) กลับเป็นชิ้นเล็ก
   3. รู้ว่าอะไรใหญ่ แต่ **ไม่บอกว่าอะไรลบได้อย่างปลอดภัย** — ผู้ใช้ต้องตัดสินใจเอง
   4. ไม่มีปุ่ม "จัดการ" ชัดๆ ต้องคลิกขวาหาเมนู

3. **ศึกษาเพิ่มจากเอกสารทางการ (black-box — ไม่ได้แกะโปรแกรม)**
   1. **วิธีสแกน**: อ่าน NTFS Master File Table (MFT) ตรงบนไดรฟ์ local → เร็วมาก; ถ้าอ่าน MFT ไม่ได้ / ไดรฟ์เครือข่าย จะ walk ปกติด้วย 2 threads (รุ่น Pro สูงสุด 32 threads, ปรับจำนวนอัตโนมัติ, ดูผลระหว่างสแกนได้)
   2. **ฟรีมีอะไร**: tree แบบ Explorer + แถบสีหลังขนาดโฟลเดอร์, Treemap 2D/3D, filter ด้วย pattern/regex, คอลัมน์ (ขนาด, allocated, จำนวนไฟล์, last access, owner), NTFS compression, รองรับ path > 255 ตัวอักษร, สแกนมือถือผ่าน MTP, export PDF, เมนูคลิกขวาใน Explorer, พกพาลง USB ได้
   3. **ต้องจ่ายเงิน (Personal/Pro)**: ไฟล์ใหญ่สุด (Top files), หาไฟล์ซ้ำ (MD5/SHA256), แทนไฟล์ซ้ำด้วย hardlink, ประวัติ/เทียบ snapshot, สถิติตามนามสกุล/อายุไฟล์, export Excel/CSV/HTML/SQLite, undo การจัดการไฟล์, สแกนตามเวลา, command line
   4. **โอกาสของ WeakClean**: ฟีเจอร์ที่ TreeSize เก็บเงิน (Top files, ไฟล์ซ้ำ, ประวัติการเติบโต, CSV export, undo) ใส่ให้ฟรีในเวอร์ชันแรกได้เลย + ป้าย "ลบได้/ห้ามลบ" ที่ TreeSize ไม่มี
   5. แหล่งที่มา: [TreeSize Features](https://jam-software.com/treesize/features.shtml) · [TreeSize Editions](https://www.jam-software.com/treesize_free/editions.shtml)
4. **เรื่อง reverse engineering**: ไม่ใช้เครื่องมือ decompile (เช่น rea / Ghidra) กับตัวโปรแกรม TreeSize เพราะ EULA ห้าม และเสี่ยงเรื่องลิขสิทธิ์ถ้า WeakClean จะขาย — ทุกอย่างในแผนนี้มาจากเอกสารสาธารณะและการสังเกตการใช้งาน

### 1.2 VantageOS Tweaker (จากไฟล์ที่แนบมา)

โครงสร้าง: Python 3.12 + **Eel** (หน้า HTML/JS เรียก Python) แพ็กด้วย PyInstaller · มี `.reg`, `.pow` (Power Plan), `.ps1` และเครื่องมือ NVIDIA แนบมา

1. **ฟีเจอร์ที่มี**
   1. **Dashboard** — OS, CPU, GPU, RAM
   2. **Tweaking › Windows Tweaks** — Classic Context Menu, GameDVR & GameBar, Visual Transparency, Telemetry
   3. **Tweaking › Latency & Network** — Timer Coalescing, Win32PrioritySeparation (0x26), Network Throttling
   4. **Tweaking › Utilities** — นำเข้า VantageOS Power Plan
   5. **Tweaking › NVIDIA** — NVCleanstall, Nvidia Inspector, Nvidia Profile Inspector, Apply `.nip` profile
   6. **Troubleshooting › Services** — 1-Click ปิด ~75 services (DiagTrack, SysMain, WSearch, Hyper-V guest ฯลฯ), สวิตช์ Wi-Fi / Bluetooth / Printer / SysMain / Search / DPS
   7. **Troubleshooting › Security** — VBS, HVCI (Memory Integrity), UAC, Spectre/Meltdown mitigations
   8. **1-Click Optimize** — สร้าง Restore Point แล้วใช้ทุก tweak ทีเดียว
   9. ไฟล์ `VantageOS.reg` ยังปรับอีกหลายอย่าง: ปิด Auto Windows Update, ตั้ง PowerShell ExecutionPolicy = Unrestricted, ปิด BitLocker auto-encryption, ปิด visual effects, ปิด News & Interests, ปิด AppCompat telemetry, ลบเมนูคลิกขวาบางอย่าง ฯลฯ
2. **สิ่งที่ดี (เอามาใช้)**
   1. แนวคิด **สวิตช์เปิด/ปิด + อ่านสถานะจริงจากเครื่อง** (`get_feature_status`) ก่อนแสดงผล
   2. สร้าง Restore Point ก่อนเปลี่ยนแปลง
   3. จัดกลุ่มตามหมวด (Windows / Latency / Network / Services / Security)
3. **จุดอ่อนที่ WeakClean ต้องทำดีกว่า**
   1. **1-Click ใช้ทุกอย่างรวมกัน** รวมถึงของที่ลดความปลอดภัย (ปิด UAC, VBS/HVCI, Spectre mitigation, ปิด Windows Update, PowerShell Unrestricted) → ผู้ใช้ไม่รู้ว่ากำลังแลกอะไร
   2. **ไม่มี Undo รายรายการ** — ถ้ามีปัญหาต้องพึ่ง Restore Point ทั้งเครื่อง (ซึ่งบางเครื่องปิดไว้ สคริปต์ก็แค่ "ข้ามไป")
   3. ปิด services แบบเหมาเครื่อง (เช่น `ShellHWDetection`, `WpnService`, `FontCache`, `tzautoupdate`) อาจทำให้ autoplay, การแจ้งเตือน, เขตเวลา พังโดยไม่รู้สาเหตุ
   4. แนบ `.exe` ของบุคคลที่สามมาในแพ็กเกจ → เสี่ยง antivirus แจ้งเตือน + เรื่องลิขสิทธิ์
   5. UI ขึ้น "Loading..." ทุกสวิตช์ และไม่บอกว่าต้องรีบูตหรือไม่จนกว่าจะอ่านคำอธิบาย

---

## 2. หลักการ UX/UI ของ WeakClean

1. **1 หน้า = 1 คำถาม = 1 ปุ่มหลัก** — ทุกหน้ามีปุ่มใหญ่สีหลักแค่ปุ่มเดียว (เช่น "สแกน", "ล้างเลย", "เร่งความเร็ว")
2. **บอกผลเป็นภาษาคน** — "คืนพื้นที่ได้ 12.4 GB" ไม่ใช่ "Deleted 48,213 files"
3. **ดูก่อน ค่อยทำ (Preview → Confirm)** — ทุกการลบ/ปรับแต่ง แสดงรายการและขนาดก่อนกดยืนยัน
4. **ย้อนกลับได้ทุกอย่าง** — ลบไฟล์ = ย้ายลงถังขยะ (หรือ Quarantine ของ WeakClean 7 วัน), ปรับแต่ง = บันทึกค่าเดิมไว้ กด Undo ได้ทีละรายการ
5. **ป้ายความเสี่ยงชัดเจน 3 ระดับ**
   1. 🟢 **ปลอดภัย** — ไม่กระทบการใช้งาน (เช่น ล้าง Temp, ปิด GameDVR)
   2. 🟡 **แนะนำสำหรับเกม** — อาจเปลี่ยนพฤติกรรมเล็กน้อย (เช่น ปิด SysMain, Search Indexer)
   3. 🔴 **ผู้เชี่ยวชาญ** — ลดความปลอดภัยหรือมีผลข้างเคียงสูง (VBS, HVCI, Spectre) → ซ่อนไว้ใน "โหมดผู้เชี่ยวชาญ" และ **ไม่รวมใน 1-Click**
6. **ป้าย "ต้องรีบูต"** แสดงบนการ์ดเลย ไม่ต้องอ่านคำอธิบาย
7. **ไม่มี Ribbon** — ใช้ Sidebar 5 เมนู + ปุ่ม action ตามบริบท (เลือกโฟลเดอร์แล้วแถบ action จะโผล่ขึ้นมาเอง)
8. **ภาษาไทยเป็นค่าเริ่มต้น** สลับอังกฤษได้ · ฟอนต์รองรับไทยสวย (IBM Plex Sans Thai / Anuphan)
9. **Dark/Light mode** ตาม Windows
10. **ใช้คีย์บอร์ดได้** — `Ctrl+K` ค้นหาไฟล์/ฟีเจอร์, `Space` พรีวิว, `Del` ย้ายลงถังขยะ

---

## 3. โครงหน้าจอ (Information Architecture)

```
WeakClean
├── 🏠 หน้าแรก (Home)
│     ├─ คะแนนสุขภาพเครื่อง (0–100) + เหตุผลสั้นๆ
│     ├─ การ์ดไดรฟ์ทั้งหมด (ใช้ไป/ว่าง)
│     ├─ สเปกเครื่อง (OS, CPU, GPU, RAM)  ← จาก VantageOS Dashboard
│     └─ 3 ปุ่มลัด: สแกนดิสก์ · ล้างขยะ · เร่งความเร็ว
├── 📊 พื้นที่ดิสก์ (Space Analyzer)  ← แทน TreeSize
│     ├─ เลือกไดรฟ์/โฟลเดอร์ → สแกน (มี progress แบบ real-time)
│     ├─ มุมมอง: Treemap (ค่าเริ่มต้น) · Sunburst · รายการ
│     ├─ แท็บย่อย: โฟลเดอร์ · ประเภทไฟล์ · ไฟล์ใหญ่สุด · ไฟล์เก่า · ไฟล์ซ้ำ
│     └─ แถบ Action: เปิดใน Explorer · ย้ายลงถังขยะ · ย้ายไปไดรฟ์อื่น · บีบอัด (NTFS compress)
├── 🧹 ล้างขยะ (Cleaner)
│     ├─ สแกน → แสดงหมวดพร้อมขนาด (ติ๊กเลือกได้)
│     └─ ปุ่ม "ล้าง X GB"
├── ⚡ เร่งความเร็ว (Boost)  ← แทน VantageOS Tweaker
│     ├─ เลือกโปรไฟล์: สมดุล · เกมมิ่ง · กำหนดเอง
│     ├─ หมวด: ระบบ · เกม & Latency · เครือข่าย · ความเป็นส่วนตัว · Services · โปรแกรมเปิดตอนบูต · GPU
│     └─ โหมดผู้เชี่ยวชาญ (ซ่อน): Security tweaks
├── 🛡️ ประวัติ & กู้คืน (Safety Center)
│     ├─ Timeline ทุกการเปลี่ยนแปลง (ลบอะไร/ปรับอะไร/เมื่อไหร่)
│     ├─ Undo รายรายการ · Undo ทั้งชุด
│     ├─ Restore Points ของ Windows
│     └─ Quarantine (ไฟล์ที่ลบ เก็บ 7 วัน)
└── ⚙️ ตั้งค่า
```

---

## 4. รายละเอียดฟีเจอร์

### 4.1 พื้นที่ดิสก์ (Space Analyzer) — แกนหลักแบบ TreeSize

1. **การสแกน**
   1. สแกนไดรฟ์ทั้งลูกหรือเลือกโฟลเดอร์ (ลากโฟลเดอร์มาวางได้)
   2. แสดงผล **ระหว่างสแกน** (streaming) ไม่ต้องรอจบ — ตัวเลขโฟลเดอร์ใหญ่ขึ้นแบบ real-time
   3. แสดงทั้ง Size และ Size on disk (Allocated) เหมือน TreeSize
   4. โหมดเร็วพิเศษเมื่อรันแบบ Admin: อ่าน NTFS MFT ตรง (เร็วกว่า walk ปกติหลายเท่า)
   5. จัดการกรณีพิเศษ: hard link นับครั้งเดียว, ข้าม junction/symlink (กันวนลูป), ไฟล์ OneDrive แบบ cloud-only แสดงแยก
2. **การแสดงผล**
   1. **Treemap** เป็นค่าเริ่มต้น (เห็นภาพรวมดีกว่า pie) — คลิกเพื่อซูมเข้า, breadcrumb ด้านบนเพื่อถอยกลับ
   2. รายการโฟลเดอร์แบบ tree พร้อมแถบสัดส่วน (แบบ TreeSize แต่สะอาดกว่า)
   3. **ไม่เอา Free Space มาปนในกราฟ** — แสดงเป็นแถบไดรฟ์แยกด้านบนแทน
3. **แท็บย่อย**
   1. **ประเภทไฟล์** — วิดีโอ, เกม, รูป, เอกสาร, ติดตั้ง (.exe/.msi/.iso), ระบบ, อื่นๆ
   2. **ไฟล์ใหญ่สุด** — Top 100
   3. **ไฟล์เก่า** — ไม่ได้เปิดเกิน 1 ปี (แทน "Age of Files")
   4. **ไฟล์ซ้ำ** — หาด้วยขนาด → hash ส่วนหัว → hash เต็ม (เร็วและแม่น)
   5. **ประวัติ** — เทียบกับการสแกนครั้งก่อน "C: โตขึ้น 8.2 GB ตั้งแต่สัปดาห์ที่แล้ว (มาจาก Downloads)"
4. **ป้ายอัจฉริยะ (จุดต่างจาก TreeSize)** — แปะป้ายบนโฟลเดอร์ที่รู้จัก
   1. 🟢 "ลบได้" — `%TEMP%`, `SoftwareDistribution\Download`, browser cache
   2. 🟡 "ตรวจสอบก่อน" — Downloads, installers, `.iso`
   3. 🔴 "ห้ามลบ" — `Windows`, `System32`, `WinSxS` (ปุ่มลบจะ disable)
5. **Actions**: เปิดใน Explorer · ย้ายลงถังขยะ · ย้ายไปไดรฟ์อื่น (เช่น ย้ายเกม Steam ไป D:) · NTFS compress · คัดลอก path · Export CSV/HTML

### 4.2 ล้างขยะ (Cleaner)

| หมวด | ตำแหน่งตัวอย่าง | ความเสี่ยง | ค่าเริ่มต้น |
|---|---|---|---|
| ไฟล์ชั่วคราวผู้ใช้ | `%TEMP%` | 🟢 | ✅ |
| ไฟล์ชั่วคราว Windows | `C:\Windows\Temp` | 🟢 | ✅ |
| แคช Windows Update | `SoftwareDistribution\Download` | 🟢 | ✅ |
| Delivery Optimization | `DeliveryOptimization\Cache` | 🟢 | ✅ |
| Thumbnail / Icon cache | `Explorer\thumbcache_*.db` | 🟢 | ✅ |
| แคชเบราว์เซอร์ (Chrome/Edge/Firefox) | `...\Cache`, `Code Cache` | 🟢 | ✅ (ไม่แตะ cookies/รหัสผ่าน) |
| Shader cache (DirectX/NVIDIA/AMD) | `D3DSCache`, `NVIDIA\DXCache` | 🟢 | ⬜ (เกมจะคอมไพล์ shader ใหม่ครั้งแรก) |
| Crash dumps / Error reports | `Minidump`, `WER` | 🟢 | ✅ |
| ถังขยะ | `$Recycle.Bin` | 🟡 | ⬜ |
| Windows.old / อัปเดตเก่า | `Windows.old`, DISM component cleanup | 🟡 | ⬜ (ย้อนกลับ Windows เวอร์ชันเก่าไม่ได้อีก) |
| Downloads เก่ากว่า 90 วัน | `%USERPROFILE%\Downloads` | 🟡 | ⬜ แสดงรายการให้เลือกเอง |

1. ทุกหมวดแสดงขนาดก่อนลบ · คลิกเพื่อดูรายการไฟล์ข้างใน
2. ไฟล์ที่กำลังถูกใช้งาน (locked) → ข้ามและรายงาน ไม่ error ใส่ผู้ใช้
3. หลังล้างเสร็จ: การ์ดสรุป "คืนพื้นที่ 6.8 GB 🎉" + ปุ่ม "ดูรายละเอียด"

### 4.3 เร่งความเร็ว (Boost) — นำฟีเจอร์ VantageOS มาจัดใหม่

**โปรไฟล์ (ปุ่มเดียวจบ)**

1. **สมดุล** — ใช้เฉพาะ 🟢 ทั้งหมด
2. **เกมมิ่ง** — 🟢 + 🟡 ที่เกี่ยวกับเกม/latency
3. **กำหนดเอง** — เลือกเองทีละสวิตช์
4. ก่อนใช้โปรไฟล์ แสดงหน้าต่างยืนยัน **"จะเปลี่ยน 13 อย่าง · ต้องรีบูต 1 อย่าง"** พร้อมรายการ แล้วค่อยกดยืนยัน
5. สร้าง Restore Point อัตโนมัติ + บันทึกค่าเดิมทุก key ลง Safety Center

**แคตตาล็อก Tweak (v1)**

| หมวด | Tweak | ระดับ | รีบูต | ใน "เกมมิ่ง" | ที่มา |
|---|---|---|---|---|---|
| ระบบ | Classic Context Menu (คลิกขวาแบบ Win10) | 🟢 | Explorer | ⬜ | VantageOS |
| ระบบ | ปิด Transparency / Mica | 🟢 | – | ✅ | VantageOS |
| ระบบ | ลด Visual Effects (คงฟอนต์ลื่น) | 🟢 | – | ✅ | VantageOS .reg |
| ระบบ | ปิด News & Interests / Widgets | 🟢 | – | ✅ | VantageOS .reg |
| ระบบ | เปิด "End Task" ใน taskbar | 🟢 | – | ✅ | VantageOS .reg |
| เกม | ปิด GameDVR & Game Bar capture | 🟢 | – | ✅ | VantageOS |
| เกม | Win32PrioritySeparation = 0x26 | 🟡 | – | ✅ | VantageOS |
| เกม | ปิด Enhance Pointer Precision | 🟢 | – | ✅ | VantageOS .reg |
| เกม | Power Plan ประสิทธิภาพสูง (WeakClean plan) | 🟡 | – | ✅ | VantageOS .pow |
| เกม | Timer Coalescing | 🟡 | ✅ | ⬜ | VantageOS |
| เครือข่าย | Network Throttling Index / SystemResponsiveness | 🟡 | ✅ | ✅ | VantageOS |
| ส่วนตัว | ปิด Telemetry (DiagTrack, dmwappushservice, AppCompat) | 🟢 | – | ✅ | VantageOS |
| Services | SysMain (Superfetch) → Disabled | 🟡 | – | ✅ (เฉพาะ SSD) | VantageOS |
| Services | Windows Search Indexer → Manual | 🟡 | – | ⬜ (ค้นหาไฟล์จะช้าลง) | VantageOS |
| Services | Hyper-V guest services → Disabled | 🟢 | – | ✅ (ถ้าไม่ใช่ VM) | VantageOS |
| Services | Fax, RetailDemo, MapsBroker, RemoteRegistry → Disabled | 🟢 | – | ✅ | VantageOS |
| Services | Wi-Fi / Bluetooth / Printer — สวิตช์ตามอุปกรณ์จริง | 🟢 | – | ⬜ | VantageOS |
| Startup | จัดการโปรแกรมเปิดตอนบูต (Registry Run, Startup folder, Task Scheduler) | 🟢 | – | ⬜ | **ใหม่** |
| GPU | ล้าง shader cache / ลิงก์ไปดาวน์โหลด NVCleanstall & Profile Inspector จากเว็บทางการ | 🟢 | – | ⬜ | VantageOS (ไม่ bundle exe) |
| GPU | นำเข้าโปรไฟล์ `.nip` (ถ้าพบ Profile Inspector ในเครื่อง) | 🟡 | – | ⬜ | VantageOS |
| ผู้เชี่ยวชาญ | ปิด VBS / HVCI (Memory Integrity) | 🔴 | ✅ | ❌ ไม่รวม | VantageOS |
| ผู้เชี่ยวชาญ | ปิด Spectre/Meltdown mitigations | 🔴 | ✅ | ❌ ไม่รวม | VantageOS |

**สิ่งที่ตั้งใจ "ไม่ทำ" ใน WeakClean (ต่างจาก VantageOS)**

1. ❌ ปิด UAC — ความเสี่ยงสูงมาก ได้ประสิทธิภาพแทบไม่มี
2. ❌ ปิด Windows Update อัตโนมัติ — ให้แค่ตัวเลือก "เลื่อนอัปเดต 7/14/35 วัน" แทน
3. ❌ ตั้ง PowerShell ExecutionPolicy = Unrestricted ทั้งเครื่อง
4. ❌ ปิด FontCache / ShellHWDetection / WpnService / tzautoupdate แบบเหมา — ได้น้อย เสียการใช้งานเยอะ
5. ❌ แนบ .exe ของบุคคลที่สามมาในตัวติดตั้ง

### 4.4 ประวัติ & กู้คืน (Safety Center)

1. Timeline รายการเปลี่ยนแปลงทั้งหมด (วันที่, อะไร, ค่าเดิม → ค่าใหม่, ใครสั่ง: โปรไฟล์/ผู้ใช้)
2. ปุ่ม **Undo** ทุกแถว + **"คืนค่าทั้งชุด"** ต่อการใช้โปรไฟล์ 1 ครั้ง
3. Quarantine: ไฟล์ที่ลบจาก Cleaner เก็บในโฟลเดอร์ซ่อน 7 วัน (ตั้งค่าได้) — กู้คืนได้ทีละไฟล์
4. ดู/สร้าง/กู้ Restore Point ของ Windows · เตือนถ้า System Protection ถูกปิดไว้ และมีปุ่ม "เปิดให้"
5. **ปุ่มฉุกเฉิน** "คืนค่าทุกอย่างที่ WeakClean เคยทำ"

### 4.5 หน้าแรก (Home)

1. **คะแนนสุขภาพ 0–100** คิดจาก: พื้นที่ว่าง C:, ขยะที่ล้างได้, โปรแกรมเปิดตอนบูต, tweak ที่ยังไม่ได้ใช้, อายุ Restore Point ล่าสุด
2. แสดง "สิ่งที่ควรทำ" ไม่เกิน 3 ข้อ เช่น "ล้างขยะได้ 6.8 GB", "มี 9 โปรแกรมเปิดตอนบูต"
3. การ์ดไดรฟ์ + สเปกเครื่อง

---

## 5. สถาปัตยกรรมและเทคโนโลยี

### 5.1 เลือก Stack

| ตัวเลือก | ข้อดี | ข้อเสีย | สรุป |
|---|---|---|---|
| **Tauri 2 + Rust + React/TS** | สแกนเร็วระดับ native, exe เล็ก, ใช้ WebView2 ที่มีใน Win10/11, ใช้ React ได้ | ต้องเรียน Rust บางส่วน | ✅ **แนะนำ** |
| Electron + Node | ทำ UI ง่าย (เคยทำ VTuber app แล้ว) | ไฟล์ใหญ่ ~150 MB, กิน RAM — ขัดกับคอนเซปต์ "ทำให้เครื่องลื่น" | ⚠️ |
| Python + Eel (แบบ VantageOS) | เขียนเร็ว | สแกนไฟล์ 800k ไฟล์ช้า, PyInstaller โดน antivirus บ่อย | ❌ |
| C# WinUI 3 / WPF | native Windows เต็มตัว | UI สวยแบบเว็บทำยากกว่า | ⚠️ ทางเลือก |

### 5.2 โครงสร้างระบบ

```
┌──────────────────────── React UI (WebView2) ────────────────────────┐
│  Home · SpaceAnalyzer · Cleaner · Boost · SafetyCenter · Settings     │
│  state: Zustand · charts: d3-hierarchy (treemap/sunburst) · i18n      │
└───────────────▲─────────────────────────────▲─────────────────────────┘
                │ invoke() / events (progress)│
┌───────────────┴──────────── Rust core (Tauri commands) ───────────────┐
│ scanner/   walk แบบขนาน (jwalk) + NTFS MFT fast path (admin)           │
│ analyzer/  สรุปตามโฟลเดอร์/ประเภท/อายุ, หาไฟล์ซ้ำ (xxhash/blake3)        │
│ cleaner/   นิยามหมวดขยะ (TOML) → preview → ย้ายลง Quarantine/Recycle   │
│ tweaks/    engine อ่าน tweak definition → detect / apply / revert      │
│ safety/    change log + snapshot ค่าเดิม (SQLite) + Restore Point       │
│ sysinfo/   CPU/GPU/RAM/OS (sysinfo crate + WMI)                        │
└───────────────▲───────────────────────────────────────────────────────┘
                │ named pipe (เฉพาะงานที่ต้องสิทธิ์ Admin)
┌───────────────┴───────── WeakClean Helper (elevated) ───────────────────┐
│ registry HKLM · services · powercfg · bcdedit · MFT read · DISM        │
└────────────────────────────────────────────────────────────────────────┘
```

1. **ตัวแอปหลักรันสิทธิ์ผู้ใช้ปกติ** — งานที่ต้อง Admin ส่งให้ Helper (ขึ้น UAC prompt ครั้งเดียวต่อ session) → ปลอดภัยกว่าการรันทั้งแอปเป็น Admin
   - ทางลัดสำหรับ v1: ใส่ปุ่ม "เปิดใหม่ในโหมด Admin" ก่อน แล้วค่อยแยก Helper ใน Phase 5
2. **Tweak เป็นข้อมูล ไม่ใช่โค้ด** — เขียนเป็นไฟล์ TOML แล้ว engine ตีความ เพิ่ม tweak ใหม่ไม่ต้องแก้ Rust

```toml
[[tweak]]
id          = "gamedvr_off"
name_th     = "ปิด Game DVR & Game Bar"
category    = "gaming"
risk        = "safe"        # safe | recommended | expert
reboot      = false
profiles    = ["balanced", "gaming"]

  [[tweak.ops]]
  type  = "registry"
  path  = 'HKCU\System\GameConfigStore'
  name  = "GameDVR_Enabled"
  kind  = "REG_DWORD"
  value = 0                 # ค่าเดิมจะถูกอ่านและเก็บอัตโนมัติก่อน apply
```

3. **ชนิด op ที่รองรับ**: `registry`, `service_start_type`, `powercfg`, `bcdedit`, `scheduled_task`, `appx_remove` (ภายหลัง)
4. **ฐานข้อมูล** SQLite ที่ `%LOCALAPPDATA%\WeakClean\weakclean.db`: ตาราง `scans`, `scan_nodes` (เก็บแค่ระดับบนๆ เพื่อเทียบประวัติ), `changes`, `quarantine`

### 5.3 โครงโฟลเดอร์โปรเจกต์

```
E:\CandyCore\WeClean\
├─ apps/
│  └─ desktop/                # Tauri app
│     ├─ src/                 # React + TS
│     │  ├─ pages/            # Home, Space, Cleaner, Boost, Safety, Settings
│     │  ├─ components/       # Treemap, DriveCard, TweakCard, RiskBadge, ...
│     │  ├─ i18n/             # th.json, en.json
│     │  └─ styles/tokens.css # สี/ฟอนต์จากดีไซน์
│     └─ src-tauri/
│        ├─ src/              # commands, scanner, cleaner, tweaks, safety
│        └─ tauri.conf.json
├─ crates/
│  ├─ weakclean-scanner/        # แยกเป็น crate ทดสอบ/benchmark ได้อิสระ
│  └─ weakclean-helper/         # elevated helper
├─ data/
│  ├─ tweaks/*.toml           # แคตตาล็อก tweak
│  └─ cleaners/*.toml         # นิยามหมวดขยะ
├─ tests/vm/                  # สคริปต์ทดสอบบน VM
└─ WeakClean_Plan.md            # ไฟล์นี้
```

---

## 6. แผนการพัฒนา (Roadmap)

| เฟส | เป้าหมาย | งานหลัก | เสร็จเมื่อ (Definition of Done) |
|---|---|---|---|
| **0. Setup** | โปรเจกต์รันได้ | สร้าง Tauri + React + TS, ใส่ design tokens, Sidebar 5 หน้า (หน้าเปล่า), i18n ไทย/อังกฤษ | `npm run tauri dev` เปิดหน้าต่างได้ สลับหน้า/ภาษาได้ |
| **1. Scanner** | สแกนเร็วและถูกต้อง | `weakclean-scanner`: jwalk ขนาน, size + allocated, hard link, ข้าม reparse, ส่ง progress event | สแกน C: (~800k ไฟล์) จบ < 30 วิ (โหมดปกติ), ตัวเลขต่างจาก TreeSize ไม่เกิน 1% |
| **2. Space Analyzer UI** | ใช้แทน TreeSize ได้ | Treemap + tree list + breadcrumb, แท็บประเภท/ใหญ่สุด/เก่า, ป้ายอัจฉริยะ, action (Explorer/ถังขยะ/ย้าย), export CSV | ผู้ใช้ทดสอบหา "อะไรกินพื้นที่" ได้ใน < 30 วิ โดยไม่ต้องสอน |
| **3. Cleaner + Safety (พื้นฐาน)** | ล้างขยะอย่างปลอดภัย | หมวดขยะ TOML, preview, Quarantine 7 วัน, change log SQLite, หน้า Safety Center (ลบ/กู้ไฟล์) | ล้างแล้วกู้คืนได้ครบ 100% ในเทสต์ |
| **4. Boost** | ปรับแต่งแบบย้อนได้ | tweak engine (detect/apply/revert), แคตตาล็อก v1 (ตารางหัวข้อ 4.3), โปรไฟล์ สมดุล/เกมมิ่ง, Startup manager, Restore Point อัตโนมัติ | ทุก tweak ผ่านเทสต์ apply → revert แล้วค่า registry/service ตรงกับก่อนเริ่ม 100% |
| **5. Polish & Ship** | พร้อมแจก/ขาย | Helper แยกสิทธิ์, Home + health score, ไฟล์ซ้ำ, ประวัติสแกน, Dark/Light, installer (MSI/NSIS), **code signing**, auto-update | ติดตั้งบนเครื่องสะอาด Win10/11 ได้ ไม่โดน SmartScreen/AV block |

> ทำงานทีละเฟส ทุกเฟสจบด้วยเวอร์ชันที่ใช้งานได้จริง (เช่น จบเฟส 2 ก็ใช้เป็น "TreeSize เวอร์ชันสวย" ได้แล้ว)

**สถานะ (14 ต.ค. 2026)**

1. ✅ ตัดสินใจ stack: **Rust + Tauri 2 + React 19 + TypeScript + Tailwind CSS 4**
2. ✅ **Phase 0** สร้างแล้วที่ `apps/desktop` — แถบหัวหน้าต่างเอง, เมนูซ้าย 5 หน้า, สลับ TH/EN, ธีม Sky Glass, คำสั่ง Rust ทดสอบ `app_info` · frontend build ผ่าน · วิธีรันดู `SETUP_TH.md`
3. ✅ **UI ทั้ง 5 หน้า** ทำตามดีไซน์ Sky Glass แล้ว (หน้าแรก · พื้นที่ดิสก์ · ล้างขยะ · เร่งความเร็ว · ประวัติ & กู้คืน) — กดเล่นได้ครบ สลับ TH/EN ได้ แต่ใช้ **ข้อมูลตัวอย่าง** จาก `src/lib/mock.ts` และในแต่ละหน้า; ปุ่มที่ต้องใช้ Rust (สแกนใหม่, เปิดใน Explorer, ซูม, ส่งออก CSV ฯลฯ) ขึ้นข้อความ "ยังเป็นแค่หน้าตา" ก่อน
4. ⏳ รอยืนยันบนเครื่อง Windows: `npm run tauri dev` (ส่วน Rust ยังไม่ได้ compile บน Windows จริง)
5. ✅ **Phase 1 — Scanner** เสร็จฝั่ง Rust: `crates/weakclean-scanner` (เดินขนาน rayon, ขนาดจริง + ขนาดบนดิสก์, ข้าม junction/symlink, hard link ใน WinSxS นับครั้งเดียว, cloud-only แยก, ไฟล์ใหญ่สุด + สถิตินามสกุล, ยกเลิกได้) + คำสั่ง Tauri `list_drives / start_scan / cancel_scan / scan_children / scan_overview` + event `scan://progress`, `scan://done` · เทสต์ 9 ข้อผ่าน · สแกน C: จริง 696,118 ไฟล์ใช้ **7.4 วินาที** (เป้า < 30 วิ)
   1. ⏳ ยังไม่ได้เทียบตัวเลขกับ TreeSize (เป้า ≤ 1%) — ต้องรัน `cargo run --release --example scan -- C:\` แล้วเทียบกับ TreeSize บนเครื่องเดียวกัน ควรรันแบบ Admin ด้วยเพราะโหมดปกติอ่านบางโฟลเดอร์ไม่ได้ (เจอ 126 จุด)
   2. ✅ สะพาน IPC/event ทดสอบกับแอปจริงแล้ว (สั่งสแกนจากหน้าจอ → ความคืบหน้าสด → ผลลัพธ์ → ยกเลิก/สแกนโฟลเดอร์เฉพาะ/กันสแกนซ้อน)
6. ✅ **Phase 2 — Space Analyzer UI (ส่วนใหญ่)** หน้า พื้นที่ดิสก์ใช้ข้อมูลจริงแล้ว: ไดรฟ์จริง, สแกน/ยกเลิก/เลือกโฟลเดอร์เอง, treemap แบบ squarified + breadcrumb + ซูม (ดับเบิลคลิก), ป้าย ลบได้/ตรวจสอบก่อน/ห้ามลบ ตามกฎ path (`src/lib/classify.ts`), แท็บ ประเภทไฟล์ + ไฟล์ใหญ่สุด, เปิดใน Explorer · ผลสแกนค้างอยู่เมื่อสลับหน้า
   1. ⏳ ยังไม่ทำ: ไฟล์เก่า / ไฟล์ซ้ำ / ประวัติการเติบโต (ต้องเก็บข้อมูลเพิ่มใน Rust), ย้ายลงถังขยะ / ย้ายไดรฟ์ (รอ Quarantine ใน Phase 3), ส่งออก CSV, ลากโฟลเดอร์มาวาง, โหมดอ่าน NTFS MFT, เทียบตัวเลขกับ TreeSize
9. ✅ **Phase 5 — Polish & Ship (ส่วนที่ทำได้เอง)**
   1. **หน้าแรกใช้ข้อมูลจริง:** คะแนนสุขภาพคิดจากพื้นที่ว่างไดรฟ์ระบบ, ขยะที่ล้างได้, tweak ปลอดภัยที่ยังไม่ใช้, tweak ที่ Windows คืนค่า (กดดูรายละเอียดคะแนนได้) · สเปกเครื่องอ่านจาก registry/Windows API (OS, CPU, GPU, RAM)
   2. **ไฟล์เก่า / ไฟล์ซ้ำ / ประวัติ:** ไฟล์ใหญ่ที่ไม่ได้แก้ไขเกิน 1 ปี · ไฟล์ซ้ำ (ขนาด → hash ส่วนหัว → hash เต็ม blake3, ข้ามไฟล์ระบบ, hard link ไม่นับ, เก็บอย่างน้อย 1 สำเนาเสมอ) · ประวัติสแกน 30 ครั้งต่อ path พร้อมสรุปการเติบโตและโฟลเดอร์ที่โตมากสุด · ย้ายไฟล์ที่เลือกเข้าที่กักกัน (กู้คืนได้) โดย backend ตรวจว่า path ต้องอยู่ในผลสแกน และไฟล์ต้องไม่ถูกแก้ไขหลังสแกน
   3. **Dark/Light:** ตามธีมของ Windows อัตโนมัติ + ปุ่มสลับ (ตามระบบ → สว่าง → มืด) ในแถบหัว จำค่าที่เลือก
   4. **รุ่น release:** `npm run tauri build -- --no-bundle` ได้ `weakclean.exe` ขนาด 5.4 MB กิน RAM ~33 MB ตอนเปิด · ตั้ง Content Security Policy ที่เข้มแล้ว (ทดสอบรุ่น release: IPC, ฟอนต์, ธีม, สแกนทำงานปกติ ไม่มี CSP violation)
   5. เทสต์ผ่าน: scanner 16 · cleaner 19 · tweaks 17 ข้อ และทดสอบ flow ย้าย→กู้คืนไฟล์ซ้ำ/ไฟล์เก่ากับแอปจริงใน sandbox (hash ตรงทั้งหมด)
   6. ⏳ **ยังไม่ได้ทำ (ต้องใช้สิ่งที่ทำเองไม่ได้ หรือเป็นงานใหญ่แยกต่างหาก):**
      1. ~~installer (MSI/NSIS)~~ ✅ สร้างแล้ว (ยังไม่เซ็น): `apps/desktop/src-tauri/target/release/bundle/msi/WeakClean_0.1.0_x64_en-US.msi` (3.1 MB) และ `bundle/nsis/WeakClean_0.1.0_x64-setup.exe` (2.5 MB) · **ยังไม่เคยติดตั้งทดสอบ** บนเครื่องใด
      2. **code signing:** ✅ เซ็นด้วยใบรับรอง self-signed ชื่อ "CandyCore" แล้ว (`scripts/release.ps1 -Sign -AllowSelfSigned`, ผลที่ `release/0.1.0/`) แต่ Windows ยังไม่เชื่อถือผู้เผยแพร่ — SmartScreen ยังเตือนบนเครื่องอื่นจนกว่าจะติดตั้ง `CandyCore.cer` หรือใช้ใบรับรองจาก CA จริง · รายละเอียดใน `RELEASE_TH.md`
      3. **auto-update** — ขั้นตอนเตรียมไว้ใน `RELEASE_TH.md` แล้ว แต่ยังไม่ใส่ปลั๊กอิน เพราะต้องมีกุญแจเซ็นอัปเดตและที่เก็บไฟล์อัปเดตของคุณ
      4. **Helper แยกสิทธิ์** (เลิกต้องเปิดทั้งแอปแบบผู้ดูแล) — ปัจจุบันใช้ปุ่ม "เปิดใหม่แบบผู้ดูแล" แทน (ตามที่แผนอนุญาตไว้สำหรับ v1) · ปุ่มนี้และการเปลี่ยน service ยังไม่เคยทดสอบจริง
      5. ทดสอบบนเครื่องสะอาด Win10/11 และ VM, หมวดขยะถังขยะ/Windows.old, โหมดอ่าน NTFS MFT, เทียบตัวเลขกับ TreeSize, แผนพลังงาน/Timer/Startup manager/GPU
   7. ✅ **หน้าตั้งค่า + ค้นหา Ctrl+K:** ภาษา/ธีม, จำนวนวันที่กักกัน (3–90 วัน, ลดแล้วลบส่วนที่เก่ากว่าถาวรหลังยืนยัน), ล้างที่กักกันถาวร (การลบจริงอย่างเดียวของโปรแกรม ต้องยืนยัน), ตำแหน่งข้อมูล, เกี่ยวกับ · ช่องค้นหาด้านบนค้นได้ทั้งหน้า/การกระทำ/หมวดขยะ/ทุก tweak (Enter ไปที่หน้านั้น) · ทดสอบกับแอปจริงใน sandbox · เทสต์ cleaner เพิ่มเป็น 21 ข้อ · ตัวติดตั้งสร้างใหม่และเซ็น CandyCore แล้ว (`release/0.1.0/`)
10. ⏭️ ถัดไป: เลือกจาก 6.1–6.5 ข้างบน — แนะนำเริ่มที่ทดสอบ tweak ระดับเครื่องบน VM แล้วทำ installer + code signing

---

## 7. การทดสอบ

1. **VM เท่านั้นสำหรับ Boost** — ใช้ Hyper-V/VirtualBox Windows 11 + snapshot ทดสอบ apply → reboot → revert ทุก tweak
2. **Unit test** ของ tweak engine: mock registry/service → ตรวจว่า revert คืนค่าเดิมเป๊ะ (รวมกรณี key "ไม่มีอยู่เดิม" ต้องลบทิ้งตอน revert)
3. **Benchmark scanner** เทียบ TreeSize Free / WizTree บนไดรฟ์เดียวกัน (เวลา + ความถูกต้องของขนาด)
4. **ทดสอบ edge case**: path ยาว > 260 ตัวอักษร, ชื่อไฟล์ภาษาไทย/อีโมจิ, โฟลเดอร์ไม่มีสิทธิ์อ่าน, OneDrive cloud-only, ไดรฟ์ USB ถูกถอดระหว่างสแกน
5. **Usability test** 3–5 คน (เพื่อนที่ไม่ใช่สาย IT): ให้ทำ 3 งาน — หาไฟล์ใหญ่สุด, ล้างขยะ, ใช้โปรไฟล์เกมแล้ว undo — จดว่าติดตรงไหน

---

## 8. ความเสี่ยงและข้อควรระวัง

1. **Antivirus/SmartScreen แจ้งเตือน** — แอปที่แก้ registry + services มักโดนจับ → ต้องมี code signing certificate และไม่ bundle .exe ของคนอื่น
2. **ลิขสิทธิ์/ที่มา** — `.reg`, `.pow`, `.nip` ของ VantageOS/KernelOS เป็นงานของเขา → ใช้เป็น "แหล่งอ้างอิงว่าปรับอะไร" แล้วเขียนนิยาม tweak ของเราเอง; NVCleanstall/Profile Inspector ให้เป็นลิงก์ดาวน์โหลดจากเว็บทางการ
3. **Tweak บางตัวไม่ได้ช่วยจริงในทุกเครื่อง** — ใส่คำอธิบายตรงไปตรงมา ไม่โฆษณาเกินจริง (เช่น "อาจลด input lag เล็กน้อยในบางเกม")
4. **Windows Update อาจรีเซ็ตค่า** — Safety Center ตรวจทุกครั้งที่เปิดแอป แจ้ง "มี 3 tweak ถูก Windows คืนค่า ใช้ใหม่ไหม?"
5. **ลบไฟล์ผิด** — ไม่มีการลบถาวรทันที ทุกอย่างผ่าน Quarantine/ถังขยะ และ path ระบบถูกล็อกห้ามลบ
6. **ลอกงานคู่แข่ง** — ศึกษา TreeSize / VantageOS จากเอกสารและการใช้งานเท่านั้น ไม่ decompile ไม่คัดลอกโค้ด ไอคอน หรือข้อความ

---

## 9. Design System (สรุปจากดีไซน์)

1. **ธีม "Sky Glass"** (v0.2): ฟ้า → ฟ้าอ่อน → เขียวมิ้นต์, การ์ดกระจกฝ้า (glassmorphism), มุมโค้งมาก, ปุ่มทรงแคปซูล — อิงจากภาพตัวอย่าง UI มือถือที่ให้มา แล้วปรับเป็นหน้าต่างโปรแกรมบนคอม
2. **โครงหน้าต่าง**: Title bar เอง (โลโก้ · ช่องค้นหา Ctrl+K · ปุ่มย่อ/ขยาย/ปิด) → Sidebar ขาว → เนื้อหาที่มี **hero gradient** ด้านบน และการ์ดกระจกที่ลอยทับขอบ hero
3. **สี (tokens)**

| Token | ค่า | ใช้กับ |
|---|---|---|
| `--backdrop` | `#BDE8F8` | พื้นหลังรอบหน้าต่าง (ภาพโปรโมต) |
| `--bg` | `#F4F8FD` | พื้นหลังแอป |
| `--surface` | `#FFFFFF` | การ์ด, sidebar |
| `--glass` | `rgba(255,255,255,.8)` + `backdrop-filter: blur(18px)` + ขอบขาว | การ์ดที่ลอยทับ hero |
| `--hero` | `linear-gradient(120deg, #1A5CE0, #1E86F0 55%, #2BB7EE)` + วงกลม `#62E4B0→#34CDC6` | แถบหัวทุกหน้า |
| `--primary` | `linear-gradient(100deg, #1A5CE0, #1677D6)` | ปุ่มหลัก, เมนูที่เลือก |
| `--switch-on` | `linear-gradient(90deg, #1A5CE0, #2BB7EE)` | สวิตช์เปิด |
| `--ink` | `#2B3A67` | ตัวอักษรหลัก (น้ำเงินเข้ม) |
| `--muted` | `#5E6C8C` | ตัวอักษรรอง |
| `--safe` | `#DDF7EC` / `#0E7A52` | ป้าย "ปลอดภัย" |
| `--recommended` | `#FFF1D6` / `#8A5300` | ป้าย "แนะนำ / ตรวจสอบก่อน" |
| `--expert` | `#FFE3E3` / `#B4232A` | ป้าย "ผู้เชี่ยวชาญ / ห้ามลบ", ปุ่มลบ |

4. **ฟอนต์**: Mitr (หัวข้อ/ตัวเลขใหญ่ — โค้งมนเข้าธีม) + Prompt (เนื้อหา) + IBM Plex Mono (ค่า registry) · ตัวเลขแบบ tabular
5. **ขนาด**: ปุ่มหลักสูง 52–54 px ทรงแคปซูล, ทุกปุ่ม/สวิตช์ ≥ 44 px, การ์ดมุม 26 px, ไอคอนในกล่อง gradient 52 px มุม 18 px
6. **หมายเหตุ Tauri**: `backdrop-filter` ทำงานใน WebView2 ได้; ถ้าอยากให้หน้าต่างโปร่งแสงแบบ Mica จริงใช้ `window-vibrancy` crate
5. **คอมโพเนนต์หลัก**: Sidebar, DriveCard, Treemap, FolderRow (มีแถบสัดส่วน), CleanCategoryRow (checkbox + ขนาด), TweakRow (สวิตช์ + RiskBadge + RebootBadge), ProfileCard, ConfirmDialog (สรุปก่อนทำ), ResultBanner, TimelineRow (Undo)
6. ค่าทั้งหมดอยู่ในไฟล์ดีไซน์ — คัดลอกไปใส่ `styles/tokens.css` ตอน Phase 0

---

## 10. ลิงก์ที่เกี่ยวข้อง

1. ดีไซน์หน้าตาโปรแกรม (Claude Design, 5 หน้าจอ กดเล่นได้): https://claude.ai/artifact/6NQt7pHsvgvM9UT5SwsoxU
   - หน้าแรก · พื้นที่ดิสก์ (คลิก treemap/รายการเพื่อดูรายละเอียด) · ล้างขยะ (ติ๊กแล้วยอดรวมเปลี่ยน) · เร่งความเร็ว (สลับโปรไฟล์ + หน้าต่างยืนยัน) · ประวัติ & กู้คืน (กดย้อนกลับได้)
   - ตัวเลขดิสก์ C: มาจากภาพ TreeSize ของจริง ส่วนขนาดขยะ/สเปกเครื่องเป็นข้อมูลตัวอย่าง
2. ต้นแบบ: VantageOS Tweaker (Python/Eel) · TreeSize (JAM Software)

## 11. ขั้นตอนถัดไป

1. ~~รีวิวดีไซน์~~ ✅ ใช้ธีม Sky Glass
2. ~~ยืนยัน stack และชื่อแอป~~ ✅ Rust + Tauri 2 · ชื่อ "WeakClean"
3. ~~Phase 0 — scaffold โปรเจกต์~~ ✅ ทำตาม `SETUP_TH.md` เพื่อรันบนเครื่อง
4. **Phase 1 — Scanner** (ดูตารางหัวข้อ 6)
