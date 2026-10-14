//! WeakClean scanner — สแกนโฟลเดอร์แบบขนานและสรุปขนาดจริง / ขนาดบนดิสก์
//!
//! หลักการ
//! - เดินด้วย `fs::read_dir` เอง (ไม่ใช้ jwalk): บน Windows `DirEntry::metadata()` ได้ขนาดและ attribute
//!   มาจาก FindNextFile อยู่แล้ว ไม่ต้องเรียก syscall เพิ่มต่อไฟล์
//! - โฟลเดอร์ย่อยแต่ละอันเป็นงานของ rayon (work-stealing) ผลรวมไล่ขึ้นมาตาม tree
//! - ข้าม symlink / junction (กันวนลูปและนับซ้ำ), hard link ใน WinSxS นับครั้งเดียว,
//!   ไฟล์ OneDrive แบบ cloud-only แยกไปเก็บใน `cloud_*` ไม่ปนกับขนาดบนดิสก์

mod sys;
pub mod dupes;

pub use dupes::{find_duplicates, DupGroup, DupeProgress};
pub use sys::{cluster_size, file_identity, list_drives, DriveInfo};

use rayon::prelude::*;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;
use std::time::Instant;

const ATTR_COMPRESSED: u32 = 0x800;
const ATTR_SPARSE: u32 = 0x200;
/// OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS = ไฟล์ที่อยู่บนคลาวด์ ยังไม่ได้ดาวน์โหลดลงเครื่อง
const ATTR_CLOUD_ONLY: u32 = 0x1000 | 0x40000 | 0x400000;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// จำนวน thread (0 = อัตโนมัติ: 2 เท่าของจำนวนแกน สูงสุด 32)
    pub threads: usize,
    /// เก็บไฟล์ใหญ่สุดกี่ไฟล์
    pub top_files: usize,
    /// นับ hard link ใน WinSxS ครั้งเดียว
    pub dedupe_hardlinks: bool,
    /// ไฟล์ที่แก้ไขล่าสุดเก่ากว่ากี่วันถือเป็น "ไฟล์เก่า" (0 = ไม่เก็บ)
    pub old_days: u64,
    /// เก็บไฟล์เก่าที่ใหญ่สุดกี่ไฟล์
    pub top_old: usize,
    /// ไฟล์ที่ใหญ่ตั้งแต่ขนาดนี้ขึ้นไปถูกจดไว้เป็นตัวเลือกของการหาไฟล์ซ้ำ (0 = ไม่เก็บ)
    pub dupe_min_size: u64,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self { threads: 0, top_files: 100, dedupe_hardlinks: true, old_days: 365, top_old: 100, dupe_min_size: 1 << 20 }
    }
}

/// ตัวนับที่อัปเดตระหว่างสแกน อ่านจาก thread อื่นเพื่อแสดงความคืบหน้าได้
#[derive(Default)]
pub struct Progress {
    files: AtomicU64,
    dirs: AtomicU64,
    bytes: AtomicU64,
    errors: AtomicU64,
    current: Mutex<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub errors: u64,
    /// โฟลเดอร์ที่กำลังอ่าน (สุ่มตัวอย่าง ไม่ได้อัปเดตทุกโฟลเดอร์)
    pub current: String,
}

impl Progress {
    pub fn snapshot(&self) -> ProgressSnapshot {
        ProgressSnapshot {
            files: self.files.load(Relaxed),
            dirs: self.dirs.load(Relaxed),
            bytes: self.bytes.load(Relaxed),
            errors: self.errors.load(Relaxed),
            current: self.current.lock().map(|c| c.clone()).unwrap_or_default(),
        }
    }
}

/// โฟลเดอร์หนึ่งใน tree — `size`/`allocated`/`files`/`dirs` รวมทุกอย่างข้างใต้แล้ว
#[derive(Debug, Default, Clone)]
pub struct Node {
    pub name: String,
    /// ขนาดจริงของไฟล์ (logical)
    pub size: u64,
    /// ขนาดที่กินบนดิสก์ (allocated)
    pub allocated: u64,
    pub files: u64,
    pub dirs: u64,
    /// เฉพาะไฟล์ที่อยู่ตรงๆ ในโฟลเดอร์นี้ (ไม่รวมโฟลเดอร์ย่อย)
    pub own_size: u64,
    pub own_files: u64,
    /// ไฟล์ OneDrive cloud-only (ไม่นับใน size/allocated)
    pub cloud_size: u64,
    pub cloud_files: u64,
    /// โฟลเดอร์ย่อย เรียงจากใหญ่ไปเล็ก
    pub children: Vec<Node>,
}

/// ข้อมูลของ Node ที่ส่งให้หน้าจอ (ไม่มี children)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub name: String,
    pub size: u64,
    pub allocated: u64,
    pub files: u64,
    pub dirs: u64,
    pub own_size: u64,
    pub own_files: u64,
    pub cloud_size: u64,
    pub cloud_files: u64,
    pub has_children: bool,
}

impl Node {
    pub fn view(&self) -> NodeView {
        NodeView {
            name: self.name.clone(),
            size: self.size,
            allocated: self.allocated,
            files: self.files,
            dirs: self.dirs,
            own_size: self.own_size,
            own_files: self.own_files,
            cloud_size: self.cloud_size,
            cloud_files: self.cloud_files,
            has_children: !self.children.is_empty(),
        }
    }

    /// ไล่ลงตามชื่อโฟลเดอร์ (เทียบแบบไม่สนตัวพิมพ์เหมือน Windows)
    pub fn find(&self, path: &[String]) -> Option<&Node> {
        let mut cur = self;
        for name in path {
            cur = cur.children.iter().find(|c| c.name.eq_ignore_ascii_case(name))?;
        }
        Some(cur)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub allocated: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OldFile {
    pub path: String,
    pub size: u64,
    pub allocated: u64,
    /// เวลาแก้ไขล่าสุด (วินาทีตั้งแต่ 1970)
    pub modified: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtStat {
    /// นามสกุลตัวพิมพ์เล็กไม่มีจุด; "" = ไม่มีนามสกุล
    pub ext: String,
    pub files: u64,
    pub size: u64,
    pub allocated: u64,
}

#[derive(Debug)]
pub struct ScanResult {
    /// path ที่สแกน (ตัด `\\?\` ออกแล้ว)
    pub root_path: String,
    pub root: Node,
    /// ไฟล์ใหญ่สุด เรียงจากใหญ่ไปเล็ก
    pub top_files: Vec<FileEntry>,
    /// ไฟล์ที่ไม่ได้แก้ไขนานที่สุดในกลุ่มที่ใหญ่สุด เรียงจากใหญ่ไปเล็ก
    pub old_files: Vec<OldFile>,
    /// ไฟล์ใหญ่ (ตั้งแต่ `dupe_min_size`) สำหรับหาไฟล์ซ้ำ: (ขนาด, path)
    pub big_files: Vec<(u64, String)>,
    /// สถิติตามนามสกุล เรียงตามขนาด
    pub extensions: Vec<ExtStat>,
    pub cluster_size: u64,
    pub elapsed_ms: u64,
    pub errors: u64,
    /// hard link ซ้ำที่ไม่ถูกนับ
    pub hardlink_dupes: u64,
    pub cancelled: bool,
}

struct Ctx<'a> {
    opts: &'a ScanOptions,
    cancel: &'a AtomicBool,
    progress: &'a Progress,
    cluster: u64,
    top: Mutex<BinaryHeap<Reverse<(u64, String, u64)>>>,
    /// ขนาดของไฟล์ที่เล็กสุดในอันดับ — ไฟล์ที่เล็กกว่านี้ไม่ต้องแย่ง lock
    top_min: AtomicU64,
    old_cutoff: i64,
    old: Mutex<BinaryHeap<Reverse<(u64, String, u64, i64)>>>,
    old_min: AtomicU64,
    big: Mutex<Vec<(u64, String)>>,
    ext: Mutex<HashMap<String, (u64, u64, u64)>>,
    seen_links: Mutex<HashSet<(u32, u64)>>,
    dupes: AtomicU64,
}

/// สแกน `root` ทั้งหมด — บล็อกจนเสร็จ (ให้เรียกจาก thread ของมันเอง) ยกเลิกได้ด้วย `cancel`
pub fn scan(root: &Path, opts: &ScanOptions, progress: &Progress, cancel: &AtomicBool) -> io::Result<ScanResult> {
    let started = Instant::now();
    // canonicalize ได้ path แบบ \\?\ ซึ่งรองรับ path ยาวเกิน 260 ตัวอักษร
    let root = fs::canonicalize(root)?;
    if !fs::metadata(&root)?.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "path is not a directory"));
    }

    let cap = opts.top_files;
    let ctx = Ctx {
        opts,
        cancel,
        progress,
        cluster: sys::cluster_size(&root),
        top: Mutex::new(BinaryHeap::new()),
        top_min: AtomicU64::new(0),
        old_cutoff: if opts.old_days == 0 { i64::MIN } else { unix_now() - (opts.old_days * 86_400) as i64 },
        old: Mutex::new(BinaryHeap::new()),
        old_min: AtomicU64::new(0),
        big: Mutex::new(Vec::new()),
        ext: Mutex::new(HashMap::new()),
        seen_links: Mutex::new(HashSet::new()),
        dupes: AtomicU64::new(0),
    };

    let threads = if opts.threads > 0 {
        opts.threads
    } else {
        (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) * 2).min(32)
    };
    // stack ใหญ่หน่อย เพราะ rayon อาจซ้อนงานโฟลเดอร์ลึกใน thread เดียว
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .stack_size(16 << 20)
        .build()
        .map_err(io::Error::other)?;

    let display = display_path(&root);
    let tree = pool.install(|| scan_dir(&ctx, &root, display.clone(), false));

    let mut top_files: Vec<FileEntry> = ctx
        .top
        .into_inner()
        .unwrap_or_default()
        .into_iter()
        .map(|Reverse((size, path, allocated))| FileEntry { path: display_path(Path::new(&path)), size, allocated })
        .collect();
    top_files.sort_by(|a, b| b.size.cmp(&a.size));
    top_files.truncate(cap);

    let mut old_files: Vec<OldFile> = ctx
        .old
        .into_inner()
        .unwrap_or_default()
        .into_iter()
        .map(|Reverse((size, path, allocated, modified))| OldFile { path: display_path(Path::new(&path)), size, allocated, modified })
        .collect();
    old_files.sort_by(|a, b| b.size.cmp(&a.size));
    let big_files: Vec<(u64, String)> = ctx.big.into_inner().unwrap_or_default().into_iter().map(|(sz, p)| (sz, display_path(Path::new(&p)))).collect();

    let mut extensions: Vec<ExtStat> = ctx
        .ext
        .into_inner()
        .unwrap_or_default()
        .into_iter()
        .map(|(ext, (files, size, allocated))| ExtStat { ext, files, size, allocated })
        .collect();
    extensions.sort_by(|a, b| b.size.cmp(&a.size));

    Ok(ScanResult {
        root_path: display,
        root: tree,
        top_files,
        old_files,
        big_files,
        extensions,
        cluster_size: ctx.cluster,
        elapsed_ms: started.elapsed().as_millis() as u64,
        errors: progress.errors.load(Relaxed),
        hardlink_dupes: ctx.dupes.load(Relaxed),
        cancelled: cancel.load(Relaxed),
    })
}

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn modified_secs(md: &fs::Metadata) -> i64 {
    md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(i64::MAX)
}

fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

fn round_up(size: u64, cluster: u64) -> u64 {
    if size == 0 {
        0
    } else {
        size.div_ceil(cluster) * cluster
    }
}

#[cfg(windows)]
fn attributes(md: &fs::Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    md.file_attributes()
}
#[cfg(not(windows))]
fn attributes(_: &fs::Metadata) -> u32 {
    0
}

fn is_winsxs(name: &str) -> bool {
    name.eq_ignore_ascii_case("WinSxS")
}

fn extension_of(name: &str) -> String {
    match name.rsplit_once('.') {
        // ".gitignore" ไม่ถือว่ามีนามสกุล
        Some((stem, ext)) if !stem.is_empty() => ext.to_ascii_lowercase(),
        _ => String::new(),
    }
}

fn scan_dir(ctx: &Ctx, path: &Path, name: String, in_winsxs: bool) -> Node {
    let mut node = Node { name, ..Node::default() };
    if ctx.cancel.load(Relaxed) {
        return node;
    }

    let rd = match fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => {
            ctx.progress.errors.fetch_add(1, Relaxed);
            return node;
        }
    };

    let mut subdirs: Vec<(String, PathBuf)> = Vec::new();
    let mut local_ext: HashMap<String, (u64, u64, u64)> = HashMap::new();
    let mut local_big: Vec<(u64, String)> = Vec::new();

    for entry in rd {
        let Ok(entry) = entry else {
            ctx.progress.errors.fetch_add(1, Relaxed);
            continue;
        };
        let Ok(ft) = entry.file_type() else {
            ctx.progress.errors.fetch_add(1, Relaxed);
            continue;
        };
        // symlink / junction: ไม่ตามเข้าไป (กันวนลูป และไม่นับซ้ำกับปลายทาง)
        if ft.is_symlink() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if ft.is_dir() {
            subdirs.push((file_name, entry.path()));
            continue;
        }
        let Ok(md) = entry.metadata() else {
            ctx.progress.errors.fetch_add(1, Relaxed);
            continue;
        };

        let attrs = attributes(&md);
        let size = md.len();
        node.own_files += 1;

        if attrs & ATTR_CLOUD_ONLY != 0 {
            node.cloud_files += 1;
            node.cloud_size += size;
            continue;
        }

        let file_path = || entry.path();
        let mut counted = true;
        if in_winsxs && ctx.opts.dedupe_hardlinks {
            if let Some((vol, index, links)) = sys::file_identity(&file_path()) {
                if links > 1 && !ctx.seen_links.lock().unwrap().insert((vol, index)) {
                    counted = false;
                    ctx.dupes.fetch_add(1, Relaxed);
                }
            }
        }
        if !counted {
            continue;
        }

        let allocated = if attrs & (ATTR_COMPRESSED | ATTR_SPARSE) != 0 {
            sys::compressed_size(&file_path()).unwrap_or_else(|| round_up(size, ctx.cluster))
        } else {
            round_up(size, ctx.cluster)
        };

        node.own_size += size;
        node.allocated += allocated;

        let e = local_ext.entry(extension_of(&file_name)).or_default();
        e.0 += 1;
        e.1 += size;
        e.2 += allocated;

        consider_top(ctx, size, allocated, &file_path);
        let modified = modified_secs(&md);
        if modified < ctx.old_cutoff {
            consider_old(ctx, size, allocated, modified, &file_path);
        }
        if ctx.opts.dupe_min_size > 0 && size >= ctx.opts.dupe_min_size {
            local_big.push((size, file_path().to_string_lossy().into_owned()));
        }
    }

    ctx.progress.files.fetch_add(node.own_files, Relaxed);
    ctx.progress.bytes.fetch_add(node.own_size, Relaxed);
    let n = ctx.progress.dirs.fetch_add(1, Relaxed);
    if n % 64 == 0 {
        if let Ok(mut cur) = ctx.progress.current.lock() {
            *cur = display_path(path);
        }
    }

    if !local_big.is_empty() {
        ctx.big.lock().unwrap().extend(local_big);
    }
    if !local_ext.is_empty() {
        let mut global = ctx.ext.lock().unwrap();
        for (k, v) in local_ext {
            let g = global.entry(k).or_default();
            g.0 += v.0;
            g.1 += v.1;
            g.2 += v.2;
        }
    }

    // โฟลเดอร์ย่อยทำขนานกัน แล้วรวมผลขึ้นมา
    let mut children: Vec<Node> = subdirs
        .into_par_iter()
        .map(|(n, p)| {
            let sxs = in_winsxs || is_winsxs(&n);
            scan_dir(ctx, &p, n, sxs)
        })
        .collect();
    children.sort_by(|a, b| b.size.cmp(&a.size));

    node.size = node.own_size;
    node.files = node.own_files;
    node.dirs = children.len() as u64;
    for c in &children {
        node.size += c.size;
        node.allocated += c.allocated;
        node.files += c.files;
        node.dirs += c.dirs;
        node.cloud_size += c.cloud_size;
        node.cloud_files += c.cloud_files;
    }
    node.children = children;
    node
}

fn consider_top(ctx: &Ctx, size: u64, allocated: u64, path: &dyn Fn() -> PathBuf) {
    let cap = ctx.opts.top_files;
    if cap == 0 || size <= ctx.top_min.load(Relaxed) {
        return;
    }
    let mut heap = ctx.top.lock().unwrap();
    heap.push(Reverse((size, path().to_string_lossy().into_owned(), allocated)));
    if heap.len() > cap {
        heap.pop();
    }
    if heap.len() == cap {
        if let Some(Reverse((min, _, _))) = heap.peek() {
            ctx.top_min.store(*min, Relaxed);
        }
    }
}

fn consider_old(ctx: &Ctx, size: u64, allocated: u64, modified: i64, path: &dyn Fn() -> PathBuf) {
    let cap = ctx.opts.top_old;
    if cap == 0 || size <= ctx.old_min.load(Relaxed) {
        return;
    }
    let mut heap = ctx.old.lock().unwrap();
    heap.push(Reverse((size, path().to_string_lossy().into_owned(), allocated, modified)));
    if heap.len() > cap {
        heap.pop();
    }
    if heap.len() == cap {
        if let Some(Reverse((min, _, _, _))) = heap.peek() {
            ctx.old_min.store(*min, Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::File::create(path).unwrap().write_all(&vec![b'x'; bytes]).unwrap();
    }

    fn run(root: &Path) -> ScanResult {
        scan(root, &ScanOptions::default(), &Progress::default(), &AtomicBool::new(false)).unwrap()
    }

    #[test]
    fn sums_sizes_files_and_dirs() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join("a/f1.txt"), 1000);
        write(&t.path().join("a/f2.TXT"), 5000);
        write(&t.path().join("b/c/f3.bin"), 0);
        write(&t.path().join("root.dat"), 10);

        let r = run(t.path());
        assert_eq!(r.root.size, 6010);
        assert_eq!(r.root.files, 4);
        assert_eq!(r.root.dirs, 3); // a, b, c
        assert_eq!(r.root.own_size, 10);
        assert_eq!(r.errors, 0);

        // เรียงใหญ่→เล็ก และค้นด้วยชื่อได้
        assert_eq!(r.root.children[0].name, "a");
        assert_eq!(r.root.find(&["a".into()]).unwrap().size, 6000);
        assert_eq!(r.root.find(&["B".into(), "c".into()]).unwrap().files, 1);
        assert!(r.root.find(&["nope".into()]).is_none());
    }

    #[test]
    fn allocated_is_cluster_rounded() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join("one.txt"), 1);
        write(&t.path().join("zero.txt"), 0);
        let r = run(t.path());
        assert_eq!(r.root.allocated, r.cluster_size);
    }

    #[test]
    fn extension_stats_and_top_files() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join("x/a.TXT"), 300);
        write(&t.path().join("y/b.txt"), 200);
        write(&t.path().join("c.mp4"), 9000);
        write(&t.path().join(".gitignore"), 5);

        let r = run(t.path());
        let txt = r.extensions.iter().find(|e| e.ext == "txt").unwrap();
        assert_eq!((txt.files, txt.size), (2, 500));
        assert!(r.extensions.iter().any(|e| e.ext.is_empty() && e.size == 5));
        assert_eq!(r.extensions[0].ext, "mp4");
        assert_eq!(r.top_files[0].size, 9000);
        assert!(r.top_files[0].path.ends_with("c.mp4"));
    }

    #[test]
    fn top_files_respects_cap() {
        let t = tempfile::tempdir().unwrap();
        for i in 1..=10 {
            write(&t.path().join(format!("f{i}.bin")), i * 100);
        }
        let opts = ScanOptions { top_files: 3, ..Default::default() };
        let r = scan(t.path(), &opts, &Progress::default(), &AtomicBool::new(false)).unwrap();
        let sizes: Vec<u64> = r.top_files.iter().map(|f| f.size).collect();
        assert_eq!(sizes, vec![1000, 900, 800]);
    }

    #[cfg(windows)]
    #[test]
    fn hardlinks_in_winsxs_counted_once() {
        let t = tempfile::tempdir().unwrap();
        let a = t.path().join("WinSxS/a.dll");
        write(&a, 3000);
        fs::hard_link(&a, t.path().join("WinSxS/b.dll")).unwrap();
        fs::hard_link(&a, t.path().join("WinSxS/sub/c.dll").tap_create_parent()).unwrap();
        // นอก WinSxS นับตามจริง
        write(&t.path().join("other/d.dll"), 100);

        let r = run(t.path());
        assert_eq!(r.root.size, 3100);
        assert_eq!(r.hardlink_dupes, 2);
    }

    #[cfg(windows)]
    trait TapCreate {
        fn tap_create_parent(self) -> Self;
    }
    #[cfg(windows)]
    impl TapCreate for PathBuf {
        fn tap_create_parent(self) -> Self {
            fs::create_dir_all(self.parent().unwrap()).unwrap();
            self
        }
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_not_followed() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join("real/f.bin"), 4000);
        // junction สร้างได้โดยไม่ต้องใช้สิทธิ์ผู้ดูแล
        let link = t.path().join("link");
        let ok = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(t.path().join("real"))
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        assert!(ok, "mklink /J failed");

        let r = run(t.path());
        assert_eq!(r.root.size, 4000, "junction target must not be counted twice");
        assert_eq!(r.root.dirs, 1);
    }

    #[test]
    fn cancel_stops_early() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join("a/f.bin"), 100);
        let cancel = AtomicBool::new(true);
        let r = scan(t.path(), &ScanOptions::default(), &Progress::default(), &cancel).unwrap();
        assert!(r.cancelled);
        assert_eq!(r.root.size, 0);
    }

    #[test]
    fn rejects_files_and_missing_paths() {
        let t = tempfile::tempdir().unwrap();
        let f = t.path().join("f.txt");
        write(&f, 1);
        let p = Progress::default();
        let c = AtomicBool::new(false);
        assert!(scan(&f, &ScanOptions::default(), &p, &c).is_err());
        assert!(scan(&t.path().join("missing"), &ScanOptions::default(), &p, &c).is_err());
    }

    #[test]
    fn lists_drives() {
        let d = list_drives();
        #[cfg(windows)]
        assert!(d.iter().any(|x| x.kind == "fixed" && x.total > 0));
        #[cfg(not(windows))]
        assert!(d.is_empty());
    }
}

#[cfg(test)]
mod old_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn old_files_and_big_files_are_collected() {
        let t = tempfile::tempdir().unwrap();
        let mk = |name: &str, bytes: usize, age_days: u64| {
            let p = t.path().join(name);
            fs::File::create(&p).unwrap().write_all(&vec![1u8; bytes]).unwrap();
            let when = std::time::SystemTime::now() - std::time::Duration::from_secs(age_days * 86_400);
            fs::File::options().write(true).open(&p).unwrap().set_modified(when).unwrap();
        };
        mk("old_big.bin", 3_000_000, 400);
        mk("old_small.bin", 100, 800);
        mk("new_big.bin", 2_000_000, 1);

        let r = scan(t.path(), &ScanOptions::default(), &Progress::default(), &AtomicBool::new(false)).unwrap();
        assert_eq!(r.old_files.iter().map(|f| f.size).collect::<Vec<_>>(), vec![3_000_000, 100], "only files untouched for a year, largest first");
        assert!(r.old_files[0].modified < unix_now() - 365 * 86_400);
        let mut big: Vec<u64> = r.big_files.iter().map(|b| b.0).collect();
        big.sort();
        assert_eq!(big, vec![2_000_000, 3_000_000], "files >= 1 MiB are kept for duplicate search");

        let off = ScanOptions { old_days: 0, dupe_min_size: 0, ..Default::default() };
        let r = scan(t.path(), &off, &Progress::default(), &AtomicBool::new(false)).unwrap();
        assert!(r.old_files.is_empty() && r.big_files.is_empty());
    }
}
