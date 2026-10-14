//! WeakClean cleaner — หมวดขยะ + ที่กักกัน + ประวัติ
//!
//! - `catalog`: นิยามหมวดขยะ (TOML) และการหาไฟล์ในแต่ละหมวด
//! - `store`: ย้ายไฟล์เข้าที่กักกัน / กู้คืน / ลบถาวรเมื่อหมดอายุ บันทึกลง SQLite

pub mod catalog;
pub mod store;

pub use catalog::{builtin as builtin_catalog, CategoryDef, Group};
pub use rusqlite;
pub use store::{CleanProgress, CleanResult, EventRow, QuarantineSummary, RestoreResult, Store, DEFAULT_RETENTION_DAYS};

use rayon::prelude::*;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySize {
    pub id: String,
    pub files: u64,
    pub bytes: u64,
    /// ไฟล์/โฟลเดอร์ที่อ่านไม่ได้ระหว่างสแกน
    pub errors: u64,
}

/// วัดขนาดของทุกหมวด (อ่านอย่างเดียว ไม่แก้ไขอะไร) — หมวดต่างๆ สแกนขนานกัน
pub fn scan_sizes(defs: &[CategoryDef]) -> Vec<CategorySize> {
    defs.par_iter()
        .map(|d| {
            let (mut files, mut bytes) = (0u64, 0u64);
            let errors = catalog::collect(d, |c| {
                files += 1;
                bytes += c.size;
                true
            });
            CategorySize { id: d.id.clone(), files, bytes, errors }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub size: u64,
}

/// ไฟล์ใหญ่สุดในหมวด (ไว้ให้ผู้ใช้เปิดดูก่อนล้าง) พร้อมจำนวนไฟล์ทั้งหมด
pub fn preview(def: &CategoryDef, limit: usize) -> (Vec<PreviewFile>, u64) {
    let mut all: Vec<PreviewFile> = Vec::new();
    let mut total = 0u64;
    catalog::collect(def, |c| {
        total += 1;
        all.push(PreviewFile { path: c.path.to_string_lossy().into_owned(), size: c.size });
        // เก็บไม่เกิน 4 เท่าของ limit แล้วตัดทิ้งเป็นระยะ เพื่อไม่กินหน่วยความจำเมื่อมีหลักแสนไฟล์
        if all.len() > limit.max(1) * 4 {
            all.sort_by(|a, b| b.size.cmp(&a.size));
            all.truncate(limit);
        }
        true
    });
    all.sort_by(|a, b| b.size.cmp(&a.size));
    all.truncate(limit);
    (all, total)
}

#[cfg(test)]
mod tests;
