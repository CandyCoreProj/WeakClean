import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { squarify } from "../../lib/treemap";

export type TreeItem = { id: string; value: number; title: string; sub: string; tint: string };

type Props = {
  items: TreeItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  label: string;
};

const GAP = 3;

/** Treemap แบบ squarified — ขนาดตามพื้นที่จริงของพื้นที่ที่แสดง; คลิก = เลือก, ดับเบิลคลิก = ซูมเข้า */
export function Treemap({ items, selected, onSelect, onOpen, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = useMemo(
    () => squarify(items.filter((i) => i.value > 0).map((i) => ({ value: i.value, item: i })), size.w, size.h),
    [items, size.w, size.h],
  );

  return (
    <div role="group" aria-label={label} className="h-[400px] rounded-card bg-surface p-2 shadow-card">
      <div ref={box} className="relative h-full w-full">
        {placed.map(({ x, y, w, h, item }) => {
          const showTitle = w > 64 && h > 34;
          const showSub = w > 80 && h > 56;
          const fs = Math.min(19, Math.max(12, Math.sqrt(w * h) / 9));
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => onSelect(item.id)}
              onDoubleClick={() => onOpen(item.id)}
              title={`${item.title} · ${item.sub}`}
              style={{ left: x + GAP / 2, top: y + GAP / 2, width: w - GAP, height: h - GAP, background: item.tint }}
              className={`absolute flex min-w-0 flex-col items-start justify-end gap-0.5 overflow-hidden rounded-[14px] border-0 p-2.5 text-left text-[#1E2C57] transition-[filter] hover:brightness-95 ${
                selected === item.id ? "shadow-[inset_0_0_0_3px_#1A5CE0]" : ""
              }`}
            >
              {showTitle && (
                <span className="max-w-full truncate font-display font-medium" style={{ fontSize: fs }}>
                  {item.title}
                </span>
              )}
              {showSub && <span className="max-w-full truncate text-sm">{item.sub}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
