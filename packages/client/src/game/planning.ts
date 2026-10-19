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
  chooseAction(shipId: string, actionId: string): void;
  pickTarget(shipId: string): void;
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

function bar(label: string, value: number, max: number, color: string) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  return h(
    "div",
    { class: "bar" },
    h("div", { class: "bar-label" }, h("span", {}, label), h("span", {}, `${value}/${max}`)),
    h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: `width:${pct}%;background:${color}` })),
  );
}

/** Spodní lišta: stav lodi, manévr, zbraně, spuštění kola. */
export function renderBottomBar(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
  clear(root);
  const my = m.state.ships.filter((s) => s.alive && s.ownerId === m.myId);
  const ship = my.find((s) => s.id === m.selectedShipId) ?? my[0];
  const humans = m.state.players.filter((p) => !p.isBot);
  const waiting = humans.filter((p) => !m.ready.includes(p.id) && m.state.ships.some((s) => s.alive && s.ownerId === p.id));

  if (m.state.status === "finished") return;
  if (m.animating) {
    root.append(h("div", { class: "bb-section bb-status" }, h("div", { class: "bb-big" }, "Vyhodnocení kola"), h("div", { class: "muted" }, "Sleduj mapu…")));
    return;
  }
  if (!ship) {
    root.append(h("div", { class: "bb-section bb-status" }, h("div", { class: "bb-big" }, "Pozorovatel"), h("div", { class: "muted" }, "Všechny tvoje lodě byly zničeny. Bitva pokračuje.")));
    return;
  }

  const o = m.orders.get(ship.id)!;
  const locked = m.submitted;
  const man = resolveManeuver(hullOf(ship.loadout).profile, o.maneuverId, ship.speed);
  const acts = actionList(ship, o);
  const aiming = m.aimingShipId === ship.id;

  /* ---- stav lodi ---- */
  const pips = h("div", { class: "pips", title: "Stresové body: červený manévr −1, nebezpečný −2, zelený +1" });
  for (let i = 0; i < STRESS.max; i++) pips.append(h("span", { class: i < ship.stressPoints ? "pip on" : "pip" }));
  const status = h(
    "div",
    { class: "bb-section bb-ship" },
    my.length > 1 ? h("div", { class: "ship-tabs" }, ...my.map((s) => h("button", { class: s.id === ship.id ? "active" : "", onclick: () => cb.select(s.id) }, s.name))) : null,
    h("div", { class: "bb-name", style: `color:${TEAM_COLORS[ship.team]}` }, ship.name),
    bar("Trup", ship.hull, ship.stats.hull, ship.hull <= ship.stats.hull * 0.3 ? "#ef4444" : "#22c55e"),
    bar("Štíty", ship.shields, ship.stats.shields, "#60a5fa"),
    h(
      "div",
      { class: "bb-row" },
      h("span", { class: "muted" }, "Stres "),
      pips,
      h("span", { class: "muted", style: "margin-left:10px" }, `Rychlost ${ship.speed}`),
      h("span", { class: "muted", style: "margin-left:10px" }, `➤ ${ship.ammo.torpedoes} · ✹ ${ship.ammo.mines}`),
    ),
  );

  /* ---- manévr ---- */
  const maneuver = h(
    "div",
    { class: "bb-section bb-maneuver" },
    h("div", { class: "bb-title" }, "Manévr"),
    man
      ? h("div", { style: `color:${DIFFICULTY_COLOR[man.difficulty]};font-size:13px` }, maneuverLabel(man), h("div", { class: "muted", style: "font-size:11px" }, DIFFICULTY_LABEL[man.difficulty]))
      : h("div", { style: "color:var(--red)" }, "Neplatný manévr"),
    man && stressCost(man.difficulty) > ship.stressPoints ? h("div", { style: "color:var(--red);font-size:11px" }, "Nedostatek stresových bodů.") : null,
    h("button", { class: aiming ? "active" : "", disabled: locked, title: "Nebo klikni přímo na loď na mapě", onclick: () => cb.aim(ship.id) }, aiming ? "Kreslím… (klik = potvrdit)" : "Nakreslit dráhu"),
  );

  /* ---- zbraně ---- */
  const targetName = (id: string | undefined) => {
    if (!id) return "";
    const s = m.state.ships.find((x) => x.id === id);
    if (s) return s.name;
    return m.state.torpedoes.some((t) => t.id === id) ? "torpédo" : "";
  };
  const enemies = m.state.ships.filter((s) => s.alive && s.team !== ship.team);
  const enemyTorpedoes = m.state.torpedoes.filter((t) => t.team !== ship.team);
  const targetSelect = (value: string | undefined, ships: Ship[], torps: Torpedo[], placeholder: string, onchange: (id: string) => void) =>
    h(
      "select",
      { disabled: locked, onchange: (e) => onchange((e.target as HTMLSelectElement).value) },
      h("option", { value: "", selected: !value }, placeholder),
      ...ships.map((s) => h("option", { value: s.id, selected: s.id === value }, `${s.name} (${Math.round(dist(ship, s))})`)),
      ...torps.map((t) => h("option", { value: t.id, selected: t.id === value }, `Torpédo ${t.id.slice(-3)} (${Math.round(dist(ship, t))})`)),
    );

  const buttons = h("div", { class: "bb-weapons" });
  for (const a of ACTIONS) {
    const active = a.active(o);
    const why = a.disabled(ship, m.state, o);
    buttons.append(
      h(
        "button",
        {
          class: `bb-weapon ${active ? "active" : ""}`,
          disabled: locked || (!!why && !active),
          title: `${a.label}\n${a.description}${why ? `\nNelze: ${why}.` : ""}`,
          onclick: () => cb.chooseAction(ship.id, a.id),
        },
        h("span", { class: "glyph" }, a.glyph),
        h("span", { class: "lbl" }, a.label.replace(/ \(1 akce\)/, "")),
      ),
    );
  }

  const details = h("div", { class: "bb-details" });
  if (o.fire) {
    details.append(
      h(
        "div",
        { class: "bb-row" },
        h("span", { class: "muted" }, "⚡ cíl:"),
        targetSelect(o.preferredTargetId, enemies, enemyTorpedoes, "nejbližší ve výseči", (id) => cb.setOrders(ship.id, { preferredTargetId: id || undefined })),
        h("span", { class: "muted" }, "· dostřel 300 ve výseči (modře na mapě)"),
      ),
    );
  }
  if (o.special?.type === "torpedo") {
    const sp = o.special;
    const inRange = enemies.filter((s) => dist(ship, s) <= 320);
    const torpsInRange = enemyTorpedoes.filter((t) => dist(ship, t) <= 320);
    details.append(
      h(
        "div",
        { class: "bb-row" },
        h("span", { class: "muted" }, "➤ cíl:"),
        targetSelect(sp.targetId, inRange, torpsInRange, sp.point ? `bod [${Math.round(sp.point.x)}, ${Math.round(sp.point.y)}]` : "— vyber —", (id) =>
          cb.setOrders(ship.id, { special: id ? { type: "torpedo", targetId: id } : { type: "torpedo" }, preferredTargetId: id || o.preferredTargetId }),
        ),
        h("button", { class: `small ${m.picking === "torpedo" ? "active" : ""}`, disabled: locked, onclick: () => cb.pickTarget(ship.id) }, "vybrat na mapě"),
        !sp.targetId && !sp.point ? h("span", { style: "color:var(--yellow)" }, "klikni na nepřítele (do 320) nebo na bod mapy (do 1200)") : null,
      ),
    );
  }
  if (o.special?.type === "mine") {
    const timer = o.special.timer;
    const opt = (label: string, value: number | undefined) =>
      h("button", { class: `small ${timer === value ? "active" : ""}`, disabled: locked, onclick: () => cb.setOrders(ship.id, { special: { type: "mine", timer: value } }) }, label);
    details.append(
      h(
        "div",
        { class: "bb-row" },
        h("span", { class: "muted" }, "✹ výbuch:"),
        opt("při vstupu", undefined),
        opt("za 1 kolo", 1),
        opt("za 2 kola", 2),
        opt("za 3 kola", 3),
        h("span", { class: "muted" }, "· pole na startu lodi (na mapě)"),
      ),
    );
  }

  const weapons = h(
    "div",
    { class: "bb-section bb-actions" },
    h(
      "div",
      { class: "bb-title" },
      `Akce ${acts.length} / ${ACTION_POINTS}`,
      h("span", { class: "muted", style: "font-weight:400;margin-left:8px;text-transform:none;letter-spacing:0" }, acts.length ? acts.map((a) => a.label).join(" · ") : "žádná – loď letí dál a nestřílí"),
    ),
    buttons,
    details,
  );

  /* ---- spuštění kola ---- */
  const go = h(
    "div",
    { class: "bb-section bb-go" },
    locked
      ? h("button", { class: "bb-launch waiting", onclick: () => cb.unready() }, h("span", { class: "big" }, "ČEKÁM…"), h("span", { class: "sub" }, "klik = změnit rozkazy"))
      : h("button", { class: "bb-launch", onclick: () => cb.ready() }, h("span", { class: "big" }, "SPUSTIT KOLO"), h("span", { class: "sub" }, "Enter")),
    h("div", { class: "muted", style: "font-size:11px;text-align:center" }, waiting.length ? `Čeká se na: ${waiting.map((p) => p.name).join(", ")}` : "Všichni připraveni"),
  );

  root.append(status, maneuver, weapons, go);
}
