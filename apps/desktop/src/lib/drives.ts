import { useEffect, useState } from "react";
import { scanner, type DriveInfo } from "./tauri";

let cache: DriveInfo[] | null = null;
let pending: Promise<DriveInfo[]> | null = null;

/** ไดรฟ์ในเครื่อง (ค่าจริงจาก Rust; ในเบราว์เซอร์ธรรมดาเป็นข้อมูลจำลอง) — โหลดครั้งเดียวแล้วใช้ร่วมกันทั้งแอป */
export function useDrives(): DriveInfo[] {
  const [drives, setDrives] = useState<DriveInfo[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    pending ??= scanner.listDrives().catch(() => []);
    let alive = true;
    void pending.then((d) => {
      cache = d;
      if (alive) setDrives(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return drives;
}

/** ไดรฟ์ระบบ = ไดรฟ์ที่ติดตั้ง Windows (C: ในเกือบทุกเครื่อง) */
export const systemDrive = (drives: DriveInfo[]): DriveInfo | undefined => drives.find((d) => d.letter === "C") ?? drives[0];
