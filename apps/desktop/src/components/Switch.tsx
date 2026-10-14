type Props = { checked: boolean; onChange: () => void; label: string };

/** สวิตช์เปิด/ปิด — พื้นที่กดสูง 44 px ตามหลักการออกแบบ */
export function Switch({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="flex h-11 w-[66px] shrink-0 items-center justify-center"
    >
      <span className={`flex h-8 w-[54px] items-center rounded-full p-[3px] transition-colors ${checked ? "bg-switch-on" : "bg-switch-off"}`}>
        <span
          className={`h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_6px_rgba(20,60,140,0.25)] transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
