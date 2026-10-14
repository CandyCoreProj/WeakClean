//! หาไฟล์ซ้ำ: ขนาดเท่ากัน → hash ส่วนหัว 64 KB → hash เต็มไฟล์ (blake3)
//! แต่ละขั้นตัดตัวที่ไม่มีคู่ทิ้ง จึงอ่านเต็มไฟล์เฉพาะที่น่าจะซ้ำจริง — hard link (ไฟล์เดียวกัน) ไม่นับเป็นไฟล์ซ้ำ

use crate::sys;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};

const HEAD: usize = 64 * 1024;

/// ตัวนับความคืบหน้าที่อ่านจาก thread อื่นได้
#[derive(Default)]
pub struct DupeProgress {
    /// 0 = จัดกลุ่มตามขนาด, 1 = hash ส่วนหัว, 2 = hash เต็มไฟล์
    stage: AtomicU64,
    done: AtomicU64,
    total: AtomicU64,
    bytes: AtomicU64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeSnapshot {
    pub stage: u64,
    pub done: u64,
    pub total: u64,
    pub bytes: u64,
}

impl DupeProgress {
    pub fn snapshot(&self) -> DupeSnapshot {
        DupeSnapshot { stage: self.stage.load(Relaxed), done: self.done.load(Relaxed), total: self.total.load(Relaxed), bytes: self.bytes.load(Relaxed) }
    }
    fn begin(&self, stage: u64, total: u64) {
        self.stage.store(stage, Relaxed);
        self.done.store(0, Relaxed);
        self.total.store(total, Relaxed);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupFile {
    pub path: String,
    /// เวลาแก้ไขล่าสุด (วินาทีตั้งแต่ 1970)
    pub modified: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    pub size: u64,
    /// พื้นที่ที่คืนได้ถ้าเก็บไว้แค่สำเนาเดียว = (จำนวนสำเนา − 1) × ขนาด
    pub wasted: u64,
    /// เรียงจากเก่าสุดไปใหม่สุด
    pub files: Vec<DupFile>,
}

/// ที่ที่ไม่ควรเสนอให้ลบแม้จะซ้ำ (ไฟล์ระบบ/ที่ระบบเป็นเจ้าของ)
fn excluded(path: &str) -> bool {
    let p = path.to_lowercase().replace('/', "\\");
    ["\\windows\\", "\\$recycle.bin\\", "\\system volume information\\", "\\program files\\windowsapps\\"].iter().any(|s| p.contains(s))
}

fn head_hash(path: &str, size: u64) -> Option<[u8; 32]> {
    let mut f = File::open(path).ok()?;
    let mut buf = vec![0u8; HEAD.min(size as usize)];
    f.read_exact(&mut buf).ok()?;
    Some(*blake3::hash(&buf).as_bytes())
}

fn full_hash(path: &str, bytes: &AtomicU64, cancel: &AtomicBool) -> Option<[u8; 32]> {
    let mut f = File::open(path).ok()?;
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if cancel.load(Relaxed) {
            return None;
        }
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        bytes.fetch_add(n as u64, Relaxed);
    }
    Some(*h.finalize().as_bytes())
}

/// กลุ่มที่มี ≥ 2 สมาชิก เรียงตามพื้นที่ที่คืนได้มากสุดก่อน (สูงสุด `max_groups` กลุ่ม)
pub fn find_duplicates(files: &[(u64, String)], progress: &DupeProgress, cancel: &AtomicBool, max_groups: usize) -> Vec<DupGroup> {
    // 1) จัดกลุ่มตามขนาด
    progress.begin(0, files.len() as u64);
    let mut by_size: HashMap<u64, Vec<&str>> = HashMap::new();
    for (size, path) in files {
        if *size > 0 && !excluded(path) {
            by_size.entry(*size).or_default().push(path);
        }
    }
    let mut groups: Vec<(u64, Vec<String>)> = by_size.into_iter().filter(|(_, v)| v.len() > 1).map(|(s, v)| (s, v.into_iter().map(String::from).collect())).collect();

    // ตัด hard link: ไฟล์ที่เป็นตัวเดียวกันบนดิสก์ไม่ใช่ "ซ้ำ"
    groups.par_iter_mut().for_each(|(_, paths)| {
        let mut seen = std::collections::HashSet::new();
        paths.retain(|p| match sys::file_identity(std::path::Path::new(p)) {
            Some((vol, idx, links)) if links > 1 => seen.insert((vol, idx)),
            _ => true,
        });
    });
    groups.retain(|(_, v)| v.len() > 1);
    if cancel.load(Relaxed) {
        return Vec::new();
    }

    // 2) hash ส่วนหัว
    let candidates: Vec<(u64, String)> = groups.iter().flat_map(|(s, v)| v.iter().map(move |p| (*s, p.clone()))).collect();
    progress.begin(1, candidates.len() as u64);
    let heads: Vec<((u64, [u8; 32]), String)> = candidates
        .into_par_iter()
        .filter_map(|(size, path)| {
            if cancel.load(Relaxed) {
                return None;
            }
            let h = head_hash(&path, size);
            progress.done.fetch_add(1, Relaxed);
            h.map(|h| ((size, h), path))
        })
        .collect();
    let mut by_head: HashMap<(u64, [u8; 32]), Vec<String>> = HashMap::new();
    for (k, p) in heads {
        by_head.entry(k).or_default().push(p);
    }

    // 3) hash เต็มไฟล์ เฉพาะกลุ่มที่ส่วนหัวตรงกัน
    let full_candidates: Vec<(u64, String)> = by_head.into_iter().filter(|(_, v)| v.len() > 1).flat_map(|((s, _), v)| v.into_iter().map(move |p| (s, p))).collect();
    progress.begin(2, full_candidates.len() as u64);
    let fulls: Vec<((u64, [u8; 32]), String)> = full_candidates
        .into_par_iter()
        .filter_map(|(size, path)| {
            let h = full_hash(&path, &progress.bytes, cancel);
            progress.done.fetch_add(1, Relaxed);
            h.map(|h| ((size, h), path))
        })
        .collect();
    if cancel.load(Relaxed) {
        return Vec::new();
    }
    let mut by_full: HashMap<(u64, [u8; 32]), Vec<String>> = HashMap::new();
    for (k, p) in fulls {
        by_full.entry(k).or_default().push(p);
    }

    let mut out: Vec<DupGroup> = by_full
        .into_iter()
        .filter(|(_, v)| v.len() > 1)
        .map(|((size, _), paths)| {
            let mut files: Vec<DupFile> = paths
                .into_iter()
                .map(|path| {
                    let modified = fs::metadata(&path).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
                    DupFile { path, modified }
                })
                .collect();
            files.sort_by(|a, b| a.modified.cmp(&b.modified).then_with(|| a.path.cmp(&b.path)));
            DupGroup { size, wasted: size * (files.len() as u64 - 1), files }
        })
        .collect();
    out.sort_by(|a, b| b.wasted.cmp(&a.wasted).then_with(|| a.files[0].path.cmp(&b.files[0].path)));
    out.truncate(max_groups);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &std::path::Path, name: &str, data: &[u8]) -> (u64, String) {
        let p = dir.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::File::create(&p).unwrap().write_all(data).unwrap();
        (data.len() as u64, p.to_string_lossy().into_owned())
    }

    fn run(files: &[(u64, String)]) -> Vec<DupGroup> {
        find_duplicates(files, &DupeProgress::default(), &AtomicBool::new(false), 100)
    }

    #[test]
    fn finds_identical_files_and_ignores_lookalikes() {
        let t = tempfile::tempdir().unwrap();
        let same = vec![7u8; 200_000];
        let mut diff_tail = same.clone();
        *diff_tail.last_mut().unwrap() = 8; // ขนาดเท่ากัน ส่วนหัวเท่ากัน แต่ท้ายไฟล์ต่าง
        let mut diff_head = same.clone();
        diff_head[0] = 9; // ส่วนหัวต่าง

        let files = vec![
            write(t.path(), "a/one.bin", &same),
            write(t.path(), "b/two.bin", &same),
            write(t.path(), "c/three.bin", &same),
            write(t.path(), "d/tail.bin", &diff_tail),
            write(t.path(), "e/head.bin", &diff_head),
            write(t.path(), "f/other.bin", &vec![1u8; 5000]),
        ];
        let r = run(&files);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].files.len(), 3);
        assert_eq!((r[0].size, r[0].wasted), (200_000, 400_000));
    }

    #[test]
    fn groups_are_sorted_by_wasted_space() {
        let t = tempfile::tempdir().unwrap();
        let big = vec![3u8; 300_000];
        let small = vec![4u8; 100_000];
        let files = vec![
            write(t.path(), "s1", &small),
            write(t.path(), "s2", &small),
            write(t.path(), "s3", &small),
            write(t.path(), "b1", &big),
            write(t.path(), "b2", &big),
        ];
        let r = run(&files);
        assert_eq!(r.iter().map(|g| g.wasted).collect::<Vec<_>>(), vec![300_000, 200_000]);
    }

    #[cfg(windows)]
    #[test]
    fn hard_links_are_not_duplicates() {
        let t = tempfile::tempdir().unwrap();
        let data = vec![5u8; 150_000];
        let a = write(t.path(), "a.bin", &data);
        fs::hard_link(&a.1, t.path().join("b.bin")).unwrap();
        let files = vec![a.clone(), (a.0, t.path().join("b.bin").to_string_lossy().into_owned())];
        assert!(run(&files).is_empty(), "two names of the same file waste no space");

        // แต่สำเนาจริงที่สาม ยังนับ (ซ้ำกับตัวเดิมหนึ่งกลุ่ม)
        let c = write(t.path(), "c.bin", &data);
        let all = vec![files[0].clone(), files[1].clone(), c];
        let r = run(&all);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].files.len(), 2);
    }

    #[test]
    fn system_locations_are_excluded() {
        let t = tempfile::tempdir().unwrap();
        let data = vec![6u8; 120_000];
        let files = vec![write(t.path(), "Windows/System32/x.dll", &data), write(t.path(), "Windows/Temp/y.dll", &data)];
        assert!(run(&files).is_empty());
    }

    #[test]
    fn cancel_returns_nothing() {
        let t = tempfile::tempdir().unwrap();
        let data = vec![2u8; 200_000];
        let files = vec![write(t.path(), "a", &data), write(t.path(), "b", &data)];
        let r = find_duplicates(&files, &DupeProgress::default(), &AtomicBool::new(true), 10);
        assert!(r.is_empty());
    }

    #[test]
    fn files_vanishing_midway_are_skipped_not_fatal() {
        let t = tempfile::tempdir().unwrap();
        let data = vec![2u8; 200_000];
        let mut files = vec![write(t.path(), "a", &data), write(t.path(), "b", &data)];
        files.push((200_000, t.path().join("gone").to_string_lossy().into_owned()));
        let r = run(&files);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].files.len(), 2);
    }
}
