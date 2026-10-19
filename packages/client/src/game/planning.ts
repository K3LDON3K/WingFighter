import {
  ACTION_POINTS,
  actionList,
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
import { ACTIONS } from "./actions.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  aim(shipId: string): void;
  ready(): void;
  unready(): void;
}

export interface PlanningModel {
  state: GameState;
  myId: string;
  orders: Map<string, ShipOrders>;
  aimingShipId: string | null;
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
  const aiming = m.aimingShipId === ship.id;
  const acts = actionList(ship, o);

  const panel = h("div", { class: "panel" });

  if (my.length > 1) {
    panel.append(
      h(
        "div",
        { class: "ship-tabs" },
        ...my.map((s) => h("button", { class: s.id === ship.id ? "active" : "", onclick: () => cb.select(s.id) }, s.name)),
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
    h(
      "div",
      { class: "field actions-box" },
      h("h3", {}, `Akce tohoto kola: ${acts.length} / ${ACTION_POINTS}`),
      acts.length
        ? h("div", {}, ...acts.map((a) => h("span", { class: "chip" }, a.label)))
        : h("div", { class: "muted", style: "font-size:12px" }, "Žádná – loď poletí stejnou rychlostí rovně a nestřílí."),
      h("div", { class: "muted", style: "font-size:11px;margin-top:4px" }, "Každá akce stojí 1 bod: úprava pohybu (jiná rychlost nebo směr), otočka, lasery, torpédo, mina."),
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
        aiming
          ? "Míříš: pohyb myši kreslí dráhu (směr podle polohy, rychlost podle vzdálenosti; kolečko / 1–5 rychlost zamkne, K = otočka). Kliknutím potvrď, Esc zruší."
          : "Klikni na svou loď a nakresli dráhu myší. Bez označení loď poletí tak, jak je nakresleno.",
      ),
      h(
        "div",
        { class: "legend" },
        h("span", { style: `color:${DIFFICULTY_COLOR.green}` }, "■ zelený +1 stres"),
        h("span", { style: `color:${DIFFICULTY_COLOR.white}` }, "■ bílý"),
        h("span", { style: `color:${DIFFICULTY_COLOR.red}` }, "■ červený −1"),
        h("span", { style: `color:${DIFFICULTY_COLOR.danger}` }, `■ nebezpečný −2, −${STRESS.dangerHullPercent} % trupu`),
      ),
      !locked && !aiming ? h("button", { style: "margin-top:6px", onclick: () => cb.aim(ship.id) }, "Nakreslit manévr") : null,
    ),
  );

  /* ---- zbraně ---- */
  const targetName = (id: string | undefined) => {
    if (!id) return "";
    const s = m.state.ships.find((x) => x.id === id);
    if (s) return s.name;
    return m.state.torpedoes.some((t) => t.id === id) ? "torpédo" : "";
  };
  const weaponLines: HTMLElement[] = [];
  for (const a of ACTIONS) {
    if (!a.active(o)) continue;
    let text = a.label;
    if (a.id === "torpedo" && o.special?.type === "torpedo") {
      text += o.special.targetId ? ` → ${targetName(o.special.targetId)}` : o.special.point ? ` → bod [${Math.round(o.special.point.x)}, ${Math.round(o.special.point.y)}]` : " – vyber cíl";
    }
    const extra: HTMLElement[] = [];
    if (a.id === "mine" && o.special?.type === "mine") {
      const timer = o.special.timer;
      const opt = (label: string, value: number | undefined) =>
        h("button", { class: timer === value ? "active" : "", disabled: locked, onclick: () => cb.setOrders(ship.id, { special: { type: "mine", timer: value } }) }, label);
      extra.push(
        h("div", { class: "row", style: "margin-top:4px;flex-wrap:wrap" }, h("span", { class: "muted", style: "font-size:12px" }, "výbuch:"), opt("při vstupu", undefined), opt("za 1 kolo", 1), opt("za 2 kola", 2), opt("za 3 kola", 3)),
        h("div", { class: "muted", style: "font-size:11px" }, timer ? "Časovaná mina nereaguje na lodě – vybuchne po odpočtu (odpočet začíná kolem po položení)." : "Vybuchne, až do pole vstoupí loď nebo torpédo (od příštího kola)."),
      );
    }
    weaponLines.push(h("div", {}, h("b", { style: "font-size:13px" }, text), h("div", { class: "muted", style: "font-size:12px" }, a.description), ...extra));
  }
  panel.append(
    h(
      "div",
      { class: "field" },
      h("h3", {}, "2 · Zbraně a otočka"),
      ...(weaponLines.length ? weaponLines : [h("div", { class: "muted", style: "font-size:12px" }, "Nic nevybráno.")]),
      m.picking === "torpedo" ? h("div", { style: "color:var(--yellow);font-size:12px;margin-top:4px" }, "Klikni na nepřátelskou loď/torpédo (žlutý dostřel 320) nebo na bod mapy (do 1200).") : null,
      h("div", { class: "muted", style: "font-size:11px;margin-top:4px" }, "Ikony u konce dráhy: ⚡ lasery · ➤ torpédo · ✹ mina · ⟲ otočka. Klik zapne/vypne, najetím myší vysvětlení."),
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
      h("h3", {}, "3 · Cíl laserů"),
      h("div", { class: "row" }, h("span", { class: "muted", style: "font-size:12px" }, "cíl:"), targetSelect),
      h(
        "div",
        { class: "muted", style: "font-size:12px;margin-top:4px" },
        "Výseč ±20° před přídí po pohybu, dostřel 300 (blízko +1 kostka útoku, daleko +1 obrany). Cíl vybereš i kliknutím na nepřítele. Torpédo jako cíl: střílí se jen na něj.",
      ),
    ),
  );

  const humans = m.state.players.filter((p) => !p.isBot);
  const waiting = humans.filter((p) => !m.ready.includes(p.id) && m.state.ships.some((s) => s.alive && s.ownerId === p.id));
  panel.append(
    h(
      "div",
      { class: "ready-bar" },
      locked
        ? h("button", { onclick: () => cb.unready() }, "Změnit rozkazy")
        : h("button", { class: "primary", onclick: () => cb.ready() }, my.length > 1 ? "Odeslat rozkazy všech lodí (Enter)" : "Připraven (Enter)"),
      h("div", { class: "waiting" }, waiting.length ? `Čeká se na: ${waiting.map((p) => p.name).join(", ")}` : "Všichni připraveni, vyhodnocuji…"),
    ),
  );

  root.append(panel);
}
