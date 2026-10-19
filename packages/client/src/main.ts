import {
  ANGLE_STEP,
  defaultOrders,
  hullOf,
  isRed,
  makeManeuver,
  maneuverEnd,
  MAX_ANGLE,
  MOVE_UNIT,
  normalizeAngle,
  parseManeuverId,
  resolveManeuver,
  TEAM_COLORS,
  TEAM_NAMES,
  type GameState,
  type RoomState,
  type RoomSummary,
  type ShipOrders,
  type TurnResult,
} from "@spacegame/shared";
import { clear, h } from "./dom.ts";
import { describeEvents, TurnAnimation } from "./game/animation.ts";
import { Camera } from "./game/camera.ts";
import { DIFFICULTY_COLOR, renderPlanning } from "./game/planning.ts";
import { Renderer, type Overlay } from "./game/renderer.ts";
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
  selectedShipId?: string;
  submitted: boolean;
  ready: string[];
  log: { turn: number; lines: string[] }[];
  /** Míření myší: pohyb = směr, kolečko = rychlost, klik = potvrdit. */
  aiming: { shipId: string; drag: boolean } | null;
  hoverShipId?: string;
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
    submitted: false,
    ready: [],
    log: [],
    aiming: null,
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
  const my = game.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  for (const s of my) {
    // výchozí manévr: stejná rychlost jako minule, rovně; pálit
    const profile = hullOf(s.loadout).profile;
    const o = defaultOrders(s);
    const keep = makeManeuver(profile, s.speed, 0, false, s.speed);
    game.orders.set(s.id, { ...o, maneuverId: keep && !(isRed(keep.difficulty) && s.stress > 0) ? keep.id : o.maneuverId, fire: true });
  }
  if (!game.selectedShipId || !my.some((s) => s.id === game!.selectedShipId)) game.selectedShipId = my[0]?.id;
  game.submitted = false;
  game.aiming = null;
}

/** Nastaví manévr; úhel ořízne na to, co loď při dané rychlosti zvládne. */
function setManeuver(shipId: string, speed: number, angle: number, koiogran: boolean) {
  if (!game) return;
  const ship = game.state.ships.find((s) => s.id === shipId);
  const o = game.orders.get(shipId);
  if (!ship || !o) return;
  const profile = hullOf(ship.loadout).profile;
  speed = Math.max(1, Math.min(profile.maxSpeed, Math.round(speed)));
  let man = makeManeuver(profile, speed, angle, koiogran, ship.speed);
  if (!man && !koiogran) {
    const max = profile.maxAngle[speed];
    const clamped = Math.sign(angle) * Math.min(Math.abs(angle), max);
    man = makeManeuver(profile, speed, Math.round(clamped / ANGLE_STEP) * ANGLE_STEP, false, ship.speed);
  }
  if (!man) return;
  if (isRed(man.difficulty) && ship.stress > 0) return;
  game.orders.set(shipId, { ...o, maneuverId: man.id });
  renderSide();
}

function pumpQueue() {
  if (!game || game.anim || game.queue.length === 0) return;
  const result = game.queue.shift()!;
  game.anim = new TurnAnimation(game.state, result);
  const lines = describeEvents(result, game.state);
  game.submitted = false;
  game.aiming = null;
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
  if (!game) return;
  net.send({ type: "submitOrders", orders: [...game.orders.values()] });
  game.submitted = true;
  game.aiming = null;
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
let mapEl: HTMLElement | null = null;
let raf = 0;
let resizeObs: ResizeObserver | null = null;

function mountGame() {
  clear(app);
  canvas = h("canvas");
  hudEl = h("div", { class: "hud" });
  overlayEl = h("div");
  mapEl = h("div", { class: "map" }, canvas, hudEl, h("div", { class: "hint" }, "klik na svou loď / tažení od ní = manévr · kolečko = rychlost (při míření) nebo zoom · tažení = posun · klik na nepřítele či torpédo = cíl · K = otočka · Esc = zrušit míření"), overlayEl);
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
    const first = cam.viewW === 0;
    cam.viewW = w;
    cam.viewH = hgt;
    if (first || !fitted) {
      cam.fit(game!.state.width, game!.state.height);
      fitted = true;
    }
  };
  let fitted = false;
  resizeObs = new ResizeObserver(resize);
  resizeObs.observe(mapEl);
  resize();
  cam.fit(game!.state.width, game!.state.height);
  fitted = true;
  // začít přiblížené na vlastní loď
  const mine = game!.state.ships.find((s) => s.ownerId === playerId && s.alive);
  if (mine && cam.zoom < 0.8) {
    cam.zoom = 0.8;
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
  canvas = renderer = cam = sideEl = hudEl = overlayEl = mapEl = null;
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
  renderer.draw(game.state, view, cam, overlay, now, window.devicePixelRatio || 1);
  renderHud();
}

function buildOverlay(view: ViewModel): Overlay {
  const g = game!;
  const me = g.state.players.find((p) => p.id === playerId);
  const overlay: Overlay = { myTeam: me?.team, hoverShipId: g.hoverShipId };
  if (g.anim || g.state.status === "finished") return overlay;
  const sel = view.ships.find((s) => s.id === g.selectedShipId);
  if (!sel) return overlay;
  overlay.selectedShipId = sel.id;
  overlay.showArc = true;
  const o = g.orders.get(sel.id);
  const ship = g.state.ships.find((s) => s.id === sel.id)!;
  const profile = hullOf(ship.loadout).profile;
  const man = o ? resolveManeuver(profile, o.maneuverId, ship.speed) : null;
  if (man) overlay.preview = { ship: sel, maneuver: man };
  overlay.aiming = !!g.aiming;
  if (!g.submitted && man) {
    const dots: { x: number; y: number; color: string }[] = [];
    for (let a = -MAX_ANGLE; a <= MAX_ANGLE; a += ANGLE_STEP) {
      const mm = makeManeuver(profile, man.speed, a, false, ship.speed);
      if (!mm || (isRed(mm.difficulty) && ship.stress > 0)) continue;
      const e = maneuverEnd(ship, mm);
      dots.push({ x: e.x, y: e.y, color: DIFFICULTY_COLOR[mm.difficulty] });
    }
    overlay.reachable = dots;
  }
  if (o?.special?.type === "torpedo") {
    overlay.showTorpedoRange = true;
    overlay.targetId = o.special.targetId || undefined;
  } else if (o?.action?.type === "lock") {
    overlay.targetId = o.action.targetId;
  } else {
    overlay.targetId = o?.preferredTargetId;
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

  // konec hry
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
      selectedShipId: game.selectedShipId,
      submitted: game.submitted,
      ready: game.ready,
      animating: !!game.anim,
    },
    {
      select: (id) => {
        game!.selectedShipId = id;
        renderSide();
      },
      setOrders: (id, patch) => {
        const cur = game!.orders.get(id);
        if (!cur) return;
        game!.orders.set(id, { ...cur, ...patch });
        renderSide();
      },
      setManeuver,
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

function bindInput(c: HTMLCanvasElement) {
  let panning = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let downOnOwnShip: string | null = null;

  const worldPos = (e: MouseEvent) => {
    const rect = c.getBoundingClientRect();
    return cam!.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  /** Nastaví směr (a při tažení i rychlost) podle polohy myši vůči lodi. */
  const aimAt = (wx: number, wy: number) => {
    const g = game;
    if (!g?.aiming) return;
    const ship = g.state.ships.find((s) => s.id === g.aiming!.shipId);
    const o = g.orders.get(ship?.id ?? "");
    if (!ship || !o) return;
    const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false };
    const bearing = normalizeAngle(Math.atan2(wy - ship.y, wx - ship.x) - ship.heading);
    // koncový bod oblouku leží na polovině úhlu zatáčky → úhel = 2 × směr k myši
    let angle = Math.round(((bearing * 180) / Math.PI) * 2 / ANGLE_STEP) * ANGLE_STEP;
    angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));
    let speed = cur.speed;
    if (g.aiming.drag) {
      const d = Math.hypot(wx - ship.x, wy - ship.y);
      speed = Math.max(1, Math.min(5, Math.round(d / (MOVE_UNIT * 0.9))));
    }
    setManeuver(ship.id, speed, angle, false);
  };

  c.addEventListener("mousedown", (e) => {
    if (!game || !cam) return;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    const w = worldPos(e);
    const hit = entityAt(w.x, w.y);
    if (hit?.kind === "ship" && hit.ownerId === playerId && !game.submitted && !game.anim) {
      downOnOwnShip = hit.id;
      game.selectedShipId = hit.id;
      renderSide();
      return;
    }
    panning = true;
  });

  window.addEventListener("mousemove", (e) => {
    if (!cam || !game) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (panning) {
      cam.panBy(dx, dy);
      cam.clampTo(game.state.width, game.state.height);
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    const w = worldPos(e);
    if (downOnOwnShip && moved && !game.aiming) game.aiming = { shipId: downOnOwnShip, drag: true };
    if (game.aiming) aimAt(w.x, w.y);
    else game.hoverShipId = entityAt(w.x, w.y)?.id;
  });

  window.addEventListener("mouseup", () => {
    panning = false;
    if (!game) return;
    if (downOnOwnShip) {
      if (game.aiming?.drag) {
        game.aiming = null; // tažení potvrzuje
        renderSide();
      } else if (!moved) {
        // klik na vlastní loď: zapnout/vypnout míření myší
        game.aiming = game.aiming?.shipId === downOnOwnShip ? null : { shipId: downOnOwnShip, drag: false };
      }
      downOnOwnShip = null;
    }
  });

  c.addEventListener("click", (e) => {
    if (moved || !cam || !game || game.anim) return;
    const g = game;
    const w = worldPos(e);
    const hit = entityAt(w.x, w.y);
    if (g.aiming) {
      if (hit?.kind === "ship" && hit.id === g.aiming.shipId) return; // řeší mouseup
      g.aiming = null; // klik kamkoli potvrdí
      renderSide();
      return;
    }
    if (!hit || (hit.kind === "ship" && hit.ownerId === playerId)) return;
    const sel = g.state.ships.find((s) => s.id === g.selectedShipId);
    const o = sel && g.orders.get(sel.id);
    if (!sel || !o || g.submitted || hit.team === sel.team) return;
    if (o.special?.type === "torpedo") {
      g.orders.set(sel.id, { ...o, special: { type: "torpedo", targetId: hit.id }, preferredTargetId: hit.id });
    } else if (o.action?.type === "lock" && hit.kind === "ship") {
      g.orders.set(sel.id, { ...o, action: { type: "lock", targetId: hit.id }, preferredTargetId: hit.id });
    } else {
      g.orders.set(sel.id, { ...o, preferredTargetId: hit.id });
    }
    renderSide();
  });

  c.addEventListener(
    "wheel",
    (e) => {
      if (!cam || !game) return;
      e.preventDefault();
      if (game.aiming && !game.submitted) {
        const o = game.orders.get(game.aiming.shipId);
        const cur = o && parseManeuverId(o.maneuverId);
        if (cur) setManeuver(game.aiming.shipId, cur.speed + (e.deltaY < 0 ? 1 : -1), cur.koiogran ? 0 : cur.angle, cur.koiogran);
        return;
      }
      const rect = c.getBoundingClientRect();
      cam.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      cam.clampTo(game.state.width, game.state.height);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (!game || game.submitted || game.anim) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const id = game.aiming?.shipId ?? game.selectedShipId;
    const o = id && game.orders.get(id);
    const cur = o ? parseManeuverId(o.maneuverId) : null;
    if (!id || !cur) return;
    if (e.key === "Escape") {
      game.aiming = null;
    } else if (/^[1-5]$/.test(e.key)) {
      setManeuver(id, Number(e.key), cur.koiogran ? 0 : cur.angle, cur.koiogran);
    } else if (e.key === "ArrowLeft") {
      setManeuver(id, cur.speed, (cur.koiogran ? 0 : cur.angle) - ANGLE_STEP, false);
    } else if (e.key === "ArrowRight") {
      setManeuver(id, cur.speed, (cur.koiogran ? 0 : cur.angle) + ANGLE_STEP, false);
    } else if (e.key === "ArrowUp") {
      setManeuver(id, cur.speed + 1, cur.koiogran ? 0 : cur.angle, cur.koiogran);
    } else if (e.key === "ArrowDown") {
      setManeuver(id, cur.speed - 1, cur.koiogran ? 0 : cur.angle, cur.koiogran);
    } else if (e.key === "k" || e.key === "K") {
      const ship = game.state.ships.find((s) => s.id === id)!;
      const ks = hullOf(ship.loadout).profile.koiogranSpeeds;
      const sp = ks.includes(cur.speed) ? cur.speed : ks[0];
      setManeuver(id, sp, 0, !cur.koiogran);
    } else return;
    e.preventDefault();
  });
}

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
