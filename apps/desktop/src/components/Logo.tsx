import { Sparkles } from "lucide-react";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center rounded-[9px] text-white"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #1A5CE0, #2BB7EE 60%, #4FDDA8)",
      }}
    >
      <Sparkles size={size * 0.57} strokeWidth={2.2} />
    </span>
  );
}
