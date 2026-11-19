// Window-level things: full screen through the desktop window (not the browser's),
// so Esc reaches the app's own keyboard handling.
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

let holders = 0;
let timer = 0;

function apply() {
  clearTimeout(timer);
  // A short wait, so going from one full-screen view straight to another doesn't flicker.
  timer = window.setTimeout(() => {
    getCurrentWindow()
      .setFullscreen(holders > 0)
      .catch(() => {});
  }, 30);
}

/** Keeps the window full screen while `on` is true (several views can ask at once). */
export function useWindowFullscreen(on: boolean) {
  useEffect(() => {
    if (!on) return;
    holders++;
    apply();
    return () => {
      holders = Math.max(0, holders - 1);
      apply();
    };
  }, [on]);
}
