import { DEFAULT_TUNING, TUNING_FIELDS, type Tuning } from "@spacegame/shared";
import { clear, h } from "./dom.ts";
import { icon, label } from "./icons.ts";

/**
 * Ladicí menu parametrů hry. Host hodnoty mění (posílají se na server a platí pro všechny),
 * ostatní je vidí jen pro čtení.
 */
export interface TuningActions {
  onChange: (patch: Partial<Tuning>) => void;
  onReset: () => void;
  onSave: () => void;
  onLoad: () => void;
  onClose: () => void;
}

export function renderTuningPanel(root: HTMLElement, tuning: Tuning, savedTuning: Tuning | null, canEdit: boolean, a: TuningActions) {
  const { onChange, onReset, onSave, onLoad, onClose } = a;
  const dirty = !!savedTuning && TUNING_FIELDS.some((f) => savedTuning[f.key] !== tuning[f.key]);
  clear(root);
  const groups = [...new Set(TUNING_FIELDS.map((f) => f.group))];
  const body = h("div", { class: "tune-body" });
  for (const g of groups) {
    const box = h("div", { class: "tune-group" }, h("div", { class: "ttl" }, label(g)));
    for (const f of TUNING_FIELDS.filter((x) => x.group === g)) {
      const val = tuning[f.key];
      const changed = val !== DEFAULT_TUNING[f.key];
      const input = h("input", {
        type: "number",
        value: String(val),
        min: String(f.min),
        max: String(f.max),
        step: String(f.step),
        disabled: !canEdit,
        class: changed ? "changed" : "",
      });
      const commit = () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v !== tuning[f.key]) onChange({ [f.key]: v } as Partial<Tuning>);
      };
      input.onchange = commit;
      input.onkeydown = (e) => e.key === "Enter" && commit();
      box.append(
        h(
          "label",
          { class: "tune-row", title: f.hint ?? "" },
          h("span", { class: "txt tune-label" }, f.label, changed ? h("span", { class: "muted" }, ` (výchozí ${DEFAULT_TUNING[f.key]})`) : null),
          input,
        ),
      );
    }
    body.append(box);
  }
  root.append(
    h(
      "div",
      { class: "pnl tune-card" },
      h(
        "div",
        { class: "row tune-head" },
        icon("target", "#7dd3fc", 14),
        h("span", { class: "ttl" }, label("Ladění parametrů")),
        h("span", { class: "muted txt" }, canEdit ? "Změny platí pro všechny hráče od příštího kola." : "Mění jen host."),
        h("div", { class: "spacer" }),
        h("span", { class: "muted", style: "font-size:8px" }, savedTuning ? (dirty ? label("neuloženo") : label("uloženo")) : label("nic neuloženo")),
        canEdit ? h("button", { class: dirty ? "on" : "", title: "Uloží na server do tuning.json – výchozí pro každou novou místnost", onclick: onSave }, label("Uložit")) : null,
        canEdit && savedTuning ? h("button", { title: "Načte hodnoty uložené na serveru", onclick: onLoad }, label("Načíst uložené")) : null,
        canEdit ? h("button", { title: "Tovární hodnoty", onclick: onReset }, label("Výchozí")) : null,
        h("button", { onclick: onClose }, "✕"),
      ),
      body,
    ),
  );
}
