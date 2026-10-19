import {
  defaultOrders,
  findManeuver,
  hullOf,
  TEAM_COLORS,
  TEAM_NAMES,
  type GameState,
  type Maneuver,
  type RoomState,
  type RoomSummary,
  type ShipOrders,
  type TurnResult,
} from "@spacegame/shared";
import { clear, h } from "./dom.ts";
import { describeEvents, TurnAnimation } from "./game/animation.ts";
import { Camera } from "./game/camera.ts";
import { renderPlanning } from "./game/planning.ts";
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
  hoverManeuver: Maneuver | null;
  pickingTorpedo: boolean;
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
    hoverManeuver: null,
    pickingTorpedo: false,
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
    const o = defaultOrders(s);
    // rozumný výchozí manévr: rovně 2, pálit na nejbližšího
    game.orders.set(s.id, { ...o, maneuverId: findManeuver(hullOf(s.loadout).dial, "straight-2")?.id ?? o.maneuverId, fire: true });
  }
  if (!game.selectedShipId || !my.some((s) => s.id === game!.selectedShipId)) game.selectedShipId = my[0]?.id;
  game.submitted = false;
  game.pickingTorpedo = false;
}

function pumpQueue() {
  if (!game || game.anim || game.queue.length === 0) return;
  const result = game.queue.shift()!;
  game.anim = new TurnAnimation(game.state, result);
  const lines = describeEvents(result, game.state);
  game.submitted = false;
  game.pickingTorpedo = false;
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
  game.pickingTorpedo = false;
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
  mapEl = h("div", { class: "map" }, canvas, hudEl, h("div", { class: "hint" }, "kolečko = zoom · tažení = posun · klik na nepřítele = cíl"), overlayEl);
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
  const dial = hullOf(g.state.ships.find((s) => s.id === sel.id)!.loadout).dial;
  const man = g.hoverManeuver ?? (o ? findManeuver(dial, o.maneuverId) : undefined);
  if (man) overlay.preview = { ship: sel, maneuver: man };
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
        if (!(patch.special?.type === "torpedo")) game!.pickingTorpedo = false;
        renderSide();
      },
      ready: submitOrders,
      unready: () => {
        net.send({ type: "unready" });
        game!.submitted = false;
        renderSide();
      },
      hoverManeuver: (m) => {
        game!.hoverManeuver = m;
      },
      pickingTorpedoTarget: (on) => {
        game!.pickingTorpedo = on;
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
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  c.addEventListener("mousedown", (e) => {
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("mousemove", (e) => {
    if (!cam || !game) return;
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      cam.panBy(dx, dy);
      cam.clampTo(game.state.width, game.state.height);
      lastX = e.clientX;
      lastY = e.clientY;
    } else {
      const rect = c.getBoundingClientRect();
      const w = cam.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      game.hoverShipId = shipAt(w.x, w.y)?.id;
    }
  });
  window.addEventListener("mouseup", () => (dragging = false));
  c.addEventListener("click", (e) => {
    if (moved || !cam || !game || game.anim) return;
    const rect = c.getBoundingClientRect();
    const w = cam.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = shipAt(w.x, w.y);
    if (!hit) return;
    const g = game;
    if (hit.ownerId === playerId) {
      g.selectedShipId = hit.id;
      renderSide();
      return;
    }
    const sel = g.state.ships.find((s) => s.id === g.selectedShipId);
    const o = sel && g.orders.get(sel.id);
    if (!sel || !o || g.submitted || hit.team === sel.team) return;
    if (o.special?.type === "torpedo") {
      g.orders.set(sel.id, { ...o, special: { type: "torpedo", targetId: hit.id }, preferredTargetId: hit.id });
    } else if (o.action?.type === "lock") {
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
      const rect = c.getBoundingClientRect();
      cam.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      cam.clampTo(game.state.width, game.state.height);
    },
    { passive: false },
  );
}

function shipAt(x: number, y: number) {
  if (!game) return undefined;
  const view = game.anim ? game.anim.view : game.view;
  let best: { id: string; d: number } | undefined;
  for (const s of view.ships) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= s.radius + 10 && (!best || d < best.d)) best = { id: s.id, d };
  }
  return best ? game.state.ships.find((s) => s.id === best!.id) : undefined;
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
