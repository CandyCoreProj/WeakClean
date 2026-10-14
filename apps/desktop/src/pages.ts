import { House, LayoutGrid, ShieldCheck, Sparkles, Zap, type LucideIcon } from "lucide-react";
import type { PageId } from "./i18n";

export type PageMeta = { id: PageId; icon: LucideIcon; tile: string };

/** ลำดับเมนูซ้าย + ไอคอน + สีกล่องไอคอนของแต่ละหน้า */
export const PAGES: PageMeta[] = [
  { id: "home", icon: House, tile: "tile-blue" },
  { id: "space", icon: LayoutGrid, tile: "tile-violet" },
  { id: "cleaner", icon: Sparkles, tile: "tile-blue" },
  { id: "boost", icon: Zap, tile: "tile-mint" },
  { id: "safety", icon: ShieldCheck, tile: "tile-violet" },
];

export const pageMeta = (id: PageId): PageMeta => PAGES.find((p) => p.id === id) ?? PAGES[0];
