import {
  RULES,
  actionCost,
  ANGLE_STEP,
  defaultOrders,
  dist,
  hullOf,
  LOCK_RANGE,
  makeManeuver,
  makePath,
  maneuverEnd,
  MAX_ANGLE,
  mineDropPosition,
  MOVE_UNIT,
  normalizeAngle,
  parseManeuverId,
  resolveManeuver,
  rightOf,
  stressCost,
  TEAM_COLORS,
  TEAM_NAMES,
  TORPEDO,
  MINE,
  applyTuning,
  computeStats,
  type GameState,
  type Pose,
  type RoomState,
  type RoomSummary,
  type Segments,
  type ShipOrders,
  type TurnResult,
} from "@spacegame/shared";
import { clear, h } from "./dom.ts";
import { icon, label } from "./icons.ts";
import { actionById } from "./game/actions.ts";
import { describeEvents, TurnAnimation } from "./game/animation.ts";
import { Camera } from "./game/camera.ts";
import { DIFFICULTY_COLOR, renderBottomBar, shieldInHand } from "./game/planning.ts";
import { ICON_RADIUS, Renderer, type IconSpot, type Overlay } from "./game/renderer.ts";
import { viewFromState, type ViewModel } from "./game/view.ts";
import { renderLobby } from "./lobby.ts";
import { renderTuningPanel } from "./tuning-panel.ts";
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
  /** Loď, které se právě kreslí dráha myší (null = nic). */
  aimingShipId: string | null;
  /** Rychlost zamknutá kolečkem/klávesou – myš pak mění jen směr. */
  speedLock: Map<string, number>;
  selectedShipId?: string;
  submitted: boolean;
  ready: string[];
  log: { turn: number; lines: string[] }[];
  /** Čeká se na kliknutí na cíl. */
  picking: "torpedo" | "lock" | null;
  /** Výběr miny na mapě: nejdřív místo, pak čas výbuchu. */
  minePick: "side" | "timer" | null;
  /** Otevřená úprava štítu (–/+ u segmentů v panelu lodi). */
  shieldEdit: boolean;
  inventoryOpen: boolean;
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
let tuningOpen = false;

/** Promítne parametry bitvy do pravidel a přepočítá maxima lodí (klientská kopie). */
function adoptTuning(state: GameState) {
  if (!state.tuning) return;
  applyTuning(state.tuning);
  for (const sh of state.ships) {
    sh.stats = computeStats(sh.loadout);
    sh.hull = Math.min(sh.hull, sh.stats.hull);
    sh.shields = Math.min(sh.shields, sh.stats.shields);
  }
}

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

function showNotice(msg: string) {
  notice = msg;
  render();
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice = "";
    render();
  }, 4000);
}
let notice = "";
let noticeTimer: number | undefined;

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
      adoptTuning(msg.state);
      startGame(msg.state);
      break;
    case "gameState":
      adoptTuning(msg.state);
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
    case "tuning":
      if (game) {
        game.state.tuning = msg.tuning;
        adoptTuning(game.state);
        game.view = game.anim ? game.view : viewFromState(game.state);
        renderSide();
      }
      break;
    case "error":
      showError(msg.message);
      return;
    case "notice":
      showNotice(msg.message);
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
    aimingShipId: null,
    speedLock: new Map(),
    submitted: false,
    ready: [],
    log: [],
    picking: null,
    minePick: null,
    shieldEdit: false,
    inventoryOpen: false,
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
  game.aimingShipId = null;
  game.speedLock.clear();
  game.picking = null;
  game.minePick = null;
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
  if (actionCost(ship, { ...o, maneuverId: man.id }) > RULES.actionPoints) return false;
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
    adoptTuning(game.state);
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
  for (const [id, o] of game.orders) {
    const ship = game.state.ships.find((x) => x.id === id);
    if (ship && shieldInHand(ship, o) > 0) {
      showError(`${ship.name}: nejdřív rozmísti všechny body štítu.`);
      game.selectedShipId = id;
      game.shieldEdit = true;
      renderSide();
      return;
    }
  }
  game.aimingShipId = null;
  game.shieldEdit = false;
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
let barEl: HTMLElement | null = null;
let hudEl: HTMLElement | null = null;
let overlayEl: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;
let tuneEl: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;
let mapEl: HTMLElement | null = null;
let raf = 0;
let resizeObs: ResizeObserver | null = null;

function mountGame() {
  clear(app);
  canvas = h("canvas");
  hudEl = h("div", { class: "hud" });
  overlayEl = h("div");
  tooltipEl = h("div", { class: "tooltip", style: "display:none" });
  tuneEl = h("div", { class: "tune-wrap", style: "display:none" });
  toastEl = h("div", { class: "toast", style: "display:none" });
  barEl = h("div", { class: "bottombar" });
  sideEl = h("div", { class: "maplog" });
  mapEl = h(
    "div",
    { class: "map" },
    canvas,
    hudEl,
    h("div", { class: "hint" }, "KLIK NA LOD = KRESLIT DRAHU · KLIK = POTVRDIT · KLIK NA NEPRITELE = CIL · TAZENI = POSUN · CMD/CTRL+KOLECKO = ZOOM"),
    sideEl,
    h("button", { class: "gear", title: "Ladění parametrů hry", onclick: () => ((tuningOpen = !tuningOpen), renderSide()) }, icon("target", "currentColor", 12), label("ladění")),
    tooltipEl,
    overlayEl,
    tuneEl,
    toastEl,
  );
  app.append(h("div", { class: "game" }, h("div", { class: "mapcol" }, mapEl, barEl)));

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
  canvas = renderer = cam = sideEl = barEl = hudEl = overlayEl = mapEl = tooltipEl = tuneEl = toastEl = null;
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
  if (game.hoverIcon && !game.icons.some((i) => `${i.shipId}:${i.id}` === game!.hoverIcon)) game.hoverIcon = undefined;
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
  // fog of war: dohled vlastního týmu (během animace z aktuálních pozic)
  overlay.vision = view.ships
    .filter((s) => s.team === me?.team)
    .map((s) => ({ x: s.x, y: s.y, r: g.state.ships.find((q) => q.id === s.id)?.stats.vision ?? 960 }));
  if (g.anim || g.state.status === "finished") return overlay;
  overlay.selectedShipId = g.selectedShipId;
  overlay.picking = g.picking ?? undefined;
  overlay.previews = [];

  const my = g.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  for (const ship of my) {
    const vs = view.ships.find((s) => s.id === ship.id);
    const o = g.orders.get(ship.id);
    if (!vs || !o) continue;
    const profile = hullOf(ship.loadout).profile;
    const man = resolveManeuver(profile, o.maneuverId, ship.speed);
    if (!man) continue;
    const aiming = g.aimingShipId === ship.id && !g.submitted;
    overlay.previews.push({ ship: vs, maneuver: man, aiming, fire: !!o.fire });
    const end = maneuverEnd(ship, man);

    if (aiming) {
      const dots: { x: number; y: number; color: string }[] = [];
      for (let a = -MAX_ANGLE; a <= MAX_ANGLE; a += ANGLE_STEP) {
        const mm = makeManeuver(profile, man.speed, a, false, ship.speed);
        if (!mm || stressCost(mm.difficulty) > ship.stressPoints) continue;
        const e = maneuverEnd(ship, mm);
        dots.push({ x: e.x, y: e.y, color: DIFFICULTY_COLOR[mm.difficulty] });
      }
      overlay.reachable = dots;
    }

    if (ship.id === g.selectedShipId) {
      if (o.special?.type === "torpedo") {
        overlay.targetId = o.special.targetId;
        overlay.targetPoint = o.special.point;
        overlay.rangeCircle = { radius: TORPEDO.lockRange, label: "torpédo: zaměření 320 · bod až 1200" };
        overlay.rangeCircle2 = { radius: TORPEDO.pointRange };
      } else {
        overlay.targetId = o.preferredTargetId;
      }
      if (o.special?.type === "mine") {
        const side = o.special.side ?? "behind";
        if (g.minePick === "side") {
          for (const sd of ["left", "behind", "right"] as const) {
            const pos = mineDropPosition(ship, sd);
            g.icons.push({ id: `mine-side:${sd}`, shipId: ship.id, kind: "mine", x: pos.x, y: pos.y, glyph: "", active: sd === side, disabled: false, hover: g.hoverIcon === `${ship.id}:mine-side:${sd}` });
          }
        } else {
          const pos = mineDropPosition(ship, side);
          overlay.mineField = { x: pos.x, y: pos.y, timer: o.special.timer };
          if (g.minePick === "timer") {
            const opts: { id: string; glyph: string; timer: number | undefined }[] = [
              { id: "mine-timer:0", glyph: "◉", timer: undefined },
              { id: "mine-timer:1", glyph: "1", timer: 1 },
              { id: "mine-timer:2", glyph: "2", timer: 2 },
              { id: "mine-timer:3", glyph: "3", timer: 3 },
              { id: "mine-back", glyph: "✕", timer: -1 },
            ];
            // tlačítka časování na odvrácené straně pole (směrem od lodi), v řadě kolmo na ten směr
            const step = 32 / Math.min(1, cam!.zoom);
            const dl = Math.hypot(pos.x - ship.x, pos.y - ship.y) || 1;
            const dx = (pos.x - ship.x) / dl;
            const dy = (pos.y - ship.y) / dl;
            const cx = pos.x + dx * (MINE.radius + 26 / Math.min(1, cam!.zoom));
            const cy = pos.y + dy * (MINE.radius + 26 / Math.min(1, cam!.zoom));
            const sgn = dy < 0 ? -1 : 1; // řada vždy zleva doprava na obrazovce
            opts.forEach((op, i) => {
              const k = (i - 2) * sgn;
              const isBack = op.id === "mine-back";
              g.icons.push({ id: op.id, shipId: ship.id, x: cx + dy * k * step + (isBack ? dy * 6 : 0), y: cy - dx * k * step - (isBack ? dx * 6 : 0), glyph: op.glyph, active: !isBack && o.special?.type === "mine" && o.special.timer === op.timer, disabled: false, hover: g.hoverIcon === `${ship.id}:${op.id}` });
            });
          }
        }
      }
    }
  }
  overlay.icons = g.icons;
  return overlay;
}

function renderHud() {
  if (!hudEl || !game) return;
  const s = game.state;
  const limit = s.settings.turnLimit ? ` / ${s.settings.turnLimit}` : "";
  const myTeam = s.players.find((p) => p.id === playerId)?.team;
  const teams = [...new Set(s.players.map((x) => x.team))].sort((a, b) => a - b);
  const counts = teams
    .map((t) => {
      const alive = s.ships.filter((x) => x.team === t && x.alive).length;
      const label = s.settings.mode === "dm" ? (s.players.find((p) => p.team === t)?.name ?? TEAM_NAMES[t]) : TEAM_NAMES[t];
      return `<span style="color:${TEAM_COLORS[t]}">${label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()}: ${t === myTeam ? alive : `${alive} V DOHLEDU`}</span>`;
    })
    .join(" · ");
  const html = `<div class="big">KOLO ${game.anim ? game.anim["result"].turn : s.turn}${limit}</div><div>${counts}</div>`;
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
            h("h2", { style: `color:${color}` }, title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()),
            h("div", { class: "muted txt" }, r.reason === "turnLimit" ? "Dosažen limit kol." : "Soupeři zničeni."),
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
  const [hShip, hAct] = (game.hoverIcon ?? "").split(":");
  const a = hAct ? actionById(hAct) : undefined;
  const sel = game.state.ships.find((s) => s.id === hShip);
  if (!a || !game.mouse || !sel) {
    tooltipEl.style.display = "none";
    return;
  }
  const why = a.disabled(sel, game.state, game.orders.get(sel.id)!);
  const html = `<b>${a.label}</b>${a.description}${why ? `<div class="warn">Nelze: ${why}.</div>` : ""}`;
  if (tooltipEl.innerHTML !== html) tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";
  const x = Math.min(game.mouse.sx + 16, mapEl.clientWidth - 300);
  const y = Math.min(game.mouse.sy + 16, mapEl.clientHeight - 120);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

function renderSide() {
  if (!sideEl || !barEl || !game) return;
  clear(sideEl);
  if (toastEl) {
    toastEl.textContent = error || notice;
    toastEl.style.display = error || notice ? "block" : "none";
    toastEl.className = `toast ${error ? "err" : "ok"}`;
  }
  if (tuneEl) {
    tuneEl.style.display = tuningOpen ? "block" : "none";
    if (tuningOpen) {
      renderTuningPanel(tuneEl, game.state.tuning, room?.savedTuning ?? null, room?.hostId === playerId, {
        onChange: (patch) => net.send({ type: "setTuning", tuning: patch }),
        onReset: () => net.send({ type: "resetTuning" }),
        onSave: () => net.send({ type: "saveTuning" }),
        onLoad: () => net.send({ type: "loadTuning" }),
        onClose: () => ((tuningOpen = false), renderSide()),
      });
    } else clear(tuneEl);
  }
  renderBottomBar(
    barEl,
    {
      state: game.state,
      myId: playerId,
      orders: game.orders,
      aimingShipId: game.aimingShipId,
      selectedShipId: game.selectedShipId,
      submitted: game.submitted,
      ready: game.ready,
      animating: !!game.anim,
      picking: game.picking ?? undefined,
      minePick: game.minePick,
      shieldEdit: game.shieldEdit,
      inventoryOpen: game.inventoryOpen,
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
        if (patch.special?.type === "mine" && game!.minePick === "side") game!.minePick = "timer";
        renderSide();
      },
      chooseAction: (id, actionId) => chooseIcon(id, actionId),
      aim: (id) => {
        if (game!.aimingShipId === id) {
          confirmManeuver(id);
          return;
        }
        game!.aimingShipId = id;
        game!.picking = null;
        game!.selectedShipId = id;
        ensureVisible(id);
        renderSide();
      },
      ready: submitOrders,
      unready: () => {
        net.send({ type: "unready" });
        game!.submitted = false;
        renderSide();
      },
      shieldDelta: (id, seg, d) => {
        const g = game!;
        const o = g.orders.get(id);
        const ship = g.state.ships.find((x) => x.id === id);
        if (!o || !ship || o.action?.type !== "shield") return;
        const segs = [...o.action.segments] as Segments;
        const next = segs[seg] + d;
        if (next < 0 || next > RULES.segmentMax) return;
        if (d > 0 && shieldInHand(ship, o) <= 0) return;
        segs[seg] = next;
        g.orders.set(id, { ...o, action: { type: "shield", segments: segs } });
        renderSide();
      },
      shieldConfirm: (id) => {
        const g = game!;
        const o = g.orders.get(id);
        const ship = g.state.ships.find((x) => x.id === id);
        if (!o || !ship || shieldInHand(ship, o) > 0) return;
        g.shieldEdit = false;
        renderSide();
      },
      centerOn: (id) => {
        const s = game!.state.ships.find((x) => x.id === id);
        if (!s || !cam) return;
        cam.x = s.x - cam.viewW / cam.zoom / 2;
        cam.y = s.y - cam.viewH / cam.zoom / 2;
        cam.clampTo(game!.state.width, game!.state.height);
      },
      inventory: () => {
        game!.inventoryOpen = !game!.inventoryOpen;
        renderSide();
      },
    },
  );
  if (game.inventoryOpen) {
    sideEl.append(
      h(
        "div",
        { class: "pnl inventory" },
        h("div", { class: "bb-head" }, h("span", { class: "ttl" }, icon("inventory", "#7dd3fc", 12), " ", label("Inventář")), h("button", { class: "px tiny", style: "margin-left:auto", onclick: () => ((game!.inventoryOpen = false), renderSide()) }, "✕")),
        h("div", { class: "txt muted" }, "Sloty lodi (trup, štít, zbraně, moduly) se připravují. Tady si budeš skládat výbavu – štíty, dobíjení, lepší lasery…"),
        h("div", { class: "inv-slots" }, ...["TRUP", "STIT", "ZBRAN", "MODUL", "MODUL"].map((n) => h("div", { class: "inv-slot" }, n))),
      ),
    );
  }
  const log = h("div", { class: "log" });
  for (const entry of game.log.slice(-6)) {
    log.append(h("div", { class: "turn" }, `Kolo ${entry.turn}`));
    for (const line of entry.lines) log.append(h("div", {}, line));
  }
  if (game.log.length === 0) log.append(h("div", {}, "Zatím žádné události."));
  const open = logOpen;
  sideEl.append(h("button", { class: "log-toggle", onclick: () => ((logOpen = !logOpen), renderSide()) }, icon("log", "#7dd3fc", 12), open ? "LOG ▾" : "LOG ▸"));
  if (open) sideEl.append(log);
  if (open) log.scrollTop = log.scrollHeight;
}
let logOpen = true;

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
  return game.icons.find((ic) => Math.hypot(ic.x - x, ic.y - y) <= (ic.kind === "mine" ? 22 : r));
}

/** Míření: směr (a bez zámku i rychlost) podle polohy myši vůči lodi. */
function aimAt(wx: number, wy: number) {
  const g = game;
  if (!g || g.submitted) return;
  const id = g.aimingShipId;
  if (!id) return;
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
  g.aimingShipId = null;
  g.speedLock.delete(id);
  renderSide();
  return true;
}

function chooseIcon(shipId: string, id: string) {
  const g = game!;
  g.selectedShipId = shipId;
  const ship = g.state.ships.find((s) => s.id === shipId)!;
  const o = g.orders.get(shipId)!;
  if (id.startsWith("mine-side:") && o.special?.type === "mine") {
    g.orders.set(shipId, { ...o, special: { ...o.special, side: id.slice(10) as "left" | "behind" | "right" } });
    g.minePick = "timer";
    renderSide();
    return;
  }
  if (id === "mine-back" && o.special?.type === "mine") {
    g.minePick = "side"; // zpět na výběr místa
    renderSide();
    return;
  }
  if (id.startsWith("mine-timer:") && o.special?.type === "mine") {
    const n = Number(id.slice(11));
    g.orders.set(shipId, { ...o, special: { ...o.special, timer: n > 0 ? n : undefined } });
    g.minePick = null;
    renderSide();
    return;
  }
  const a = actionById(id);
  if (!a) return;
  const why = a.disabled(ship, g.state, o);
  if (why) {
    showError(`${a.label}: ${why}.`);
    return;
  }
  const next = { ...o, ...a.apply(o, ship, g.state) };
  g.orders.set(shipId, next);
  g.picking = a.pick && a.active(next) ? a.pick : null;
  g.shieldEdit = a.id === "shield" && next.action?.type === "shield";
  g.minePick = a.id === "mine" && next.special?.type === "mine" ? "side" : null;
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
    game.hoverIcon = ic ? `${ic.shipId}:${ic.id}` : undefined;
    game.hoverId = ic ? undefined : entityAt(w.x, w.y)?.id;
    if (!ic && !game.anim && game.aimingShipId) aimAt(w.x, w.y);
  });

  window.addEventListener("mouseup", () => {
    panning = false;
  });

  c.addEventListener("click", (e) => {
    if (moved || !cam || !game || game.anim || game.submitted) return;
    const g = game;
    const w = worldPos(e);

    // 1) míření: klik kamkoliv potvrdí dráhu
    if (g.aimingShipId) {
      confirmManeuver(g.aimingShipId);
      return;
    }
    // 2) ikona zbraně
    const ic = iconAt(w.x, w.y);
    if (ic) {
      chooseIcon(ic.shipId, ic.id);
      return;
    }
    const hit = entityAt(w.x, w.y);
    if (g.minePick) {
      g.minePick = null; // klik mimo = ponechat aktuální volbu
      renderSide();
      return;
    }
    // 3) vlastní loď: označit a začít kreslit dráhu
    if (hit?.kind === "ship" && hit.ownerId === playerId) {
      g.selectedShipId = hit.id;
      g.picking = null;
      const ship = g.state.ships.find((s) => s.id === hit.id)!;
      const o = g.orders.get(hit.id)!;
      const curCost = actionCost(ship, o);
      const adjusting = actionCost(ship, o) > actionCost(ship, { ...o, maneuverId: defaultOrders(ship).maneuverId });
      if (curCost >= RULES.actionPoints && !adjusting) showError("Úprava pohybu stojí akci a obě už máš použité. Odeber zbraň.");
      else g.aimingShipId = hit.id;
      renderSide();
      return;
    }
    const sel = g.state.ships.find((s) => s.id === g.selectedShipId);
    const o = sel && g.orders.get(sel.id);
    if (!sel || !o) return;
    // 4) výběr cíle pro označenou loď
    if (hit && hit.team !== sel.team) {
      if (o.special?.type === "torpedo" && dist(sel, hitPos(hit)) <= TORPEDO.lockRange) {
        g.orders.set(sel.id, { ...o, special: { type: "torpedo", targetId: hit.id }, preferredTargetId: hit.id });
        g.picking = null;
      } else {
        g.orders.set(sel.id, { ...o, preferredTargetId: hit.id });
      }
      renderSide();
      return;
    }
    if (!hit && o.special?.type === "torpedo" && (g.picking === "torpedo" || !o.special.targetId)) {
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
      const id = game.aimingShipId;
      if (id && !game.submitted && !game.anim && !(e.ctrlKey || e.metaKey)) {
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
      if (game.shieldEdit) {
        // zpět na původní rozložení = akce se zruší
        game.shieldEdit = false;
        if (o && o.action?.type === "shield") game.orders.set(id, { ...o, action: undefined });
      } else if (game.minePick) game.minePick = null;
      else if (game.picking) game.picking = null;
      else game.aimingShipId = null;
      game.speedLock.delete(id);
      renderSide();
    } else if (/^[1-5]$/.test(e.key)) {
      game.speedLock.set(id, Number(e.key));
      setManeuver(id, Number(e.key), cur.koiogran ? 0 : cur.angle, cur.koiogran);
    } else if (e.key === "k" || e.key === "K") {
      chooseIcon(id, "koiogran");
    } else if (e.key === " ") {
      if (game.aimingShipId) confirmManeuver(game.aimingShipId);
      else {
        game.aimingShipId = id;
        renderSide();
      }
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
  renderLobby(app, { playerId, name: playerName, rooms, room, error: error || notice, connected }, net, setName);
}

render();
net.connect();
try {
  document.fonts?.load("9px PS2P");
  document.fonts?.load("15px Pix");
} catch {
  /* ignore */
}

// Ladicí přístup ke stavu (pro automatické testy v prohlížeči).
(window as unknown as { __sg: () => unknown }).__sg = () => ({ game, cam, playerId });
