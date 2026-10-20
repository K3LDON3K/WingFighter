import { DEFAULT_TUNING, TUNING_FIELDS, type Tuning } from "@wingfighter/shared";
import { clear, h } from "./dom.ts";
import { icon, label } from "./icons.ts";

/**
 * Ladicí menu parametrů hry. Host hodnoty mění (posílají se na server a platí pro všechny),
 * ostatní je vidí jen pro čtení. Záložky = skupiny parametrů.
 * Panel se při překreslení nestaví znovu: rozepsaná hodnota v políčku se neztrácí.
 */
export interface TuningActions {
  onChange: (patch: Partial<Tuning>) => void;
  onReset: () => void;
  onSave: () => void;
  onLoad: () => void;
  onClose: () => void;
}

interface Built {
  tuning: Tuning;
  canEdit: boolean;
  head: HTMLElement;
  tabs: HTMLElement;
  body: HTMLElement;
  localRows: HTMLElement[];
  inputs: Map<keyof Tuning, { input: HTMLInputElement; row: HTMLElement; note: HTMLElement }>;
}

/** Místní (jen tento prohlížeč) volby zobrazení – neposílají se na server. */
const LOCAL_GROUP = "Zobrazení";
const KEY_HITBOXES = "wingfighter.showHitboxes";
export function showHitboxes(): boolean {
  try {
    return localStorage.getItem(KEY_HITBOXES) === "1";
  } catch {
    return false;
  }
}
function setShowHitboxes(on: boolean) {
  try {
    localStorage.setItem(KEY_HITBOXES, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const GROUPS = [...new Set(TUNING_FIELDS.map((f) => f.group)), LOCAL_GROUP];
let activeTab = GROUPS[0];
const built = new WeakMap<HTMLElement, Built>();

export function renderTuningPanel(root: HTMLElement, tuning: Tuning, savedTuning: Tuning | null, canEdit: boolean, a: TuningActions) {
  let b = built.get(root);
  if (!b || b.canEdit !== canEdit || root.childElementCount === 0) {
    clear(root);
    b = build(root, tuning, canEdit, a);
    built.set(root, b);
  }
  b.tuning = tuning;
  // hlavička (stav uložení, tlačítka)
  const dirty = !!savedTuning && TUNING_FIELDS.some((f) => savedTuning[f.key] !== tuning[f.key]);
  clear(b.head);
  b.head.append(
    ...([
    icon("target", "#7dd3fc", 14),
    h("span", { class: "ttl" }, label("Ladění parametrů")),
    h("span", { class: "muted txt" }, canEdit ? "Změny platí pro všechny hráče od příštího kola." : "Mění jen host."),
    h("div", { class: "spacer" }),
    h("span", { class: "muted", style: "font-size:8px" }, savedTuning ? (dirty ? label("neuloženo") : label("uloženo")) : label("nic neuloženo")),
    canEdit ? h("button", { class: dirty ? "on" : "", title: "Uloží na server do tuning.json – výchozí pro každou novou místnost", onclick: a.onSave }, label("Uložit")) : null,
    canEdit && savedTuning ? h("button", { title: "Načte hodnoty uložené na serveru", onclick: a.onLoad }, label("Načíst uložené")) : null,
    canEdit ? h("button", { title: "Tovární hodnoty", onclick: a.onReset }, label("Výchozí")) : null,
    h("button", { onclick: a.onClose }, "✕"),
    ].filter((x): x is HTMLElement | SVGSVGElement => !!x)),
  );
  // záložky
  clear(b.tabs);
  for (const g of GROUPS) {
    const changedCount = TUNING_FIELDS.filter((f) => f.group === g && tuning[f.key] !== DEFAULT_TUNING[f.key]).length;
    b.tabs.append(
      h(
        "button",
        {
          class: `tab ${g === activeTab ? "on" : ""}`,
          onclick: () => {
            activeTab = g;
            renderTuningPanel(root, b!.tuning, savedTuning, canEdit, a);
          },
        },
        label(g),
        changedCount ? h("span", { class: "tab-dot", title: `${changedCount} změněných` }, String(changedCount)) : null,
      ),
    );
  }
  // hodnoty: rozepsané (fokusované) políčko nepřepisujeme
  for (const f of TUNING_FIELDS) {
    const e = b.inputs.get(f.key)!;
    const val = tuning[f.key];
    const changed = val !== DEFAULT_TUNING[f.key];
    e.row.style.display = f.group === activeTab ? "" : "none";
    if (f.bool) e.input.checked = val > 0;
    else if (document.activeElement !== e.input) e.input.value = String(val);
    e.input.classList.toggle("changed", changed);
    e.note.textContent = changed ? (f.bool ? ` (výchozí ${DEFAULT_TUNING[f.key] ? "ano" : "ne"})` : ` (výchozí ${DEFAULT_TUNING[f.key]})`) : "";
  }
  for (const r of b.localRows) r.style.display = activeTab === LOCAL_GROUP ? "" : "none";
}

function build(root: HTMLElement, tuning: Tuning, canEdit: boolean, a: TuningActions): Built {
  const inputs: Built["inputs"] = new Map();
  const body = h("div", { class: "tune-body" });
  const b: Built = { tuning, canEdit, head: h("div", { class: "row tune-head" }), tabs: h("div", { class: "tune-tabs" }), body, inputs, localRows: [] };
  for (const f of TUNING_FIELDS) {
    const input = f.bool
      ? h("input", { type: "checkbox", checked: tuning[f.key] > 0, disabled: !canEdit })
      : h("input", { type: "number", value: String(tuning[f.key]), min: String(f.min), max: String(f.max), step: String(f.step), disabled: !canEdit });
    const commit = () => {
      const v = f.bool ? (input.checked ? 1 : 0) : Number(input.value);
      if (Number.isFinite(v) && v !== b.tuning[f.key]) a.onChange({ [f.key]: v } as Partial<Tuning>);
    };
    input.onchange = commit;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        commit();
        input.blur();
      }
    };
    const note = h("span", { class: "muted" });
    const row = h("label", { class: "tune-row", title: f.hint ?? "" }, h("span", { class: "txt tune-label" }, f.label, note), input);
    inputs.set(f.key, { input, row, note });
    body.append(row);
  }
  // místní volby zobrazení (platí jen pro tento prohlížeč, může je měnit každý hráč)
  const hb = h("input", { type: "checkbox", checked: showHitboxes(), onchange: () => setShowHitboxes(hb.checked) });
  const hbRow = h("label", { class: "tune-row", title: "Vykreslí kolizní kruhy (tělo, příď, křídla) všech viditelných lodí. Jen pro tento prohlížeč." }, h("span", { class: "txt tune-label" }, "Zobrazit hitboxy lodí (kolizní model)"), hb);
  const noteRow = h("div", { class: "muted txt", style: "padding:6px 0" }, "Volby v této záložce se neposílají na server – mění jen zobrazení v tomto prohlížeči.");
  b.localRows.push(hbRow, noteRow);
  body.append(hbRow, noteRow);
  root.append(h("div", { class: "pnl tune-card" }, b.head, b.tabs, body));
  return b;
}
