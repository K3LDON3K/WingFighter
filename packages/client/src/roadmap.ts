/**
 * Roadmapa – přehled toho, na čem se pracuje a co se plánuje. Data žijí na serveru v souboru roadmap.json
 * (kořen projektu) a jdou upravovat přímo ve hře: tlačítko UPRAVIT → přidat, upravit, označit hotové, smazat.
 */
import {
  newRoadmapId,
  ROADMAP_GROUPS,
  ROADMAP_STATUS_LABEL,
  ROADMAP_STATUSES,
  type RoadmapItem,
  type RoadmapStatus,
} from "@wingfighter/shared";
import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";

const SECTIONS: { status: RoadmapStatus; color: string; hint: string }[] = [
  { status: "doing", color: "#4ade80", hint: "Průběžná práce, která nikdy úplně nekončí." },
  { status: "next", color: "#7dd3fc", hint: "Nejbližší věci na řadě." },
  { status: "mid", color: "#fbbf24", hint: "Domluvené, přijde po nejbližších věcech." },
  { status: "later", color: "#94a3b8", hint: "Vzdálenější plány – pořadí se může měnit." },
];
const DONE_COLOR = "#64748b";

let overlay: HTMLElement | null = null;
let items: RoadmapItem[] = [];
let editing = false;
/** id položky s otevřeným formulářem; "new" = formulář pro novou položku */
let formFor: string | null = null;
/** id položky, u které čeká potvrzení smazání */
let confirmDelete: string | null = null;
let showDone = false;
let notice = "";
let noticeErr = false;
let loading = true;
let closeFn: () => void = () => {};

/** Otevře okno roadmapy (zavře se křížkem, klikem vedle nebo Esc). */
export function openRoadmap(): void {
  if (overlay) return;
  const close = () => {
    overlay?.remove();
    overlay = null;
    formFor = null;
    confirmDelete = null;
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  closeFn = close;
  overlay = h("div", { class: "mu-overlay", onclick: (e) => {
      if (e.target === overlay) close();
    } }, h("div", { class: "mu-body" }, card()));
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
  void load();
}

async function load(): Promise<void> {
  loading = true;
  try {
    const r = await fetch("/api/roadmap", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    items = (await r.json()) as RoadmapItem[];
    notice = "";
  } catch {
    notice = "Roadmapu se nepodařilo načíst ze serveru.";
    noticeErr = true;
  }
  loading = false;
  rerender();
}

async function save(next: RoadmapItem[]): Promise<void> {
  try {
    const r = await fetch("/api/roadmap", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    if (!r.ok) throw new Error(String(r.status));
    items = (await r.json()) as RoadmapItem[];
    notice = "Uloženo (roadmap.json).";
    noticeErr = false;
  } catch {
    notice = "Uložení se nezdařilo – zkus to znovu.";
    noticeErr = true;
  }
  formFor = null;
  confirmDelete = null;
  rerender();
}

function rerender(): void {
  if (!overlay) return;
  const body = overlay.querySelector(".mu-body");
  if (!body) return;
  const old = body.querySelector(".rm-card");
  const fresh = card();
  if (old) old.replaceWith(fresh);
  else body.append(fresh);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function card(): HTMLElement {
  const open = items.filter((it) => !it.done);
  const done = items.filter((it) => it.done);
  return h(
    "div",
    { class: "pnl mu-card rm-card" },
    h(
      "div",
      { class: "bb-head" },
      icon("target", "#7dd3fc", 14),
      h("span", { class: "ttl" }, label("Roadmapa")),
      h("span", { class: "muted txt", style: "font-size:13px;margin-left:8px" }, "na čem se pracuje a co se plánuje"),
      h(
        "button",
        { class: `px tiny ${editing ? "on" : ""}`, style: "margin-left:auto", title: editing ? "Ukončit úpravy" : "Přidávat, upravovat a označovat hotové položky", onclick: () => {
            editing = !editing;
            formFor = null;
            confirmDelete = null;
            rerender();
          } },
        icon("pen", "currentColor", 10),
        " ",
        label(editing ? "Hotovo s úpravami" : "Upravit"),
      ),
      h("button", { class: "px tiny rm-close", style: "margin-left:6px", onclick: () => closeFn() }, "✕"),
    ),
    editing && formFor !== "new"
      ? h("div", { class: "rm-tools" }, h("button", { class: "px tiny", onclick: () => {
            formFor = "new";
            rerender();
          } }, icon("plus", "currentColor", 10), " ", label("Přidat položku")))
      : null,
    editing && formFor === "new" ? itemForm(null) : null,
    loading ? h("div", { class: "muted txt" }, "Načítám…") : null,
    ...SECTIONS.map((sec) => {
      const list = open.filter((it) => it.status === sec.status);
      if (!list.length && !editing) return null;
      return section(label(ROADMAP_STATUS_LABEL[sec.status]), sec.color, sec.hint, list, (it) => row(it, sec.color));
    }),
    done.length
      ? h(
          "div",
          { class: "rm-sec" },
          h(
            "button",
            { class: "rm-sec-h rm-sec-btn", style: `color:${DONE_COLOR}`, title: "Dokončené položky", onclick: () => {
                showDone = !showDone;
                rerender();
              } },
            label("Hotovo"),
            h("span", { class: "muted" }, ` · ${done.length} ${showDone ? "▴" : "▾"}`),
          ),
          ...(showDone ? done.map((it) => row(it, DONE_COLOR)) : []),
        )
      : null,
    h(
      "div",
      { class: `muted txt rm-foot ${noticeErr ? "err" : ""}` },
      notice || "Roadmapa je uložená na serveru v souboru roadmap.json – jde upravit tady i v souboru. Historie změn je v README.",
    ),
  );
}

function section(title: string, color: string, hint: string, list: RoadmapItem[], render: (it: RoadmapItem) => HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "rm-sec" },
    h("div", { class: "rm-sec-h", style: `color:${color}`, title: hint }, title, h("span", { class: "muted" }, ` · ${list.length}`)),
    ...(list.length ? list.map(render) : [h("div", { class: "muted txt rm-empty" }, "– nic –")]),
  );
}

function row(it: RoadmapItem, color: string): HTMLElement {
  if (editing && formFor === it.id) return itemForm(it);
  const el = h(
    "div",
    { class: `rm-item ${it.done ? "done" : ""} ${editing ? "edit" : ""}` },
    h("span", { class: "rm-dot", style: `background:${color}` }),
    h("span", { class: "rm-group txt" }, it.group),
    h("span", { class: "rm-title" }, it.title),
    h("span", { class: "rm-text txt" }, it.done && it.doneAt ? `${it.text ? it.text + " " : ""}(hotovo ${it.doneAt})` : it.text),
  );
  if (editing) {
    const del = confirmDelete === it.id;
    el.append(
      h(
        "span",
        { class: "rm-btns" },
        h(
          "button",
          { class: `px tiny ${it.done ? "on" : ""}`, title: it.done ? "Vrátit mezi rozpracované" : "Označit jako hotové", onclick: () => {
              void save(items.map((x) => (x.id === it.id ? { ...x, done: !x.done, doneAt: x.done ? undefined : today() } : x)));
            } },
          icon("check", "currentColor", 10),
        ),
        h("button", { class: "px tiny", title: "Upravit", onclick: () => {
            formFor = it.id;
            confirmDelete = null;
            rerender();
          } }, icon("pen", "currentColor", 10)),
        h(
          "button",
          { class: `px tiny ${del ? "danger" : ""}`, title: del ? "Opravdu smazat" : "Smazat", onclick: () => {
              if (del) void save(items.filter((x) => x.id !== it.id));
              else {
                confirmDelete = it.id;
                rerender();
              }
            } },
          del ? "SMAZAT?" : "✕",
        ),
      ),
    );
  }
  return el;
}

/** Formulář pro novou (it = null) nebo existující položku. */
function itemForm(it: RoadmapItem | null): HTMLElement {
  const group = h("input", { class: "rm-in", value: it?.group ?? ROADMAP_GROUPS[0], placeholder: "Oblast", maxLength: 40 });
  group.setAttribute("list", "rm-groups");
  const title = h("input", { class: "rm-in", value: it?.title ?? "", placeholder: "Název (povinné)", maxLength: 120 });
  const text = h("input", { class: "rm-in", value: it?.text ?? "", placeholder: "Popis (nepovinný)", maxLength: 400 });
  const status = h("select", { class: "rm-in" }, ...ROADMAP_STATUSES.map((s) => h("option", { value: s, selected: s === (it?.status ?? "next") }, ROADMAP_STATUS_LABEL[s])));
  const submit = () => {
    const t = title.value.trim();
    if (!t) {
      title.focus();
      return;
    }
    const next: RoadmapItem = {
      id: it?.id ?? newRoadmapId(),
      group: group.value.trim() || "Jiné",
      title: t,
      text: text.value.trim(),
      status: status.value as RoadmapStatus,
      done: it?.done ?? false,
      doneAt: it?.doneAt,
    };
    void save(it ? items.map((x) => (x.id === it.id ? next : x)) : [...items, next]);
  };
  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") submit();
    e.stopPropagation();
  };
  for (const el of [group, title, text]) el.onkeydown = onkeydown;
  const form = h(
    "div",
    { class: "rm-form" },
    h("datalist", { id: "rm-groups" }, ...ROADMAP_GROUPS.map((g) => h("option", { value: g }))),
    group,
    title,
    status,
    text,
    h(
      "div",
      { class: "rm-form-btns" },
      h("button", { class: "px tiny on", onclick: submit }, label(it ? "Uložit" : "Přidat")),
      h("button", { class: "px tiny", onclick: () => {
          formFor = null;
          rerender();
        } }, label("Zrušit")),
    ),
  );
  setTimeout(() => title.focus(), 0);
  return form;
}
