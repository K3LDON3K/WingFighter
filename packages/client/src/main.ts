import {
  RULES,
  actionCost,
  ANGLE_STEP,
  defaultOrders,
  dist,
  profileOf,
  MODULES,
  loadoutWeight,
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
  COMET,
  CARGO,
  MINE,
  applyTuning,
  computeStats,
  type GameState,
  type Pose,
  type RoomState,
  FACING_NAMES,
  HULLS,
  PILOTS,
  scannerModule,
  SCANNER,
  type Ship,
  laserArcOf,
  laserOdds,
  mgArcOf,
  mgPreview,
  laserTarget,
  mineSideOf,
  mineModule,
  type RoomSummary,
  type Segments,
  type ShipOrders,
  type TurnResult,
} from "@wingfighter/shared";
import { clear, h } from "./dom.ts";
import { icon, label } from "./icons.ts";
import { renderLoadout } from "./loadout-ui.ts";
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
  /** Inventář v režimu výběru modulu k vyhození. */
  jettisonPick: boolean;
  /** Herní menu (Esc). */
  menuOpen: boolean;
  /** Potvrzení spuštění kola s nevyužitými akcemi: otevřeno / vypnuto pro zbytek bitvy. */
  confirmOpen: boolean;
  skipConfirm: boolean;
  /** Skener: vysunutá tlačítka / výběr cíle skenu lodi. */
  scanOpen: boolean;
  scanPick: boolean;
  /** Vysunutá nabídka nákladu (vyhodit / zvednout). */
  cargoOpen: boolean;
  hoverId?: string;
  hoverIcon?: string;
  mouse: { x: number; y: number; sx: number; sy: number } | null;
  icons: IconSpot[];
}

const app = document.getElementById("app")!;
let playerName = (() => {
  try {
    return localStorage.getItem("wingfighter.name") ?? "";
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
    localStorage.setItem("wingfighter.name", n);
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
        const sameTurn = game.state.turn === msg.state.turn && !game.anim && game.queue.length === 0;
        game.state = msg.state;
        game.view = viewFromState(msg.state);
        if (sameTurn) {
          // mezikolová aktualizace (skener): rozkazy zůstávají
          for (const [id, o] of game.orders) if (!msg.state.ships.some((x) => x.id === id && x.alive)) game.orders.delete(id);
          for (const sh of msg.state.ships) if (sh.alive && sh.ownerId === playerId && !game.orders.has(sh.id)) game.orders.set(sh.id, defaultOrders(sh));
        } else resetOrders();
      }
      game!.ready = msg.ready;
      game!.submitted = msg.ready.includes(playerId);
      break;
    case "planningStatus":
      if (game) {
        game.ready = msg.ready;
        game.submitted = msg.ready.includes(playerId);
        renderSide();
      }
      break;
    case "scanResult":
      if (game) showScanResult(msg.ship);
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
    jettisonPick: false,
    menuOpen: false,
    confirmOpen: false,
    skipConfirm: !loadAskConfirm(),
    scanOpen: false,
    scanPick: false,
    cargoOpen: false,
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
  game.cargoOpen = false;
  const my = game.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  for (const s of my) game.orders.set(s.id, defaultOrders(s));
  if (!game.selectedShipId || !my.some((s) => s.id === game!.selectedShipId)) game.selectedShipId = my[0]?.id;
  game.submitted = false;
  ensureVisible(game.selectedShipId);
}

/** Vycentruje kameru na loď. */
const ZOOM_STEP = 1.1;
function zoomBy(factor: number) {
  if (!game || !cam) return;
  cam.zoomAt(cam.viewW / 2, cam.viewH / 2, factor);
  cam.clampTo(game.state.width, game.state.height);
}

/** Vycentrovat na loď se zoomem, při kterém je v okně celý její kruh dohledu; opakovaný stisk přepíná na celou mapu a zpět. */
function centerOnShip(shipId: string | undefined, force = false) {
  if (!game || !cam || !shipId) return;
  const s = game.state.ships.find((x) => x.id === shipId);
  if (!s) return;
  const r = s.stats.vision ?? 960;
  const z = cam.zoomForRadius(r + 20);
  // kamera se od posledního centrování nepohnula → druhý stisk = celá mapa
  const unchanged = lastCenter && Math.abs(cam.zoom - lastCenter.zoom) < 1e-6 && Math.abs(cam.x - lastCenter.x) < 0.5 && Math.abs(cam.y - lastCenter.y) < 0.5;
  if (unchanged && !force) {
    cam.fit(game.state.width, game.state.height);
    lastCenter = null;
    return;
  }
  cam.centerOn(s.x, s.y, z);
  cam.clampTo(game.state.width, game.state.height);
  lastCenter = { x: cam.x, y: cam.y, zoom: cam.zoom };
}
let lastCenter: { x: number; y: number; zoom: number } | null = null;

/** Když je loď mimo záběr, vycentruje na ni kameru. */
function ensureVisible(shipId: string | undefined) {
  if (!game || !cam || !shipId) return;
  const s = game.state.ships.find((x) => x.id === shipId);
  if (!s) return;
  const sp = cam.toScreen(s.x, s.y);
  const m = 120;
  if (sp.x < m || sp.y < m || sp.x > cam.viewW - m || sp.y > cam.viewH - m) {
    // jen přesun na loď, zoom zůstává
    cam.centerOn(s.x, s.y);
    cam.clampTo(game.state.width, game.state.height);
  }
}

/** Nastaví manévr; úhel ořízne na to, co loď při dané rychlosti zvládne. Vrací true při úspěchu. */
function setManeuver(shipId: string, speed: number, angle: number, koiogran: boolean): boolean {
  if (!game) return false;
  const ship = game.state.ships.find((s) => s.id === shipId);
  const o = game.orders.get(shipId);
  if (!ship || !o) return false;
  const profile = profileOf(ship.loadout);
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

/** Potvrzování nevyužitých akcí: pamatuje se v prohlížeči pro kód místnosti (všechny její bitvy). */
function confirmKey() {
  return `wingfighter.confirm.${room?.code ?? "x"}`;
}
function loadAskConfirm(): boolean {
  try {
    return localStorage.getItem(confirmKey()) !== "off";
  } catch {
    return true;
  }
}
function setAskConfirm(ask: boolean) {
  if (!game) return;
  game.skipConfirm = !ask;
  try {
    localStorage.setItem(confirmKey(), ask ? "on" : "off");
  } catch {
    /* ignore */
  }
  showNotice(ask ? "Potvrzení nevyužitých akcí: zapnuto" : "Potvrzení nevyužitých akcí: vypnuto – kolo se spustí rovnou");
  renderSide();
}

function submitOrders(force = false) {
  if (!game || game.submitted) return;
  if (game.confirmOpen && !force) return;
  for (const [id, o] of game.orders) {
    const ship = game.state.ships.find((x) => x.id === id);
    if (ship && o.action?.type === "jettison" && !ship.loadout.modules.some((m) => m.id === (o.action as { moduleId: string }).moduleId)) {
      showError(`${ship.name}: vyber modul k vyhození v okénku nad tlačítkem VYHODIT (nebo akci zruš).`);
      game.selectedShipId = id;
      renderSide();
      return;
    }
    if (ship && shieldInHand(ship, o) > 0) {
      showError(`${ship.name}: nejdřív rozmísti všechny body štítu.`);
      game.selectedShipId = id;
      game.shieldEdit = true;
      renderSide();
      return;
    }
  }
  if (!force && !game.skipConfirm) {
    let unused = 0;
    for (const [id, o] of game.orders) {
      const ship = game.state.ships.find((x) => x.id === id && x.alive);
      if (ship) unused += Math.max(0, RULES.actionPoints - actionCost(ship, o));
    }
    if (unused > 0) {
      game.confirmOpen = true;
      renderSide();
      return;
    }
  }
  game.confirmOpen = false;
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
let menuEl: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;
let tuneEl: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;
let pstatEl: HTMLElement | null = null;
let confirmEl: HTMLElement | null = null;
let mapEl: HTMLElement | null = null;
let raf = 0;
let resizeObs: ResizeObserver | null = null;

function mountGame() {
  clear(app);
  canvas = h("canvas");
  hudEl = h("div", { class: "hud" });
  overlayEl = h("div");
  menuEl = h("div", { class: "menu-wrap", style: "display:none" });
  tooltipEl = h("div", { class: "tooltip", style: "display:none" });
  tuneEl = h("div", { class: "tune-wrap", style: "display:none" });
  toastEl = h("div", { class: "toast", style: "display:none" });
  pstatEl = h("div", { class: "pstat" });
  confirmEl = h("div", { class: "confirm-wrap", style: "display:none" });
  barEl = h("div", { class: "bottombar" });
  sideEl = h("div", { class: "maplog" });
  mapEl = h(
    "div",
    { class: "map" },
    canvas,
    hudEl,
    h("div", { class: "hint" }, "KLIK NA LOĎ = KRESLIT DRÁHU · KLIK = POTVRDIT · KLIK NA NEPŘÍTELE = CÍL · TAŽENÍ = POSUN · KOLEČKO / +- = ZOOM · C = CENTROVAT"),
    sideEl,
    h(
      "div",
      { class: "map-zoom" },
      h("button", { class: "gear", title: "Přiblížit (+)", onclick: () => zoomBy(ZOOM_STEP) }, "+"),
      h("button", { class: "gear", title: "Oddálit (−)", onclick: () => zoomBy(1 / ZOOM_STEP) }, "−"),
      h("button", { class: "gear", title: "Vycentrovat na loď se zoomem na její dohled (C); znovu = celá mapa", onclick: () => centerOnShip(game?.selectedShipId) }, icon("center", "currentColor", 12), label("centrovat")),
    ),
    h(
      "div",
      { class: "map-tools" },
      h("button", { class: "gear", id: "inv-btn", title: "Inventář lodi (připravuje se)", onclick: () => ((game!.inventoryOpen = !game!.inventoryOpen), renderSide()) }, icon("inventory", "currentColor", 12), label("inventář")),
      h("button", { class: "gear", title: "Tabulka skóre (Tab)", onclick: () => toggleStats() }, icon("log", "currentColor", 12), label("skóre")),
      h("button", { class: "gear", title: "Ladění parametrů hry", onclick: () => ((tuningOpen = !tuningOpen), renderSide()) }, icon("target", "currentColor", 12), label("ladění")),
      h("button", { class: "gear", title: "Herní menu (Esc)", onclick: () => toggleMenu() }, icon("log", "currentColor", 12), label("menu")),
    ),
    pstatEl,
    tooltipEl,
    overlayEl,
    confirmEl,
    menuEl,
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
  if (mine) centerOnShip(mine.id, true);

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
  canvas = renderer = cam = sideEl = barEl = hudEl = overlayEl = mapEl = tooltipEl = tuneEl = toastEl = menuEl = null;
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
  overlay.visionRing = true;
  overlay.myShipIds = g.state.ships.filter((s) => s.alive && s.ownerId === playerId).map((s) => s.id);
  if (g.anim || g.state.status === "finished") return overlay;
  overlay.cometPredict = true;
  overlay.selectedShipId = g.selectedShipId;
  overlay.picking = g.picking ?? undefined;
  overlay.previews = [];

  const my = g.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  for (const ship of my) {
    const vs = view.ships.find((s) => s.id === ship.id);
    const o = g.orders.get(ship.id);
    if (!vs || !o) continue;
    const profile = profileOf(ship.loadout);
    const man = resolveManeuver(profile, o.maneuverId, ship.speed);
    if (!man) continue;
    const aiming = g.aimingShipId === ship.id && !g.submitted;
    overlay.previews.push({ ship: vs, maneuver: man, aiming, fire: !!o.fire, laserArc: o.fire ? laserArcOf(ship, o.laserModuleId) : undefined, mgArc: o.fireMg ? mgArcOf(ship, o.mgModuleId) : undefined });
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
      if (g.scanOpen && scannerModule(ship.loadout)) overlay.scanRanges = { ship: SCANNER.range, deep: SCANNER.deepRange };
      if (o.special?.type === "torpedo") {
        overlay.targetId = o.special.targetId;
        overlay.targetPoint = o.special.point;
        overlay.rangeCircle = { radius: TORPEDO.lockRange, label: "torpédo: zaměření 320 · bod až 1200" };
        overlay.rangeCircle2 = { radius: TORPEDO.pointRange };
      } else {
        overlay.targetId = o.preferredTargetId;
        if (o.fireMg && !o.fire) {
          const pv = mgPreview(g.state, ship, o.preferredTargetId, o.mgModuleId);
          if (pv) {
            const pct = Math.round(pv.hitChance * 100);
            overlay.targetId = pv.targetId;
            overlay.laserOdds = { x: pv.x, y: pv.y, text: `${pct} % ×${pv.shots}`, color: pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171" };
          }
        }
        if (o.fire) {
          const tgt = laserTarget(g.state, ship, o.preferredTargetId, o.laserModuleId);
          if (tgt) {
            const odds = laserOdds(ship, tgt);
            const pct = Math.round(odds.hitChance * 100);
            overlay.targetId = tgt.id;
            overlay.laserOdds = { x: tgt.x, y: tgt.y, text: `${pct} %`, color: pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171" };
          }
        }
      }
      if (o.action?.type === "pickup") {
        overlay.rangeCircle = { radius: CARGO.range, label: `zvednutí nákladu · dosah ${CARGO.range} · rychlost ≤ ${CARGO.maxSpeed}` };
        if (o.action.targetId) overlay.targetId = o.action.targetId;
      }
      if (o.special?.type === "mine") {
        const side = mineSideOf(mineModule(ship)?.facing);
        if (g.minePick === "side") {
          // strana je daná natočením minového modulu – jen ji ukážeme a jdeme rovnou na čas
          const pos = mineDropPosition(ship, side);
          g.icons.push({ id: `mine-side:${side}`, shipId: ship.id, kind: "mine", x: pos.x, y: pos.y, glyph: "", active: true, disabled: false, hover: g.hoverIcon === `${ship.id}:mine-side:${side}` });
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

/** Okno s výsledkem skenu lodi: loď, pilot, moduly s natočením a municí. Platí jen teď (zavřením zmizí). */
function showScanResult(ship: Ship) {
  if (!mapEl || !game) return;
  mapEl.querySelector(".scan-wrap")?.remove();
  const lo = ship.loadout;
  const lines = lo.modules.map((m) => `${MODULES[m.type].name}${m.facing ? ` (${FACING_NAMES[m.facing]})` : ""}${m.ammo !== undefined ? ` · ${m.ammo} ks` : ""}${m.type === "scanner" ? ` · ${m.charges ?? 0} nábojů` : ""}`);
  const entry = game.log.find((l) => l.turn === game!.state.turn) ?? (game.log.push({ turn: game.state.turn, lines: [] }), game.log[game.log.length - 1]);
  entry.lines.push(`Sken ${ship.name}: ${HULLS[lo.hullId]?.name ?? lo.hullId}, pilot ${PILOTS[lo.pilotId]?.name ?? lo.pilotId}; ${lines.length ? lines.join(", ") : "bez modulů"}.`);
  const wrap = h(
    "div",
    { class: "scan-wrap" },
    h(
      "div",
      { class: "pnl scan-card" },
      h("div", { class: "bb-head" }, icon("scan", "#7dd3fc", 14), h("span", { class: "ttl" }, label(`Sken: ${ship.name}`)), h("button", { class: "px tiny", style: "margin-left:auto", onclick: () => wrap.remove() }, "✕")),
      h("div", { class: "txt muted" }, `${HULLS[lo.hullId]?.name ?? lo.hullId} · pilot ${PILOTS[lo.pilotId]?.name ?? lo.pilotId} · trup ${ship.hull}/${ship.stats.hull}${ship.shieldType === "whole" ? ` · štít ${ship.shields}` : ship.shieldType === "segment" ? ` · segmenty ${ship.segments.join("/")}` : ""}`),
      renderLoadout({ loadout: lo, readonly: true, hideHead: true, budget: game.state.tuning.startBudget, allowed: game.state.settings.allowedModules, compact: true }),
      h("div", { class: "txt muted", style: "margin-top:6px" }, "Platí jen teď – po zavření je nutné skenovat znovu."),
    ),
  );
  mapEl.append(wrap);
  renderSide();
}

/** Okno se statistikami během hry (Tab, tlačítko SKÓRE, menu). */
function showStats() {
  toggleStats(true);
}

function toggleStats(open?: boolean) {
  if (!mapEl || !game) return;
  const cur = mapEl.querySelector(".scan-wrap.stats");
  const want = open ?? !cur;
  mapEl.querySelector(".scan-wrap")?.remove();
  if (!want) return;
  const wrap = h("div", { class: "scan-wrap stats" });
  wrap.append(
    h(
      "div",
      { class: "pnl scan-card wide" },
      h("div", { class: "bb-head" }, icon("log", "#7dd3fc", 14), h("span", { class: "ttl" }, label(`Tabulka skóre · kolo ${game.state.turn}`)), h("span", { class: "muted", style: "margin-left:auto;font-size:6px" }, "TAB / ESC = ZAVRIT"), h("button", { class: "px tiny", style: "margin-left:8px", onclick: () => wrap.remove() }, "✕")),
      renderLeaderboard(game.state),
    ),
  );
  mapEl.append(wrap);
  game.menuOpen = false;
  renderSide();
}

/** Žebříček: poškození, sestřely, kredity, manévry, zbraně – řazeno podle sestřelů a poškození. */
function renderLeaderboard(s: GameState): HTMLElement {
  const stats = s.stats ?? {};
  const rows = [...s.players]
    .map((p) => ({ p, st: stats[p.id] }))
    .filter((x) => x.st)
    .sort((a, b) => b.st!.kills - a.st!.kills || b.st!.damageDealt - a.st!.damageDealt || b.st!.creditsEarned - a.st!.creditsEarned);
  const th = (t: string, title?: string) => h("th", { title: title ?? "" }, label(t));
  const td = (v: string | number, cls = "") => h("td", { class: cls }, String(v));
  const table = h(
    "table",
    { class: "lb" },
    h("thead", {}, h("tr", {}, th("#"), th("hráč"), th("sestřely"), th("poškození", "Uděleno / utrženo (trup i štít)"), th("kredity", "Vydělané kredity (bez startovního rozpočtu)"), th("manévry", "zelený / bílý / červený / nebezpečný · otočky"), th("lasery", "zásahy / salvy"), th("kulomet", "zásahy / projektily"), th("torp.", "vystřelená torpéda"), th("miny"), th("skeny"), th("komety", "sestřelené komety / průlety ocasem"))),
    h(
      "tbody",
      {},
      ...rows.map(({ p, st }, i) => {
        const m = st!.maneuvers;
        return h(
          "tr",
          { class: p.id === playerId ? "me" : "" },
          td(i + 1),
          h("td", { class: "txt", style: `color:${TEAM_COLORS[p.team]}` }, p.name, st!.deaths ? h("span", { class: "muted" }, ` ✕${st!.deaths}`) : null),
          td(st!.kills, "num"),
          td(`${st!.damageDealt} / ${st!.damageTaken}`, "num"),
          td(st!.creditsEarned, "num"),
          h("td", { class: "num man" }, h("span", { style: "color:#4ade80" }, String(m.green)), " / ", h("span", {}, String(m.white)), " / ", h("span", { style: "color:#f87171" }, String(m.red)), " / ", h("span", { style: "color:#fb923c" }, String(m.danger)), m.koiogran ? h("span", { class: "muted" }, ` · ⟲${m.koiogran}`) : null),
          td(`${st!.laserHits} / ${st!.lasersFired}`, "num"),
          td(`${st!.mgHits ?? 0} / ${st!.mgShots ?? 0}`, "num"),
          td(st!.torpedoesFired, "num"),
          td(st!.minesDropped, "num"),
          td(`${st!.cometsShot ?? 0} / ${st!.cometTails ?? 0}`, "num"),
          td(st!.scans, "num"),
        );
      }),
    ),
  );
  return h("div", { class: "lb-wrap" }, h("div", { class: "ttl", style: "margin:10px 0 6px" }, label("Žebříček")), table);
}

/** Opuštění hry s potvrzením (bitva ostatních pokračuje; opouští se i případné navazující bitvy v místnosti). */
function askLeave() {
  if (!confirmEl || !game) return;
  game.menuOpen = false;
  renderMenu();
  clear(confirmEl);
  confirmEl.style.display = "grid";
  const close = () => {
    clear(confirmEl!);
    confirmEl!.style.display = "none";
    (confirmEl as HTMLElement & { _close?: () => void })._close = undefined;
  };
  confirmEl.append(
    h(
      "div",
      { class: "pnl confirm" },
      h("div", { class: "ctl" }, label("Opustit hru")),
      h("div", { class: "ctx txt" }, "Opustíš místnost ", h("b", {}, room?.name ?? ""), ".", h("br"), "Bitva ostatních pokračuje bez tebe a opouštíš i všechny navazující bitvy v této místnosti.", h("br"), "Opravdu odejít?"),
      h(
        "div",
        { class: "cbtns" },
        h("button", { class: "px cb primary", onclick: () => (close(), net.send({ type: "leaveRoom" })) }, icon("wait", "#fff", 10), label("odejít")),
        h("button", { class: "px cb", onclick: close }, label("zůstat"), h("span", { class: "k" }, "ESC")),
      ),
    ),
  );
  (confirmEl as HTMLElement & { _close?: () => void })._close = close;
}

function toggleMenu(open?: boolean) {
  if (!game) return;
  game.menuOpen = open ?? !game.menuOpen;
  renderSide();
}

/** Herní menu (Esc): pokračovat, ukončit bitvu (host – vrátí všechny do místnosti), opustit hru. */
function renderMenu() {
  if (!menuEl || !game) return;
  clear(menuEl);
  menuEl.style.display = game.menuOpen ? "grid" : "none";
  if (!game.menuOpen) return;
  const isHost = room?.hostId === playerId;
  menuEl.append(
    h(
      "div",
      { class: "pnl menu-card" },
      h("div", { class: "menu-title" }, label("Menu")),
      h("div", { class: "muted txt" }, `Kolo ${game.state.turn} · ${room?.name ?? ""}`),
      h("button", { class: "px menu-btn primary", onclick: () => toggleMenu(false) }, icon("play", "currentColor", 12), " ", label("Pokračovat"), h("span", { class: "sub" }, "ESC")),
      isHost
        ? h(
            "button",
            { class: "px menu-btn", title: "Ukončí bitvu pro všechny a vrátí hráče do místnosti (výbava a nastavení zůstanou)", onclick: () => net.send({ type: "backToLobby" }) },
            icon("people", "currentColor", 12),
            " ",
            label("Ukončit bitvu – do místnosti"),
          )
        : h("div", { class: "muted txt menu-note" }, "Bitvu může pro všechny ukončit jen host."),
      h(
        "button",
        { class: "px menu-btn danger", title: "Opustí místnost; bitva ostatních pokračuje bez tebe", onclick: () => askLeave() },
        icon("wait", "currentColor", 12),
        " ",
        label("Opustit hru – hlavní menu"),
      ),
      h("button", { class: "px menu-btn", onclick: () => showStats() }, icon("log", "currentColor", 12), " ", label("Tabulka skóre"), h("span", { class: "sub" }, "TAB")),
      h("div", { class: "muted txt menu-note" }, "Esc během plánování nejdřív ruší rozdělanou akci (kreslení dráhy, výběr cíle), prázdný Esc otevře menu."),
    ),
  );
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
      return `<span style="color:${TEAM_COLORS[t]}">${label.toUpperCase()}: ${t === myTeam ? alive : `${alive} V DOHLEDU`}</span>`;
    })
    .join(" · ");
  const credits = s.players.find((p) => p.id === playerId)?.credits;
  const html = `<div class="big">KOLO ${game.anim ? game.anim["result"].turn : s.turn}${limit}${credits !== undefined ? `<span class="hud-cr" title="Kredity: zbytek rozpočtu + odměny">${credits} CR</span>` : ""}</div><div>${counts}</div>`;
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
            h("h2", { style: `color:${color}` }, title.toUpperCase()),
            h("div", { class: "muted txt" }, r.reason === "turnLimit" ? "Dosažen limit kol." : "Soupeři zničeni."),
            renderLeaderboard(s),
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
  const hoverComet = !a && game.hoverId ? (game.anim ? game.anim.view : game.view).comets.find((c) => c.id === game!.hoverId) : undefined;
  if ((!a || !sel) && !hoverComet) {
    tooltipEl.style.display = "none";
    return;
  }
  if (!game.mouse) {
    tooltipEl.style.display = "none";
    return;
  }
  const why = a && sel ? a.disabled(sel, game.state, game.orders.get(sel.id)!) : "";
  const html = hoverComet
    ? `<b>Kometa</b>Odolnost ${hoverComet.hull}/${hoverComet.maxHull}, rychlost ${hoverComet.speed}/kolo. Náraz zraní loď (−${COMET.damage}) a odmrští ji. Sestřelení: +${COMET.reward} CR.<div class="ok">Průlet ocasem (tyrkysová zóna za kometou) doplní štít (${COMET.shieldPct} % / +1 segment) – každá loď jednou za kometu.</div>`
    : `<b>${a!.label}</b>${a!.description}${why ? `<div class="warn">Nelze: ${why}.</div>` : ""}`;
  if (tooltipEl.innerHTML !== html) tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";
  const x = Math.min(game.mouse.sx + 16, mapEl.clientWidth - 300);
  const y = Math.min(game.mouse.sy + 16, mapEl.clientHeight - 120);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

/** Svislý seznam hráčů vpravo na mapě: kdo už kolo odeslal. */
function renderPlayersStatus() {
  if (!pstatEl || !game) return;
  clear(pstatEl);
  const players = room?.players ?? [];
  const playing = !!game.anim;
  pstatEl.append(h("div", { class: "pcap" }, label(playing ? "přehrává se" : "hráči")));
  for (const p of players) {
    const alive = game.state.ships.some((sh) => sh.ownerId === p.id && sh.alive);
    const done = p.isBot || game.ready.includes(p.id) || !alive;
    const off = !p.isBot && !p.connected;
    const mark = off ? icon("wait", "#64748b", 10) : playing ? icon("play", "#64748b", 10) : done ? icon("check", "#4ade80", 10) : icon("wait", "#facc15", 10);
    pstatEl.append(h("div", { class: `p ${p.id === playerId ? "me" : ""} ${off ? "off" : ""}`, title: off ? "odpojen" : done ? "kolo odesláno" : "plánuje" }, mark, h("span", { style: `color:${TEAM_COLORS[p.team]}` }, p.name)));
  }
  pstatEl.append(h("div", { class: "leg" }, "✔ odesláno · ⌛ plánuje", h("br"), "šedě = odpojen"));
}

/** Dialog: spustit kolo i s nevyužitými akcemi? */
function renderConfirm() {
  if (!confirmEl || !game) return;
  const leaving = (confirmEl as HTMLElement & { _close?: () => void })._close;
  if (leaving && !game.confirmOpen) return;
  (confirmEl as HTMLElement & { _close?: () => void })._close = undefined;
  confirmEl.style.display = game.confirmOpen ? "grid" : "none";
  clear(confirmEl);
  if (!game.confirmOpen) return;
  let unused = 0;
  for (const [id, o] of game.orders) {
    const ship = game.state.ships.find((x) => x.id === id && x.alive);
    if (ship) unused += Math.max(0, RULES.actionPoints - actionCost(ship, o));
  }
  const total = RULES.actionPoints * [...game.orders.keys()].filter((id) => game!.state.ships.some((x) => x.id === id && x.alive)).length;
  const word = unused === 1 ? "volnou akci" : unused < 5 ? "volné akce" : "volných akcí";
  const chk = h("input", { type: "checkbox", id: "skip-confirm" }) as HTMLInputElement;
  confirmEl.append(
    h(
      "div",
      { class: "pnl confirm" },
      h("div", { class: "ctl" }, label("Nevyužité akce")),
      h("div", { class: "ctx txt" }, "Máš ještě ", h("b", {}, String(unused)), ` ${word} z ${total}.`, h("br"), "Opravdu spustit kolo?"),
      h(
        "div",
        { class: "cbtns" },
        h("button", { class: "px cb primary", onclick: () => confirmLaunch(true) }, icon("play", "#fff", 10), label("spustit"), h("span", { class: "k" }, "ENTER")),
        h("button", { class: "px cb", onclick: () => confirmLaunch(false) }, label("zpět"), h("span", { class: "k" }, "ESC")),
      ),
      h("label", { class: "cchk", htmlFor: "skip-confirm" }, chk, "vypnout potvrzování (přepínač nad tlačítkem, klávesa P)"),
    ),
  );
  (confirmEl as HTMLElement & { _chk?: HTMLInputElement })._chk = chk;
}

function confirmLaunch(go: boolean) {
  if (!game) return;
  const chk = (confirmEl as (HTMLElement & { _chk?: HTMLInputElement }) | null)?._chk;
  game.confirmOpen = false;
  if (chk?.checked) setAskConfirm(false);
  if (go) submitOrders(true);
  else renderSide();
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
  renderMenu();
  renderPlayersStatus();
  renderConfirm();
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
      scanOpen: game.scanOpen,
      scanPick: game.scanPick,
      cargoOpen: game.cargoOpen,
      askConfirm: !game.skipConfirm,
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
      ready: () => submitOrders(),
      toggleConfirm: () => setAskConfirm(game!.skipConfirm),
      showScore: () => toggleStats(true),
      cargoToggle: (id) => {
        game!.selectedShipId = id;
        game!.cargoOpen = !game!.cargoOpen;
        renderSide();
      },
      leave: () => askLeave(),
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
        // návrat na původní rozložení = akce se sama vypne (tlačítka zmizí)
        const same = segs.every((v, i) => v === ship.segments[i]);
        g.orders.set(id, same ? { ...o, action: undefined } : { ...o, action: { type: "shield", segments: segs } });
        if (same) g.shieldEdit = false;
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
      centerOn: (id) => centerOnShip(id),
      scanToggle: (id) => {
        game!.selectedShipId = id;
        game!.scanOpen = !game!.scanOpen;
        game!.scanPick = false;
        renderSide();
      },
      scanPickTarget: (id, on) => {
        game!.selectedShipId = id;
        game!.scanPick = on;
        game!.picking = null;
        renderSide();
      },
      scan: (id, mode) => {
        const sh = game!.state.ships.find((x) => x.id === id);
        const mod = sh && scannerModule(sh.loadout);
        if (!mod) return;
        net.send({ type: "scan", shipId: id, moduleId: mod.id, mode });
        game!.scanPick = false;
        renderSide();
      },
      jettisonPick: (id) => {
        game!.selectedShipId = id;
        game!.inventoryOpen = true;
        game!.jettisonPick = true;
        renderSide();
      },
      inventory: () => {
        game!.inventoryOpen = !game!.inventoryOpen;
        renderSide();
      },
    },
  );
  document.getElementById("inv-btn")?.classList.toggle("on", game.inventoryOpen);
  if (game.inventoryOpen) {
    sideEl.append(
      h(
        "div",
        { class: "pnl inventory" },
        h("div", { class: "bb-head" }, h("span", { class: "ttl" }, icon("inventory", "#7dd3fc", 12), " ", label("Inventář")), h("button", { class: "px tiny", style: "margin-left:auto", onclick: () => ((game!.inventoryOpen = false), (game!.jettisonPick = false), renderSide()) }, "✕")),
        (() => {
          const g = game!;
          const sh = g.state.ships.find((x) => x.id === g.selectedShipId) ?? g.state.ships.find((x) => x.ownerId === playerId);
          const me = g.state.players.find((p) => p.id === playerId);
          if (!sh) return h("div", { class: "txt muted" }, "Žádná loď.");
          const o = g.orders.get(sh.id);
          const picking = g.jettisonPick && o?.action?.type === "jettison" && !g.submitted;
          const chosenId = o?.action?.type === "jettison" ? o.action.moduleId : undefined;
          const chosen = sh.loadout.modules.find((m) => m.id === chosenId);
          const wrap = h("div", {});
          if (picking) {
            wrap.append(h("div", { class: "txt warn-txt" }, chosen ? `Vyhodit: ${MODULES[chosen.type].name}. Potvrď, nebo klikni na jiný modul.` : "Klikni na modul, který chceš na začátku kola vyhodit."));
            wrap.append(
              renderLoadout({
                loadout: sh.loadout,
                readonly: true,
                hideHead: true,
                budget: g.state.tuning.startBudget,
                allowed: g.state.settings.allowedModules,
                compact: true,
                showCargo: true,
                selectedId: chosenId,
                onSelect: (id) => {
                  const cur = g.orders.get(sh.id);
                  if (!cur) return;
                  g.orders.set(sh.id, { ...cur, action: { type: "jettison", moduleId: id } });
                  renderSide();
                },
              }),
            );
            wrap.append(
              h(
                "div",
                { class: "row", style: "margin-top:8px;gap:6px" },
                h("button", { class: "px", disabled: !chosen, onclick: () => ((g.jettisonPick = false), (g.inventoryOpen = false), renderSide()) }, icon("check", "currentColor", 10), " ", label("potvrdit vyhození")),
                h(
                  "button",
                  {
                    class: "px",
                    onclick: () => {
                      const cur = g.orders.get(sh.id);
                      if (cur) g.orders.set(sh.id, { ...cur, action: undefined });
                      g.jettisonPick = false;
                      renderSide();
                    },
                  },
                  label("zrušit"),
                ),
              ),
            );
          } else {
            wrap.append(
              h("div", { class: "txt muted" }, `${sh.name} · kredity ${me?.credits ?? 0}.${chosen ? ` Na začátku kola vyhodí ${MODULES[chosen.type].name}.` : ""}`),
              renderLoadout({ loadout: sh.loadout, readonly: true, hideHead: true, budget: g.state.tuning.startBudget, allowed: g.state.settings.allowedModules, compact: true, showCargo: true, selectedId: chosenId }),
            );
            if (!g.submitted && g.state.status !== "finished" && sh.ownerId === playerId)
              wrap.append(h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "px", onclick: () => (chosen ? ((g.jettisonPick = true), renderSide()) : chooseIcon(sh.id, "jettison")) }, icon("debris", "currentColor", 10), " ", label(chosen ? "změnit vyhození" : "vyhodit modul (1 akce)"))));
          }
          return wrap;
        })(),
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
  kind: "ship" | "torpedo" | "debris" | "comet";
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
  for (const db of view.debris) {
    const d = Math.hypot(db.x - x, db.y - y);
    if (d <= 16 && (!best || d < best.d)) best = { e: { kind: "debris", id: db.id, team: -1 }, d };
  }
  for (const c of view.comets) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= c.radius + 8 && (!best || d < best.d)) best = { e: { kind: "comet", id: c.id, team: -1 }, d };
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
  const man = resolveManeuver(profileOf(ship.loadout), o.maneuverId, ship.speed);
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
    g.minePick = "timer"; // strana je daná modulem, zpět = znovu čas
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
  if (a.id === "jettison") g.jettisonPick = false; // výběr modulu probíhá v okénku nad tlačítkem
  if (a.id === "jettison" || a.id === "pickup") g.cargoOpen = true;
  g.minePick = a.id === "mine" && next.special?.type === "mine" ? "timer" : null;
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
    // 3b) sken lodi: klik na cizí loď → hned
    if (g.scanPick && hit && hit.kind === "ship" && hit.team !== sel.team) {
      const mod = scannerModule(sel.loadout);
      if (mod) net.send({ type: "scan", shipId: sel.id, moduleId: mod.id, mode: "ship", targetId: hit.id });
      g.scanPick = false;
      renderSide();
      return;
    }
    // 4) výběr cíle pro označenou loď (trosky / kometa = cíl laserů a kulometu; trosky při zvedání = náklad)
    if (hit && hit.kind === "debris" && o.action?.type === "pickup") {
      g.orders.set(sel.id, { ...o, action: { type: "pickup", targetId: hit.id } });
      renderSide();
      return;
    }
    if (hit && (hit.kind === "debris" || hit.kind === "comet")) {
      g.orders.set(sel.id, { ...o, preferredTargetId: o.preferredTargetId === hit.id ? undefined : hit.id });
      renderSide();
      return;
    }
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
      cam.zoomAt(sx, sy, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      cam.clampTo(game.state.width, game.state.height);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (!game) return;
    if (e.key === "Tab") {
      toggleStats();
      e.preventDefault();
      return;
    }
    const leaveClose = (confirmEl as (HTMLElement & { _close?: () => void }) | null)?._close;
    if (leaveClose && confirmEl?.style.display !== "none" && !game.confirmOpen) {
      if (e.key === "Escape") {
        leaveClose();
        e.preventDefault();
      }
      return;
    }
    const stats = mapEl?.querySelector(".scan-wrap.stats");
    if (stats && e.key === "Escape") {
      stats.remove();
      e.preventDefault();
      return;
    }
    if (game.confirmOpen) {
      if (e.key === "Enter") confirmLaunch(true);
      else if (e.key === "Escape") confirmLaunch(false);
      else return;
      e.preventDefault();
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "Escape" && game.menuOpen) {
      toggleMenu(false);
      e.preventDefault();
      return;
    }

    if (game.anim) {
      if (e.key === "Escape") toggleMenu(true);
      return;
    }
    if (e.key === "Enter") {
      if (!game.menuOpen) submitOrders();
      return;
    }
    if (e.key === "+" || e.key === "=") {
      zoomBy(ZOOM_STEP);
      return;
    }
    if (e.key === "-") {
      zoomBy(1 / ZOOM_STEP);
      return;
    }
    if (e.key === "c" || e.key === "C") {
      centerOnShip(game.selectedShipId);
      return;
    }
    if (e.key === "p" || e.key === "P") {
      setAskConfirm(game.skipConfirm);
      return;
    }
    const id = game.selectedShipId;
    const o = id && game.orders.get(id);
    const cur = o ? parseManeuverId(o.maneuverId) : null;
    if (e.key === "Escape" && (game.submitted || !id || !cur || (!game.shieldEdit && !game.minePick && !game.picking && !game.aimingShipId && !game.jettisonPick && !game.inventoryOpen && !tuningOpen && !game.scanPick && !game.cargoOpen))) {
      toggleMenu(true);
      e.preventDefault();
      return;
    }
    if (game.submitted) return;
    if (!id || !cur) return;
    if (e.key === "Escape") {
      if (game.scanPick) game.scanPick = false;
      else if (game.cargoOpen) game.cargoOpen = false;
      else if (tuningOpen) tuningOpen = false;
      else if (game.jettisonPick || game.inventoryOpen) {
        game.jettisonPick = false;
        game.inventoryOpen = false;
      } else if (game.shieldEdit) {
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
  const s = hit.kind === "ship" ? view.ships.find((x) => x.id === hit.id) : hit.kind === "torpedo" ? view.torpedoes.find((x) => x.id === hit.id) : hit.kind === "comet" ? view.comets.find((x) => x.id === hit.id) : view.debris.find((x) => x.id === hit.id);
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
  document.fonts?.load("15px Jersey");
  document.fonts?.load("8px PS2P");
} catch {
  /* ignore */
}

// Ladicí přístup ke stavu (pro automatické testy v prohlížeči).
(window as unknown as { __sg: () => unknown }).__sg = () => ({ game, cam, playerId, net });
