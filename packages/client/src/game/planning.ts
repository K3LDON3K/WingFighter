import {
  ANGLE_STEP,
  dist,
  hullOf,
  isRed,
  LOCK_RANGE,
  makeManeuver,
  MAX_ANGLE,
  maneuverLabel,
  parseManeuverId,
  TEAM_COLORS,
  TORPEDO,
  type ActionOrder,
  type Difficulty,
  type GameState,
  type Ship,
  type ShipOrders,
  type SpecialOrder,
  type Torpedo,
} from "@spacegame/shared";
import { clear, h } from "../dom.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  setManeuver(shipId: string, speed: number, angle: number, koiogran: boolean): void;
  ready(): void;
  unready(): void;
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

export const DIFFICULTY_COLOR: Record<Difficulty, string> = { green: "#4ade80", white: "#e2e8f0", red: "#f87171", danger: "#fb923c" };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  green: "zelený – odstraní stres",
  white: "bílý",
  red: "červený – stres, bez akce",
  danger: "NEBEZPEČNÝ – stres, bez akce, 1 zranění",
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
  const cur = parseManeuverId(o.maneuverId) ?? { speed: 2, angle: 0, koiogran: false };
  const curMan = makeManeuver(profile, cur.speed, cur.angle, cur.koiogran, ship.speed);

  const panel = h("div", { class: "panel" });

  if (my.length > 1) {
    panel.append(
      h("div", { class: "ship-tabs" }, ...my.map((s) => h("button", { class: s.id === ship.id ? "active" : "", onclick: () => cb.select(s.id) }, s.name))),
    );
  }

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
    h("div", {}, ship.stress > 0 ? h("div", { style: "color:var(--red);font-size:12px;margin-bottom:6px" }, `Stres ${ship.stress}: žádný červený manévr, akce až po zeleném manévru.`) : null),
  );

  /* ---- manévr ---- */
  const allowed = (speed: number, angle: number, k = false) => {
    const mm = makeManeuver(profile, speed, angle, k, ship.speed);
    if (!mm) return null;
    if (isRed(mm.difficulty) && ship.stress > 0) return null;
    return mm;
  };
  const speedRow = h("div", { class: "choices" });
  for (let s = 1; s <= profile.maxSpeed; s++) {
    const mm = allowed(s, cur.koiogran ? 0 : cur.angle, cur.koiogran) ?? allowed(s, 0);
    const color = mm ? DIFFICULTY_COLOR[mm.difficulty] : undefined;
    speedRow.append(
      h(
        "button",
        {
          class: cur.speed === s ? "active" : "",
          disabled: locked || !mm,
          style: color ? `border-color:${color}` : "",
          title: `Rychlost ${s}${s === ship.speed ? " (aktuální)" : ""}`,
          onclick: () => cb.setManeuver(ship.id, s, cur.koiogran ? 0 : cur.angle, cur.koiogran),
        },
        `${s}${s === ship.speed ? "•" : ""}`,
      ),
    );
  }
  const dirRow = h("div", { class: "choices dir" });
  for (let a = -MAX_ANGLE; a <= MAX_ANGLE; a += ANGLE_STEP) {
    const mm = allowed(cur.speed, a);
    dirRow.append(
      h(
        "button",
        {
          class: !cur.koiogran && cur.angle === a ? "active" : "",
          disabled: locked || !mm,
          style: mm ? `border-color:${DIFFICULTY_COLOR[mm.difficulty]}` : "",
          title: mm ? maneuverLabel(mm) : "loď to nezvládne",
          onclick: () => cb.setManeuver(ship.id, cur.speed, a, false),
        },
        a === 0 ? "↑" : `${a < 0 ? "↰" : "↱"}${Math.abs(a)}`,
      ),
    );
  }
  const kList = profile.koiogranSpeeds.map((s) => ({ s, mm: allowed(s, 0, true) }));
  panel.append(
    h(
      "div",
      { class: "field" },
      h("h3", {}, "Manévr"),
      h("div", { class: "muted", style: "font-size:11px;margin-bottom:6px" }, "Rychlost (• = aktuální; změna o 2+ je červená)"),
      speedRow,
      h("div", { class: "muted", style: "font-size:11px;margin-bottom:6px" }, "Směr (změna kurzu ve stupních)"),
      dirRow,
      h(
        "div",
        { class: "choices" },
        ...kList.map(({ s, mm }) =>
          h(
            "button",
            {
              class: cur.koiogran && cur.speed === s ? "active" : "",
              disabled: locked || !mm,
              style: mm ? `border-color:${DIFFICULTY_COLOR[mm.difficulty]}` : "",
              onclick: () => cb.setManeuver(ship.id, s, 0, true),
            },
            `⟲ otočka ${s}`,
          ),
        ),
      ),
      curMan
        ? h(
            "div",
            { style: `font-size:12px;color:${DIFFICULTY_COLOR[curMan.difficulty]}` },
            `${maneuverLabel(curMan)} · ${DIFFICULTY_LABEL[curMan.difficulty]}`,
          )
        : h("div", { style: "font-size:12px;color:var(--red)" }, "Neplatný manévr – vyber jiný."),
      h("div", { class: "muted", style: "font-size:11px;margin-top:4px" }, "Na mapě: klikni na svou loď → pohyb myši = směr, kolečko = rychlost, klik = potvrdit. Nebo táhni od lodi."),
    ),
  );

  /* ---- akce ---- */
  const actionBtn = (label: string, active: boolean, onclick: () => void, disabled = false) =>
    h("button", { class: active ? "active" : "", disabled: locked || disabled, onclick }, label);
  const setAction = (action?: ActionOrder) => cb.setOrders(ship.id, { action, special: undefined });
  const setSpecial = (special?: SpecialOrder) => cb.setOrders(ship.id, { special, action: undefined });
  const a = o.action;
  const sp = o.special;
  const canAct = ship.stress === 0 || curMan?.difficulty === "green";
  const redChosen = !!curMan && isRed(curMan.difficulty);

  const targetSelect = (
    value: string | undefined,
    ships: Ship[],
    torps: Torpedo[],
    onchange: (id: string) => void,
  ) => {
    const empty = ships.length + torps.length === 0;
    return h(
      "select",
      { disabled: locked, onchange: (e) => onchange((e.target as HTMLSelectElement).value) },
      h("option", { value: "", selected: !value }, empty ? "nikdo v dosahu" : "— vyber cíl —"),
      ...ships.map((s) => h("option", { value: s.id, selected: s.id === value }, `${s.name} (${Math.round(dist(ship, s))})`)),
      ...torps.map((t) => h("option", { value: t.id, selected: t.id === value }, `Torpédo ${t.id.slice(-3)} (${Math.round(dist(ship, t))})`)),
    );
  };

  panel.append(
    h(
      "div",
      { class: "field" },
      h("h3", {}, "Akce po pohybu"),
      !canAct ? h("div", { class: "muted", style: "font-size:12px" }, "Stresovaná loď nemůže provést akci.") : null,
      redChosen ? h("div", { class: "muted", style: "font-size:12px" }, "Po červeném manévru akce nebude.") : null,
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
              enemies.filter((s) => dist(ship, s) <= LOCK_RANGE),
              [],
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
              enemies.filter((s) => dist(ship, s) <= TORPEDO.lockRange),
              enemyTorpedoes.filter((t) => dist(ship, t) <= TORPEDO.lockRange),
              (id) => setSpecial(id ? { type: "torpedo", targetId: id } : undefined),
            ),
          )
        : null,
      sp?.type === "torpedo" && !sp.targetId ? h("div", { style: "color:var(--yellow);font-size:12px" }, "Vyber cíl v zaměřovacím dostřelu (žlutá kružnice) – loď nebo nepřátelské torpédo.") : null,
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
        h("span", { class: "muted", style: "font-size:12px" }, "cíl:"),
        targetSelect(o.preferredTargetId, enemies, enemyTorpedoes, (id) => cb.setOrders(ship.id, { preferredTargetId: id || undefined })),
      ),
      h(
        "div",
        { class: "muted", style: "font-size:12px;margin-top:4px" },
        "Výseč ±20°, dostřel 300. Loď jako cíl: když není ve výseči, střílí se na nejbližšího nepřítele. Torpédo jako cíl: střílí se jen na něj.",
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
        : h("button", { class: "primary", disabled: !curMan, onclick: () => cb.ready() }, my.length > 1 ? "Odeslat rozkazy všech lodí" : "Připraven"),
      h("div", { class: "waiting" }, waiting.length ? `Čeká se na: ${waiting.map((p) => p.name).join(", ")}` : "Všichni připraveni, vyhodnocuji…"),
    ),
  );

  root.append(panel);
}
