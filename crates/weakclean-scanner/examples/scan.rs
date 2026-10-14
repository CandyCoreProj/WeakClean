//! ทดลองสแกนจากบรรทัดคำสั่ง + วัดเวลา (ใช้เทียบกับ TreeSize / WizTree)
//!
//!   cargo run --release --example scan -- C:\
//!   cargo run --release --example scan -- C:\Users 8     (ระบุจำนวน thread)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use weakclean_scanner::{scan, Progress, ScanOptions};

fn gb(b: u64) -> String {
    format!("{:.2} GB", b as f64 / 1_073_741_824.0)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let root = args.next().unwrap_or_else(|| r"C:\".into());
    let threads = args.next().and_then(|t| t.parse().ok()).unwrap_or(0);

    let progress = Arc::new(Progress::default());
    let done = Arc::new(AtomicBool::new(false));
    let reporter = {
        let (p, d) = (progress.clone(), done.clone());
        std::thread::spawn(move || {
            while !d.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(2));
                let s = p.snapshot();
                eprintln!("  … {} ไฟล์ · {} โฟลเดอร์ · {} · {}", s.files, s.dirs, gb(s.bytes), s.current);
            }
        })
    };

    let opts = ScanOptions { threads, ..Default::default() };
    let r = scan(root.as_ref(), &opts, &progress, &AtomicBool::new(false)).expect("scan failed");
    done.store(true, Ordering::Relaxed);
    reporter.join().ok();

    println!("\nสแกน {} เสร็จใน {:.1} วินาที", r.root_path, r.elapsed_ms as f64 / 1000.0);
    println!("  ขนาดจริง     : {}", gb(r.root.size));
    println!("  ขนาดบนดิสก์  : {} (คลัสเตอร์ {} B)", gb(r.root.allocated), r.cluster_size);
    println!("  ไฟล์ / โฟลเดอร์: {} / {}", r.root.files, r.root.dirs);
    println!("  cloud-only    : {} ไฟล์ {}", r.root.cloud_files, gb(r.root.cloud_size));
    println!("  hard link ซ้ำ  : {} · อ่านไม่ได้ {}", r.hardlink_dupes, r.errors);

    println!("\nโฟลเดอร์ใหญ่สุดระดับบน");
    for c in r.root.children.iter().take(10) {
        println!("  {:>10}  {}", gb(c.size), c.name);
    }
    println!("\nไฟล์ใหญ่สุด");
    for f in r.top_files.iter().take(5) {
        println!("  {:>10}  {}", gb(f.size), f.path);
    }
    println!("\nนามสกุลที่ใช้พื้นที่มากสุด");
    for e in r.extensions.iter().take(5) {
        println!("  {:>10}  .{} ({} ไฟล์)", gb(e.size), e.ext, e.files);
    }
}
