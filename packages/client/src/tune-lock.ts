import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";

/** Ladění parametrů je schované pod heslem (natvrdo); odemčení se pamatuje v prohlížeči. */
const TUNE_PASSWORD = "serunavas";
const KEY = "wingfighter.tuneUnlocked";

export function isTuneUnlocked(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Zavolá `onOk` hned, pokud je ladění odemčené; jinak otevře dialog s heslem
 * (přes celou stránku) a `onOk` zavolá po správném heslu.
 */
export function withTuneAccess(onOk: () => void): void {
  if (isTuneUnlocked()) {
    onOk();
    return;
  }
  document.querySelector(".tune-lock")?.remove();
  const input = h("input", { type: "password", class: "px", placeholder: "heslo", autocomplete: "off", style: "width:180px;text-align:center" }) as HTMLInputElement;
  const err = h("div", { class: "warn txt", style: "min-height:18px;font-size:13px" });
  const wrap = h("div", { class: "confirm-wrap tune-lock", style: "position:fixed" });
  const close = () => wrap.remove();
  const submit = () => {
    if (input.value === TUNE_PASSWORD) {
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* bez úložiště se heslo zeptá příště znovu */
      }
      close();
      onOk();
    } else {
      err.textContent = "Špatné heslo.";
      input.select();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    else if (e.key === "Escape") close();
    e.stopPropagation();
  });
  wrap.append(
    h(
      "div",
      { class: "pnl confirm" },
      h("div", { class: "ctl" }, icon("target", "currentColor", 14), " ", label("Ladění parametrů")),
      h("div", { class: "ctx txt" }, "Ladění je jen pro správce hry. Zadej heslo:"),
      input,
      err,
      h("div", { class: "cbtns" }, h("button", { class: "px cb primary", style: "background:var(--accent-d);border-color:#7dd3fc #075985 #075985 #7dd3fc;color:#03111c", onclick: submit }, icon("tick", "currentColor", 10), label("odemknout")), h("button", { class: "px cb", onclick: close }, label("zrušit"), h("span", { class: "k" }, "ESC"))),
    ),
  );
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target === wrap) close();
  });
  document.body.append(wrap);
  input.focus();
}
