/**
 * Roadmapa – textové záznamy o tom, na čem se pracuje a co se plánuje. Upravuje se ručně v tomto souboru.
 * Každá položka: krátký název + jednořádkový popis; `status` řadí do sekcí.
 */
import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";

export interface RoadmapItem {
  title: string;
  text: string;
  status: "doing" | "planned" | "idea";
}

export const ROADMAP: RoadmapItem[] = [
  // --- pracuje se ---
  { status: "doing", title: "Droidi", text: "Další druhy droidů (navigační, bojový, technický) s vlastními funkcemi za technologii." },
  { status: "doing", title: "Štíty", text: "Záložní štít se zapíná automaticky; ladění chování více štítů v bitvě." },
  { status: "doing", title: "Editor výbavy", text: "Přehlednější rozvržení, výběr slotu, váha a rychlost – doladění detailů." },
  // --- plánuje se ---
  { status: "planned", title: "Další trupy", text: "Těžší loď za 2 lodní body s více sloty a velkým modulem." },
  { status: "planned", title: "Velké moduly", text: "Moduly přes dva sloty (příď + záď): těžké dělo, velký štít, hangár." },
  { status: "planned", title: "Kampaň / série bitev", text: "Více bitev za sebou s přenosem výbavy, kreditů a pilotů." },
  { status: "planned", title: "Statistiky", text: "Historie bitev a žebříček hráčů na serveru." },
  // --- nápady ---
  { status: "idea", title: "Mlhoviny a jiné překážky", text: "Oblasti, které mění dohled, rychlost nebo účinnost zbraní." },
  { status: "idea", title: "Mise s cílem", text: "Jiné módy než deathmatch: dobýt bod, doprovodit loď, přežít vlny." },
];

const SECTIONS: { status: RoadmapItem["status"]; title: string; color: string; hint: string }[] = [
  { status: "doing", title: "Pracuje se", color: "#4ade80", hint: "Rozpracované – objeví se v dalších verzích." },
  { status: "planned", title: "Plánuje se", color: "#fbbf24", hint: "Domluvené, zatím nezačaté." },
  { status: "idea", title: "Nápady", color: "#94a3b8", hint: "Zatím jen úvahy – pořadí se může měnit." },
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
        ...items.map((it) => h("div", { class: "rm-item" }, h("span", { class: "rm-dot", style: `background:${sec.color}` }), h("span", { class: "rm-title" }, it.title), h("span", { class: "rm-text txt" }, it.text))),
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
