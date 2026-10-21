/**
 * Roadmapa – textové záznamy o tom, na čem se pracuje a co se plánuje. Upravuje se ručně v tomto souboru.
 * Každá položka: krátký název + jednořádkový popis; `status` řadí do sekcí.
 */
import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";

export interface RoadmapItem {
  /** oblast (droid, modul, loď, herní mód, mapa, UI…) – zobrazí se jako štítek před názvem */
  group: string;
  title: string;
  text: string;
  status: "doing" | "next" | "mid" | "later";
}

export const ROADMAP: RoadmapItem[] = [
  // --- stále probíhá ---
  { status: "doing", group: "UI", title: "Úprava UI", text: "Průběžné zpřehledňování a zkompaktnění obrazovek." },
  // --- budeme vypracovávat ---
  { status: "next", group: "Nový droid", title: "Droid Střelec", text: "" },
  { status: "next", group: "Nový modul", title: "Velký modul – Hyperpohon", text: "" },
  { status: "next", group: "Nový modul", title: "Velký modul – Atomová bomba", text: "" },
  { status: "next", group: "Prvky na mapě", title: "Vizuální prvky bez efektů", text: "" },
  { status: "next", group: "Zpětná vazba", title: "Zpětná vazba po zápase", text: "Po dokončení zápasu může hráč napsat zpětnou vazbu; admin ji uvidí v roadmapě jako seznam zpráv." },
  // --- střednědobý vývoj ---
  { status: "mid", group: "Nový droid", title: "Droid Hacker", text: "" },
  { status: "mid", group: "Nová loď", title: "Střední loď", text: "" },
  { status: "mid", group: "Prvky na mapě", title: "Budovy, vesmírné stanice", text: "" },
  { status: "mid", group: "Prvky na mapě", title: "Nové druhy hazardu", text: "Slunce, planety." },
  { status: "mid", group: "Prvky na mapě", title: "Skryté suroviny či moduly v asteroidech", text: "" },
  // --- pozdější vývoj ---
  { status: "later", group: "Nová loď", title: "Velká loď", text: "" },
  { status: "later", group: "Herní mód", title: "Obrana Velké lodi", text: "" },
  { status: "later", group: "Herní mód", title: "Útok na Velkou loď", text: "" },
];

const SECTIONS: { status: RoadmapItem["status"]; title: string; color: string; hint: string }[] = [
  { status: "doing", title: "Stále probíhá", color: "#4ade80", hint: "Průběžná práce, která nikdy úplně nekončí." },
  { status: "next", title: "Budeme vypracovávat", color: "#7dd3fc", hint: "Nejbližší věci na řadě." },
  { status: "mid", title: "Střednědobý vývoj", color: "#fbbf24", hint: "Domluvené, přijde po nejbližších věcech." },
  { status: "later", title: "Pozdější vývoj", color: "#94a3b8", hint: "Vzdálenější plány – pořadí se může měnit." },
];

let overlay: HTMLElement | null = null;

/** Otevře okno roadmapy (zavře se křížkem, klikem vedle nebo Esc). */
export function openRoadmap(): void {
  if (overlay) return;
  const close = () => {
    overlay?.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const card = h(
    "div",
    { class: "pnl mu-card rm-card" },
    h("div", { class: "bb-head" }, icon("target", "#7dd3fc", 14), h("span", { class: "ttl" }, label("Roadmapa")), h("span", { class: "muted txt", style: "font-size:13px;margin-left:8px" }, "na čem se pracuje a co se plánuje"), h("button", { class: "px tiny", style: "margin-left:auto", onclick: close }, "✕")),
    ...SECTIONS.map((sec) => {
      const items = ROADMAP.filter((it) => it.status === sec.status);
      if (!items.length) return null;
      return h(
        "div",
        { class: "rm-sec" },
        h("div", { class: "rm-sec-h", style: `color:${sec.color}`, title: sec.hint }, label(sec.title), h("span", { class: "muted" }, ` · ${items.length}`)),
        ...items.map((it) =>
          h(
            "div",
            { class: "rm-item" },
            h("span", { class: "rm-dot", style: `background:${sec.color}` }),
            h("span", { class: "rm-group txt" }, it.group),
            h("span", { class: "rm-title" }, it.title),
            h("span", { class: "rm-text txt" }, it.text),
          ),
        ),
      );
    }),
    h("div", { class: "muted txt rm-foot" }, "Historie změn je v README (Historie změn). Roadmapa se upravuje v souboru roadmap.ts."),
  );
  overlay = h("div", { class: "mu-overlay", onclick: (e) => {
      if (e.target === overlay) close();
    } }, h("div", { class: "mu-body" }, card));
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
}
