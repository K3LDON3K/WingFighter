import {
  dist,
  hullOf,
  maneuverLabel,
  resolveManeuver,
  STRESS,
  stressCost,
  TEAM_COLORS,
  type Difficulty,
  type GameState,
  type Ship,
  type ShipOrders,
  type Torpedo,
} from "@spacegame/shared";
import { clear, h } from "../dom.ts";
import { activeAction } from "./actions.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  reaim(shipId: string): void;
  ready(): void;
  unready(): void;
}

export interface PlanningModel {
  state: GameState;
  myId: string;
  orders: Map<string, ShipOrders>;
  confirmed: Set<string>;
  selectedShipId?: string;
  submitted: boolean;
  ready: string[];
  animating: boolean;
  picking?: "torpedo" | "lock";
}

export const DIFFICULTY_COLOR: Record<Difficulty, string> = { green: "#4ade80", white: "#e2e8f0", red: "#f87171", danger: "#fb923c" };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  green: "zelený – vrátí 1 stresový bod",
  white: "bílý – bez vlivu",
  red: "červený – stojí 1 stresový bod",
  danger: `NEBEZPEČNÝ – stojí 2 body a ${STRESS.dangerHullPercent} % trupu`,
};

export function renderPlanning(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
  clear(root);
  const my = m.state.ships.filter((s) => s.alive && s.ownerId === m.myId);
  const ship = my.find((s) => s.id === m.selectedShipId) ?? my[0];

  if (m.animating) {
    root.append(h("div", { class: "panel" }, h("h3", {}, "Vyhodnocení kola"), h("div", { class: "muted" }, "Sleduj mapu…")));
    return;
  }
  if (m.state.status === "finished") return;
  if (!ship) {
    root.append(h("div", { class: "panel" }, h("h3", {}, "Pozorovatel"), h("div", { class: "muted" }, "Všechny tvoje lodě byly zničeny. Bitva pokračuje.")));
    return;
  }

  const o = m.orders.get(ship.id)!;
  const enemies = m.state.ships.filter((s) => s.alive && s.team !== ship.team);
  const enemyTorpedoes = m.state.torpedoes.filter((t) => t.team !== ship.team);
  const profile = hullOf(ship.loadout).profile;
  const locked = m.submitted;
  const man = resolveManeuver(profile, o.maneuverId, ship.speed);
  const confirmed = m.confirmed.has(ship.id);
  const act = activeAction(o);

  const panel = h("div", { class: "panel" });

  if (my.length > 1) {
    panel.append(
      h(
        "div",
        { class: "ship-tabs" },
        ...my.map((s) => h("button", { class: `${s.id === ship.id ? "active" : ""} ${m.confirmed.has(s.id) ? "done" : ""}`, onclick: () => cb.select(s.id) }, s.name)),
      ),
    );
  }

  const pips = h("div", { class: "pips", title: "Stresové body: červený manévr −1, nebezpečný −2, zelený +1" });
  for (let i = 0; i < STRESS.max; i++) pips.append(h("span", { class: i < ship.stressPoints ? "pip on" : "pip" }));

  panel.append(
    h("h2", { style: `color:${TEAM_COLORS[ship.team]}` }, ship.name),
    h(
      "div",
      { class: "stats" },
      h("div", {}, "Trup", h("b", {}, `${ship.hull}/${ship.stats.hull}`)),
      h("div", {}, "Štíty", h("b", {}, `${ship.shields}/${ship.stats.shields}`)),
      h("div", {}, "Stres", h("b", {}, pips)),
      h("div", {}, "Rychlost", h("b", {}, String(ship.speed))),
      h("div", {}, "Torpéda", h("b", {}, String(ship.ammo.torpedoes))),
      h("div", {}, "Miny", h("b", {}, String(ship.ammo.mines))),
    ),
  );

  /* ---- manévr ---- */
  panel.append(
    h(
      "div",
      { class: "field" },
      h("h3", {}, "1 · Manévr"),
      man
        ? h(
            "div",
            {},
            h("div", { style: `font-size:13px;color:${DIFFICULTY_COLOR[man.difficulty]}` }, `${maneuverLabel(man)} · ${DIFFICULTY_LABEL[man.difficulty]}`),
            stressCost(man.difficulty) > ship.stressPoints ? h("div", { style: "color:var(--red);font-size:12px" }, "Na tenhle manévr nemáš dost stresových bodů.") : null,
          )
        : h("div", { style: "color:var(--red);font-size:12px" }, "Loď tenhle manévr nezvládne."),
      h(
        "div",
        { class: "muted", style: "font-size:11px;margin-top:4px" },
        confirmed
          ? "Manévr potvrzen. Klikni na loď, pokud ho chceš změnit."
          : "Pohyb myši u lodi kreslí dráhu: směr podle polohy, rychlost podle vzdálenosti (nebo kolečko / klávesy 1–5, K = otočka). Kliknutím potvrď.",
      ),
      h(
        "div",
        { class: "legend" },
        h("span", { style: `color:${DIFFICULTY_COLOR.green}` }, "■ zelený +1 stres"),
        h("span", { style: `color:${DIFFICULTY_COLOR.white}` }, "■ bílý"),
        h("span", { style: `color:${DIFFICULTY_COLOR.red}` }, "■ červený −1"),
        h("span", { style: `color:${DIFFICULTY_COLOR.danger}` }, `■ nebezpečný −2, −${STRESS.dangerHullPercent} % trupu`),
      ),
      !locked && confirmed ? h("button", { style: "margin-top:6px", onclick: () => cb.reaim(ship.id) }, "Změnit manévr") : null,
    ),
  );

  /* ---- akce ---- */
  const targetName = (id: string | undefined) => {
    if (!id) return "";
    const s = m.state.ships.find((x) => x.id === id);
    if (s) return s.name;
    return m.state.torpedoes.some((t) => t.id === id) ? "torpédo" : "";
  };
  let chosen = act.label;
  if (o.special?.type === "torpedo") {
    chosen += o.special.targetId ? ` → ${targetName(o.special.targetId)}` : o.special.point ? ` → bod [${Math.round(o.special.point.x)}, ${Math.round(o.special.point.y)}]` : " – vyber cíl";
  } else if (o.action?.type === "lock") chosen += ` → ${targetName(o.action.targetId) || "vyber cíl"}`;

  panel.append(
    h(
      "div",
      { class: "field" },
      h("h3", {}, "2 · Akce po pohybu"),
      confirmed
        ? h(
            "div",
            {},
            h("div", { style: "font-size:13px" }, h("b", {}, chosen)),
            h("div", { class: "muted", style: "font-size:12px;margin-top:2px" }, act.description),
            m.picking === "torpedo" ? h("div", { style: "color:var(--yellow);font-size:12px;margin-top:4px" }, "Klikni na nepřátelskou loď/torpédo (žlutý dostřel 320) nebo na bod mapy (do 1200).") : null,
            m.picking === "lock" ? h("div", { style: "color:var(--yellow);font-size:12px;margin-top:4px" }, "Klikni na nepřátelskou loď v dosahu 300.") : null,
          )
        : h("div", { class: "muted", style: "font-size:12px" }, "Nejdřív potvrď manévr – ikony akcí se objeví u konce dráhy. Najetím myší zobrazíš vysvětlení."),
    ),
  );

  /* ---- lasery ---- */
  const targetSelect = h(
    "select",
    { disabled: locked, onchange: (e) => cb.setOrders(ship.id, { preferredTargetId: (e.target as HTMLSelectElement).value || undefined }) },
    h("option", { value: "", selected: !o.preferredTargetId }, "nejbližší ve výseči"),
    ...enemies.map((s: Ship) => h("option", { value: s.id, selected: s.id === o.preferredTargetId }, `${s.name} (${Math.round(dist(ship, s))})`)),
    ...enemyTorpedoes.map((t: Torpedo) => h("option", { value: t.id, selected: t.id === o.preferredTargetId }, `Torpédo ${t.id.slice(-3)} (${Math.round(dist(ship, t))})`)),
  );
  panel.append(
    h(
      "div",
      { class: "field" },
      h("h3", {}, "3 · Lasery"),
      h(
        "div",
        { class: "row" },
        h("button", { class: o.fire ? "active" : "", disabled: locked, onclick: () => cb.setOrders(ship.id, { fire: !o.fire }) }, o.fire ? "pálit: ano" : "pálit: ne"),
        h("span", { class: "muted", style: "font-size:12px" }, "cíl:"),
        targetSelect,
      ),
      h(
        "div",
        { class: "muted", style: "font-size:12px;margin-top:4px" },
        "Výseč ±20° před přídí po pohybu, dostřel 300 (blízko +1 kostka útoku, daleko +1 obrany). Cíl vybereš i kliknutím na nepřítele. Torpédo jako cíl: střílí se jen na něj.",
      ),
    ),
  );

  const humans = m.state.players.filter((p) => !p.isBot);
  const waiting = humans.filter((p) => !m.ready.includes(p.id) && m.state.ships.some((s) => s.alive && s.ownerId === p.id));
  const allConfirmed = my.every((s) => m.confirmed.has(s.id));
  panel.append(
    h(
      "div",
      { class: "ready-bar" },
      locked
        ? h("button", { onclick: () => cb.unready() }, "Změnit rozkazy")
        : h("button", { class: "primary", disabled: !allConfirmed, title: allConfirmed ? "" : "Nejdřív potvrď manévr všech lodí", onclick: () => cb.ready() }, my.length > 1 ? "Odeslat rozkazy všech lodí (Enter)" : "Připraven (Enter)"),
      h("div", { class: "waiting" }, waiting.length ? `Čeká se na: ${waiting.map((p) => p.name).join(", ")}` : "Všichni připraveni, vyhodnocuji…"),
    ),
  );

  root.append(panel);
}
