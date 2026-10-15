import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ฟอนต์ติดมากับแอป (ใช้ได้แม้ไม่มีอินเทอร์เน็ต)
import "@fontsource/mitr/400.css";
import "@fontsource/mitr/500.css";
import "@fontsource/prompt/400.css";
import "@fontsource/prompt/500.css";
import "@fontsource/prompt/600.css";
import "./index.css";

import App from "./App";
import { ReminderCard } from "./components/ReminderCard";
import { I18nProvider } from "./i18n";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./theme";

// หน้าต่างเตือนโหลดไฟล์ชุดเดียวกันทั้งหมด แล้วรู้ว่าตัวเองเป็นใครจาก label ของหน้าต่าง
// (label ตั้งไว้ตอนสร้างหน้าต่างใน src-tauri/src/background.rs)
const isReminder = isTauri() && getCurrentWindow().label === "reminder";
if (isReminder) document.body.dataset.reminder = "1";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        {isReminder ? (
          <ReminderCard />
        ) : (
          <ToastProvider>
            <App />
          </ToastProvider>
        )}
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>,
);
