import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";

/** Jednoduché potvrzení přes celou stránku (Enter = potvrdit, Esc = zpět). */
export function confirmDialog(opts: { title: string; text: Node | string; ok: string; cancel?: string; danger?: boolean }, onOk: () => void): void {
  document.querySelector(".app-confirm")?.remove();
  const wrap = h("div", { class: "confirm-wrap app-confirm", style: "position:fixed" });
  const close = () => {
    wrap.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "Enter") {
      close();
      onOk();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  wrap.append(
    h(
      "div",
      { class: "pnl confirm" },
      h("div", { class: "ctl" }, label(opts.title)),
      h("div", { class: "ctx txt" }, opts.text),
      h(
        "div",
        { class: "cbtns" },
        h("button", { class: "px cb primary", style: opts.danger ? "" : "background:var(--accent-d);border-color:#7dd3fc #075985 #075985 #7dd3fc;color:#03111c", onclick: () => (close(), onOk()) }, icon("tick", "currentColor", 10), label(opts.ok), h("span", { class: "k" }, "ENTER")),
        h("button", { class: "px cb", onclick: close }, label(opts.cancel ?? "zpět"), h("span", { class: "k" }, "ESC")),
      ),
    ),
  );
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target === wrap) close();
  });
  document.body.append(wrap);
}
