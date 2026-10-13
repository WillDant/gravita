import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startEngine } from "./store";
import "./styles.css";

// The theme is always explicit on <html>: the user's choice, else the OS, kept in sync.
function applyTheme() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("gravita.theme");
  } catch {
    // No storage: follow the OS.
  }
  const os = matchMedia("(prefers-color-scheme: dark)");
  const set = () => {
    document.documentElement.dataset.theme =
      stored === "light" || stored === "dark" ? stored : os.matches ? "dark" : "light";
  };
  set();
  os.addEventListener("change", set);
}

applyTheme();
startEngine();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
