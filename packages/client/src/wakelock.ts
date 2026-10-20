/** Během bitvy drží obrazovku vzhůru (Screen Wake Lock API – iPadOS 16.4+, Chrome, Android). */
let lock: WakeLockSentinel | null = null;
let wanted = false;

async function acquire() {
  if (!wanted || lock || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => {
      lock = null;
    });
  } catch {
    lock = null; // např. nízká baterie nebo karta na pozadí – zkusíme znovu při návratu
  }
}

export function keepAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else {
    void lock?.release();
    lock = null;
  }
}

if (typeof document !== "undefined") {
  // po návratu z pozadí prohlížeč zámek uvolní – obnovit
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void acquire();
  });
}
