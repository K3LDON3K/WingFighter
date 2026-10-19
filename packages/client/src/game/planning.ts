import {
  RULES,
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
import { icon, label, segBar } from "../icons.ts";
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
  minePick?: "side" | "timer" | null;
}

export const DIFFICULTY_COLOR: Record<Difficulty, string> = { green: "#4ade80", white: "#e2e8f0", red: "#f87171", danger: "#fb923c" };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  green: "zelený – vrátí 1 stresový bod",
  white: "bílý – bez vlivu",
  red: "červený – stojí 1 stresový bod",
  danger: `NEBEZPEČNÝ – stojí 2 body a ${STRESS.dangerHullPercent} % trupu`,
};
const DIFFICULTY_SHORT: Record<Difficulty, string> = { green: "zelený", white: "bílý", red: "červený", danger: "nebezpečný" };
const ACTION_ICON: Record<string, string> = { laser: "laser", torpedo: "torpedo", mine: "mine", koiogran: "turn", evade: "evade" };

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
        { class: "pnl bb-status" },
        h("div", { class: "bb-big" }, icon(m.animating ? "play" : "wait", "#7dd3fc", 18), label(m.animating ? "Vyhodnocení kola" : "Pozorovatel")),
        h("div", { class: "txt muted" }, m.animating ? "Sleduj mapu…" : "Všechny tvoje lodě byly zničeny. Bitva pokračuje."),
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
  const status = h(
    "div",
    { class: "pnl bb-ship" },
    h(
      "div",
      { class: "bb-head" },
      h("span", { class: "bb-name txt", style: `color:${TEAM_COLORS[ship.team]}` }, ship.name),
      my.length > 1
        ? h("div", { class: "ship-tabs" }, ...my.map((s, i) => h("button", { class: `px ${s.id === ship.id ? "on" : ""}`, title: s.name, onclick: () => cb.select(s.id) }, String(i + 1))))
        : h("span", { class: "muted", style: "margin-left:auto" }, "1/1"),
    ),
    h("div", { class: "bb-row", title: `Trup ${ship.hull}/${ship.stats.hull}` }, icon("hull", "#4ade80"), segBar(20, Math.round((20 * ship.hull) / ship.stats.hull), ship.hull <= ship.stats.hull * 0.3 ? "#ef4444" : "#22c55e", "#14341f"), h("span", { class: "num" }, String(ship.hull))),
    h("div", { class: "bb-row", title: `Štíty ${ship.shields}/${ship.stats.shields}` }, icon("shield", "#60a5fa"), segBar(20, Math.round((20 * ship.shields) / Math.max(1, ship.stats.shields)), "#3b82f6", "#132449"), h("span", { class: "num" }, String(ship.shields))),
    h(
      "div",
      { class: "bb-row" },
      h("span", { class: "stat", title: "Stresové body: červený manévr −1, nebezpečný −2, zelený +1" }, icon("stress", "#f472b6"), segBar(STRESS.max, ship.stressPoints, "#f472b6", "#3b1a2e")),
      h("span", { class: "stat", title: "Aktuální rychlost" }, icon("speed", "#94a3b8"), String(ship.speed)),
      h("span", { class: "stat", title: "Torpéda" }, icon("torpedo", "#94a3b8"), String(ship.ammo.torpedoes)),
      h("span", { class: "stat", title: "Miny" }, icon("mine", "#94a3b8"), String(ship.ammo.mines)),
    ),
  );

  /* ---- 2. manévr ---- */
  const dcolor = man ? DIFFICULTY_COLOR[man.difficulty] : "#f87171";
  const maneuver = h(
    "div",
    { class: "pnl bb-maneuver" },
    h("div", { class: "ttl" }, label("Manévr")),
    h(
      "div",
      { class: "man-readout", title: man ? DIFFICULTY_LABEL[man.difficulty] : "Neplatný manévr" },
      h("span", { class: "man-glyph", style: `color:${dcolor}` }, angleGlyph(cur.angle, cur.koiogran)),
      h("span", { class: "man-speed" }, String(cur.speed)),
      h("span", { class: "man-angle" }, cur.koiogran ? "180°" : `${Math.abs(cur.angle)}°`),
      h("span", { class: "man-diff", style: `color:${dcolor}` }, label(man ? (stressCost(man.difficulty) > ship.stressPoints ? "chybí stres" : DIFFICULTY_SHORT[man.difficulty]) : "neplatný")),
    ),
    h("button", { class: `px ${aiming ? "on" : ""}`, disabled: locked, title: "Klikni na loď na mapě, nebo sem. Pohyb myši = dráha, klik = potvrdit.", onclick: () => cb.aim(ship.id) }, icon(aiming ? "check" : "pen", "currentColor", 12), label(aiming ? "potvrdit" : "nakreslit")),
  );

  /* ---- 3. akce ---- */
  const apips = h("div", { class: "apip" });
  for (let i = 0; i < RULES.actionPoints; i++) apips.append(h("i", { class: i < acts.length ? "on" : "" }));
  const buttons = h("div", { class: "bb-weapons" });
  for (const a of ACTIONS) {
    const active = a.active(o);
    const why = a.disabled(ship, m.state, o);
    buttons.append(
      h(
        "button",
        {
          class: `px bb-weapon ${active ? "on" : ""}`,
          disabled: locked || (!!why && !active),
          title: `${a.label}\n${a.description}${why ? `\nNelze: ${why}.` : ""}`,
          onclick: () => cb.chooseAction(ship.id, a.id),
        },
        icon(ACTION_ICON[a.id] ?? "target", "currentColor", 24),
        h("span", { class: "lbl" }, label(a.label.replace(/ \(1 akce\)/, "").replace(" 180°", "").replace("Úhybný manévr", "Úhyb"))),
      ),
    );
  }
  const details = h("div", { class: "bb-details" });
  const seg = (content: Node | string, active: boolean, title: string, onclick: () => void) => h("button", { class: `px seg ${active ? "on" : ""}`, disabled: locked, title, onclick }, content);
  if (o.special?.type === "torpedo") {
    const sp = o.special;
    const tname = sp.targetId ? (m.state.ships.find((x) => x.id === sp.targetId)?.name ?? "torpédo") : null;
    details.append(
      icon("target", sp.targetId || sp.point ? "#4ade80" : "#fbbf24"),
      sp.targetId
        ? h("span", { class: "txt" }, tname)
        : sp.point
          ? h("span", {}, `[${Math.round(sp.point.x)}, ${Math.round(sp.point.y)}]`)
          : h("span", { class: "warn" }, label("klikni na cíl: loď ≤ 320 · bod ≤ 1200")),
    );
  } else if (o.special?.type === "mine") {
    const timer = o.special.timer;
    const side: MineSide = o.special.side ?? "behind";
    const setMine = (patch: Partial<{ timer: number | undefined; side: MineSide }>) =>
      cb.setOrders(ship.id, { special: { type: "mine", timer: "timer" in patch ? patch.timer : timer, side: patch.side ?? side } });
    details.append(
      icon("mine", "#94a3b8"),
      h(
        "div",
        { class: "segs-btn", title: "Kam minu odhodit" },
        seg(icon("left", "currentColor", 12), side === "left", "vlevo", () => setMine({ side: "left" })),
        seg(icon("down", "currentColor", 12), side === "behind", "za sebe", () => setMine({ side: "behind" })),
        seg(icon("right", "currentColor", 12), side === "right", "vpravo", () => setMine({ side: "right" })),
      ),
      h(
        "div",
        { class: "segs-btn", title: "Výbuch: při vstupu do pole, nebo časovaný" },
        seg(icon("target", "currentColor", 12), timer === undefined, "při vstupu do pole", () => setMine({ timer: undefined })),
        seg("1", timer === 1, "za 1 kolo", () => setMine({ timer: 1 })),
        seg("2", timer === 2, "za 2 kola", () => setMine({ timer: 2 })),
        seg("3", timer === 3, "za 3 kola", () => setMine({ timer: 3 })),
      ),
    );
    if (timer) details.append(h("span", { class: "muted" }, icon("clock", "#94a3b8", 12), ` ${timer}`));
    if (m.minePick === "side") details.append(h("span", { class: "warn" }, label("← klikni na mapě, kam minu odhodit")));
    else if (m.minePick === "timer") details.append(h("span", { class: "warn" }, label("← klikni na mapě na čas výbuchu (✕ = jiné místo)")));
  } else if (o.fire) {
    const tname = o.preferredTargetId ? (m.state.ships.find((x) => x.id === o.preferredTargetId)?.name ?? "torpédo") : null;
    details.append(icon("target", "#4ade80"), h("span", { class: "txt" }, tname ?? "nejbližší ve výseči"), h("span", { class: "muted" }, label("· střílí na začátku kola · klik na nepřítele = cíl")));
  } else {
    details.append(h("span", { class: "muted" }, "—"));
  }
  const actions = h(
    "div",
    { class: "pnl bb-actions" },
    h("div", { class: "bb-head" }, h("span", { class: "ttl" }, label("Akce")), apips, h("span", { class: "muted bb-acts" }, label(acts.map((a) => a.label).join(" · ")))),
    buttons,
    details,
  );

  /* ---- 4. spuštění kola ---- */
  const go = h(
    "div",
    { class: "pnl bb-go" },
    locked
      ? h("button", { class: "px bb-launch waiting", onclick: () => cb.unready() }, icon("wait", "#e2e8f0", 20), h("span", { class: "big" }, label("Čekám")), h("span", { class: "sub" }, label("klik = upravit")))
      : h("button", { class: "px bb-launch", onclick: () => cb.ready() }, icon("play", "#fff", 20), h("span", { class: "big" }, label("Spustit"), h("br"), label("kolo")), h("span", { class: "sub" }, "ENTER")),
    h("div", { class: "bb-wait muted txt", title: waiting.map((p) => p.name).join(", ") }, waiting.length ? `čeká: ${waiting.map((p) => p.name).join(", ")}` : "všichni připraveni"),
  );

  root.append(status, maneuver, actions, go);
}
