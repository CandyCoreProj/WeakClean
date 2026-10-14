import React from "react";
import ReactDOM from "react-dom/client";

// ฟอนต์ติดมากับแอป (ใช้ได้แม้ไม่มีอินเทอร์เน็ต)
import "@fontsource/mitr/400.css";
import "@fontsource/mitr/500.css";
import "@fontsource/prompt/400.css";
import "@fontsource/prompt/500.css";
import "@fontsource/prompt/600.css";
import "./index.css";

import App from "./App";
import { I18nProvider } from "./i18n";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./theme";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>,
);
