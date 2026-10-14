// ซ่อนหน้าต่าง console ตอน release บน Windows (อย่าลบบรรทัดนี้)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    weakclean_lib::run()
}
