use super::*;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

fn write(path: &Path, bytes: usize) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::File::create(path).unwrap().write_all(&vec![b'x'; bytes]).unwrap();
}

fn def(id: &str, paths: &[&Path]) -> CategoryDef {
    CategoryDef {
        id: id.into(),
        group: Group::Safe,
        default_on: true,
        name_th: id.into(),
        name_en: id.into(),
        desc_th: String::new(),
        desc_en: String::new(),
        paths: paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        requires_admin: false,
        older_than_days: None,
        extensions: vec![],
        recursive: true,
    }
}

/// สภาพแวดล้อมจำลอง: โฟลเดอร์ขยะ + ที่เก็บข้อมูลของ WeakClean แยกกัน
struct Env {
    tmp: TempDir,
    junk: PathBuf,
    store: Store,
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let junk = tmp.path().join("work").join("junk");
    fs::create_dir_all(&junk).unwrap();
    let store = Store::open(&tmp.path().join("wc")).unwrap();
    Env { tmp, junk, store }
}

fn quiet(_: CleanProgress) {}

#[test]
fn scan_sizes_counts_files_without_touching_them() {
    let e = env();
    write(&e.junk.join("a.tmp"), 100);
    write(&e.junk.join("sub/b.tmp"), 200);
    let r = scan_sizes(&[def("c", &[&e.junk])]);
    assert_eq!((r[0].files, r[0].bytes), (2, 300));
    assert!(e.junk.join("a.tmp").exists() && e.junk.join("sub/b.tmp").exists());
}

#[test]
fn missing_paths_are_empty_not_errors() {
    let e = env();
    let r = scan_sizes(&[def("c", &[&e.junk.join("nope")])]);
    assert_eq!((r[0].files, r[0].bytes, r[0].errors), (0, 0, 0));
}

#[test]
fn clean_moves_files_to_quarantine_and_logs_event() {
    let e = env();
    write(&e.junk.join("a.tmp"), 100);
    write(&e.junk.join("sub/deep/b.tmp"), 200);

    let d = def("c", &[&e.junk]);
    let r = e.store.clean(&[&d], &quiet).unwrap();
    assert_eq!((r.moved_files, r.moved_bytes, r.skipped_files), (2, 300, 0));

    // ต้นทางว่าง แต่ตัวโฟลเดอร์ยังอยู่
    assert!(!e.junk.join("a.tmp").exists());
    assert!(e.junk.exists());

    let ev = e.store.events(10).unwrap();
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].kind.as_str(), ev[0].state.as_str()), ("clean", "active"));
    assert_eq!((ev[0].held_files, ev[0].held_bytes), (2, 300));
    assert_eq!(ev[0].params["bytes"], 300);

    let q = e.store.quarantine_summary(7).unwrap();
    assert_eq!((q.files, q.bytes, q.lifetime_freed), (2, 300, 300));
    assert!(q.next_expiry.is_some());
}

#[test]
fn empty_clean_creates_no_event() {
    let e = env();
    let r = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap();
    assert!(r.event_id.is_none());
    assert!(e.store.events(10).unwrap().is_empty());
}

#[test]
fn restore_puts_everything_back_exactly() {
    let e = env();
    write(&e.junk.join("a.tmp"), 100);
    write(&e.junk.join("sub/deep/b.tmp"), 200);
    let id = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap().event_id.unwrap();

    // ลบโฟลเดอร์ย่อยทิ้งหลังถูกล้าง — ตอนกู้ต้องสร้างโฟลเดอร์ให้ใหม่
    fs::remove_dir_all(e.junk.join("sub")).unwrap();

    let r = e.store.restore(id).unwrap();
    assert_eq!((r.restored_files, r.restored_bytes, r.conflicts, r.failed), (2, 300, 0, 0));
    assert_eq!(fs::metadata(e.junk.join("a.tmp")).unwrap().len(), 100);
    assert_eq!(fs::metadata(e.junk.join("sub/deep/b.tmp")).unwrap().len(), 200);

    let ev = &e.store.events(10).unwrap()[0];
    assert_eq!((ev.state.as_str(), ev.held_files), ("undone", 0));
    assert_eq!(e.store.quarantine_summary(7).unwrap().bytes, 0);
    assert_eq!(e.store.quarantine_summary(7).unwrap().lifetime_freed, 0, "restored files no longer count as freed");
    // กู้ซ้ำไม่ได้ทำอะไร
    assert_eq!(e.store.restore(id).unwrap().restored_files, 0);
}

#[test]
fn restore_never_overwrites_existing_files() {
    let e = env();
    write(&e.junk.join("a.tmp"), 100);
    let id = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap().event_id.unwrap();
    write(&e.junk.join("a.tmp"), 5); // โปรแกรมสร้างไฟล์ชื่อเดียวกันขึ้นมาใหม่

    let r = e.store.restore(id).unwrap();
    assert_eq!((r.restored_files, r.conflicts), (0, 1));
    assert_eq!(fs::metadata(e.junk.join("a.tmp")).unwrap().len(), 5, "existing file must be kept");
    assert_eq!(e.store.events(1).unwrap()[0].state, "partial");
    assert_eq!(e.store.quarantine_summary(7).unwrap().files, 1, "conflicting file stays in quarantine");
}

#[cfg(windows)]
#[test]
fn locked_files_are_skipped_and_left_untouched() {
    use std::os::windows::fs::OpenOptionsExt;
    let e = env();
    write(&e.junk.join("free.tmp"), 10);
    write(&e.junk.join("busy.tmp"), 50);
    // เปิดไฟล์ค้างไว้แบบไม่แชร์ = เหมือนโปรแกรมที่กำลังใช้อยู่
    let _lock = fs::OpenOptions::new().read(true).share_mode(0).open(e.junk.join("busy.tmp")).unwrap();

    let r = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap();
    assert_eq!((r.moved_files, r.skipped_files, r.skipped_bytes), (1, 1, 50));
    assert!(e.junk.join("busy.tmp").exists(), "locked file must stay in place");
    assert!(!e.junk.join("free.tmp").exists());
}

#[cfg(windows)]
#[test]
fn junctions_are_never_followed() {
    let e = env();
    let outside = e.tmp.path().join("precious");
    write(&outside.join("keep.doc"), 999);
    let link = e.junk.join("link");
    let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&outside).output().unwrap().status.success();
    assert!(ok);
    write(&e.junk.join("a.tmp"), 1);

    let d = def("c", &[&e.junk]);
    assert_eq!(scan_sizes(std::slice::from_ref(&d))[0].files, 1);
    let r = e.store.clean(&[&d], &quiet).unwrap();
    assert_eq!(r.moved_files, 1);
    assert!(outside.join("keep.doc").exists(), "files behind a junction must be untouched");
}

#[test]
fn extension_and_age_filters() {
    let e = env();
    write(&e.junk.join("old.exe"), 10);
    write(&e.junk.join("new.exe"), 10);
    write(&e.junk.join("old.txt"), 10);
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(200 * 86_400);
    for n in ["old.exe", "old.txt"] {
        fs::File::options().write(true).open(e.junk.join(n)).unwrap().set_modified(old).unwrap();
    }
    let mut d = def("c", &[&e.junk]);
    d.extensions = vec!["exe".into()];
    d.older_than_days = Some(90);
    let r = e.store.clean(&[&d], &quiet).unwrap();
    assert_eq!(r.moved_files, 1);
    assert!(!e.junk.join("old.exe").exists());
    assert!(e.junk.join("new.exe").exists() && e.junk.join("old.txt").exists());
}

#[test]
fn non_recursive_only_touches_top_level() {
    let e = env();
    write(&e.junk.join("a.tmp"), 1);
    write(&e.junk.join("sub/b.tmp"), 1);
    let mut d = def("c", &[&e.junk]);
    d.recursive = false;
    e.store.clean(&[&d], &quiet).unwrap();
    assert!(!e.junk.join("a.tmp").exists());
    assert!(e.junk.join("sub/b.tmp").exists());
}

#[test]
fn glob_patterns_match_profile_folders() {
    let e = env();
    write(&e.junk.join("User Data/Default/Cache/a"), 1);
    write(&e.junk.join("User Data/Profile 1/Cache/b"), 1);
    write(&e.junk.join("User Data/Default/Cookies"), 1); // ต้องไม่ถูกแตะ
    let pattern = format!("{}\\User Data\\*\\Cache", e.junk.display());
    let d = CategoryDef { paths: vec![pattern], ..def("c", &[]) };
    let r = e.store.clean(&[&d], &quiet).unwrap();
    assert_eq!(r.moved_files, 2);
    assert!(e.junk.join("User Data/Default/Cookies").exists());
}

#[test]
fn drive_roots_and_system_folders_are_refused() {
    let e = env();
    let root = e.junk.ancestors().last().unwrap().to_path_buf();
    let d = def("c", &[&root]);
    assert_eq!(scan_sizes(std::slice::from_ref(&d))[0].files, 0, "a drive root must never be scanned for cleaning");
    if let Ok(w) = std::env::var("WINDIR") {
        assert_eq!(scan_sizes(&[def("w", &[Path::new(&w)])])[0].files, 0);
    }
}

#[test]
fn purge_deletes_only_expired_batches() {
    let e = env();
    write(&e.junk.join("old.tmp"), 100);
    let old_id = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap().event_id.unwrap();
    write(&e.junk.join("new.tmp"), 40);
    let new_id = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap().event_id.unwrap();

    // ทำให้ชุดแรกดูเหมือนถูกกักไว้ 10 วันแล้ว
    let db = rusqlite::Connection::open(e.tmp.path().join("wc/weakclean.db")).unwrap();
    db.execute("UPDATE events SET ts = ts - ?1 WHERE id = ?2", rusqlite::params![10 * 86_400, old_id]).unwrap();
    drop(db);

    assert_eq!(e.store.purge_expired(7).unwrap(), (1, 100));
    let evs = e.store.events(10).unwrap();
    assert_eq!(evs.iter().find(|x| x.id == old_id).unwrap().state, "expired");
    assert_eq!(evs.iter().find(|x| x.id == new_id).unwrap().state, "active");
    assert!(e.store.restore(old_id).is_err(), "expired batches can't be restored");
    assert_eq!(e.store.restore(new_id).unwrap().restored_files, 1);
    assert_eq!(e.store.restorable_events().unwrap().len(), 0);
}

#[test]
fn preview_returns_largest_first() {
    let e = env();
    for (n, sz) in [("a", 10), ("b", 300), ("c", 20)] {
        write(&e.junk.join(n), sz);
    }
    let (files, total) = preview(&def("c", &[&e.junk]), 2);
    assert_eq!(total, 3);
    assert_eq!(files.iter().map(|f| f.size).collect::<Vec<_>>(), vec![300, 20]);
}

#[test]
fn quarantine_paths_moves_only_the_given_files_and_is_restorable() {
    let e = env();
    write(&e.junk.join("keep.bin"), 10);
    write(&e.junk.join("dupe_a.bin"), 100);
    write(&e.junk.join("sub/dupe_b.bin"), 200);
    let items = vec![(e.junk.join("dupe_a.bin"), 100), (e.junk.join("sub/dupe_b.bin"), 200), (e.junk.join("already_gone.bin"), 5)];

    let r = e.store.quarantine_paths("duplicates", items, &quiet).unwrap();
    assert_eq!((r.moved_files, r.moved_bytes, r.skipped_files), (2, 300, 1));
    assert!(e.junk.join("keep.bin").exists(), "files not listed are untouched");
    assert!(!e.junk.join("dupe_a.bin").exists());

    let ev = &e.store.events(1).unwrap()[0];
    assert_eq!(ev.params["categories"][0], "duplicates");
    let back = e.store.restore(r.event_id.unwrap()).unwrap();
    assert_eq!(back.restored_files, 2);
    assert!(e.junk.join("sub/dupe_b.bin").exists());
}

#[test]
fn retention_setting_roundtrips_and_shorter_retention_purges_older_batches() {
    let e = env();
    assert_eq!(e.store.retention_days(), 7);
    assert!(e.store.set_retention_days(0).is_err());
    assert!(e.store.set_retention_days(400).is_err());

    write(&e.junk.join("a.tmp"), 100);
    let id = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap().event_id.unwrap();
    let db = rusqlite::Connection::open(e.tmp.path().join("wc/weakclean.db")).unwrap();
    db.execute("UPDATE events SET ts = ts - ?1 WHERE id = ?2", rusqlite::params![5 * 86_400, id]).unwrap();
    drop(db);

    // ยืดเป็น 30 วัน: ของอายุ 5 วันอยู่ต่อ
    assert_eq!(e.store.set_retention_days(30).unwrap(), (0, 0));
    assert_eq!(e.store.retention_days(), 30);
    // ลดเหลือ 3 วัน: ชุดอายุ 5 วันถูกลบถาวรทันที
    assert_eq!(e.store.set_retention_days(3).unwrap(), (1, 100));
    assert_eq!(e.store.events(1).unwrap()[0].state, "expired");
}

#[test]
fn purge_all_empties_the_quarantine_permanently() {
    let e = env();
    write(&e.junk.join("a.tmp"), 100);
    write(&e.junk.join("b.tmp"), 50);
    let id = e.store.clean(&[&def("c", &[&e.junk])], &quiet).unwrap().event_id.unwrap();
    assert_eq!(e.store.purge_all().unwrap(), (2, 150));
    assert_eq!(e.store.quarantine_summary(7).unwrap().bytes, 0);
    assert!(e.store.restore(id).is_err(), "purged files can no longer be restored");
    assert!(!e.junk.join("a.tmp").exists());
}
