import {
  ACTION_POINTS,
  actionList,
  hullOf,
  parseManeuverId,
  resolveManeuver,
  STRESS,
  stressCost,
  TEAM_COLORS,
  type Difficulty,
  type GameState,
  type MineSide,
  type ShipOrders,
} from "@spacegame/shared";
import { clear, h } from "../dom.ts";
import { ACTIONS } from "./actions.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  chooseAction(shipId: string, actionId: string): void;
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
const DIFFICULTY_SHORT: Record<Difficulty, string> = { green: "zelený", white: "bílý", red: "červený", danger: "nebezpečný" };

function bar(icon: string, value: number, max: number, color: string, title: string) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  return h(
    "div",
    { class: "bar", title },
    h("span", { class: "bar-icon" }, icon),
    h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: `width:${pct}%;background:${color}` })),
    h("span", { class: "bar-num" }, `${value}`),
  );
}

function angleGlyph(angle: number, koiogran: boolean): string {
  if (koiogran) return "⟲";
  if (angle === 0) return "↑";
  const a = Math.abs(angle);
  if (a <= 45) return angle < 0 ? "↖" : "↗";
  return angle < 0 ? "↰" : "↱";
}

/** Spodní lišta: stav lodi, manévr, zbraně, spuštění kola. Pevné rozměry – text nemění velikost UI. */
export function renderBottomBar(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
  clear(root);
  const my = m.state.ships.filter((s) => s.alive && s.ownerId === m.myId);
  const ship = my.find((s) => s.id === m.selectedShipId) ?? my[0];
  const humans = m.state.players.filter((p) => !p.isBot);
  const waiting = humans.filter((p) => !m.ready.includes(p.id) && m.state.ships.some((s) => s.alive && s.ownerId === p.id));

  if (m.state.status === "finished") return;
  if (m.animating || !ship) {
    root.append(
      h(
        "div",
        { class: "bb-section bb-status" },
        h("div", { class: "bb-big" }, m.animating ? "⏵ Vyhodnocení kola" : "◌ Pozorovatel"),
        h("div", { class: "muted" }, m.animating ? "Sleduj mapu…" : "Všechny tvoje lodě byly zničeny. Bitva pokračuje."),
      ),
    );
    return;
  }

  const o = m.orders.get(ship.id)!;
  const locked = m.submitted;
  const man = resolveManeuver(hullOf(ship.loadout).profile, o.maneuverId, ship.speed);
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false };
  const acts = actionList(ship, o);
  const aiming = m.aimingShipId === ship.id;

  /* ---- 1. loď ---- */
  const pips = h("div", { class: "pips", title: `Stresové body ${ship.stressPoints}/${STRESS.max}: červený manévr −1, nebezpečný −2, zelený +1` });
  for (let i = 0; i < STRESS.max; i++) pips.append(h("span", { class: i < ship.stressPoints ? "pip on" : "pip" }));
  const status = h(
    "div",
    { class: "bb-section bb-ship" },
    h(
      "div",
      { class: "bb-head" },
      h("span", { class: "bb-name", style: `color:${TEAM_COLORS[ship.team]}` }, ship.name),
      my.length > 1 ? h("div", { class: "ship-tabs" }, ...my.map((s, i) => h("button", { class: s.id === ship.id ? "active" : "", title: s.name, onclick: () => cb.select(s.id) }, String(i + 1)))) : null,
    ),
    bar("⛨", ship.hull, ship.stats.hull, ship.hull <= ship.stats.hull * 0.3 ? "#ef4444" : "#22c55e", `Trup ${ship.hull}/${ship.stats.hull}`),
    bar("◍", ship.shields, ship.stats.shields, "#60a5fa", `Štíty ${ship.shields}/${ship.stats.shields}`),
    h(
      "div",
      { class: "bb-row bb-stats" },
      h("span", { class: "stat", title: "Stresové body" }, "⚡", pips),
      h("span", { class: "stat", title: "Aktuální rychlost" }, "➜", h("b", {}, String(ship.speed))),
      h("span", { class: "stat", title: "Torpéda" }, "➤", h("b", {}, String(ship.ammo.torpedoes))),
      h("span", { class: "stat", title: "Miny" }, "✹", h("b", {}, String(ship.ammo.mines))),
    ),
  );

  /* ---- 2. manévr ---- */
  const dcolor = man ? DIFFICULTY_COLOR[man.difficulty] : "#f87171";
  const maneuver = h(
    "div",
    { class: "bb-section bb-maneuver" },
    h("div", { class: "bb-title" }, "Manévr"),
    h(
      "div",
      { class: "man-readout", title: man ? DIFFICULTY_LABEL[man.difficulty] : "Neplatný manévr" },
      h("span", { class: "man-glyph", style: `color:${dcolor}` }, angleGlyph(cur.angle, cur.koiogran)),
      h("div", { class: "man-nums" }, h("span", { class: "man-speed" }, String(cur.speed)), h("span", { class: "man-angle" }, cur.koiogran ? "180°" : `${Math.abs(cur.angle)}°`)),
      h("span", { class: "man-dot", style: `background:${dcolor}` }),
      h("span", { class: "man-diff", style: `color:${dcolor}` }, man ? (stressCost(man.difficulty) > ship.stressPoints ? "chybí stres" : DIFFICULTY_SHORT[man.difficulty]) : "neplatný"),
    ),
    h("button", { class: `bb-btn ${aiming ? "active" : ""}`, disabled: locked, title: "Klikni na loď na mapě, nebo sem. Pohyb myši = dráha, klik = potvrdit.", onclick: () => cb.aim(ship.id) }, aiming ? "✓ potvrdit" : "✎ nakreslit"),
  );

  /* ---- 3. akce ---- */
  const apips = h("div", { class: "pips" });
  for (let i = 0; i < ACTION_POINTS; i++) apips.append(h("span", { class: i < acts.length ? "pip ap on" : "pip ap" }));
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
        h("span", { class: "lbl" }, a.label.replace(/ \(1 akce\)/, "").replace(" 180°", "")),
      ),
    );
  }
  const details = h("div", { class: "bb-details" });
  const seg = (label: string, active: boolean, title: string, onclick: () => void) => h("button", { class: `seg ${active ? "active" : ""}`, disabled: locked, title, onclick }, label);
  if (o.special?.type === "torpedo") {
    const sp = o.special;
    const tname = sp.targetId ? (m.state.ships.find((x) => x.id === sp.targetId)?.name ?? "torpédo") : null;
    details.append(
      h("span", { class: "det-icon" }, "➤"),
      sp.targetId
        ? h("span", { class: "det-ok" }, `◎ ${tname}`)
        : sp.point
          ? h("span", { class: "det-ok" }, `✛ [${Math.round(sp.point.x)}, ${Math.round(sp.point.y)}]`)
          : h("span", { class: "det-warn" }, "klikni na cíl: loď ≤ 320 · bod ≤ 1200"),
    );
  } else if (o.special?.type === "mine") {
    const timer = o.special.timer;
    const side: MineSide = o.special.side ?? "behind";
    const setMine = (patch: Partial<{ timer: number | undefined; side: MineSide }>) =>
      cb.setOrders(ship.id, { special: { type: "mine", timer: "timer" in patch ? patch.timer : timer, side: patch.side ?? side } });
    details.append(
      h("span", { class: "det-icon" }, "✹"),
      h(
        "div",
        { class: "segs", title: "Kam minu odhodit" },
        seg("↙", side === "left", "vlevo", () => setMine({ side: "left" })),
        seg("↓", side === "behind", "za sebe", () => setMine({ side: "behind" })),
        seg("↘", side === "right", "vpravo", () => setMine({ side: "right" })),
      ),
      h(
        "div",
        { class: "segs", title: "Výbuch: při vstupu do pole, nebo časovaný" },
        seg("◉", timer === undefined, "při vstupu do pole", () => setMine({ timer: undefined })),
        seg("⏱1", timer === 1, "za 1 kolo", () => setMine({ timer: 1 })),
        seg("⏱2", timer === 2, "za 2 kola", () => setMine({ timer: 2 })),
        seg("⏱3", timer === 3, "za 3 kola", () => setMine({ timer: 3 })),
      ),
    );
  } else if (o.fire) {
    const tname = o.preferredTargetId ? (m.state.ships.find((x) => x.id === o.preferredTargetId)?.name ?? "torpédo") : null;
    details.append(h("span", { class: "det-icon" }, "⚡"), h("span", { class: "det-ok" }, tname ? `◎ ${tname}` : "◎ nejbližší ve výseči"), h("span", { class: "muted" }, "· klik na nepřítele = cíl"));
  } else {
    details.append(h("span", { class: "muted" }, "—"));
  }
  const actions = h(
    "div",
    { class: "bb-section bb-actions" },
    h("div", { class: "bb-head" }, h("span", { class: "bb-title" }, "Akce"), apips, h("span", { class: "muted bb-acts" }, acts.map((a) => a.label).join(" · "))),
    buttons,
    details,
  );

  /* ---- 4. spuštění kola ---- */
  const go = h(
    "div",
    { class: "bb-section bb-go" },
    locked
      ? h("button", { class: "bb-launch waiting", onclick: () => cb.unready() }, h("span", { class: "big" }, "⏳ ČEKÁM"), h("span", { class: "sub" }, "klik = upravit"))
      : h("button", { class: "bb-launch", onclick: () => cb.ready() }, h("span", { class: "big" }, "▶ SPUSTIT KOLO"), h("span", { class: "sub" }, "Enter")),
    h("div", { class: "bb-wait muted", title: waiting.map((p) => p.name).join(", ") }, waiting.length ? `čeká: ${waiting.map((p) => p.name).join(", ")}` : "všichni připraveni"),
  );

  root.append(status, maneuver, actions, go);
}
