//! ที่กักกัน + ประวัติการเปลี่ยนแปลง (SQLite)
//!
//! หลักการ: ไม่มีการลบถาวรทันที — ไฟล์ที่ "ล้าง" จะถูก *ย้าย* ไปที่ `quarantine/<event>/<n>` พร้อมบันทึก path เดิมลงฐานข้อมูล
//! กู้คืนได้จนกว่าจะครบกำหนด (ค่าตั้งต้น 7 วัน) แล้วค่อยลบจริงตอนเปิดโปรแกรม

use crate::catalog::{self, CategoryDef};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const DEFAULT_RETENTION_DAYS: u64 = 7;
/// ERROR_NOT_SAME_DEVICE — rename ข้ามไดรฟ์ไม่ได้ ต้องคัดลอกแล้วลบต้นทาง
const ERROR_NOT_SAME_DEVICE: i32 = 17;

pub struct Store {
    conn: Mutex<Connection>,
    quarantine: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryResult {
    pub id: String,
    pub moved_files: u64,
    pub moved_bytes: u64,
    pub skipped_files: u64,
    pub skipped_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    /// None = ไม่มีไฟล์ถูกย้ายเลย (จึงไม่สร้างรายการในประวัติ)
    pub event_id: Option<i64>,
    pub moved_files: u64,
    pub moved_bytes: u64,
    pub skipped_files: u64,
    pub skipped_bytes: u64,
    pub categories: Vec<CategoryResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanProgress {
    pub category: String,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: i64,
    /// วินาทีตั้งแต่ 1970
    pub ts: i64,
    pub kind: String,
    pub params: Value,
    /// active | undone | partial | expired
    pub state: String,
    pub held_files: u64,
    pub held_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineSummary {
    pub files: u64,
    pub bytes: u64,
    /// เวลาที่ชุดเก่าสุดจะถูกลบถาวร (วินาทีตั้งแต่ 1970) — None ถ้าไม่มีอะไรในที่กักกัน
    pub next_expiry: Option<i64>,
    pub retention_days: u64,
    /// ขนาดรวมที่เคยล้างไปทั้งหมดตลอดกาล
    pub lifetime_freed: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored_files: u64,
    pub restored_bytes: u64,
    /// ปลายทางมีไฟล์ชื่อเดียวกันอยู่แล้ว จึงไม่ทับ
    pub conflicts: u64,
    pub failed: u64,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn db_err(e: rusqlite::Error) -> io::Error {
    io::Error::other(e)
}

/// ย้ายไฟล์/โฟลเดอร์ (rename; ถ้าข้ามไดรฟ์ใช้คัดลอก+ลบ) — ล้มเหลวแล้วต้นทางต้องยังอยู่ครบ
///
/// โฟลเดอร์ที่ผู้ใช้ลบเองจากหน้า พื้นที่ดิสก์ จะถูกย้ายมาทั้งก้อนด้วยฟังก์ชันนี้ —
/// ไดรฟ์เดียวกันคือเปลี่ยนชื่อโฟลเดอร์ ไม่กี่มิลลิวินาทีต่อให้ใหญ่หลายสิบ GB
fn move_file(from: &Path, to: &Path) -> io::Result<()> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(ERROR_NOT_SAME_DEVICE) => {
            if from.is_dir() {
                return move_dir_across_volumes(from, to);
            }
            fs::copy(from, to)?;
            if let Err(e) = fs::remove_file(from) {
                // ลบต้นทางไม่ได้ (ถูกล็อก) → เอาสำเนาออก ถือว่าไม่ได้ย้าย
                let _ = fs::remove_file(to);
                return Err(e);
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// โฟลเดอร์ข้ามไดรฟ์: rename ใช้ไม่ได้ (ERROR_NOT_SAME_DEVICE) จึงคัดลอกทั้งต้นไม้แล้วลบต้นทาง
/// ล้มเหลวกลางทาง = เก็บกวาดปลายทางทิ้ง ต้นทางไม่ถูกแตะ
fn move_dir_across_volumes(from: &Path, to: &Path) -> io::Result<()> {
    if let Err(e) = copy_tree(from, to) {
        let _ = fs::remove_dir_all(to);
        return Err(e);
    }
    if let Err(e) = fs::remove_dir_all(from) {
        let _ = fs::remove_dir_all(to);
        return Err(e);
    }
    Ok(())
}

/// คัดลอกทั้งโฟลเดอร์ลงไปข้างใน `to` (ไม่ตาม symlink/junction เหมือนตัวสแกน)
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        let target = to.join(entry.file_name());
        if ft.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// ลบของในที่กักกันทิ้งถาวร — ของที่ถูกย้ายมาอาจเป็นโฟลเดอร์ทั้งก้อน ไม่ใช่แค่ไฟล์
fn remove_quarantined(stored: &str) -> io::Result<()> {
    let path = Path::new(stored);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => {
            if path.is_dir() {
                fs::remove_dir_all(path)
            } else {
                Err(e)
            }
        }
    }
}

impl Store {
    /// `base` เช่น %LOCALAPPDATA%\WeakClean — เก็บ weakclean.db และโฟลเดอร์ quarantine ไว้ข้างใน
    pub fn open(base: &Path) -> io::Result<Store> {
        let quarantine = base.join("quarantine");
        fs::create_dir_all(&quarantine)?;
        let conn = Connection::open(base.join("weakclean.db")).map_err(db_err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS events (
                 id     INTEGER PRIMARY KEY,
                 ts     INTEGER NOT NULL,
                 kind   TEXT NOT NULL,
                 params TEXT NOT NULL DEFAULT '{}',
                 state  TEXT NOT NULL DEFAULT 'active'
             );
             CREATE TABLE IF NOT EXISTS items (
                 id          INTEGER PRIMARY KEY,
                 event_id    INTEGER NOT NULL REFERENCES events(id),
                 category    TEXT NOT NULL,
                 orig_path   TEXT NOT NULL,
                 stored_path TEXT NOT NULL,
                 size        INTEGER NOT NULL,
                 state       TEXT NOT NULL DEFAULT 'held'
             );
             CREATE INDEX IF NOT EXISTS items_event ON items(event_id, state);
             CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .map_err(db_err)?;
        Ok(Store { conn: Mutex::new(conn), quarantine })
    }

    /// ล้างหมวดที่เลือก: ย้ายไฟล์ทั้งหมดเข้าที่กักกันแล้วบันทึกเป็น 1 รายการในประวัติ
    pub fn clean(&self, defs: &[&CategoryDef], progress: &(dyn Fn(CleanProgress) + Sync)) -> io::Result<CleanResult> {
        // รวบรวมก่อน แล้วค่อยย้าย (ไม่ย้ายไปด้วยเดินไปด้วย กันเดินชนไฟล์ที่เพิ่งย้าย)
        let groups = defs
            .iter()
            .map(|def| {
                let mut files = Vec::new();
                catalog::collect(def, |c| {
                    files.push(c);
                    true
                });
                (def.id.clone(), files)
            })
            .collect();
        self.move_groups(groups, progress)
    }

    /// ย้ายไฟล์ที่ระบุเอง (เช่น ไฟล์ซ้ำ/ไฟล์เก่าที่ผู้ใช้เลือก) เข้าที่กักกันเป็น 1 รายการในประวัติ — `category` ใช้เป็นป้ายในประวัติ
    pub fn quarantine_paths(&self, category: &str, items: Vec<(PathBuf, u64)>, progress: &(dyn Fn(CleanProgress) + Sync)) -> io::Result<CleanResult> {
        let files = items.into_iter().map(|(path, size)| catalog::Candidate { path, size }).collect();
        self.move_groups(vec![(category.to_string(), files)], progress)
    }

    fn move_groups(&self, groups: Vec<(String, Vec<catalog::Candidate>)>, progress: &(dyn Fn(CleanProgress) + Sync)) -> io::Result<CleanResult> {
        let ts = now();
        let mut conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO events(ts, kind, params) VALUES (?1, 'clean', '{}')", params![ts]).map_err(db_err)?;
        let event_id = conn.last_insert_rowid();
        let dir = self.quarantine.join(event_id.to_string());
        fs::create_dir_all(&dir)?;

        let mut result = CleanResult::default();
        let mut seq = 0u64;
        let mut last_report = Instant::now();

        for (cat_id, files) in groups {
            let mut cat = CategoryResult { id: cat_id.clone(), moved_files: 0, moved_bytes: 0, skipped_files: 0, skipped_bytes: 0 };

            let tx = conn.transaction().map_err(db_err)?;
            {
                let mut insert = tx
                    .prepare("INSERT INTO items(event_id, category, orig_path, stored_path, size) VALUES (?1, ?2, ?3, ?4, ?5)")
                    .map_err(db_err)?;
                for f in files {
                    // path ที่ไม่ใช่ UTF-8 เก็บลงฐานข้อมูลแล้วกู้คืนไม่ได้แน่นอน → ไม่แตะ
                    let Some(orig) = f.path.to_str() else {
                        cat.skipped_files += 1;
                        cat.skipped_bytes += f.size;
                        continue;
                    };
                    seq += 1;
                    let stored = dir.join(format!("{seq:x}"));
                    match move_file(&f.path, &stored) {
                        Ok(()) => {
                            let stored_str = stored.to_string_lossy();
                            insert.execute(params![event_id, cat_id, orig, stored_str, f.size as i64]).map_err(db_err)?;
                            cat.moved_files += 1;
                            cat.moved_bytes += f.size;
                        }
                        Err(_) => {
                            // ถูกใช้งานอยู่ / ไม่มีสิทธิ์ / หายไปแล้ว → ข้าม ไม่ถือเป็นข้อผิดพลาดของผู้ใช้
                            cat.skipped_files += 1;
                            cat.skipped_bytes += f.size;
                        }
                    }
                    if last_report.elapsed() > Duration::from_millis(200) {
                        last_report = Instant::now();
                        progress(CleanProgress { category: cat_id.clone(), files: result.moved_files + cat.moved_files, bytes: result.moved_bytes + cat.moved_bytes });
                    }
                }
            }
            tx.commit().map_err(db_err)?;

            result.moved_files += cat.moved_files;
            result.moved_bytes += cat.moved_bytes;
            result.skipped_files += cat.skipped_files;
            result.skipped_bytes += cat.skipped_bytes;
            result.categories.push(cat);
            progress(CleanProgress { category: cat_id.clone(), files: result.moved_files, bytes: result.moved_bytes });
        }

        if result.moved_files == 0 {
            conn.execute("DELETE FROM events WHERE id = ?1", params![event_id]).map_err(db_err)?;
            let _ = fs::remove_dir(&dir);
        } else {
            let p = json!({
                "files": result.moved_files,
                "bytes": result.moved_bytes,
                "skippedFiles": result.skipped_files,
                "categories": result.categories.iter().filter(|c| c.moved_files > 0).map(|c| &c.id).collect::<Vec<_>>(),
            });
            conn.execute("UPDATE events SET params = ?1 WHERE id = ?2", params![p.to_string(), event_id]).map_err(db_err)?;
            result.event_id = Some(event_id);
        }
        Ok(result)
    }

    /// กู้ไฟล์ทั้งชุดกลับไปที่เดิม — ไม่เขียนทับไฟล์ที่ปลายทางมีอยู่แล้ว
    pub fn restore(&self, event_id: i64) -> io::Result<RestoreResult> {
        let mut conn = self.conn.lock().unwrap();
        let state: Option<String> = conn
            .query_row("SELECT state FROM events WHERE id = ?1", params![event_id], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        match state.as_deref() {
            None => return Err(io::Error::new(io::ErrorKind::NotFound, "event not found")),
            Some("expired") => return Err(io::Error::new(io::ErrorKind::NotFound, "quarantine expired")),
            _ => {}
        }

        let items: Vec<(i64, String, String, i64)> = {
            let mut q = conn
                .prepare("SELECT id, orig_path, stored_path, size FROM items WHERE event_id = ?1 AND state = 'held'")
                .map_err(db_err)?;
            let rows = q.query_map(params![event_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(db_err)?;
            rows.collect::<Result<_, _>>().map_err(db_err)?
        };

        let mut res = RestoreResult::default();
        let tx = conn.transaction().map_err(db_err)?;
        {
            let mut mark = tx.prepare("UPDATE items SET state = 'restored' WHERE id = ?1").map_err(db_err)?;
            for (id, orig, stored, size) in items {
                let orig = PathBuf::from(orig);
                if fs::symlink_metadata(&orig).is_ok() {
                    res.conflicts += 1;
                    continue;
                }
                if let Some(parent) = orig.parent() {
                    if fs::create_dir_all(parent).is_err() {
                        res.failed += 1;
                        continue;
                    }
                }
                match move_file(Path::new(&stored), &orig) {
                    Ok(()) => {
                        mark.execute(params![id]).map_err(db_err)?;
                        res.restored_files += 1;
                        res.restored_bytes += size as u64;
                    }
                    Err(_) => res.failed += 1,
                }
            }
        }
        tx.commit().map_err(db_err)?;

        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM items WHERE event_id = ?1 AND state = 'held'", params![event_id], |r| r.get(0))
            .map_err(db_err)?;
        let new_state = if left == 0 { "undone" } else { "partial" };
        conn.execute("UPDATE events SET state = ?1 WHERE id = ?2", params![new_state, event_id]).map_err(db_err)?;
        if left == 0 {
            let _ = fs::remove_dir(self.quarantine.join(event_id.to_string()));
        }
        Ok(res)
    }

    /// ลบถาวรเฉพาะชุดที่หมดอายุแล้ว (เก่ากว่า `retention_days`) — คืน (จำนวนไฟล์, ขนาด) ที่ลบ
    pub fn purge_expired(&self, retention_days: u64) -> io::Result<(u64, u64)> {
        self.purge_before(now() - (retention_days * 86_400) as i64)
    }

    /// ลบถาวรทุกอย่างที่อยู่ในที่กักกันตอนนี้ (กู้คืนไม่ได้อีก) — ใช้กับปุ่ม "ล้างที่กักกัน"
    pub fn purge_all(&self) -> io::Result<(u64, u64)> {
        self.purge_before(i64::MAX)
    }

    fn purge_before(&self, cutoff: i64) -> io::Result<(u64, u64)> {
        let conn = self.conn.lock().unwrap();
        let old: Vec<i64> = {
            let mut q = conn
                .prepare("SELECT id FROM events WHERE kind = 'clean' AND state IN ('active', 'partial') AND ts < ?1")
                .map_err(db_err)?;
            let rows = q.query_map(params![cutoff], |r| r.get(0)).map_err(db_err)?;
            rows.collect::<Result<_, _>>().map_err(db_err)?
        };
        let (mut files, mut bytes) = (0u64, 0u64);
        for id in old {
            let held: Vec<(String, i64)> = {
                let mut q = conn.prepare("SELECT stored_path, size FROM items WHERE event_id = ?1 AND state = 'held'").map_err(db_err)?;
                let rows = q.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_err)?;
                rows.collect::<Result<_, _>>().map_err(db_err)?
            };
            for (stored, size) in held {
                if remove_quarantined(&stored).is_err() {
                    continue;
                }
                files += 1;
                bytes += size as u64;
            }
            conn.execute("UPDATE items SET state = 'purged' WHERE event_id = ?1 AND state = 'held'", params![id]).map_err(db_err)?;
            conn.execute("UPDATE events SET state = 'expired' WHERE id = ?1", params![id]).map_err(db_err)?;
            let _ = fs::remove_dir(self.quarantine.join(id.to_string()));
        }
        Ok((files, bytes))
    }

    /// ประวัติล่าสุดก่อน
    pub fn events(&self, limit: usize) -> io::Result<Vec<EventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut q = conn
            .prepare(
                "SELECT e.id, e.ts, e.kind, e.params, e.state,
                        COALESCE(SUM(CASE WHEN i.state = 'held' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN i.state = 'held' THEN i.size ELSE 0 END), 0)
                 FROM events e LEFT JOIN items i ON i.event_id = e.id
                 GROUP BY e.id ORDER BY e.ts DESC, e.id DESC LIMIT ?1",
            )
            .map_err(db_err)?;
        let rows = q
            .query_map(params![limit as i64], |r| {
                let raw: String = r.get(3)?;
                Ok(EventRow {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    kind: r.get(2)?,
                    params: serde_json::from_str(&raw).unwrap_or(Value::Null),
                    state: r.get(4)?,
                    held_files: r.get::<_, i64>(5)? as u64,
                    held_bytes: r.get::<_, i64>(6)? as u64,
                })
            })
            .map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }

    pub fn quarantine_summary(&self, retention_days: u64) -> io::Result<QuarantineSummary> {
        let conn = self.conn.lock().unwrap();
        let (files, bytes): (i64, i64) = conn
            .query_row("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM items WHERE state = 'held'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(db_err)?;
        let oldest: Option<i64> = conn
            .query_row(
                "SELECT MIN(e.ts) FROM events e WHERE e.state IN ('active', 'partial') AND EXISTS (SELECT 1 FROM items i WHERE i.event_id = e.id AND i.state = 'held')",
                [],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        let lifetime: i64 = conn
            .query_row("SELECT COALESCE(SUM(size), 0) FROM items WHERE state != 'restored'", [], |r| r.get(0))
            .map_err(db_err)?;
        Ok(QuarantineSummary {
            files: files as u64,
            bytes: bytes as u64,
            next_expiry: oldest.map(|t| t + (retention_days * 86_400) as i64),
            retention_days,
            lifetime_freed: lifetime as u64,
        })
    }

    pub fn setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> io::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value]).map_err(db_err)?;
        Ok(())
    }

    /// จำนวนวันที่เก็บไฟล์ในที่กักกัน (ตั้งค่าได้ 1–365 วัน; ค่าตั้งต้น 7)
    pub fn retention_days(&self) -> u64 {
        self.setting("retention_days").and_then(|v| v.parse().ok()).filter(|d| (1..=365).contains(d)).unwrap_or(DEFAULT_RETENTION_DAYS)
    }

    /// ตั้งจำนวนวัน แล้วลบถาวรชุดที่เก่ากว่าค่าใหม่ทันที — คืน (ไฟล์, ขนาด) ที่ถูกลบ
    pub fn set_retention_days(&self, days: u64) -> io::Result<(u64, u64)> {
        if !(1..=365).contains(&days) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "retention must be 1-365 days"));
        }
        self.set_setting("retention_days", &days.to_string())?;
        self.purge_expired(days)
    }

    pub fn base_dir(&self) -> &Path {
        self.quarantine.parent().unwrap_or(&self.quarantine)
    }

    /// ให้ crate อื่น (tweaks) ใช้ฐานข้อมูลเดียวกันเก็บตารางของตัวเอง
    pub fn with_conn<R>(&self, f: impl FnOnce(&mut Connection) -> R) -> R {
        let mut conn = self.conn.lock().unwrap();
        f(&mut conn)
    }

    /// เพิ่มรายการในประวัติ (kind เช่น "boost") แล้วคืนรหัส
    pub fn add_event(&self, kind: &str, params: &Value) -> io::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO events(ts, kind, params) VALUES (?1, ?2, ?3)", params![now(), kind, params.to_string()]).map_err(db_err)?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_event(&self, id: i64, params: Option<&Value>, state: Option<&str>) -> io::Result<()> {
        let conn = self.conn.lock().unwrap();
        if let Some(p) = params {
            conn.execute("UPDATE events SET params = ?1 WHERE id = ?2", params![p.to_string(), id]).map_err(db_err)?;
        }
        if let Some(st) = state {
            conn.execute("UPDATE events SET state = ?1 WHERE id = ?2", params![st, id]).map_err(db_err)?;
        }
        Ok(())
    }

    pub fn delete_event(&self, id: i64) -> io::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM events WHERE id = ?1", params![id]).map_err(db_err)?;
        Ok(())
    }

    /// เวลาของการล้างขยะครั้งล่าสุด (วินาทีตั้งแต่ 1970) — None ถ้ายังไม่เคยล้างเลย
    ///
    /// ตัวช่วยเบื้องหลังใช้นับรอบเตือน โดยนับจาก "การล้างที่สำเร็จ" จริง ไม่ใช่ตอนเปิดโปรแกรม
    /// (การปรับแต่งไม่นับ เพราะไม่เกี่ยวกับพื้นที่ที่คืนมา)
    pub fn last_clean_ts(&self) -> Option<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT MAX(ts) FROM events WHERE kind = 'clean'", [], |r| r.get::<_, Option<i64>>(0)).ok().flatten()
    }

    /// รหัสของทุกชุดที่ยังกู้ได้ (ใหม่สุดก่อน) — ใช้กับปุ่ม "คืนค่าทุกอย่าง"
    pub fn restorable_events(&self) -> io::Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut q = conn
            .prepare("SELECT id FROM events WHERE kind = 'clean' AND state IN ('active', 'partial') ORDER BY ts DESC, id DESC")
            .map_err(db_err)?;
        let rows = q.query_map([], |r| r.get(0)).map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }
}
