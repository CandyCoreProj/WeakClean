import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { squarify } from "../../lib/treemap";

export type TreeItem = {
  id: string;
  /** ขนาดจริง (ใช้แสดงผล) */
  value: number;
  /** ขนาดที่ใช้วางกระเบื้อง ถ้าไม่ใส่ใช้ value — ใช้ขยายก้อนเล็กอย่าง "อื่นๆ" ให้พอมีที่ใส่ชื่อ */
  layoutValue?: number;
  title: string;
  sub: string;
  tint: string;
  /** เปิดเข้าไปดูข้างในได้ (แสดงลูกศร ›) */
  openable?: boolean;
};

type Props = {
  items: TreeItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  label: string;
};

const GAP = 4;
const RADIUS = 16;

/** Treemap แบบ squarified — คลิก = เลือก (ดูรายละเอียดด้านขวา), ดับเบิลคลิก = เปิดโฟลเดอร์ */
export function Treemap({ items, selected, onSelect, onOpen, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  /* วัดใหม่ทุกครั้งที่วาด: ขนาดอาจเปลี่ยนหลังวาด (แถบเลื่อนโผล่/หาย, ฟอนต์โหลดเสร็จ, หน้าต่างเปลี่ยนขนาด)
   * ถ้าปล่อยค้าง ตำแหน่งกระเบื้องจะอิงขนาดเก่าแล้วล้นออกนอกกรอบ */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const placed = useMemo(
    () =>
      squarify(
        // squarify ต้องได้ค่ามาก→น้อย และมากกว่า 0
        items
          .map((i) => ({ value: i.layoutValue ?? i.value, item: i }))
          .filter((i) => i.value > 0)
          .sort((a, b) => b.value - a.value),
        size.w,
        size.h,
      ),
    [items, size.w, size.h],
  );

  return (
    <div role="group" aria-label={label} className="h-[400px] overflow-hidden rounded-card bg-surface p-2 shadow-card">
      <div ref={box} className="relative h-full w-full">
        {placed.map(({ x, y, w, h, item }) => {
          const tw = Math.max(0, w - GAP);
          const th = Math.max(0, h - GAP);
          const pad = tw > 110 && th > 70 ? 14 : 8;
          const innerW = tw - pad * 2;
          const innerH = th - pad * 2;
          const showTitle = innerW >= 34 && innerH >= 16;
          const showSub = innerW >= 70 && innerH >= 40;
          const showArrow = item.openable && tw >= 64 && th >= 44;
          const fs = Math.min(20, Math.max(11, Math.sqrt(tw * th) / 9));
          const isSel = selected === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isSel}
              onClick={() => onSelect(item.id)}
              onDoubleClick={() => item.openable && onOpen(item.id)}
              title={`${item.title} · ${item.sub}`}
              style={{
                left: x + GAP / 2,
                top: y + GAP / 2,
                width: tw,
                height: th,
                background: item.tint,
                borderRadius: Math.min(RADIUS, th / 2, tw / 2),
                padding: pad,
              }}
              className={`group absolute flex min-w-0 flex-col items-start justify-end gap-0.5 overflow-hidden border-0 text-left text-[#1E2C57] transition-[filter,box-shadow] ${
                isSel ? "z-10 shadow-[inset_0_0_0_3px_#1A5CE0,0_0_0_3px_rgba(91,155,255,0.35)]" : "hover:brightness-[0.95]"
              }`}
            >
              {showArrow && (
                <span
                  aria-hidden="true"
                  className={`absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/70 transition-opacity ${
                    isSel ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <ChevronRight size={15} strokeWidth={2.4} />
                </span>
              )}
              {showTitle && (
                <span
                  className={`max-w-full font-display leading-tight font-medium ${innerH >= 34 && innerW >= 60 ? "line-clamp-2" : "truncate"}`}
                  style={{ fontSize: fs }}
                >
                  {item.title}
                </span>
              )}
              {showSub && <span className="max-w-full truncate text-sm opacity-80">{item.sub}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
