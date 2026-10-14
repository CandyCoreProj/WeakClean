//! ส่วนที่แตะ Win32 โดยตรง: รายการไดรฟ์, ขนาดคลัสเตอร์, ขนาดไฟล์บีบอัด, ตัวระบุ hard link
//! บนระบบที่ไม่ใช่ Windows จะเป็นค่าสำรองง่ายๆ เพื่อให้โค้ดคอมไพล์/ทดสอบได้

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    /// ตัวอักษรไดรฟ์ เช่น "C"
    pub letter: String,
    /// เช่น "C:\\"
    pub root: String,
    /// fixed | removable | network | cdrom | ramdisk
    pub kind: String,
    pub total: u64,
    pub free: u64,
}

/// ขนาดคลัสเตอร์เริ่มต้นเมื่ออ่านค่าจริงไม่ได้
pub const DEFAULT_CLUSTER: u64 = 4096;

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle};
    use std::path::Component;
    use std::path::Prefix;
    use windows_sys::Win32::Foundation::{GetLastError, HANDLE, NO_ERROR};
    use windows_sys::Win32::Storage::FileSystem::{
        GetCompressedFileSizeW, GetDiskFreeSpaceExW, GetDiskFreeSpaceW, GetDriveTypeW, GetFileInformationByHandle,
        GetLogicalDrives, BY_HANDLE_FILE_INFORMATION,
    };
    use windows_sys::Win32::System::WindowsProgramming::{
        DRIVE_CDROM, DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
    };

    fn wide_str(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    pub fn list_drives() -> Vec<DriveInfo> {
        let mask = unsafe { GetLogicalDrives() };
        (0..26u8)
            .filter(|i| mask >> i & 1 == 1)
            .filter_map(|i| {
                let letter = (b'A' + i) as char;
                let root = format!("{letter}:\\");
                let w = wide_str(&root);
                let kind = match unsafe { GetDriveTypeW(w.as_ptr()) } {
                    DRIVE_FIXED => "fixed",
                    DRIVE_REMOVABLE => "removable",
                    DRIVE_REMOTE => "network",
                    DRIVE_CDROM => "cdrom",
                    DRIVE_RAMDISK => "ramdisk",
                    _ => return None,
                };
                let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
                // ไดรฟ์ที่ไม่มีสื่อ (เช่นช่องอ่านการ์ดว่าง) จะคืน 0 → ข้าม
                if unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, &mut total, &mut free) } == 0 {
                    return None;
                }
                Some(DriveInfo { letter: letter.to_string(), root, kind: kind.into(), total, free })
            })
            .collect()
    }

    pub fn cluster_size(path: &Path) -> u64 {
        let letter = match path.components().next() {
            Some(Component::Prefix(p)) => match p.kind() {
                Prefix::Disk(l) | Prefix::VerbatimDisk(l) => Some(l as char),
                _ => None,
            },
            _ => None,
        };
        let Some(letter) = letter else { return DEFAULT_CLUSTER };
        let w = wide_str(&format!("{letter}:\\"));
        let (mut spc, mut bps, mut free, mut total) = (0u32, 0u32, 0u32, 0u32);
        if unsafe { GetDiskFreeSpaceW(w.as_ptr(), &mut spc, &mut bps, &mut free, &mut total) } == 0 {
            return DEFAULT_CLUSTER;
        }
        (spc as u64 * bps as u64).max(1)
    }

    /// ขนาดที่ไฟล์กินจริงบนดิสก์ (รองรับ NTFS compression / sparse)
    pub fn compressed_size(path: &Path) -> Option<u64> {
        let w: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut high = 0u32;
        let low = unsafe { GetCompressedFileSizeW(w.as_ptr(), &mut high) };
        if low == u32::MAX && unsafe { GetLastError() } != NO_ERROR {
            return None;
        }
        Some(((high as u64) << 32) | low as u64)
    }

    /// (volume serial, file index, จำนวน hard link)
    pub fn file_identity(path: &Path) -> Option<(u32, u64, u32)> {
        // 0x80 = FILE_READ_ATTRIBUTES, แชร์ทุกแบบ เพื่อไม่ไปขัดโปรแกรมอื่นที่เปิดไฟล์อยู่
        let f = std::fs::OpenOptions::new().access_mode(0x80).share_mode(7).open(path).ok()?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(f.as_raw_handle() as HANDLE, &mut info) } == 0 {
            return None;
        }
        let index = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
        Some((info.dwVolumeSerialNumber, index, info.nNumberOfLinks))
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn list_drives() -> Vec<DriveInfo> {
        Vec::new()
    }
    pub fn cluster_size(_: &Path) -> u64 {
        DEFAULT_CLUSTER
    }
    pub fn compressed_size(_: &Path) -> Option<u64> {
        None
    }
    pub fn file_identity(_: &Path) -> Option<(u32, u64, u32)> {
        None
    }
}

pub use imp::{cluster_size, compressed_size, file_identity, list_drives};
