import {
  ANGLE_STEP,
  defaultOrders,
  dist,
  hullOf,
  LOCK_RANGE,
  makeManeuver,
  makePath,
  maneuverEnd,
  MAX_ANGLE,
  MOVE_UNIT,
  normalizeAngle,
  parseManeuverId,
  resolveManeuver,
  rightOf,
  stressCost,
  TEAM_COLORS,
  TEAM_NAMES,
  TORPEDO,
  type GameState,
  type Pose,
  type RoomState,
  type RoomSummary,
  type ShipOrders,
  type TurnResult,
} from "@spacegame/shared";
import { clear, h } from "./dom.ts";
import { ACTIONS, actionById, activeAction } from "./game/actions.ts";
import { describeEvents, TurnAnimation } from "./game/animation.ts";
import { Camera } from "./game/camera.ts";
import { DIFFICULTY_COLOR, renderPlanning } from "./game/planning.ts";
import { ICON_RADIUS, Renderer, type IconSpot, type Overlay } from "./game/renderer.ts";
import { viewFromState, type ViewModel } from "./game/view.ts";
import { renderLobby } from "./lobby.ts";
import { Net } from "./net.ts";

/* ------------------------------------------------------------------ */
/* Stav aplikace                                                        */
/* ------------------------------------------------------------------ */

interface GameSession {
  state: GameState;
  view: ViewModel;
  anim: TurnAnimation | null;
  queue: TurnResult[];
  orders: Map<string, ShipOrders>;
  /** Lodě s potvrzeným manévrem (pak se vybírá akce). */
  confirmed: Set<string>;
  /** Rychlost zamknutá kolečkem/klávesou – myš pak mění jen směr. */
  speedLock: Map<string, number>;
  selectedShipId?: string;
  submitted: boolean;
  ready: string[];
  log: { turn: number; lines: string[] }[];
  /** Čeká se na kliknutí na cíl. */
  picking: "torpedo" | "lock" | null;
  hoverId?: string;
  hoverIcon?: string;
  mouse: { x: number; y: number; sx: number; sy: number } | null;
  icons: IconSpot[];
}

const app = document.getElementById("app")!;
let playerName = (() => {
  try {
    return localStorage.getItem("spacegame.name") ?? "";
  } catch {
    return "";
  }
})();
let playerId = "";
let connected = false;
let rooms: RoomSummary[] = [];
let room: RoomState | null = null;
let error = "";
let errorTimer: number | undefined;
let game: GameSession | null = null;
let screen: "lobby" | "game" = "lobby";

const net = new Net(() => playerName || "Pilot");
net.onStatus = (c) => {
  connected = c;
  render();
};

function setName(n: string) {
  playerName = n;
  try {
    localStorage.setItem("spacegame.name", n);
  } catch {
    /* ignore */
  }
}

function showError(msg: string) {
  error = msg;
  render();
  clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    error = "";
    render();
  }, 5000);
}

net.on((msg) => {
  switch (msg.type) {
    case "welcome":
      playerId = msg.playerId;
      if (!playerName) setName(msg.name);
      break;
    case "rooms":
      rooms = msg.rooms;
      break;
    case "room":
      room = msg.room;
      if (!room || !room.inGame) {
        if (game) leaveGame();
      }
      break;
    case "gameStart":
      startGame(msg.state);
      break;
    case "gameState":
      if (!game) startGame(msg.state);
      else {
        game.state = msg.state;
        game.view = viewFromState(msg.state);
        resetOrders();
      }
      game!.ready = msg.ready;
      game!.submitted = msg.ready.includes(playerId);
      break;
    case "planningStatus":
      if (game) {
        game.ready = msg.ready;
        game.submitted = msg.ready.includes(playerId);
      }
      break;
    case "turnResult":
      if (game) {
        game.queue.push(msg.result);
        pumpQueue();
      }
      break;
    case "error":
      showError(msg.message);
      return;
  }
  render();
});

/* ------------------------------------------------------------------ */
/* Hra                                                                  */
/* ------------------------------------------------------------------ */

function startGame(state: GameState) {
  game = {
    state,
    view: viewFromState(state),
    anim: null,
    queue: [],
    orders: new Map(),
    confirmed: new Set(),
    speedLock: new Map(),
    submitted: false,
    ready: [],
    log: [],
    picking: null,
    mouse: null,
    icons: [],
  };
  resetOrders();
  screen = "game";
  mountGame();
}

function leaveGame() {
  game = null;
  screen = "lobby";
  unmountGame();
}

function resetOrders() {
  if (!game) return;
  game.orders.clear();
  game.confirmed.clear();
  game.speedLock.clear();
  game.picking = null;
  const my = game.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  for (const s of my) game.orders.set(s.id, defaultOrders(s));
  if (!game.selectedShipId || !my.some((s) => s.id === game!.selectedShipId)) game.selectedShipId = my[0]?.id;
  game.submitted = false;
  ensureVisible(game.selectedShipId);
}

/** Když je loď mimo záběr, vycentruje na ni kameru. */
function ensureVisible(shipId: string | undefined) {
  if (!game || !cam || !shipId) return;
  const s = game.state.ships.find((x) => x.id === shipId);
  if (!s) return;
  const sp = cam.toScreen(s.x, s.y);
  const m = 120;
  if (sp.x < m || sp.y < m || sp.x > cam.viewW - m || sp.y > cam.viewH - m) {
    cam.x = s.x - cam.viewW / cam.zoom / 2;
    cam.y = s.y - cam.viewH / cam.zoom / 2;
    cam.clampTo(game.state.width, game.state.height);
  }
}

/** Nastaví manévr; úhel ořízne na to, co loď při dané rychlosti zvládne. Vrací true při úspěchu. */
function setManeuver(shipId: string, speed: number, angle: number, koiogran: boolean): boolean {
  if (!game) return false;
  const ship = game.state.ships.find((s) => s.id === shipId);
  const o = game.orders.get(shipId);
  if (!ship || !o) return false;
  const profile = hullOf(ship.loadout).profile;
  speed = Math.max(1, Math.min(profile.maxSpeed, Math.round(speed)));
  let man = makeManeuver(profile, speed, angle, koiogran, ship.speed);
  if (!man && !koiogran) {
    const max = profile.maxAngle[speed];
    const clamped = Math.sign(angle) * Math.min(Math.abs(angle), max);
    man = makeManeuver(profile, speed, Math.round(clamped / ANGLE_STEP) * ANGLE_STEP, false, ship.speed);
  }
  if (!man) return false;
  if (man.id !== o.maneuverId) {
    game.orders.set(shipId, { ...o, maneuverId: man.id });
    renderSide();
  }
  return true;
}

function pumpQueue() {
  if (!game || game.anim || game.queue.length === 0) return;
  const result = game.queue.shift()!;
  game.anim = new TurnAnimation(game.state, result);
  const lines = describeEvents(result, game.state);
  game.submitted = false;
  game.picking = null;
  renderSide();
  const finish = () => {
    if (!game) return;
    game.log.push({ turn: result.turn, lines });
    game.state = result.state;
    game.view = game.anim!.finalView();
    game.anim = null;
    game.ready = [];
    resetOrders();
    renderSide();
    pumpQueue();
  };
  (game.anim as TurnAnimation & { onDone?: () => void }).onDone = finish;
}

function submitOrders() {
  if (!game || game.submitted) return;
  const my = game.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  if (!my.every((s) => game!.confirmed.has(s.id))) return;
  net.send({ type: "submitOrders", orders: [...game.orders.values()] });
  game.submitted = true;
  game.picking = null;
  renderSide();
}

/* ------------------------------------------------------------------ */
/* Herní obrazovka (canvas + panel)                                     */
/* ------------------------------------------------------------------ */

let canvas: HTMLCanvasElement | null = null;
let renderer: Renderer | null = null;
let cam: Camera | null = null;
let sideEl: HTMLElement | null = null;
let hudEl: HTMLElement | null = null;
let overlayEl: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;
let mapEl: HTMLElement | null = null;
let raf = 0;
let resizeObs: ResizeObserver | null = null;

function mountGame() {
  clear(app);
  canvas = h("canvas");
  hudEl = h("div", { class: "hud" });
  overlayEl = h("div");
  tooltipEl = h("div", { class: "tooltip", style: "display:none" });
  mapEl = h(
    "div",
    { class: "map" },
    canvas,
    hudEl,
    h("div", { class: "hint" }, "myš u lodi = dráha · klik = potvrdit · pak ikony akcí · klik na nepřítele = cíl · tažení = posun · ⌘/Ctrl+kolečko = zoom · Enter = připraven"),
    tooltipEl,
    overlayEl,
  );
  sideEl = h("div", { class: "side" });
  app.append(h("div", { class: "game" }, mapEl, sideEl));

  const ctx = canvas.getContext("2d")!;
  renderer = new Renderer(canvas, ctx);
  cam = new Camera(mapEl.clientWidth, mapEl.clientHeight);
  const resize = () => {
    if (!canvas || !mapEl || !cam) return;
    const dpr = window.devicePixelRatio || 1;
    const w = mapEl.clientWidth;
    const hgt = mapEl.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    cam.viewW = w;
    cam.viewH = hgt;
  };
  resizeObs = new ResizeObserver(resize);
  resizeObs.observe(mapEl);
  resize();
  cam.fit(game!.state.width, game!.state.height);
  const mine = game!.state.ships.find((s) => s.ownerId === playerId && s.alive);
  if (mine && cam.zoom < 0.9) {
    cam.zoom = 0.9;
    cam.x = mine.x - cam.viewW / cam.zoom / 2;
    cam.y = mine.y - cam.viewH / cam.zoom / 2;
    cam.clampTo(game!.state.width, game!.state.height);
  }

  bindInput(canvas);
  renderSide();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    frame(now);
  };
  raf = requestAnimationFrame(loop);
}

function unmountGame() {
  cancelAnimationFrame(raf);
  resizeObs?.disconnect();
  canvas = renderer = cam = sideEl = hudEl = overlayEl = mapEl = tooltipEl = null;
  render();
}

function frame(now: number) {
  if (!game || !renderer || !cam || !canvas) return;
  if (game.anim) {
    game.anim.update(now);
    if (game.anim.finished) {
      const done = (game.anim as TurnAnimation & { onDone?: () => void }).onDone;
      done?.();
    }
  }
  const view = game.anim ? game.anim.view : game.view;
  const overlay = buildOverlay(view);
  if (game.hoverIcon && !game.icons.some((i) => i.id === game!.hoverIcon)) game.hoverIcon = undefined;
  renderer.draw(game.state, view, cam, overlay, now, window.devicePixelRatio || 1);
  renderHud();
  renderTooltip();
}

/** Kam loď skočí přídavným posunem / úskokem z konce manévru. */
function actionGhost(end: Pose, o: ShipOrders): Pose | undefined {
  const a = o.action;
  if (!a || o.special) return undefined;
  if (a.type === "boost") {
    const angle = a.dir === "straight" ? 0 : a.dir === "left" ? -Math.PI / 4 : Math.PI / 4;
    return makePath(end, MOVE_UNIT, angle)(1);
  }
  if (a.type === "barrelRoll") {
    const r = rightOf(end.heading);
    const sign = a.side === "left" ? -1 : 1;
    return { x: end.x + r.x * MOVE_UNIT * sign, y: end.y + r.y * MOVE_UNIT * sign, heading: end.heading };
  }
  return undefined;
}

function buildOverlay(view: ViewModel): Overlay {
  const g = game!;
  const me = g.state.players.find((p) => p.id === playerId);
  const overlay: Overlay = { myTeam: me?.team, hoverId: g.hoverId };
  g.icons = [];
  if (g.anim || g.state.status === "finished") return overlay;
  const sel = view.ships.find((s) => s.id === g.selectedShipId);
  if (!sel) return overlay;
  overlay.selectedShipId = sel.id;
  const o = g.orders.get(sel.id);
  const ship = g.state.ships.find((s) => s.id === sel.id)!;
  const profile = hullOf(ship.loadout).profile;
  const man = o ? resolveManeuver(profile, o.maneuverId, ship.speed) : null;
  if (!o || !man) return overlay;
  const confirmed = g.confirmed.has(sel.id);
  overlay.preview = { ship: sel, maneuver: man };
  overlay.aiming = !confirmed && !g.submitted;
  overlay.picking = g.picking ?? undefined;

  if (!g.submitted && !confirmed) {
    const dots: { x: number; y: number; color: string }[] = [];
    for (let a = -MAX_ANGLE; a <= MAX_ANGLE; a += ANGLE_STEP) {
      const mm = makeManeuver(profile, man.speed, a, false, ship.speed);
      if (!mm || stressCost(mm.difficulty) > ship.stressPoints) continue;
      const e = maneuverEnd(ship, mm);
      dots.push({ x: e.x, y: e.y, color: DIFFICULTY_COLOR[mm.difficulty] });
    }
    overlay.reachable = dots;
  }

  const end = maneuverEnd(ship, man);
  if (confirmed && !g.submitted) {
    overlay.actionGhost = actionGhost(end, o);
    // věneček ikon kolem konce dráhy
    const n = ACTIONS.length;
    const ringR = ship.stats.radius + 48 / Math.min(1, cam!.zoom);
    const active = activeAction(o);
    for (let i = 0; i < n; i++) {
      const a = ACTIONS[i];
      const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      g.icons.push({
        id: a.id,
        x: end.x + Math.cos(ang) * ringR,
        y: end.y + Math.sin(ang) * ringR,
        glyph: a.glyph,
        active: a.id === active.id,
        disabled: !!a.disabled(ship, g.state),
        hover: g.hoverIcon === a.id,
      });
    }
    overlay.icons = g.icons;
  }

  if (o.special?.type === "torpedo") {
    overlay.targetId = o.special.targetId;
    overlay.targetPoint = o.special.point;
    if (g.picking === "torpedo") overlay.rangeCircle = { radius: TORPEDO.lockRange, label: "zaměření lodi 320 · bod až 1200" };
  } else if (o.action?.type === "lock") {
    overlay.targetId = o.action.targetId;
    if (g.picking === "lock") overlay.rangeCircle = { radius: LOCK_RANGE, label: "zámek 300" };
  } else {
    overlay.targetId = o.preferredTargetId;
  }
  return overlay;
}

function renderHud() {
  if (!hudEl || !game) return;
  const s = game.state;
  const limit = s.settings.turnLimit ? ` / ${s.settings.turnLimit}` : "";
  const teams = [...new Set(s.ships.map((x) => x.team))].sort((a, b) => a - b);
  const counts = teams
    .map((t) => {
      const alive = s.ships.filter((x) => x.team === t && x.alive).length;
      const label = s.settings.mode === "dm" ? (s.players.find((p) => p.team === t)?.name ?? TEAM_NAMES[t]) : TEAM_NAMES[t];
      return `<span style="color:${TEAM_COLORS[t]}">${label}: ${alive}</span>`;
    })
    .join(" · ");
  const html = `<div class="big">Kolo ${game.anim ? game.anim["result"].turn : s.turn}${limit}</div><div>${counts}</div>`;
  if (hudEl.innerHTML !== html) hudEl.innerHTML = html;

  if (overlayEl) {
    const finished = s.status === "finished" && !game.anim && game.queue.length === 0;
    if (finished && !overlayEl.firstChild) {
      const r = s.result!;
      let title = "Remíza";
      let color = "#e2e8f0";
      if (r.winnerTeam !== null) {
        const name = s.settings.mode === "dm" ? (s.players.find((p) => p.id === r.winnerPlayerId)?.name ?? "?") : TEAM_NAMES[r.winnerTeam];
        title = `Vítězí ${name}`;
        color = TEAM_COLORS[r.winnerTeam];
      }
      const isHost = room?.hostId === playerId;
      overlayEl.append(
        h(
          "div",
          { class: "overlay" },
          h(
            "div",
            { class: "card" },
            h("h2", { style: `color:${color}` }, title),
            h("div", { class: "muted" }, r.reason === "turnLimit" ? "Dosažen limit kol." : "Soupeři zničeni."),
            h("div", { style: "margin-top:16px" }, isHost ? h("button", { class: "primary", onclick: () => net.send({ type: "backToLobby" }) }, "Zpět do místnosti") : h("span", { class: "muted" }, "Host může vrátit všechny do místnosti.")),
          ),
        ),
      );
    } else if (!finished && overlayEl.firstChild) {
      clear(overlayEl);
    }
  }
}

function renderTooltip() {
  if (!tooltipEl || !game || !mapEl) return;
  const a = game.hoverIcon ? actionById(game.hoverIcon) : undefined;
  const sel = game.state.ships.find((s) => s.id === game!.selectedShipId);
  if (!a || !game.mouse || !sel) {
    tooltipEl.style.display = "none";
    return;
  }
  const why = a.disabled(sel, game.state);
  const html = `<b>${a.label}</b>${a.description}${why ? `<div class="warn">Nelze: ${why}.</div>` : ""}`;
  if (tooltipEl.innerHTML !== html) tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";
  const x = Math.min(game.mouse.sx + 16, mapEl.clientWidth - 300);
  const y = Math.min(game.mouse.sy + 16, mapEl.clientHeight - 120);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

function renderSide() {
  if (!sideEl || !game) return;
  clear(sideEl);
  const planning = h("div");
  renderPlanning(
    planning,
    {
      state: game.state,
      myId: playerId,
      orders: game.orders,
      confirmed: game.confirmed,
      selectedShipId: game.selectedShipId,
      submitted: game.submitted,
      ready: game.ready,
      animating: !!game.anim,
      picking: game.picking ?? undefined,
    },
    {
      select: (id) => {
        game!.selectedShipId = id;
        game!.picking = null;
        renderSide();
      },
      setOrders: (id, patch) => {
        const cur = game!.orders.get(id);
        if (!cur) return;
        game!.orders.set(id, { ...cur, ...patch });
        renderSide();
      },
      reaim: (id) => {
        game!.confirmed.delete(id);
        game!.picking = null;
        game!.selectedShipId = id;
        renderSide();
      },
      ready: submitOrders,
      unready: () => {
        net.send({ type: "unready" });
        game!.submitted = false;
        renderSide();
      },
    },
  );
  const log = h("div", { class: "log" });
  for (const entry of game.log.slice(-12)) {
    log.append(h("div", { class: "turn" }, `Kolo ${entry.turn}`));
    for (const line of entry.lines) log.append(h("div", {}, line));
  }
  if (game.log.length === 0) log.append(h("div", {}, "Naplánuj manévr a akci, pak dej Připraven. Vše se vyhodnotí najednou."));
  sideEl.append(planning, log);
  log.scrollTop = log.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* Vstup na mapě                                                        */
/* ------------------------------------------------------------------ */

interface Entity {
  kind: "ship" | "torpedo";
  id: string;
  team: number;
  ownerId?: string;
}

function entityAt(x: number, y: number): Entity | undefined {
  if (!game) return undefined;
  const view = game.anim ? game.anim.view : game.view;
  let best: { e: Entity; d: number } | undefined;
  for (const s of view.ships) {
    const d = Math.hypot(s.x - x, s.y - y);
    const ship = game.state.ships.find((q) => q.id === s.id);
    if (d <= s.radius + 10 && (!best || d < best.d)) best = { e: { kind: "ship", id: s.id, team: s.team, ownerId: ship?.ownerId }, d };
  }
  for (const t of view.torpedoes) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= 14 && (!best || d < best.d)) best = { e: { kind: "torpedo", id: t.id, team: t.team }, d };
  }
  return best?.e;
}

function iconAt(x: number, y: number): IconSpot | undefined {
  if (!game || !cam) return undefined;
  const r = ICON_RADIUS / Math.min(1, cam.zoom) + 3;
  return game.icons.find((ic) => Math.hypot(ic.x - x, ic.y - y) <= r);
}

/** Míření: směr (a bez zámku i rychlost) podle polohy myši vůči lodi. */
function aimAt(wx: number, wy: number) {
  const g = game;
  if (!g || g.submitted) return;
  const id = g.selectedShipId;
  if (!id || g.confirmed.has(id)) return;
  const ship = g.state.ships.find((s) => s.id === id);
  const o = g.orders.get(id);
  if (!ship || !o) return;
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false };
  const d = Math.hypot(wx - ship.x, wy - ship.y);
  if (d < ship.stats.radius + 4) return; // těsně u lodi nic neměnit
  const bearing = normalizeAngle(Math.atan2(wy - ship.y, wx - ship.x) - ship.heading);
  // koncový bod oblouku leží na polovině úhlu zatáčky → úhel = 2 × směr k myši
  let angle = Math.round((((bearing * 180) / Math.PI) * 2) / ANGLE_STEP) * ANGLE_STEP;
  angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));
  const speed = g.speedLock.get(id) ?? Math.max(1, Math.min(5, Math.round(d / (MOVE_UNIT * 0.9))));
  if (cur.koiogran) {
    setManeuver(id, speed, 0, true);
    return;
  }
  setManeuver(id, speed, angle, false);
}

function confirmManeuver(id: string): boolean {
  const g = game!;
  const ship = g.state.ships.find((s) => s.id === id);
  const o = g.orders.get(id);
  if (!ship || !o) return false;
  const man = resolveManeuver(hullOf(ship.loadout).profile, o.maneuverId, ship.speed);
  if (!man || stressCost(man.difficulty) > ship.stressPoints) {
    showError("Na tento manévr nemáš dost stresových bodů.");
    return false;
  }
  g.confirmed.add(id);
  renderSide();
  return true;
}

function chooseIcon(id: string) {
  const g = game!;
  const shipId = g.selectedShipId!;
  const ship = g.state.ships.find((s) => s.id === shipId)!;
  const o = g.orders.get(shipId)!;
  const a = actionById(id);
  if (!a) return;
  if (a.disabled(ship, g.state)) return;
  g.orders.set(shipId, { ...o, ...a.apply(o, ship, g.state) });
  g.picking = a.pick ?? null;
  renderSide();
}

function bindInput(c: HTMLCanvasElement) {
  let panning = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  const worldPos = (e: MouseEvent) => {
    const rect = c.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { ...cam!.toWorld(sx, sy), sx, sy };
  };

  c.addEventListener("mousedown", (e) => {
    if (!game || !cam) return;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    panning = true;
  });

  window.addEventListener("mousemove", (e) => {
    if (!cam || !game) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (panning) {
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) {
        cam.panBy(dx, dy);
        cam.clampTo(game.state.width, game.state.height);
      }
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    if (!c.contains(e.target as Node)) {
      game.mouse = null;
      game.hoverIcon = undefined;
      return;
    }
    const w = worldPos(e);
    game.mouse = w;
    const ic = iconAt(w.x, w.y);
    game.hoverIcon = ic?.id;
    game.hoverId = ic ? undefined : entityAt(w.x, w.y)?.id;
    if (!ic && !game.anim) aimAt(w.x, w.y);
  });

  window.addEventListener("mouseup", () => {
    panning = false;
  });

  c.addEventListener("click", (e) => {
    if (moved || !cam || !game || game.anim || game.submitted) return;
    const g = game;
    const w = worldPos(e);
    const sel = g.state.ships.find((s) => s.id === g.selectedShipId);
    const o = sel && g.orders.get(sel.id);

    // 1) ikona akce
    const ic = iconAt(w.x, w.y);
    if (ic) {
      chooseIcon(ic.id);
      return;
    }
    const hit = entityAt(w.x, w.y);

    // 2) vlastní loď: vybrat / znovu mířit
    if (hit?.kind === "ship" && hit.ownerId === playerId) {
      if (g.selectedShipId === hit.id && g.confirmed.has(hit.id)) g.confirmed.delete(hit.id);
      g.selectedShipId = hit.id;
      g.picking = null;
      renderSide();
      return;
    }
    if (!sel || !o) return;

    // 3) míření: klik potvrdí manévr
    if (!g.confirmed.has(sel.id)) {
      confirmManeuver(sel.id);
      return;
    }

    // 4) výběr cíle
    if (hit && hit.team !== sel.team) {
      if (o.special?.type === "torpedo" && dist(sel, hitPos(hit)) <= TORPEDO.lockRange) {
        g.orders.set(sel.id, { ...o, special: { type: "torpedo", targetId: hit.id }, preferredTargetId: hit.id });
        g.picking = null;
      } else if (o.action?.type === "lock" && hit.kind === "ship" && dist(sel, hitPos(hit)) <= LOCK_RANGE) {
        g.orders.set(sel.id, { ...o, action: { type: "lock", targetId: hit.id }, preferredTargetId: hit.id });
        g.picking = null;
      } else {
        g.orders.set(sel.id, { ...o, preferredTargetId: hit.id });
      }
      renderSide();
      return;
    }
    if (!hit && o.special?.type === "torpedo") {
      if (dist(sel, w) <= TORPEDO.pointRange) {
        g.orders.set(sel.id, { ...o, special: { type: "torpedo", point: { x: Math.round(w.x), y: Math.round(w.y) } } });
        g.picking = null;
        renderSide();
      } else showError("Bod je dál než dolet torpéda (1200).");
    }
  });

  c.addEventListener(
    "wheel",
    (e) => {
      if (!cam || !game) return;
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const id = game.selectedShipId;
      const aiming = id && !game.confirmed.has(id) && !game.submitted && !game.anim;
      if (aiming && !(e.ctrlKey || e.metaKey)) {
        const o = game.orders.get(id);
        const cur = o && parseManeuverId(o.maneuverId);
        if (cur) {
          const sp = Math.max(1, Math.min(5, cur.speed + (e.deltaY < 0 ? 1 : -1)));
          game.speedLock.set(id, sp);
          setManeuver(id, sp, cur.koiogran ? 0 : cur.angle, cur.koiogran);
        }
        return;
      }
      cam.zoomAt(sx, sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      cam.clampTo(game.state.width, game.state.height);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (!game || game.anim) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "Enter") {
      submitOrders();
      return;
    }
    if (game.submitted) return;
    const id = game.selectedShipId;
    const o = id && game.orders.get(id);
    const cur = o ? parseManeuverId(o.maneuverId) : null;
    if (!id || !cur) return;
    if (e.key === "Escape") {
      if (game.picking) game.picking = null;
      else game.confirmed.delete(id);
      game.speedLock.delete(id);
      renderSide();
    } else if (/^[1-5]$/.test(e.key)) {
      game.confirmed.delete(id);
      game.speedLock.set(id, Number(e.key));
      setManeuver(id, Number(e.key), cur.koiogran ? 0 : cur.angle, cur.koiogran);
    } else if (e.key === "k" || e.key === "K") {
      game.confirmed.delete(id);
      const ship = game.state.ships.find((s) => s.id === id)!;
      const ks = hullOf(ship.loadout).profile.koiogranSpeeds;
      const sp = ks.includes(cur.speed) ? cur.speed : ks[0];
      if (!cur.koiogran) game.speedLock.set(id, sp);
      setManeuver(id, sp, 0, !cur.koiogran);
    } else if (e.key === " ") {
      if (!game.confirmed.has(id)) confirmManeuver(id);
    } else return;
    e.preventDefault();
  });
}

function hitPos(hit: Entity): { x: number; y: number } {
  const view = game!.view;
  const s = hit.kind === "ship" ? view.ships.find((x) => x.id === hit.id) : view.torpedoes.find((x) => x.id === hit.id);
  return s ?? { x: 0, y: 0 };
}

/* ------------------------------------------------------------------ */
/* Vykreslení                                                           */
/* ------------------------------------------------------------------ */

function render() {
  if (screen === "game") {
    renderSide();
    return;
  }
  renderLobby(app, { playerId, name: playerName, rooms, room, error, connected }, net, setName);
}

render();
net.connect();

// Ladicí přístup ke stavu (pro automatické testy v prohlížeči).
(window as unknown as { __sg: () => unknown }).__sg = () => ({ game, cam, playerId });
