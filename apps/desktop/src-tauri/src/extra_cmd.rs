//! คำสั่งที่ต่อยอดจากผลสแกน: ไฟล์เก่า, ไฟล์ซ้ำ, ย้ายเข้าที่กักกัน และประวัติการเติบโตของพื้นที่

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use weakclean_cleaner::rusqlite::params;
use weakclean_cleaner::CleanResult;
use weakclean_scanner::{find_duplicates, DupGroup, DupeProgress, Node, OldFile, ScanResult};

use crate::clean_cmd::CleanerState;
use crate::scan_cmd::ScanState;

const EVENT_DUPE_PROGRESS: &str = "dupes://progress";
const EVENT_DUPE_DONE: &str = "dupes://done";
const MAX_DUPE_GROUPS: usize = 200;
/// ประวัติเก็บไว้ต่อ path ที่สแกนไม่เกินกี่ครั้ง
const KEEP_SNAPSHOTS: i64 = 30;
/// รายการใน snapshot ต้องใหญ่ตั้งแต่เท่านี้ (ไบต์) ถึงจะเก็บ — กันฐานข้อมูลโตเกินจำเป็น
const SNAPSHOT_MIN: u64 = 50 << 20;

#[derive(Default)]
pub struct ExtraState {
    dupes: Mutex<Option<Arc<Vec<DupGroup>>>>,
    running: Mutex<Option<Arc<AtomicBool>>>,
}

#[tauri::command]
pub fn scan_old_files(state: State<'_, ScanState>) -> Result<Vec<OldFile>, String> {
    let last = state.last.lock().unwrap().clone().ok_or("no scan result yet")?;
    Ok(last.old_files.clone())
}

/// เริ่มหาไฟล์ซ้ำจากผลสแกนล่าสุด (เบื้องหลัง) — ติดตามด้วย event `dupes://progress` และ `dupes://done`
#[tauri::command]
pub fn dupes_start(app: AppHandle, scan: State<'_, ScanState>, extra: State<'_, ExtraState>) -> Result<(), String> {
    let last = scan.last.lock().unwrap().clone().ok_or("no scan result yet")?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = extra.running.lock().unwrap();
        if running.is_some() {
            return Err("a duplicate search is already running".into());
        }
        *running = Some(cancel.clone());
    }
    *extra.dupes.lock().unwrap() = None;

    std::thread::spawn(move || {
        let progress = Arc::new(DupeProgress::default());
        let finished = Arc::new(AtomicBool::new(false));
        let reporter = {
            let (app, progress, finished) = (app.clone(), progress.clone(), finished.clone());
            std::thread::spawn(move || {
                while !finished.load(Ordering::Relaxed) {
                    let _ = app.emit(EVENT_DUPE_PROGRESS, progress.snapshot());
                    std::thread::sleep(Duration::from_millis(200));
                }
            })
        };
        let groups = find_duplicates(&last.big_files, &progress, &cancel, MAX_DUPE_GROUPS);
        finished.store(true, Ordering::Relaxed);
        let _ = reporter.join();

        let st = app.state::<ExtraState>();
        *st.running.lock().unwrap() = None;
        let cancelled = cancel.load(Ordering::Relaxed);
        let summary = DupeSummary { groups: groups.len(), wasted: groups.iter().map(|g| g.wasted).sum(), cancelled };
        if !cancelled {
            *st.dupes.lock().unwrap() = Some(Arc::new(groups));
        }
        let _ = app.emit(EVENT_DUPE_DONE, summary);
    });
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DupeSummary {
    groups: usize,
    wasted: u64,
    cancelled: bool,
}

#[tauri::command]
pub fn dupes_cancel(extra: State<'_, ExtraState>) {
    if let Some(c) = extra.running.lock().unwrap().as_ref() {
        c.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn dupes_result(extra: State<'_, ExtraState>) -> Result<Vec<DupGroup>, String> {
    let r = extra.dupes.lock().unwrap().clone().ok_or("no duplicate search result yet")?;
    Ok((*r).clone())
}

/// ย้ายไฟล์ที่เลือกจากรายการไฟล์เก่า/ไฟล์ซ้ำ เข้าที่กักกัน (กู้คืนได้ที่หน้า ประวัติ & กู้คืน)
///
/// ความปลอดภัย: path ทุกตัวต้องอยู่ในรายการที่เราเพิ่งสแกนเจอ (หน้าจอส่ง path อะไรก็ได้มาลบไม่ได้),
/// ไฟล์ต้องยังมีขนาดและเวลาแก้ไขเท่าตอนสแกน (ถ้าถูกแก้แล้วจะไม่แตะ),
/// และของไฟล์ซ้ำ แต่ละกลุ่มต้องเหลือสำเนาอย่างน้อย 1 ไฟล์เสมอ
#[tauri::command]
pub async fn quarantine_listed(
    scan: State<'_, ScanState>,
    extra: State<'_, ExtraState>,
    cleaner: State<'_, CleanerState>,
    list: String,
    paths: Vec<String>,
) -> Result<CleanResult, String> {
    let last = scan.last.lock().unwrap().clone();
    let dupes = extra.dupes.lock().unwrap().clone();
    let c = cleaner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (category, allowed) = match list.as_str() {
            "old" => ("old_files", allowed_old(last.as_deref().ok_or("no scan result yet")?)),
            "dupes" => ("duplicates", allowed_dupes(dupes.as_deref().ok_or("no duplicate search result yet")?, &paths)?),
            _ => return Err("unknown list".to_string()),
        };
        let mut items: Vec<(PathBuf, u64)> = Vec::new();
        let mut seen = HashSet::new();
        for p in &paths {
            let &(size, modified) = allowed.get(p.as_str()).ok_or_else(|| format!("not in the scan result: {p}"))?;
            if !seen.insert(p.as_str()) {
                continue;
            }
            let path = PathBuf::from(p);
            let ok = std::fs::symlink_metadata(&path).ok().is_some_and(|md| {
                md.is_file() && md.len() == size && md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64) == Some(modified)
            });
            if ok {
                items.push((path, size));
            }
        }
        c.store.quarantine_paths(category, items, &|_| {}).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// path → (ขนาด, เวลาแก้ไข) ของทุกไฟล์ในรายการไฟล์เก่า
fn allowed_old(last: &ScanResult) -> HashMap<&str, (u64, i64)> {
    last.old_files.iter().map(|f| (f.path.as_str(), (f.size, f.modified))).collect()
}

/// path → (ขนาด, เวลาแก้ไข) ของไฟล์ซ้ำ และตรวจว่าแต่ละกลุ่มไม่ถูกเลือกจนหมด
fn allowed_dupes<'a>(groups: &'a [DupGroup], selected: &[String]) -> Result<HashMap<&'a str, (u64, i64)>, String> {
    let sel: HashSet<&str> = selected.iter().map(String::as_str).collect();
    let mut map = HashMap::new();
    for g in groups {
        let mut picked = 0;
        for f in &g.files {
            map.insert(f.path.as_str(), (g.size, f.modified));
            if sel.contains(f.path.as_str()) {
                picked += 1;
            }
        }
        if picked >= g.files.len() {
            return Err("at least one copy of every duplicate group must be kept".into());
        }
    }
    Ok(map)
}

/* ───────── ลบเองจากหน้า พื้นที่ดิสก์ (คลิกขวา → ลบ) ───────── */

/// ป้ายในประวัติของสิ่งที่ผู้ใช้ลบเองจากหน้า พื้นที่ดิสก์
const CATEGORY_DISK_SPACE: &str = "disk_space";

/// ย้ายโฟลเดอร์/ไฟล์ที่ผู้ใช้เลือกเองจากหน้า พื้นที่ดิสก์ เข้าที่กักกัน (กู้คืนได้ที่หน้า ประวัติ & กู้คืน)
///
/// ความปลอดภัย: path ต้องอยู่ใต้รากที่สแกนไว้จริง และต้องตรงกับสิ่งที่สแกนเจอ —
/// โฟลเดอร์ต้องมีอยู่ใน tree ของผลสแกน ส่วนไฟล์ต้องมีขนาดเท่าที่จดไว้ตอนสแกน (หน้าจอส่ง path อะไรก็ได้มาลบไม่ได้)
/// ของที่ย้ายไม่ได้ เช่น ถูกใช้งานอยู่ หรือไม่มีสิทธิ์ จะถูกข้ามและรายงานกลับไป ไม่ทำให้ทั้งชุดล้มเหลว
#[tauri::command]
pub async fn quarantine_scan_paths(scan: State<'_, ScanState>, cleaner: State<'_, CleanerState>, paths: Vec<String>) -> Result<CleanResult, String> {
    let last = scan.last.lock().unwrap().clone().ok_or("no scan result yet")?;
    let c = cleaner.inner().clone();
    let targets = scan_targets(&last, &paths)?;
    let tried: Vec<String> = targets.iter().map(|(p, _, _)| p.to_string_lossy().into_owned()).collect();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut items = Vec::new();
        for (path, size, folder) in targets {
            // ต้องยังเป็นของเดิมอยู่: โฟลเดอร์ที่ยังเป็นโฟลเดอร์ หรือไฟล์ที่ไม่ถูกแก้ขนาดหลังสแกน
            let unchanged = std::fs::symlink_metadata(&path).is_ok_and(|md| {
                if folder {
                    md.is_dir()
                } else {
                    md.is_file() && md.len() == size
                }
            });
            if unchanged {
                items.push((path, size));
            }
        }
        c.store.quarantine_paths(CATEGORY_DISK_SPACE, items, &|_| {})
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // ผลสแกนที่ค้างในหน่วยความจำต้องตรงกับดิสก์ — ของที่ถูกข้าม (ยังอยู่ที่เดิม) ยังอยู่ในรายการต่อ
    let mut guard = scan.last.lock().unwrap();
    if let Some(arc) = guard.as_mut() {
        let r = Arc::make_mut(arc);
        for p in &tried {
            if !Path::new(p).exists() {
                r.forget_path(p);
            }
        }
    }
    Ok(result)
}

/// ตรวจ path ที่หน้าจอส่งมาเทียบกับผลสแกน แล้วคืน (path, ขนาด, เป็นโฟลเดอร์) ของรายการที่ลบได้
fn scan_targets(last: &ScanResult, paths: &[String]) -> Result<Vec<(PathBuf, u64, bool)>, String> {
    let root = last.root_path.trim_end_matches(['\\', '/']);
    let files = scanned_files(last);
    let mut picked: Vec<(PathBuf, u64, bool)> = Vec::new();

    for raw in paths {
        let p = raw.trim_end_matches(['\\', '/']);
        let inside = p.len() > root.len() && p.get(..root.len()).is_some_and(|head| head.eq_ignore_ascii_case(root)) && p.as_bytes()[root.len()] == b'\\';
        if !inside {
            return Err(format!("not inside the scanned folder: {raw}"));
        }
        // ประกอบชื่อกลับขึ้นมาเองจากผลสแกน — path ที่มี . หรือ .. จึงผ่านเข้ามาไม่ได้
        let names: Vec<String> = p
            .get(root.len() + 1..)
            .unwrap_or_default()
            .split('\\')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        if names.is_empty() || names.iter().any(|s| s == "." || s == "..") {
            return Err(format!("not in the scan result: {raw}"));
        }

        let full = match scanned_folder(&last.root, &names) {
            // ใช้ชื่อจริงตามที่สแกนเจอ (ตัวพิมพ์อาจต่างจากที่หน้าจอส่งมา)
            Some((node, actual)) => {
                picked.push((PathBuf::from(format!("{root}\\{}", actual.join("\\"))), node.size, true));
                continue;
            }
            None => format!("{root}\\{}", names.join("\\")),
        };
        // ไฟล์ไม่ได้อยู่ใน tree — ต้องเป็นไฟล์ที่จดไว้ตอนสแกน และใช้ชื่อที่จดไว้
        match files.get(&full.to_lowercase()) {
            Some((size, path)) => picked.push((PathBuf::from(path), *size, false)),
            None => return Err(format!("not in the scan result: {raw}")),
        }
    }

    // เลือกทั้งโฟลเดอร์แม่และลูกพร้อมกันไม่ได้ — ย้ายแม่ทีเดียวก็พาลูกไปด้วย จึงเก็บไว้แค่แม่
    let mut kept: Vec<(PathBuf, u64, bool)> = Vec::new();
    for item in picked {
        if kept.iter().any(|(p, _, _)| covers(p, &item.0)) {
            continue;
        }
        kept.retain(|(p, _, _)| !covers(&item.0, p));
        kept.push(item);
    }
    if kept.is_empty() {
        return Err("nothing to delete".into());
    }
    Ok(kept)
}

/// ไล่ตาม tree เอาตัวโฟลเดอร์พร้อมชื่อจริงตามที่สแกนเจอ
fn scanned_folder<'a>(root: &'a Node, names: &[String]) -> Option<(&'a Node, Vec<String>)> {
    let mut node = root;
    let mut actual = Vec::with_capacity(names.len());
    for name in names {
        let child = node.children.iter().find(|c| c.name.eq_ignore_ascii_case(name))?;
        actual.push(child.name.clone());
        node = child;
    }
    Some((node, actual))
}

/// path (ตัวพิมพ์เล็ก) → (ขนาด, path ตามที่สแกนเจอ) ของไฟล์ที่จดไว้ตอนสแกน:
/// ไฟล์ใหญ่สุด · ไฟล์เก่า · ไฟล์ที่เข้าเกณฑ์หาไฟล์ซ้ำ
fn scanned_files(last: &ScanResult) -> HashMap<String, (u64, String)> {
    let mut map = HashMap::new();
    let mut add = |path: &str, size: u64| {
        map.insert(path.to_lowercase(), (size, path.to_string()));
    };
    for f in &last.top_files {
        add(&f.path, f.size);
    }
    for f in &last.old_files {
        add(&f.path, f.size);
    }
    for (size, path) in &last.big_files {
        add(path, *size);
    }
    map
}

/// `child` อยู่ใต้ `parent` หรือเป็นตัวเดียวกัน
fn covers(parent: &Path, child: &Path) -> bool {
    let (a, b) = (parent.to_string_lossy().to_lowercase(), child.to_string_lossy().to_lowercase());
    a == b || b.starts_with(&format!("{a}\\"))
}

/* ───────── ประวัติการสแกน / การเติบโตของพื้นที่ ───────── */

fn ensure_table(conn: &weakclean_cleaner::rusqlite::Connection) -> weakclean_cleaner::rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scans (
             id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, root TEXT NOT NULL,
             size INTEGER NOT NULL, allocated INTEGER NOT NULL, files INTEGER NOT NULL, dirs INTEGER NOT NULL,
             entries TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS scans_root ON scans(root, ts);",
    )
}

/// โฟลเดอร์ใหญ่ๆ ระดับ 1–2 ของ tree ((path, ขนาด)) — ใช้เทียบการเติบโตระหว่างครั้ง
fn entries_of(root: &Node) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    for c in &root.children {
        if c.size >= SNAPSHOT_MIN {
            out.push((c.name.clone(), c.size));
        }
        for g in &c.children {
            if g.size >= SNAPSHOT_MIN {
                out.push((format!("{}\\{}", c.name, g.name), g.size));
            }
        }
    }
    out.sort_by(|a, b| b.1.cmp(&a.1));
    out.truncate(400);
    out
}

/// เรียกตอนสแกนเสร็จ (ไม่ใช่ถูกยกเลิก) — ล้มเหลวก็ไม่กระทบการสแกน
pub fn record_snapshot(app: &AppHandle, r: &ScanResult) {
    let Some(cleaner) = app.try_state::<CleanerState>() else { return };
    let entries = serde_json::to_string(&entries_of(&r.root)).unwrap_or_else(|_| "[]".into());
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let root = r.root_path.to_lowercase();
    cleaner.store.with_conn(|c| {
        let _ = ensure_table(c);
        let _ = c.execute(
            "INSERT INTO scans(ts, root, size, allocated, files, dirs, entries) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![ts, root, r.root.size as i64, r.root.allocated as i64, r.root.files as i64, r.root.dirs as i64, entries],
        );
        let _ = c.execute("DELETE FROM scans WHERE root = ?1 AND id NOT IN (SELECT id FROM scans WHERE root = ?1 ORDER BY ts DESC, id DESC LIMIT ?2)", params![root, KEEP_SNAPSHOTS]);
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    id: i64,
    ts: i64,
    size: u64,
    allocated: u64,
    files: u64,
    dirs: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Driver {
    path: String,
    delta: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Growth {
    /// เทียบกับสแกนครั้งก่อนหน้า (วินาทีตั้งแต่ 1970)
    since: i64,
    delta: i64,
    /// โฟลเดอร์ที่โตขึ้นมากสุด (ลึกสุดที่เก็บไว้)
    drivers: Vec<Driver>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    snapshots: Vec<Snapshot>,
    growth: Option<Growth>,
}

/// ประวัติการสแกนของ path นี้ (ใหม่สุดก่อน) พร้อมสรุปการเติบโตเทียบครั้งก่อน
#[tauri::command]
pub async fn scan_history(cleaner: State<'_, CleanerState>, root: String) -> Result<History, String> {
    let c = cleaner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = root.to_lowercase();
        c.store.with_conn(|conn| {
            ensure_table(conn).map_err(|e| e.to_string())?;
            let mut q = conn.prepare("SELECT id, ts, size, allocated, files, dirs, entries FROM scans WHERE root = ?1 ORDER BY ts DESC, id DESC").map_err(|e| e.to_string())?;
            let rows: Vec<(Snapshot, String)> = q
                .query_map(params![root], |r| {
                    Ok((Snapshot { id: r.get(0)?, ts: r.get(1)?, size: r.get::<_, i64>(2)? as u64, allocated: r.get::<_, i64>(3)? as u64, files: r.get::<_, i64>(4)? as u64, dirs: r.get::<_, i64>(5)? as u64 }, r.get::<_, String>(6)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;

            let growth = (rows.len() >= 2).then(|| {
                let parse = |s: &str| -> HashMap<String, i64> { serde_json::from_str::<Vec<(String, u64)>>(s).unwrap_or_default().into_iter().map(|(p, sz)| (p, sz as i64)).collect() };
                let (now, before) = (parse(&rows[0].1), parse(&rows[1].1));
                let mut deltas: Vec<(String, i64)> = now
                    .iter()
                    .map(|(p, s)| (p.clone(), s - before.get(p).copied().unwrap_or(0)))
                    .filter(|(_, d)| *d >= (SNAPSHOT_MIN as i64))
                    .collect();
                // ถ้าโฟลเดอร์ลูกโตจนอธิบายได้ ให้แสดงลูกแทนแม่ (ไม่แสดงซ้ำซ้อน)
                let keys: Vec<String> = deltas.iter().map(|(p, _)| p.clone()).collect();
                deltas.retain(|(p, _)| !keys.iter().any(|k| k.starts_with(&format!("{p}\\"))));
                deltas.sort_by(|a, b| b.1.cmp(&a.1));
                deltas.truncate(5);
                Growth { since: rows[1].0.ts, delta: rows[0].0.size as i64 - rows[1].0.size as i64, drivers: deltas.into_iter().map(|(path, delta)| Driver { path, delta }).collect() }
            });
            Ok(History { snapshots: rows.into_iter().map(|(s, _)| s).collect(), growth })
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use weakclean_scanner::FileEntry;

    const FOLDER: &str = "C:\\Program Files\\Adobe";

    /// ผลสแกนจำลอง: C:\Program Files\Adobe (50) · C:\Program Files\Steam (30) และไฟล์ C:\pagefile.sys (12)
    fn tree() -> ScanResult {
        let leaf = |name: &str, size: u64| Node { name: name.into(), size, ..Node::default() };
        ScanResult {
            root_path: "C:\\".into(),
            root: Node {
                name: "C:\\".into(),
                size: 92,
                children: vec![Node { name: "Program Files".into(), size: 80, children: vec![leaf("Adobe", 50), leaf("Steam", 30)], ..Node::default() }],
                ..Node::default()
            },
            top_files: vec![FileEntry { path: "C:\\pagefile.sys".into(), size: 12, allocated: 12 }],
            old_files: vec![],
            big_files: vec![(12, "C:\\pagefile.sys".into())],
            extensions: vec![],
            cluster_size: 4096,
            elapsed_ms: 0,
            errors: 0,
            hardlink_dupes: 0,
            cancelled: false,
        }
    }

    #[test]
    fn scan_targets_accepts_scanned_folders_and_files() {
        let t = scan_targets(&tree(), &[FOLDER.into(), "C:\\pagefile.sys".into()]).unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].0.to_string_lossy(), FOLDER);
        assert_eq!((t[0].1, t[0].2), (50, true), "a folder carries the size the scan measured");
        assert_eq!((t[1].1, t[1].2), (12, false), "a recorded file is deletable too");
    }

    #[test]
    fn scan_targets_uses_the_names_from_the_scan_not_from_the_screen() {
        let t = scan_targets(&tree(), &["c:\\program files\\adobe\\".into()]).unwrap();
        assert_eq!(t[0].0.to_string_lossy(), FOLDER, "case and the trailing slash are normalised");
    }

    #[test]
    fn scan_targets_refuses_anything_outside_the_scan_result() {
        let t = tree();
        for bad in [
            "D:\\Secret",
            "C:\\",
            "C:\\Windows\\System32",
            "C:\\Program Files\\..\\Windows",
            "C:\\Program Files\\Adobe\\setup.exe",
        ] {
            assert!(scan_targets(&t, &[bad.to_string()]).is_err(), "{bad} must be refused");
        }
        assert!(scan_targets(&t, &[]).is_err(), "an empty list is refused");
    }

    #[test]
    fn scan_targets_keeps_only_the_parent_when_a_folder_and_its_child_are_picked() {
        for order in [[FOLDER, "C:\\Program Files"], ["C:\\Program Files", FOLDER]] {
            let t = scan_targets(&tree(), &order.map(String::from)).unwrap();
            assert_eq!(t.len(), 1, "picking a folder together with its child must collapse into one");
            assert_eq!(t[0].0.to_string_lossy(), "C:\\Program Files", "the parent covers the child");
            assert_eq!(t[0].1, 80, "and it carries the parent's own size");
        }
    }
}
