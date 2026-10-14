//! แคตตาล็อกหมวดขยะ (อ่านจาก data/cleaners/catalog.toml ที่ฝังมากับตัวโปรแกรม) และตัวหาไฟล์ในแต่ละหมวด

use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Group {
    Safe,
    Check,
}

impl Group {
    pub fn as_str(self) -> &'static str {
        match self {
            Group::Safe => "safe",
            Group::Check => "check",
        }
    }
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct CategoryDef {
    pub id: String,
    pub group: Group,
    #[serde(default)]
    pub default_on: bool,
    pub name_th: String,
    pub name_en: String,
    pub desc_th: String,
    pub desc_en: String,
    pub paths: Vec<String>,
    /// ต้องรันแบบผู้ดูแลจึงลบได้ครบ (ถ้าไม่ใช่ จะข้ามไฟล์ที่ลบไม่ได้)
    #[serde(default)]
    pub requires_admin: bool,
    /// เฉพาะไฟล์ที่แก้ไขล่าสุดเก่ากว่ากี่วัน
    #[serde(default)]
    pub older_than_days: Option<u64>,
    /// เฉพาะไฟล์ที่มีนามสกุลเหล่านี้ (ตัวพิมพ์เล็ก ไม่มีจุด)
    #[serde(default)]
    pub extensions: Vec<String>,
    /// ลงไปในโฟลเดอร์ย่อยด้วยไหม
    #[serde(default = "yes")]
    pub recursive: bool,
}

#[derive(Deserialize)]
struct CatalogFile {
    category: Vec<CategoryDef>,
}

/// หมวดทั้งหมดที่ติดมากับโปรแกรม
pub fn builtin() -> Vec<CategoryDef> {
    toml::from_str::<CatalogFile>(include_str!("../../../data/cleaners/catalog.toml"))
        .expect("data/cleaners/catalog.toml must be valid")
        .category
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub path: PathBuf,
    pub size: u64,
}

/// แทน %VAR% ด้วยค่าจาก environment; คืน None ถ้ามีตัวแปรที่ไม่มีอยู่ (ข้าม pattern นั้นไปเลย)
pub fn expand_env(pattern: &str) -> Option<String> {
    let mut out = String::with_capacity(pattern.len());
    let mut rest = pattern;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let j = after.find('%')?;
        let value = std::env::var(&after[..j]).ok().filter(|v| !v.is_empty())?;
        out.push_str(&value);
        rest = &after[j + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// เทียบ `*` (ไม่กี่ตัวอักษร) และ `?` (หนึ่งตัวอักษร) แบบไม่สนตัวพิมพ์
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let t: Vec<char> = text.to_lowercase().chars().collect();
    let (mut pi, mut ti, mut star, mut mark) = (0, 0, None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// ขยาย pattern เป็น path ที่มีอยู่จริง (ชื่อส่วนไหนมี * ? จะไล่ดูในโฟลเดอร์นั้น)
pub fn resolve(pattern: &str) -> Vec<PathBuf> {
    let Some(expanded) = expand_env(pattern) else { return Vec::new() };
    let mut segments = expanded.split(['\\', '/']).filter(|s| !s.is_empty());
    let Some(first) = segments.next() else { return Vec::new() };
    // "C:" → "C:\" เพื่อให้เป็น path ราก
    let mut current: Vec<PathBuf> = vec![if first.ends_with(':') { PathBuf::from(format!("{first}\\")) } else { PathBuf::from(first) }];

    for seg in segments {
        let mut next = Vec::new();
        for base in &current {
            if seg.contains('*') || seg.contains('?') {
                let Ok(rd) = fs::read_dir(base) else { continue };
                for e in rd.flatten() {
                    if wildcard_match(seg, &e.file_name().to_string_lossy()) {
                        next.push(e.path());
                    }
                }
            } else {
                let p = base.join(seg);
                if fs::symlink_metadata(&p).is_ok() {
                    next.push(p);
                }
            }
        }
        current = next;
    }
    current.retain(|p| fs::symlink_metadata(p).is_ok());
    current
}

/// ที่ที่ห้ามถือเป็นเป้าหมายการล้างเด็ดขาด ต่อให้ environment ถูกตั้งค่าผิด (เช่น TEMP=C:\)
pub fn is_forbidden_root(path: &Path) -> bool {
    if path.parent().is_none() {
        return true; // รากของไดรฟ์
    }
    let norm = |p: &Path| p.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
    let me = norm(path);
    ["WINDIR", "SYSTEMROOT", "USERPROFILE", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "HOMEDRIVE", "SYSTEMDRIVE"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .any(|v| {
            let v = norm(Path::new(&v));
            me == v || me == format!("{v}\\users") || (v.len() == 2 && v.ends_with(':') && me == format!("{v}"))
        })
}

fn extension_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// ไล่หาไฟล์ที่ควรล้างของหมวดนี้ — เรียก `visit` ทีละไฟล์ (คืน false เพื่อหยุด) และคืนจำนวนที่อ่านไม่ได้
/// ข้าม symlink/junction ทุกชนิด และไม่แตะตัวโฟลเดอร์
pub fn collect(def: &CategoryDef, mut visit: impl FnMut(Candidate) -> bool) -> u64 {
    let cutoff = def.older_than_days.map(|d| SystemTime::now() - Duration::from_secs(d * 86_400));
    let mut errors = 0u64;

    let mut accept = |path: PathBuf, md: &fs::Metadata| -> bool {
        if let Some(cut) = cutoff {
            let modified = md.modified().or_else(|_| md.created()).unwrap_or(SystemTime::now());
            if modified >= cut {
                return true;
            }
        }
        if !def.extensions.is_empty() && !def.extensions.contains(&extension_of(&path)) {
            return true;
        }
        visit(Candidate { path, size: md.len() })
    };

    'patterns: for pattern in &def.paths {
        for target in resolve(pattern) {
            if is_forbidden_root(&target) {
                continue;
            }
            let Ok(md) = fs::symlink_metadata(&target) else { continue };
            if md.file_type().is_symlink() {
                continue;
            }
            if md.is_file() {
                if !accept(target, &md) {
                    break 'patterns;
                }
                continue;
            }
            // เดินแบบใช้ stack; โฟลเดอร์ย่อยจะลงไปก็ต่อเมื่อหมวดนี้ recursive
            let mut stack = vec![target];
            while let Some(dir) = stack.pop() {
                let rd = match fs::read_dir(&dir) {
                    Ok(rd) => rd,
                    Err(_) => {
                        errors += 1;
                        continue;
                    }
                };
                for entry in rd {
                    let Ok(entry) = entry else {
                        errors += 1;
                        continue;
                    };
                    let Ok(ft) = entry.file_type() else {
                        errors += 1;
                        continue;
                    };
                    if ft.is_symlink() {
                        continue;
                    }
                    if ft.is_dir() {
                        if def.recursive {
                            stack.push(entry.path());
                        }
                    } else if let Ok(md) = entry.metadata() {
                        if !accept(entry.path(), &md) {
                            break 'patterns;
                        }
                    } else {
                        errors += 1;
                    }
                }
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_catalog_is_valid() {
        let cats = builtin();
        assert!(cats.len() >= 8);
        let mut ids: Vec<_> = cats.iter().map(|c| c.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), cats.len(), "category ids must be unique");
        assert!(cats.iter().all(|c| !c.paths.is_empty()));
        // หมวดที่เสี่ยงต้องไม่ถูกติ๊กตั้งต้น
        assert!(cats.iter().filter(|c| c.group == Group::Check).all(|c| !c.default_on));
    }

    #[test]
    fn wildcards() {
        assert!(wildcard_match("thumbcache_*.db", "ThumbCache_256.DB"));
        assert!(wildcard_match("*", "anything"));
        assert!(wildcard_match("Profile ?", "Profile 1"));
        assert!(!wildcard_match("Profile ?", "Profile 10"));
        assert!(!wildcard_match("*.db", "a.dbx"));
        assert!(wildcard_match("a*b*c", "aXXbYYc"));
    }

    #[test]
    fn env_expansion() {
        std::env::set_var("WC_TEST_VAR", "C:\\Foo");
        assert_eq!(expand_env("%WC_TEST_VAR%\\Bar").as_deref(), Some("C:\\Foo\\Bar"));
        assert_eq!(expand_env("no vars").as_deref(), Some("no vars"));
        assert!(expand_env("%WC_DOES_NOT_EXIST_XYZ%\\Bar").is_none());
        assert!(expand_env("broken%").is_none());
    }

    #[test]
    fn forbidden_roots() {
        assert!(is_forbidden_root(Path::new("C:\\")));
        if let Ok(w) = std::env::var("WINDIR") {
            assert!(is_forbidden_root(Path::new(&w)));
            assert!(!is_forbidden_root(&Path::new(&w).join("Temp")));
        }
        if let Ok(u) = std::env::var("USERPROFILE") {
            assert!(is_forbidden_root(Path::new(&u)));
            assert!(!is_forbidden_root(&Path::new(&u).join("Downloads")));
        }
    }
}
