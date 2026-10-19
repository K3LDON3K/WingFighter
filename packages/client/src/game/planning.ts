import {
  dist,
  hullOf,
  LOCK_RANGE,
  maneuverLabel,
  TEAM_COLORS,
  TORPEDO,
  type ActionOrder,
  type GameState,
  type Maneuver,
  type Ship,
  type ShipOrders,
  type SpecialOrder,
} from "@spacegame/shared";
import { clear, h } from "../dom.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  ready(): void;
  unready(): void;
  hoverManeuver(man: Maneuver | null): void;
  pickingTorpedoTarget(on: boolean): void;
}

export interface PlanningModel {
  state: GameState;
  myId: string;
  orders: Map<string, ShipOrders>;
  selectedShipId?: string;
  submitted: boolean;
  ready: string[];
  animating: boolean;
}

const GLYPH: Record<string, string> = { "turn-left": "↰", "bank-left": "↖", straight: "↑", "bank-right": "↗", "turn-right": "↱", koiogran: "⟲" };
const ROWS = ["turn-left", "bank-left", "straight", "bank-right", "turn-right", "koiogran"];

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
  const dial = hullOf(ship.loadout).dial;
  const locked = m.submitted;

  const panel = h("div", { class: "panel" });

  // záložky lodí
  if (my.length > 1) {
    panel.append(
      h(
        "div",
        { class: "ship-tabs" },
        ...my.map((s) => h("button", { class: s.id === ship.id ? "active" : "", onclick: () => cb.select(s.id) }, s.name)),
      ),
    );
  }

  // statistiky
  panel.append(
    h("h2", { style: `color:${TEAM_COLORS[ship.team]}` }, ship.name),
    h(
      "div",
      { class: "stats" },
      h("div", {}, "Trup", h("b", {}, `${ship.hull}/${ship.stats.hull}`)),
      h("div", {}, "Štíty", h("b", {}, `${ship.shields}/${ship.stats.shields}`)),
      h("div", {}, "Torpéda", h("b", {}, String(ship.ammo.torpedoes))),
      h("div", {}, "Miny", h("b", {}, String(ship.ammo.mines))),
    ),
    h("div", {}, ship.stress > 0 ? h("div", { style: "color:var(--red);font-size:12px;margin-bottom:6px" }, `Stres ${ship.stress}: jen zelené/bílé manévry, akce až po zeleném manévru.`) : null),
  );

  // ciferník
  const dialEl = h("div", { class: "dial" });
  for (const row of ROWS) {
    for (let speed = 1; speed <= 5; speed++) {
      const man = dial.find((d) => (d.side ? `${d.kind}-${d.side}` : d.kind) === row && d.speed === speed);
      if (!man) {
        dialEl.append(h("span", {}));
        continue;
      }
      const disabled = locked || (man.difficulty === "red" && ship.stress > 0);
      const btn = h(
        "button",
        {
          class: `${man.difficulty} ${o.maneuverId === man.id ? "active" : ""}`,
          disabled,
          title: maneuverLabel(man),
          onclick: () => cb.setOrders(ship.id, { maneuverId: man.id }),
        },
        GLYPH[row],
        h("small", {}, String(speed)),
      );
      btn.onmouseenter = () => cb.hoverManeuver(man);
      btn.onmouseleave = () => cb.hoverManeuver(null);
      dialEl.append(btn);
    }
  }
  dialEl.append(h("div", { class: "label" }, "zelený = odstraní stres · červený = způsobí stres (bez akce)"));
  panel.append(h("div", { class: "field" }, h("h3", {}, "Manévr"), dialEl));

  // akce
  const actionBtn = (label: string, active: boolean, onclick: () => void, disabled = false) =>
    h("button", { class: active ? "active" : "", disabled: locked || disabled, onclick }, label);
  const setAction = (action?: ActionOrder) => cb.setOrders(ship.id, { action, special: undefined });
  const setSpecial = (special?: SpecialOrder) => cb.setOrders(ship.id, { special, action: undefined });
  const a = o.action;
  const sp = o.special;
  const canAct = ship.stress === 0 || dial.find((d) => d.id === o.maneuverId)?.difficulty === "green";

  const targetSelect = (value: string | undefined, filter: (s: Ship) => boolean, onchange: (id: string) => void) => {
    const list = enemies.filter(filter);
    return h(
      "select",
      { disabled: locked, onchange: (e) => onchange((e.target as HTMLSelectElement).value) },
      h("option", { value: "", selected: !value }, list.length ? "— vyber cíl —" : "nikdo v dosahu"),
      ...list.map((s) => h("option", { value: s.id, selected: s.id === value }, `${s.name} (${Math.round(dist(ship, s))})`)),
    );
  };

  panel.append(
    h(
      "div",
      { class: "field" },
      h("h3", {}, "Akce po pohybu"),
      !canAct ? h("div", { class: "muted", style: "font-size:12px" }, "Stresovaná loď nemůže provést akci.") : null,
      h(
        "div",
        { class: "choices" },
        actionBtn("žádná", !a && !sp, () => setAction(undefined)),
        actionBtn("zaměřit", a?.type === "focus", () => setAction({ type: "focus" }), !canAct),
        actionBtn("úhyb", a?.type === "evade", () => setAction({ type: "evade" }), !canAct),
        actionBtn("zámek", a?.type === "lock", () => setAction({ type: "lock", targetId: a?.type === "lock" ? a.targetId : enemies[0]?.id ?? "" }), !canAct || enemies.length === 0),
        actionBtn("posun ↑", a?.type === "boost" && a.dir === "straight", () => setAction({ type: "boost", dir: "straight" }), !canAct),
        actionBtn("posun ↖", a?.type === "boost" && a.dir === "left", () => setAction({ type: "boost", dir: "left" }), !canAct),
        actionBtn("posun ↗", a?.type === "boost" && a.dir === "right", () => setAction({ type: "boost", dir: "right" }), !canAct),
        actionBtn("úskok ←", a?.type === "barrelRoll" && a.side === "left", () => setAction({ type: "barrelRoll", side: "left" }), !canAct),
        actionBtn("úskok →", a?.type === "barrelRoll" && a.side === "right", () => setAction({ type: "barrelRoll", side: "right" }), !canAct),
      ),
      a?.type === "lock"
        ? h(
            "div",
            { class: "row" },
            h("span", { class: "muted", style: "font-size:12px" }, "Cíl zámku:"),
            targetSelect(
              a.targetId,
              (s) => dist(ship, s) <= LOCK_RANGE,
              (id) => setAction(id ? { type: "lock", targetId: id } : undefined),
            ),
          )
        : null,
    ),
    h(
      "div",
      { class: "field" },
      h("h3", {}, "Speciální zbraň (místo akce)"),
      h(
        "div",
        { class: "choices" },
        actionBtn(
          `torpédo (${ship.ammo.torpedoes})`,
          sp?.type === "torpedo",
          () => {
            const first = enemies.find((s) => dist(ship, s) <= TORPEDO.lockRange);
            setSpecial({ type: "torpedo", targetId: first?.id ?? "" });
            cb.pickingTorpedoTarget(true);
          },
          !canAct || ship.ammo.torpedoes <= 0,
        ),
        actionBtn(`mina (${ship.ammo.mines})`, sp?.type === "mine", () => setSpecial({ type: "mine" }), !canAct || ship.ammo.mines <= 0),
      ),
      sp?.type === "torpedo"
        ? h(
            "div",
            { class: "row" },
            h("span", { class: "muted", style: "font-size:12px" }, "Cíl torpéda:"),
            targetSelect(
              sp.targetId,
              (s) => dist(ship, s) <= TORPEDO.lockRange,
              (id) => setSpecial(id ? { type: "torpedo", targetId: id } : undefined),
            ),
          )
        : null,
      sp?.type === "torpedo" && !sp.targetId ? h("div", { style: "color:var(--yellow);font-size:12px" }, "Vyber cíl v zaměřovacím dostřelu (žlutá kružnice), jinak se torpédo nevypustí.") : null,
      sp?.type === "mine" ? h("div", { class: "muted", style: "font-size:12px" }, "Mina zůstane na místě, kde loď kolo začínala. Aktivuje se příští kolo – i pro tebe.") : null,
    ),
    h(
      "div",
      { class: "field" },
      h("h3", {}, "Lasery"),
      h(
        "div",
        { class: "row" },
        actionBtn(o.fire ? "pálit: ano" : "pálit: ne", o.fire, () => cb.setOrders(ship.id, { fire: !o.fire })),
        h("span", { class: "muted", style: "font-size:12px" }, "preferovaný cíl:"),
        targetSelect(
          o.preferredTargetId,
          () => true,
          (id) => cb.setOrders(ship.id, { preferredTargetId: id || undefined }),
        ),
      ),
      h("div", { class: "muted", style: "font-size:12px;margin-top:4px" }, "Střílí se po pohybu na preferovaný cíl, pokud je ve výseči (±20°, dostřel 300); jinak na nejbližšího nepřítele ve výseči."),
    ),
  );

  // připraven
  const humans = m.state.players.filter((p) => !p.isBot);
  const waiting = humans.filter((p) => !m.ready.includes(p.id) && m.state.ships.some((s) => s.alive && s.ownerId === p.id));
  panel.append(
    h(
      "div",
      { class: "ready-bar" },
      locked
        ? h("button", { onclick: () => cb.unready() }, "Změnit rozkazy")
        : h("button", { class: "primary", onclick: () => cb.ready() }, my.length > 1 ? "Odeslat rozkazy všech lodí" : "Připraven"),
      h("div", { class: "waiting" }, waiting.length ? `Čeká se na: ${waiting.map((p) => p.name).join(", ")}` : "Všichni připraveni, vyhodnocuji…"),
    ),
  );

  root.append(panel);
}
