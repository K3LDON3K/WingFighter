/** Dotykový režim: auto (podle zařízení), zapnuto, vypnuto – volba v ladění → Zobrazení. */
const KEY = "wingfighter.touch";
export type TouchSetting = "auto" | "on" | "off";

export function touchSetting(): TouchSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : "auto";
  } catch {
    return "auto";
  }
}
export function setTouchSetting(v: TouchSetting) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
  applyTouchClass();
}
export function deviceIsTouch(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
}
export function isTouchMode(): boolean {
  const s = touchSetting();
  return s === "on" ? true : s === "off" ? false : deviceIsTouch();
}
/** Třída na <body> pro CSS (větší ovládací prvky, dotyková nápověda). */
export function applyTouchClass() {
  document.body.classList.toggle("touch", isTouchMode());
}
