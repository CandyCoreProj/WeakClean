# WeakClean

โปรแกรม Windows ที่ตอบสองคำถามในที่เดียว: **"พื้นที่ดิสก์หายไปไหน?"** และ **"ทำให้เครื่องลื่นขึ้นได้ไหม?"** — กดง่าย ปลอดภัย และย้อนกลับได้ทุกอย่าง

*A Windows disk analyzer + PC optimizer: simple, safe and fully reversible.*

- **พื้นที่ดิสก์** — สแกนเร็ว (C: ~700,000 ไฟล์ ใน ~3–7 วินาที) treemap, ไฟล์ใหญ่สุด/เก่า/ซ้ำ, ประวัติการเติบโต
- **ล้างขยะ** — ย้ายเข้าที่กักกัน (ไม่ลบถาวร) กู้คืนได้ภายใน 7 วัน
- **เร่งความเร็ว** — ปรับแต่ง Windows แบบบันทึกค่าเดิมก่อนเสมอ ตรวจสอบหลังเขียน ย้อนกลับได้ทีละรายการ
- **ประวัติ & กู้คืน** — ทุกอย่างที่แอปทำอยู่ที่นี่
- ธีมสว่าง/มืดตาม Windows · ไทย/English · ไม่เชื่อมต่ออินเทอร์เน็ตและไม่เก็บสถิติการใช้งาน

Stack: Tauri 2 (Rust) + React 19 + TypeScript + Tailwind CSS 4

## เริ่มพัฒนา

ดู [SETUP_TH.md](SETUP_TH.md) (ติดตั้งเครื่องมือและวิธีรัน) และแผนงานใน [WeClean_Plan.md](WeClean_Plan.md)

```powershell
cd apps\desktop
npm install
npm run tauri dev
```

## โครงสร้าง

| โฟลเดอร์ | ทำอะไร |
|---|---|
| `apps/desktop` | แอป Tauri + หน้าจอ React |
| `crates/weakclean-scanner` | สแกนดิสก์แบบขนาน, ไฟล์ซ้ำ |
| `crates/weakclean-cleaner` | หมวดขยะ, ที่กักกัน, ประวัติ (SQLite) |
| `crates/weakclean-tweaks` | tweak engine (detect / apply / revert) |
| `data/` | แคตตาล็อกหมวดขยะและ tweak (TOML) |
| `scripts/` | สคริปต์ build + เซ็นโค้ด |

ทดสอบ: `cargo test` ในแต่ละ crate · การปล่อยรุ่นและเซ็นโค้ด: [RELEASE_TH.md](RELEASE_TH.md)

## ข้อควรระวัง

ตัวติดตั้งยังเซ็นด้วยใบรับรอง self-signed ชื่อ CandyCore จึงมีคำเตือนจาก Windows SmartScreen และ tweak ระดับเครื่อง (service, นโยบาย) ควรทดสอบบน VM ก่อนใช้กับเครื่องจริง
