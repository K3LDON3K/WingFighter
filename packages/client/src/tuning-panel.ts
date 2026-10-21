import { BUILTIN_PILOTS, DEFAULT_TUNING, pilotAbilities, pilotList, TUNING_FIELDS, type PilotDef, type PilotMods, type Tuning } from "@wingfighter/shared";
import { clear, h } from "./dom.ts";
import { parallaxRow, renderScaleRow } from "./display.ts";
import { icon, label } from "./icons.ts";
import { setTouchSetting, touchSetting, deviceIsTouch, type TouchSetting } from "./touch.ts";

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
  /** Uložit editované piloty na server (jen host; chybí = editor jen pro čtení). */
  onSavePilots?: (pilots: PilotDef[]) => void;
}

interface Built {
  tuning: Tuning;
  canEdit: boolean;
  head: HTMLElement;
  tabs: HTMLElement;
  body: HTMLElement;
  localRows: HTMLElement[];
  pilotRows: HTMLElement[];
  inputs: Map<keyof Tuning, { input: HTMLInputElement; row: HTMLElement; note: HTMLElement }>;
}

/** Místní (jen tento prohlížeč) volby zobrazení – neposílají se na server. */
const LOCAL_GROUP = "Zobrazení";
const KEY_HITBOXES = "wingfighter.showHitboxes";
const KEY_SELRING = "wingfighter.showSelectRing";
function localFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setLocalFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
export const showHitboxes = () => localFlag(KEY_HITBOXES);
/** Bílý kroužek kolem vybrané lodi (a slabý při najetí myší) – výchozí vypnuto. */
export const showSelectRing = () => localFlag(KEY_SELRING);

const PILOT_GROUP = "Piloti";
const GROUPS = [...new Set(TUNING_FIELDS.map((f) => f.group)), PILOT_GROUP, LOCAL_GROUP];
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
    h("div", { class: "tp-local" }, h("span", { class: "muted", style: "font-size:8px" }, label("Zobrazení (jen tento počítač)")), renderScaleRow(), parallaxRow()),
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
  for (const r of b.pilotRows) r.style.display = activeTab === PILOT_GROUP ? "" : "none";
}

/* ---------- editor pilotů ---------- */
const MOD_FIELDS: { key: keyof PilotMods; label: string; min: number; max: number }[] = [
  { key: "attack", label: "útok (kostky)", min: -2, max: 2 },
  { key: "agility", label: "obrana (kostky)", min: -2, max: 2 },
  { key: "stressMax", label: "max. stres", min: -2, max: 2 },
  { key: "maxSpeed", label: "max. rychlost", min: -2, max: 2 },
  { key: "hullPct", label: "trup %", min: -50, max: 50 },
];
let draft: PilotDef[] | null = null;

function buildPilotEditor(root: HTMLElement, canEdit: boolean, a: TuningActions) {
  const redraw = () => {
    clear(root);
    if (!draft) draft = structuredClone(pilotList());
    const list = draft;
    const parts: (HTMLElement | null)[] = [
      h("div", { class: "muted txt", style: "padding:4px 0 8px" }, canEdit ? "Piloti platí pro všechny místnosti na serveru (pilots.json). Kadet nemá modifikátory a může se v letce opakovat; ostatní jsou unikátní. Změny platí po Uložit." : "Piloty upravuje jen host."),
      h(
        "div",
        { class: "pe-head" },
        h("span", {}, label("Pilot")),
        h("span", {}, label("Popis")),
        ...MOD_FIELDS.map((f) => h("span", { class: "pe-num", title: f.label }, label(f.label))),
        h("span", { class: "pe-num" }, label("unikát")),
        h("span", {}),
      ),
      ...list.map((p, i) =>
        h(
          "div",
          { class: "pe-row" },
          h("input", { value: p.name, maxLength: 20, disabled: !canEdit, oninput: (e) => (p.name = (e.target as HTMLInputElement).value) }),
          h("input", { value: p.description, maxLength: 300, disabled: !canEdit, oninput: (e) => (p.description = (e.target as HTMLInputElement).value) }),
          ...MOD_FIELDS.map((f) =>
            h("input", {
              type: "number",
              class: "pe-num",
              value: String(p.mods[f.key]),
              min: String(f.min),
              max: String(f.max),
              step: f.key === "hullPct" ? "5" : "1",
              disabled: !canEdit || p.id === "kadet",
              onchange: (e) => {
                p.mods[f.key] = Math.max(f.min, Math.min(f.max, Math.round(Number((e.target as HTMLInputElement).value) || 0)));
                p.abilities = pilotAbilities(p.mods);
              },
            }),
          ),
          h("input", { type: "checkbox", class: "pe-num", checked: p.unique, disabled: !canEdit || p.id === "kadet", onchange: (e) => (p.unique = (e.target as HTMLInputElement).checked) }),
          canEdit && !p.builtin ? h("button", { class: "px tiny", title: "Smazat pilota", onclick: () => (list.splice(i, 1), redraw()) }, "✕") : h("span", { class: "muted", style: "font-size:10px" }, label(p.id === "kadet" ? "základ" : p.builtin ? "vestavěný" : "")),
        ),
      ),
      canEdit
        ? h(
            "div",
            { class: "row", style: "gap:8px;margin-top:8px;flex-wrap:wrap" },
            h("button", { onclick: () => (list.push({ id: `p${Date.now().toString(36)}`, name: "Nový pilot", description: "", abilities: [], mods: { attack: 0, agility: 0, stressMax: 0, maxSpeed: 0, hullPct: 0 }, unique: true }), redraw()) }, icon("plus", "currentColor", 10), " ", label("nový pilot")),
            h("button", { class: "on", title: "Uloží piloty na server a rozešle všem místnostem", onclick: () => a.onSavePilots?.(list) }, label("Uložit piloty")),
            h("button", { title: "Zahodí neuložené změny", onclick: () => ((draft = null), redraw()) }, label("Načíst aktuální")),
            h("button", { title: "Vrátí vestavěné čtyři piloty", onclick: () => ((draft = structuredClone(BUILTIN_PILOTS)), redraw()) }, label("Výchozí")),
          )
        : null,
    ];
    root.append(...parts.filter((x): x is HTMLElement => !!x));
  };
  redraw();
}

function build(root: HTMLElement, tuning: Tuning, canEdit: boolean, a: TuningActions): Built {
  const inputs: Built["inputs"] = new Map();
  const body = h("div", { class: "tune-body" });
  const b: Built = { tuning, canEdit, head: h("div", { class: "row tune-head" }), tabs: h("div", { class: "tune-tabs" }), body, inputs, localRows: [], pilotRows: [] };
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
  const hb = h("input", { type: "checkbox", checked: showHitboxes(), onchange: () => setLocalFlag(KEY_HITBOXES, hb.checked) });
  const sr = h("input", { type: "checkbox", checked: showSelectRing(), onchange: () => setLocalFlag(KEY_SELRING, sr.checked) });
  const srRow = h("label", { class: "tune-row", title: "Bílý kroužek kolem vybrané lodi a slabý kroužek při najetí myší. Žlutý čárkovaný kroužek cíle zůstává vždy." }, h("span", { class: "txt tune-label" }, "Zobrazit kroužek kolem vybrané lodi"), sr);
  const hbRow = h("label", { class: "tune-row", title: "Vykreslí kolizní kruhy (tělo, příď, křídla) všech viditelných lodí. Jen pro tento prohlížeč." }, h("span", { class: "txt tune-label" }, "Zobrazit hitboxy lodí (kolizní model)"), hb);
  const tsel = h("select", { onchange: () => setTouchSetting(tsel.value as TouchSetting) }, ...(["auto", "on", "off"] as TouchSetting[]).map((v) => h("option", { value: v, selected: touchSetting() === v }, v === "auto" ? `automaticky (${deviceIsTouch() ? "dotykové zařízení" : "myš"})` : v === "on" ? "zapnuto" : "vypnuto")));
  const tRow = h("label", { class: "tune-row", title: "Dotykové ovládání: tažení = posun, dva prsty = zoom, tažení z vlastní lodi = kreslení dráhy s potvrzením ✓ / ✕, podržení = info, tlačítko ☰ místo Esc." }, h("span", { class: "txt tune-label" }, "Dotykové ovládání (tablet)"), tsel);
  const noteRow = h("div", { class: "muted txt", style: "padding:6px 0" }, "Volby v této záložce se neposílají na server – mění jen zobrazení v tomto prohlížeči.");
  b.localRows.push(tRow, srRow, hbRow, noteRow);
  body.append(tRow, srRow, hbRow, noteRow);
  // editor pilotů
  const pilotBox = h("div", { class: "pilot-editor" });
  buildPilotEditor(pilotBox, canEdit, a);
  b.pilotRows.push(pilotBox);
  body.append(pilotBox);
  root.append(h("div", { class: "pnl tune-card" }, b.head, b.tabs, body));
  return b;
}
