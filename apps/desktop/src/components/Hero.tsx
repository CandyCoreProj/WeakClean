import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  /** ปุ่ม/ตัวเลือกใต้คำอธิบาย */
  children?: ReactNode;
  /** สิ่งที่วางด้านขวาของ hero เช่น ปุ่มหลัก หรือการ์ดกระจก */
  aside?: ReactNode;
  /** จัดแนว aside: ตรงกลาง (ค่าเริ่มต้น) หรือชิดบน */
  asideAlign?: "center" | "start";
  /** เว้นด้านล่างเพิ่มสำหรับหน้าที่การ์ดลอยทับสูงกว่าปกติ (ใช้คู่กับ -mt-[78px]) */
  tall?: boolean;
};

/** แถบหัวไล่สีฟ้า + วงกลมมิ้นต์ ใช้ทุกหน้า (การ์ดถัดไปให้ใส่ -mt-16 เพื่อลอยทับขอบ) */
export function Hero({ eyebrow, title, subtitle, children, aside, asideAlign = "center", tall = false }: Props) {
  return (
    <section className={`relative overflow-hidden rounded-b-[40px] bg-hero px-10 pt-9 ${tall ? "pb-[110px]" : "pb-24"}`}>
      <div aria-hidden="true" className="absolute -top-40 -right-24 h-[460px] w-[460px] rounded-full bg-blob-mint" />
      <div aria-hidden="true" className="absolute -bottom-64 left-48 h-[440px] w-[440px] rounded-full bg-[#3FC2F2] opacity-50" />
      <div className={`relative flex justify-between gap-8 ${asideAlign === "start" ? "items-start" : "items-center"}`}>
        <div className="flex max-w-[540px] flex-col gap-2.5 text-white">
          {eyebrow && <span className="text-[15px] opacity-90">{eyebrow}</span>}
          <h1 className="m-0 font-display text-[34px] leading-tight font-medium">{title}</h1>
          <p className="m-0 text-base leading-relaxed">{subtitle}</p>
          {children}
        </div>
        {aside}
      </div>
    </section>
  );
}
