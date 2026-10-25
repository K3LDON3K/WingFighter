import {
  setPilots,
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
  maneuverPath,
  rightOf,
  effStressCost,
  profileFor,
  TEAM_COLORS,
  TEAM_NAMES,
  TORPEDO,
  torpedoLockRange,
  torpedoPointRange,
  COMET,
  CARGO,
  inStorm,
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
  LASER,
  laserReach,
  laserArcOf,
  laserReachShip,
  moduleWorking,
  shotsOf,
  shotsOfType,
  shotTargetId,
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
  seriesStandings,
  seriesWinner,
} from "@wingfighter/shared";
import { clear, h } from "./dom.ts";
import { withTuneAccess } from "./tune-lock.ts";
import { audioReady, isMuted, setMuted, setSfxListener, sfx, unlockAudio } from "./sound.ts";
import { loadLibrary, playMode, renderSynth } from "./music.ts";
(window as unknown as { __wfRender: typeof renderSynth }).__wfRender = renderSynth;
import { renderMusicPanel } from "./music-ui.ts";
import { logoCanvas, replayLogo } from "./logo.ts";
import { playDefeat, playDraw, playVictory } from "./victory.ts";
import { onRenderScaleChange, parallaxRow, renderScale, renderScaleRow } from "./display.ts";
let unsubScale: (() => void) | null = null;

/** Vítězná animace už běžela pro tuto bitvu. */
let victoryShown = false;

/** Překryvný panel Hudba a zvuk (z lobby i z herního menu). */
let musicOverlay: HTMLElement | null = null;
let musicOff: (() => void) | null = null;
export function openMusicPanel() {
  if (musicOverlay) return;
  const body = h("div", { class: "mu-body" });
  musicOverlay = h("div", { class: "mu-overlay", onclick: (e) => {
      if (e.target === musicOverlay) closeMusicPanel();
    } }, body);
  document.body.append(musicOverlay);
  musicOff = renderMusicPanel(body, closeMusicPanel);
}
function closeMusicPanel() {
  musicOff?.();
  musicOverlay?.remove();
  musicOverlay = null;
  musicOff = null;
}
import { icon, label } from "./icons.ts";
import { renderLoadout } from "./loadout-ui.ts";
import { actionById } from "./game/actions.ts";
import { describeEvents, TurnAnimation } from "./game/animation.ts";
import { Camera } from "./game/camera.ts";
import { DIFFICULTY_COLOR, renderBottomBar, shieldInHand, updateManeuverPanel } from "./game/planning.ts";
import { ICON_RADIUS, Renderer, type IconSpot, type Overlay } from "./game/renderer.ts";
import { viewFromState, type ViewModel } from "./game/view.ts";
import { renderLobby } from "./lobby.ts";
import { renderTuningPanel, showHitboxes, showSelectRing } from "./tuning-panel.ts";
import { applyTouchClass, isTouchMode } from "./touch.ts";
import { keepAwake } from "./wakelock.ts";
import { initTooltips } from "./tooltip.ts";

/** Manévr před začátkem kreslení (dotyk: ✕ ho vrátí). */
const aimBackup = new Map<string, string>();
function cancelAiming(id: string) {
  const g = game;
  if (!g) return;
  const prev = aimBackup.get(id);
  const o = g.orders.get(id);
  if (prev && o) g.orders.set(id, { ...o, maneuverId: prev });
  aimBackup.delete(id);
  g.speedLock.delete(id);
  if (g.aimingShipId === id) g.aimingShipId = null;
  renderSide();
}
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
  /** Aktivní střela (id modulu): klik na nepřítele jí přiřadí cíl. */
  activeShot?: string;
  /** Otevřené podmenu zbraně s více moduly. */
  weaponOpen?: "laser" | "mg" | null;
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
  droidOpen: boolean;
  scanPick: boolean;
  /** Dobití štítu: vysunutá nabídka / zvolené body do segmentů. */
  rechargeOpen: boolean;
  rechargePick: number[];
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
  if (state.pilots?.length) setPilots(state.pilots);
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
  sfx("error");
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
      checkBuild(msg.build);
      break;
    case "rooms":
      rooms = msg.rooms;
      break;
    case "room":
      if (room && msg.room && msg.room.code === room.code && msg.room.players.length > room.players.length) sfx("join");
      room = msg.room;
      if (room?.pilots?.length) setPilots(room.pilots);
      if (!room || !room.inGame) {
        if (game) leaveGame();
      }
      break;
    case "gameStart":
      adoptTuning(msg.state);
      victoryShown = false;
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
      sfx("scan");
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
    droidOpen: false,
    scanPick: false,
    rechargeOpen: false,
    rechargePick: [0, 0, 0, 0],
    cargoOpen: false,
    mouse: null,
    icons: [],
  };
  resetOrders();
  screen = "game";
  splash = false;
  mountGame();
  closeMusicPanel();
  playMode("game");
  keepAwake(true);
}

function leaveGame() {
  game = null;
  screen = "lobby";
  unmountGame();
  closeMusicPanel();
  playMode("menu");
  keepAwake(false);
}

function resetOrders() {
  if (!game) return;
  game.orders.clear();
  game.aimingShipId = null;
  game.activeShot = undefined;
  game.weaponOpen = null;
  game.speedLock.clear();
  game.picking = null;
  game.minePick = null;
  game.cargoOpen = false;
  game.droidOpen = false;
  game.rechargeOpen = false;
  game.scanOpen = false;
  game.scanPick = false;
  game.shieldEdit = false;
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
  cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
}

/** Režimy centrování (C): blízko na loď → celý dohled lodi → celá mapa → znovu blízko. */
const CENTER_MODES = [
  { name: "loď", title: "Blízko na vybranou loď (polovina dohledu)" },
  { name: "dohled", title: "Celý kruh dohledu vybrané lodi" },
  { name: "mapa", title: "Celá mapa" },
] as const;
let lastCenter: { x: number; y: number; zoom: number; mode: number } | null = null;
let centerBtn: HTMLButtonElement | null = null;
/** Je kamera stále tam, kam ji dalo poslední centrování? Pak vrací jeho režim. */
function activeCenterMode(): number | null {
  if (!cam || !lastCenter) return null;
  const same = Math.abs(cam.zoom - lastCenter.zoom) < 1e-6 && Math.abs(cam.x - lastCenter.x) < 0.5 && Math.abs(cam.y - lastCenter.y) < 0.5;
  return same ? lastCenter.mode : null;
}
function centerOnShip(shipId: string | undefined, force = false) {
  if (!game || !cam || !shipId) return;
  const s = game.state.ships.find((x) => x.id === shipId);
  if (!s) return;
  const cur = activeCenterMode();
  const mode = force || cur === null ? 0 : (cur + 1) % CENTER_MODES.length;
  const r = (s.stats.vision ?? 960) + 20;
  if (mode === 2) cam.fit(game.state.width, game.state.height);
  else {
    cam.centerOn(s.x, s.y, cam.zoomForRadius(mode === 0 ? r / 2 : r));
    cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
  }
  lastCenter = { x: cam.x, y: cam.y, zoom: cam.zoom, mode };
  updateCenterBtn();
}
let centerBtnMode: number | null | undefined;
/** Tlačítko CENTROVAT ukazuje aktivní režim (tři políčka) a název; po ručním posunu kamery nic. */
function updateCenterBtn() {
  if (!centerBtn) return;
  const m = activeCenterMode();
  if (m === centerBtnMode && centerBtn.childElementCount) return;
  centerBtnMode = m;
  const next = m === null ? 0 : (m + 1) % CENTER_MODES.length;
  clear(centerBtn);
  centerBtn.title = `Pohled (C): ${CENTER_MODES.map((x, i) => (i === m ? `[${x.name}]` : x.name)).join(" → ")}. Další stisk: ${CENTER_MODES[next].title.toLowerCase()}.`;
  const pips = h("span", { class: "cpips" });
  CENTER_MODES.forEach((_, i) => pips.append(h("i", { class: i === m ? "on" : "" })));
  centerBtn.append(icon("center", "currentColor", 12), label("pohled"), pips, h("span", { class: "cmode" }, label(m === null ? "–" : CENTER_MODES[m].name)));
}

/** Vycentrovat na loď při zachování aktuálního zoomu (tlačítko s okem, klávesa F). */
function lookAtShip(shipId: string | undefined) {
  if (!game || !cam || !shipId) return;
  const s = game.state.ships.find((x) => x.id === shipId);
  if (!s) return;
  cam.centerOn(s.x, s.y);
  cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
}

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
    cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
  }
}

/** Nastaví manévr; úhel ořízne na to, co loď při dané rychlosti zvládne. Vrací true při úspěchu. */
function setManeuver(shipId: string, speed: number, angle: number, koiogran: boolean): boolean {
  if (!game) return false;
  const ship = game.state.ships.find((s) => s.id === shipId);
  const o = game.orders.get(shipId);
  if (!ship || !o) return false;
  const profile = profileFor(ship, o);
  speed = Math.max(koiogran ? 2 : 1, Math.min(profile.maxSpeed, Math.round(speed)));
  let man = makeManeuver(profile, speed, angle, koiogran, ship.speed);
  if (!man) {
    const max = profile.maxAngle[speed];
    const clamped = Math.sign(angle) * Math.min(Math.abs(angle), max);
    man = makeManeuver(profile, speed, Math.round(clamped / ANGLE_STEP) * ANGLE_STEP, koiogran, ship.speed);
  }
  if (!man) return false;
  // bez volných stresových bodů se manévr vůbec nenabízí (dřív šel vybrat a jen se neprovedl)
  if (effStressCost(man, o) > ship.stressPoints) return false;
  if (actionCost(ship, { ...o, maneuverId: man.id }) > RULES.actionPoints) return false;
  if (man.id !== o.maneuverId) {
    game.orders.set(shipId, { ...o, maneuverId: man.id });
    // při kreslení myší se manévr mění mnohokrát za sekundu – panel překreslit až v dalším snímku
    requestSide();
  }
  return true;
}

/** Odložené překreslení postranního panelu (sloučí víc změn do jednoho snímku). */
let sideDirty = false;
function requestSide() {
  sideDirty = true;
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
    if (game.state.status !== "finished") {
      sfx("turnStart");
      if (game.state.ships.some((s) => s.alive && s.ownerId === playerId && inStorm(game!.state, s))) setTimeout(() => sfx("storm"), 300);
    }
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
    return localStorage.getItem(confirmKey()) === "on";
  } catch {
    return false;
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

/** Zavře okénko štítu; beze změny rozložení se akce zruší (akce stojí jen skutečná úprava). */
function closeShieldEdit(g: NonNullable<typeof game>, shipId: string | null) {
  g.shieldEdit = false;
  const ship = shipId ? g.state.ships.find((x) => x.id === shipId) : undefined;
  const o = shipId ? g.orders.get(shipId) : undefined;
  if (!ship || !o || !shipId || o.action?.type !== "shield") return;
  if (o.action.segments.every((v, i) => v === ship.segments[i])) g.orders.set(shipId, { ...o, action: undefined });
}

function submitOrders(force = false) {
  if (!game || game.submitted) return;
  if (game.confirmOpen) force = true; // otevřené potvrzení: další SPUSTIT / Enter = potvrdit
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
  if (!force && !game.skipConfirm && unusedActions().unused > 0) {
    // potvrzení se vysune nad tlačítko SPUSTIT KOLO (Enter = spustit, Esc = zpět)
    game.confirmOpen = true;
    renderSide();
    return;
  }
  game.confirmOpen = false;
  game.aimingShipId = null;
  closeShieldEdit(game, game.selectedShipId ?? null);
  game.droidOpen = false;
  game.rechargeOpen = false;
  game.scanOpen = false;
  game.scanPick = false;
  game.cargoOpen = false;
  sfx("launch");
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
    h("div", { class: "hint mouse-only" }, "KLIK NA LOĎ = KRESLIT DRÁHU · KLIK = POTVRDIT · KLIK NA NEPŘÍTELE = CÍL · TAŽENÍ = POSUN · KOLEČKO / +- = ZOOM · C = POHLED · F = NAJÍT LOĎ"),
    h("div", { class: "hint touch-only" }, "TÁHNOUT Z VLASTNÍ LODI = DRÁHA (PAK ✓ / ✕) · ŤUKNOUT NA NEPŘÍTELE = CÍL · TÁHNOUT = POSUN · 2 PRSTY = ZOOM · PODRŽET = INFO"),
    sideEl,
    h(
      "div",
      { class: "map-zoom" },
      (centerBtn = h("button", { class: "gear center-btn", onclick: () => centerOnShip(game?.selectedShipId) })),
      h("span", { class: "mz-gap" }),
      h("button", { class: "gear mz-sq", title: "Oddálit (−)", onclick: () => zoomBy(1 / ZOOM_STEP) }, "−"),
      h("button", { class: "gear mz-sq", title: "Najít vybranou loď: vycentrovat na ni, zoom zůstane (F)", onclick: () => lookAtShip(game?.selectedShipId) }, icon("eye", "currentColor", 12)),
      h("button", { class: "gear mz-sq", title: "Přiblížit (+)", onclick: () => zoomBy(ZOOM_STEP) }, "+"),
    ),
    h(
      "div",
      { class: "map-tools" },
      h("button", { class: "gear", id: "inv-btn", title: "Inventář lodi (připravuje se)", onclick: () => ((game!.inventoryOpen = !game!.inventoryOpen), renderSide()) }, icon("inventory", "currentColor", 12), label("inventář")),
      h("button", { class: "gear touch-only", title: "Menu", onclick: () => toggleMenu(!game?.menuOpen) }, "☰ ", label("menu")),
      h("button", { class: "gear", title: "Tabulka skóre (Tab)", onclick: () => toggleStats() }, icon("log", "currentColor", 12), label("skóre")),
      h("button", { class: "gear", title: "Ladění parametrů hry", onclick: () => (tuningOpen ? ((tuningOpen = false), renderSide()) : withTuneAccess(() => ((tuningOpen = true), renderSide()))) }, icon("target", "currentColor", 12), label("ladění")),
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
  /** Rozložení lišty je vždy stejné; na užších obrazovkách se celá zmenší (zoom), nic se nepřeskládá. */
  const fitUi = () => {
    const w = window.innerWidth;
    const scale = Math.max(0.5, Math.min(1, w / UI_DESIGN_WIDTH));
    document.documentElement.style.setProperty("--ui-zoom", String(scale));
  };
  const resize = () => {
    fitUi();
    if (!canvas || !mapEl || !cam) return;
    const dpr = (window.devicePixelRatio || 1) * renderScale();
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
  unsubScale?.();
  unsubScale = onRenderScaleChange(resize);
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
  inputAbort.abort();
  resizeObs?.disconnect();
  canvas = renderer = cam = sideEl = barEl = hudEl = overlayEl = mapEl = tooltipEl = tuneEl = toastEl = menuEl = null;
  render();
}

/** Server po restartu servíruje novější klienta: otevřená stránka se starou verzí se sama obnoví (jednou, mimo rozehranou bitvu). */
function checkBuild(build: string | undefined) {
  if (!build) return;
  const mine = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) => s.src.match(/assets\/(main-[A-Za-z0-9_-]+\.js)/)?.[1]).find(Boolean);
  if (!mine || mine === build) return;
  let done = "";
  try {
    done = sessionStorage.getItem("wingfighter.reloadedFor") ?? "";
    sessionStorage.setItem("wingfighter.reloadedFor", build);
  } catch {
    /* bez úložiště obnovíme jen jednou díky porovnání */
  }
  if (done === build) return;
  if (game) {
    showNotice("Je k dispozici nová verze hry – po bitvě obnov stránku.");
    return;
  }
  location.reload();
}

/** Šířka okna, pro kterou je lišta navržená; užší okno ji celou zmenší. */
const UI_DESIGN_WIDTH = 1280;

let lastFrameAt = 0;
/** Poslední vstup myší/kolečkem (po něm chvíli kreslíme plnou rychlostí). */
let lastInputAt = 0;
function frame(now: number) {
  if (!game || !renderer || !cam || !canvas) return;
  if (sideDirty) {
    sideDirty = false;
    // při kreslení dráhy stačí vyměnit panel Manévr; celá lišta se překreslí po potvrzení
    const light = game.aimingShipId && barEl && updateManeuverPanel(barEl, { state: game.state, myId: playerId, orders: game.orders, selectedShipId: game.selectedShipId } as Parameters<typeof updateManeuverPanel>[1]);
    if (!light) renderSide();
  }
  // v klidu stačí ~30 snímků/s (tahová hra) – šetří procesor; při animaci, kreslení dráhy a pohybu myši plných 60
  const busy = !!game.anim || !!game.aimingShipId || now - lastInputAt < 250;
  if (!busy && now - lastFrameAt < 30) return;
  lastFrameAt = now;
  if (game.anim) {
    game.anim.update(now);
    if (game.anim.finished) {
      const done = (game.anim as TurnAnimation & { onDone?: () => void }).onDone;
      done?.();
    }
  }
  const view = game.anim ? game.anim.view : game.view;
  updateCenterBtn();
  const overlay = buildOverlay(view);
  if (game.hoverIcon && !game.icons.some((i) => `${i.shipId}:${i.id}` === game!.hoverIcon)) game.hoverIcon = undefined;
  renderer.draw(game.state, view, cam, overlay, now, (window.devicePixelRatio || 1) * renderScale());
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
  const overlay: Overlay = { myTeam: me?.team, hoverId: g.hoverId, animating: g.anim ? g.anim.progress : undefined };
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
  overlay.showHitboxes = showHitboxes();
  overlay.showSelectRing = showSelectRing();
  overlay.picking = g.picking ?? undefined;
  overlay.previews = [];
  overlay.plannedSegments = {};
  overlay.stormActive = g.state.ships.some((s) => s.alive && s.ownerId === playerId && inStorm(g.state, s));

  const my = g.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  for (const ship of my) {
    const vs = view.ships.find((s) => s.id === ship.id);
    const o = g.orders.get(ship.id);
    if (o?.action?.type === "shield") overlay.plannedSegments[ship.id] = o.action.segments;
    if (!vs || !o) continue;
    const profile = profileFor(ship, o);
    const man = resolveManeuver(profile, o.maneuverId, ship.speed);
    if (!man) continue;
    const aiming = g.aimingShipId === ship.id && !g.submitted;
    const laserShots = shotsOfType(ship, o, "laser");
    const mgShots = shotsOfType(ship, o, "mg");
    overlay.previews.push({ ship: vs, maneuver: man, aiming, fire: laserShots.length > 0, laserArcs: laserShots.map(({ mod }) => laserArcOf(ship, mod.id)), mgArcs: mgShots.map(({ mod }) => mgArcOf(ship, mod.id)) });
    const end = maneuverEnd(ship, man);

    if (aiming) {
      const dots: { x: number; y: number; color: string }[] = [];
      for (let a = -MAX_ANGLE; a <= MAX_ANGLE; a += ANGLE_STEP) {
        const mm = makeManeuver(profile, man.speed, a, man.koiogran, ship.speed);
        if (!mm || effStressCost(mm, o) > ship.stressPoints) continue;
        const e = maneuverEnd(ship, mm);
        dots.push({ x: e.x, y: e.y, color: DIFFICULTY_COLOR[mm.difficulty] });
      }
      overlay.reachable = dots;
    }

    if (ship.id === g.selectedShipId) {
      if (g.scanOpen && scannerModule(ship.loadout)) overlay.scanRanges = { ship: SCANNER.range, deep: SCANNER.deepRange };
      // které zbraně na co míří (značka cíle s ikonkami zbraní)
      {
        const tw: Record<string, string[]> = {};
        const add = (id: string | undefined, w: string) => {
          if (!id) return;
          (tw[id] ??= []).push(w);
        };
        // každá střela zvlášť: značka s číslem modulu (pořadí mezi moduly stejného typu), když je jich víc
        const lasersAll = ship.loadout.modules.filter((x) => x.type === "laser");
        const mgsAll = ship.loadout.modules.filter((x) => x.type === "mg");
        for (const { shot, mod } of shotsOfType(ship, o, "laser")) {
          const tid = shotTargetId(o, shot);
          const tag = lasersAll.length > 1 ? `laser#${lasersAll.indexOf(mod) + 1}` : "laser";
          const tgt = laserTarget(g.state, ship, tid, mod.id);
          const pt = tid && !g.state.ships.some((x) => x.id === tid) ? ((g.state.debris ?? []).find((d) => d.id === tid) ?? (g.state.comets ?? []).find((c) => c.id === tid) ?? g.state.torpedoes.find((t) => t.id === tid)) : undefined;
          if (pt && !laserReach(g.state, ship, pt, mod.id)) add(pt.id, tag);
          else if (tgt) add(tgt.id, tag);
        }
        for (const { shot, mod } of shotsOfType(ship, o, "mg")) add(mgPreview(g.state, ship, shotTargetId(o, shot), mod.id)?.targetId, mgsAll.length > 1 ? `mg#${mgsAll.indexOf(mod) + 1}` : "mg");
        if (o.special?.type === "torpedo") add(o.special.targetId, "torpedo");
        overlay.targetWeapons = tw;
      }
      if (o.special?.type === "torpedo") {
        overlay.targetId = o.special.targetId;
        overlay.targetPoint = o.special.point;
        overlay.rangeCircle = { radius: torpedoLockRange(ship), label: `torpédo: zaměření ${torpedoLockRange(ship)} · bod až ${torpedoPointRange(ship)}` };
        overlay.rangeCircle2 = { radius: torpedoPointRange(ship) };
      } else {
        overlay.targetId = o.preferredTargetId;
        // náhled šance: aktivní střela (naposledy zvolený modul), jinak první
        const activeOf = (type: "laser" | "mg") => {
          const list = shotsOfType(ship, o, type);
          return list.find((x) => x.mod.id === g.activeShot) ?? list[0];
        };
        const mgA = activeOf("mg");
        const laA = activeOf("laser");
        if (mgA && (!laA || g.activeShot === mgA.mod.id)) {
          const pv = mgPreview(g.state, ship, shotTargetId(o, mgA.shot), mgA.mod.id);
          if (pv) {
            const pct = Math.round(pv.hitChance * 100);
            overlay.targetId = pv.targetId;
            const cov = Math.round(pv.coverage * 100);
            overlay.laserOdds = { x: pv.x, y: pv.y, text: `${pct} % ×${pv.shots}`, color: pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171", sub: pv.coverage < 1 ? `${cov} % v dosahu` : undefined };
            if (pv.coverage < 1) {
              const arc = mgArcOf(ship, mgA.mod.id);
              overlay.partialTarget = { id: pv.targetId, x: arc.x, y: arc.y, heading: arc.heading, range: arc.range, halfArc: arc.halfArc };
            }
          }
        } else if (laA) {
          const tgt = laserTarget(g.state, ship, shotTargetId(o, laA.shot), laA.mod.id);
          if (tgt) {
            const odds = laserOdds(ship, tgt, laA.mod.id);
            const pct = Math.round(odds.hitChance * 100);
            overlay.targetId = tgt.id;
            const cov = Math.round(odds.coverage * 100);
            const bandTxt = odds.rangeBand === 1 ? "pásmo 1 · +1 kostka" : odds.rangeBand === 3 ? "pásmo 3 · obránce +1" : "pásmo 2";
            overlay.laserOdds = { x: tgt.x, y: tgt.y, text: `${pct} %`, color: pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171", sub: odds.coverage < 1 ? `${cov} % v dosahu · ${bandTxt}` : bandTxt };
            if (odds.coverage < 1) {
              const arc = laserArcOf(ship, laA.mod.id);
              overlay.partialTarget = { id: tgt.id, x: arc.x, y: arc.y, heading: arc.heading, range: arc.range, halfArc: arc.halfArc };
            }
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
  const lines = lo.modules.map((m) => `${MODULES[m.type].name}${m.facing ? ` (${FACING_NAMES[m.facing]})` : ""}${m.ammo !== undefined ? ` · ${m.ammo} ks` : ""}`);
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
      renderLoadout({ loadout: lo, readonly: true, hideHead: true, budget: game.state.tuning.startBudget, allowed: game.state.settings.allowedModules, compact: true, team: ship.team }),
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
    h("thead", {}, h("tr", {}, th("#"), th("hráč"), th("sestřely"), th("poškození", "Uděleno / utrženo (trup i štít)"), th("kredity", "Vydělané kredity (bez startovního rozpočtu)"), th("manévry", "zelený / bílý / oranžový / nebezpečný (červený) · otočky"), th("lasery", "zásahy / salvy"), th("kulomet", "zásahy / projektily"), th("torp.", "vystřelená torpéda"), th("miny"), th("skeny"), th("komety", "sestřelené komety / průlety ocasem"))),
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
          h("td", { class: "num man" }, h("span", { style: "color:#4ade80" }, String(m.green)), " / ", h("span", {}, String(m.white)), " / ", h("span", { style: "color:#fb923c" }, String(m.red)), " / ", h("span", { style: "color:#f87171" }, String(m.danger)), m.koiogran ? h("span", { class: "muted" }, ` · ⟲${m.koiogran}`) : null),
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
function mbtn(ic: Parameters<typeof icon>[0], text: string, key: string, onclick: () => void, cls = "", hint = "", disabled = false) {
  return h(
    "button",
    { class: `px menu-btn ${cls}`, disabled, title: hint, onclick },
    h("span", { class: "mi" }, icon(ic, "currentColor", 12)),
    h("span", { class: "ml" }, label(text), hint ? h("span", { class: "mh" }, hint) : null),
    key ? h("span", { class: "sub" }, key) : null,
  );
}

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
      h("div", { class: "menu-head" }, h("div", { class: "menu-title" }, label("Menu")), h("div", { class: "muted txt" }, `Kolo ${game.state.turn} · ${room?.name ?? ""}`)),
      mbtn("play", "Pokračovat", "ESC", () => toggleMenu(false), "primary"),
      h("div", { class: "menu-sep" }, label("Přehled")),
      mbtn("log", "Tabulka skóre", "TAB", () => showStats()),
      mbtn("wait", "Hudba a zvuk", "M", () => openMusicPanel(), "", "M = ztlumit vše"),
      renderScaleRow(),
      parallaxRow(),
      h("div", { class: "menu-sep" }, label("Odchod")),
      mbtn("people", "Ukončit bitvu pro všechny", isHost ? "" : "jen host", () => net.send({ type: "backToLobby" }), "", "Vrátí všechny hráče do místnosti; výbava a nastavení zůstanou.", !isHost),
      mbtn("wait", "Opustit hru", "", () => askLeave(), "danger", "Odejdeš do hlavního menu; bitva ostatních pokračuje bez tebe."),
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
      const myTeam2 = s.players.find((p) => p.id === playerId)?.team;
      sfx(r.winnerTeam !== null && r.winnerTeam === myTeam2 ? "win" : "lose");
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
            seriesSummary(s),
            h("div", { style: "margin-top:16px" }, isHost ? h("button", { class: "primary", onclick: () => net.send({ type: "backToLobby" }) }, "Zpět do místnosti") : h("span", { class: "muted" }, "Host může vrátit všechny do místnosti.")),
          ),
        ),
      );
    } else if (!finished && overlayEl.firstChild) {
      clear(overlayEl);
      victoryShown = false;
    }
    // vítězná animace: jedna bitva hned po výhře, série až po celkové výhře; jen pro vítěze
    if (finished && overlayEl.firstChild && !victoryShown) {
      const outcome = myOutcome(s);
      if (outcome) {
        victoryShown = true;
        const col = TEAM_COLORS[s.players.find((p) => p.id === playerId)?.team ?? 0];
        if (outcome === "win") playVictory(overlayEl.firstChild as HTMLElement, col);
        else if (outcome === "lose") playDefeat(overlayEl.firstChild as HTMLElement, col, { sound: true });
        else playDraw(overlayEl.firstChild as HTMLElement, [TEAM_COLORS[0], TEAM_COLORS[1], TEAM_COLORS[2]], { sound: true });
      }
    }
  }
}

/** Výsledek pro mě: výhra / prohra / remíza; null = série ještě neskončila (animace až po poslední bitvě). */
function myOutcome(s: GameState): "win" | "lose" | "draw" | null {
  const me = s.players.find((p) => p.id === playerId);
  if (!me) return null;
  const ss = room?.series;
  if (ss) {
    if (!ss.finished) return null;
    const key = s.settings.mode === "dm" ? me.id : String(me.team);
    const w = seriesWinner(ss.results);
    return w === null ? "draw" : w === key ? "win" : "lose";
  }
  const r = s.result;
  if (!r) return null;
  if (r.winnerTeam === null) return "draw";
  return r.winnerTeam === me.team ? "win" : "lose";
}

/** Stav série bitev v závěrečném okně (jen když místnost hraje sérii). */
function seriesSummary(s: GameState): HTMLElement | null {
  const ss = room?.series;
  if (!ss) return null;
  const tdm = s.settings.mode === "tdm";
  const sideName = (k: string) => (tdm ? TEAM_NAMES[Number(k)] : (s.players.find((p) => p.id === k)?.name ?? "?"));
  const sideColor = (k: string) => (tdm ? TEAM_COLORS[Number(k)] : TEAM_COLORS[s.players.findIndex((p) => p.id === k) % TEAM_COLORS.length] ?? "#e2e8f0");
  const st = seriesStandings(ss.results);
  const win = ss.finished ? seriesWinner(ss.results) : null;
  return h(
    "div",
    { class: "series-end" },
    h("div", { class: "ttl", style: "margin:10px 0 4px" }, label(ss.finished ? `Série skončila · ${win === null ? "remíza" : `vítěz ${sideName(win)}`}` : `Série · odehráno ${ss.played} ze ${ss.total}`)),
    ...st.map((x, i) => h("div", { class: "se-row" }, h("span", { class: "muted" }, `${i + 1}. `), h("b", { style: `color:${sideColor(x.key)}` }, sideName(x.key)), ` ${x.points} b. `, h("span", { class: "muted" }, `(${x.wins}V ${x.draws}R ${x.losses}P · ${x.kills} sestřelů · ${x.damage} zranění)`))),
  );
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
  const tdm = game.state.settings.mode === "tdm";
  const sorted = tdm ? [...players].sort((a, b) => a.team - b.team) : players;
  let lastTeam = -1;
  for (const p of sorted) {
    if (tdm && p.team !== lastTeam) {
      // oddělené týmy: hlavička v barvě týmu (a mezera mezi týmy)
      pstatEl.append(h("div", { class: `tcap ${lastTeam >= 0 ? "gap" : ""}`, style: `color:${TEAM_COLORS[p.team]}` }, label(TEAM_NAMES[p.team] ?? `tým ${p.team + 1}`)));
      lastTeam = p.team;
    }
    const alive = game.state.ships.some((sh) => sh.ownerId === p.id && sh.alive);
    const done = p.isBot || game.ready.includes(p.id) || !alive;
    const off = !p.isBot && !p.connected;
    const hasShip = game.state.ships.some((sh) => sh.ownerId === p.id);
    const dead = hasShip && !alive;
    const mark = dead ? icon("skull", "#94a3b8", 10) : off ? icon("wait", "#64748b", 10) : playing ? icon("play", "#64748b", 10) : done ? icon("check", "#4ade80", 10) : icon("wait", "#facc15", 10);
    pstatEl.append(h("div", { class: `p ${p.id === playerId ? "me" : ""} ${off ? "off" : ""} ${dead ? "dead" : ""}`, title: dead ? "sestřelen" : off ? "odpojen" : done ? "kolo odesláno" : "plánuje" }, mark, h("span", { style: `color:${TEAM_COLORS[p.team]}` }, p.name)));
  }
}

/** Dialog: spustit kolo i s nevyužitými akcemi? */
/** Volné akční body mých živých lodí (pro potvrzení před spuštěním kola). */
function unusedActions(): { unused: number; total: number } {
  let unused = 0;
  let total = 0;
  if (!game) return { unused, total };
  for (const [id, o] of game.orders) {
    const ship = game.state.ships.find((x) => x.id === id && x.alive);
    if (!ship) continue;
    unused += Math.max(0, RULES.actionPoints - actionCost(ship, o));
    total += RULES.actionPoints;
  }
  return { unused, total };
}

/** Překryvný dialog slouží už jen pro potvrzení odchodu (askLeave); potvrzení kola je v liště. */
function renderConfirm() {
  if (!confirmEl || !game) return;
  if ((confirmEl as HTMLElement & { _close?: () => void })._close) return;
  confirmEl.style.display = "none";
  clear(confirmEl);
}

function confirmLaunch(go: boolean) {
  if (!game) return;
  game.confirmOpen = false;
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
        onSavePilots: (pilots) => net.send({ type: "setPilots", pilots }),
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
      activeShot: game.activeShot,
      selectedShipId: game.selectedShipId,
      submitted: game.submitted,
      ready: game.ready,
      animating: !!game.anim,
      picking: game.picking ?? undefined,
      minePick: game.minePick,
      shieldEdit: game.shieldEdit,
      inventoryOpen: game.inventoryOpen,
      scanOpen: game.scanOpen,
      weaponOpen: game.weaponOpen,
      droidOpen: game.droidOpen,
      rechargeOpen: game.rechargeOpen,
      rechargePick: game.rechargePick,
      scanPick: game.scanPick,
      cargoOpen: game.cargoOpen,
      askConfirm: !game.skipConfirm,
      confirm: game.confirmOpen ? unusedActions() : null,
    },
    {
      select: (id) => {
        game!.selectedShipId = id;
        game!.picking = null;
        ensureVisible(id);
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
      cancelManeuver: (id) => {
        const g = game!;
        if (g.aimingShipId === id && aimBackup.has(id)) {
          cancelAiming(id);
          return;
        }
        // rozkreslený / naplánovaný manévr zpět na „rovně stejnou rychlostí“ (zdarma)
        const ship = g.state.ships.find((x) => x.id === id);
        const o = g.orders.get(id);
        if (!ship || !o) return;
        g.orders.set(id, { ...o, maneuverId: defaultOrders(ship).maneuverId });
        g.aimingShipId = null;
        g.speedLock.delete(id);
        sfx("cancel");
        renderSide();
      },
      aim: (id) => {
        if (game!.aimingShipId === id) {
          confirmManeuver(id);
          return;
        }
        game!.aimingShipId = id;
        aimBackup.set(id, game!.orders.get(id)?.maneuverId ?? "");
        game!.picking = null;
        game!.selectedShipId = id;
        ensureVisible(id);
        renderSide();
      },
      ready: () => submitOrders(),
      toggleConfirm: () => setAskConfirm(game!.skipConfirm),
      confirmLaunch: (go) => confirmLaunch(go),
      showScore: () => toggleStats(true),
      jettisonChosen: (id, moduleId) => {
        const g = game!;
        const o = g.orders.get(id);
        if (!o) return;
        const ship = g.state.ships.find((x) => x.id === id);
        const mod = ship?.loadout.modules.find((x) => x.id === moduleId) ?? ship?.loadout.cargo?.find((x) => x.id === moduleId);
        g.orders.set(id, { ...o, action: { type: "jettison", moduleId } });
        g.cargoOpen = false; // potvrzení = okénko se zavře
        sfx("toggle");
        if (mod) showNotice(`Vyhodí se: ${MODULES[mod.type].name} (na začátku kola)`);
        renderSide();
      },
      cancelAction: (id) => {
        const g = game!;
        const o = g.orders.get(id);
        if (!o) return;
        g.orders.set(id, { ...o, action: undefined });
        g.cargoOpen = false;
        g.shieldEdit = false;
        g.jettisonPick = false;
        sfx("cancel");
        renderSide();
      },
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
        sfx("click");
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
        g.rechargeOpen = false;
        g.rechargePick = [0, 0, 0, 0];
        closeShieldEdit(g, id);
        renderSide();
      },
      centerOn: (id) => centerOnShip(id),
      droidToggle: (id) => {
        game!.selectedShipId = id;
        game!.droidOpen = !game!.droidOpen;
        game!.rechargeOpen = false;
        renderSide();
      },
      shieldMode: (id, mode) => {
        const g = game!;
        g.selectedShipId = id;
        g.droidOpen = false;
        if (!g.scanPick) g.scanOpen = false;
        g.rechargePick = [0, 0, 0, 0];
        if (mode === "close") {
          g.rechargeOpen = false;
          closeShieldEdit(g, id);
        } else if (mode === "recharge") {
          g.rechargeOpen = true;
        } else {
          g.rechargeOpen = false;
          const o = g.orders.get(id);
          if (o?.action?.type === "shield") g.shieldEdit = true;
          else chooseIcon(id, "shield"); // zvolí akci a otevře −/+
        }
        renderSide();
      },
      rechargePick: (id, seg) => {
        game!.selectedShipId = id;
        const sh = game!.state.ships.find((x) => x.id === id);
        if (!sh) return;
        const cap = RULES.segmentHp * sh.stats.segmentModules;
        const pick = game!.rechargePick;
        const total = pick.reduce((a, b) => a + b, 0);
        if (pick[seg] > 0 && (total >= RULES.rechargeSegments || sh.segments[seg] + pick[seg] >= cap)) pick[seg]--; // klik znovu = ubrat
        else if (total < RULES.rechargeSegments && sh.segments[seg] + pick[seg] < cap) pick[seg]++;
        renderSide();
      },
      recharge: (id) => {
        const sh = game!.state.ships.find((x) => x.id === id);
        if (!sh) return;
        const segs = sh.shieldType === "segment" ? game!.rechargePick : undefined;
        net.send({ type: "rechargeShield", shipId: id, segments: segs?.some((n) => n > 0) ? segs : undefined });
        sfx("click");
        game!.rechargeOpen = false;
        game!.rechargePick = [0, 0, 0, 0];
        if (sh.shieldType === "segment") closeShieldEdit(game!, id);
        renderSide();
      },
      weaponToggle: (id, type) => {
        game!.selectedShipId = id;
        game!.weaponOpen = game!.weaponOpen === type ? null : type;
        game!.droidOpen = false;
        if (!game!.scanPick) game!.scanOpen = false;
        renderSide();
      },
      scanToggle: (id) => {
        game!.selectedShipId = id;
        game!.weaponOpen = null;
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
        sfx(mode === "deep" ? "deepScan" : "click");
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
                team: sh.team,
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
              renderLoadout({ loadout: sh.loadout, team: sh.team, readonly: true, hideHead: true, budget: g.state.tuning.startBudget, allowed: g.state.settings.allowedModules, compact: true, showCargo: true, selectedId: chosenId }),
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
let logOpen = false;

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
  // v režimu otočky je nejnižší rychlost 2
  const speed = g.speedLock.get(id) ?? Math.max(cur.koiogran ? 2 : 1, Math.min(5, Math.round(d / (MOVE_UNIT * 0.9))));
  setManeuver(id, speed, angle, cur.koiogran);
}

function confirmManeuver(id: string): boolean {
  const g = game!;
  const ship = g.state.ships.find((s) => s.id === id);
  const o = g.orders.get(id);
  if (!ship || !o) return false;
  const man = resolveManeuver(profileFor(ship, o), o.maneuverId, ship.speed);
  if (!man || effStressCost(man, o) > ship.stressPoints) {
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
  // volba jiné akce zavře otevřená okénka droida / skeneru (podmenu zbraně zůstává jen pro její vlastní tlačítka)
  g.droidOpen = false;
  if (!g.scanPick) g.scanOpen = false;
  if (!id.startsWith("shot:")) g.weaponOpen = null;
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
  if (id.startsWith("shot:")) {
    // dlaždice modulu zbraně: vypnuto → zapnout (a zvolit), zapnuto a nezvolené → zvolit, zvolené → vypnout
    const moduleId = id.slice(5);
    const mod = ship.loadout.modules.find((x) => x.id === moduleId);
    if (!mod) return;
    const shots = shotsOf(ship, o);
    const has = shots.some((sh) => sh.moduleId === moduleId);
    if (has && g.activeShot === moduleId) {
      g.orders.set(shipId, { ...o, shots: shots.filter((sh) => sh.moduleId !== moduleId) });
      g.activeShot = undefined;
      sfx("cancel");
    } else if (has) {
      g.activeShot = moduleId;
      sfx("toggle");
    } else {
      const why = mod.type === "laser" && inStorm(g.state, ship) ? "v bouři lasery nefungují" : !moduleWorking(mod) ? "modul je zničený" : mod.type === "mg" && (mod.ammo ?? 0) <= 0 ? "došly náboje" : actionCost(ship, o) >= RULES.actionPoints ? `žádná volná akce (max. ${RULES.actionPoints} za kolo)` : null;
      if (why) {
        showError(`${MODULES[mod.type].name}: ${why}.`);
        return;
      }
      g.orders.set(shipId, { ...o, shots: [...shots, { moduleId }] });
      g.activeShot = moduleId;
      sfx("toggle");
    }
    g.picking = null;
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
  sfx(a.active(next, ship) ? "toggle" : "cancel");
  g.orders.set(shipId, next);
  g.picking = a.pick && a.active(next, ship) ? a.pick : null;
  g.shieldEdit = a.id === "shield" && next.action?.type === "shield";
  if (a.id === "jettison") g.jettisonPick = false; // výběr modulu probíhá v okénku nad tlačítkem
  if (a.id === "jettison" || a.id === "pickup") g.cargoOpen = true;
  g.minePick = a.id === "mine" && next.special?.type === "mine" ? "timer" : null;
  renderSide();
}

/** Posluchače na window patří k právě otevřené hře; při jejím opuštění se odeberou (jinak se hromadily a drželi staré plátno v paměti). */
let inputAbort = new AbortController();

function bindInput(c: HTMLCanvasElement) {
  inputAbort.abort();
  inputAbort = new AbortController();
  let panning = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  const worldPos = (e: { clientX: number; clientY: number }) => {
    const rect = c.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { ...cam!.toWorld(sx, sy), sx, sy };
  };

  /* ---------- dotyk: prsty, pinch, tažení z lodi, podržení ---------- */
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; mx: number; my: number } | null = null;
  let aimDrag: string | null = null; // loď, ze které se táhne dráha
  let longPress = 0;
  let longPressed = false;
  const TAP_SLOP = 8;
  const AIM_OFFSET = 50; // duch lodi se drží nad prstem, aby ho prst nezakrýval

  const startAiming = (shipId: string): boolean => {
    const g = game!;
    const ship = g.state.ships.find((s) => s.id === shipId)!;
    const o = g.orders.get(shipId)!;
    const curCost = actionCost(ship, o);
    const adjusting = curCost > actionCost(ship, { ...o, maneuverId: defaultOrders(ship).maneuverId });
    if (curCost >= RULES.actionPoints && !adjusting) {
      showError("Úprava pohybu stojí akci a obě už máš použité. Odeber zbraň.");
      return false;
    }
    g.selectedShipId = shipId;
    g.picking = null;
    g.aimingShipId = shipId;
    aimBackup.set(shipId, o.maneuverId);
    return true;
  };

  c.addEventListener("pointerdown", (e) => {
    if (!game || !cam) return;
    if (e.pointerType === "mouse" && !isTouchMode()) {
      if (e.button !== 0) return;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      panning = true;
      return;
    }
    // dotykový režim
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(longPress);
    longPressed = false;
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (aimDrag) {
        // druhý prst při kreslení = zrušit kreslení, vrátit původní dráhu
        cancelAiming(aimDrag);
        aimDrag = null;
      }
      return;
    }
    if (fingers.size > 2) return;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    const w = worldPos(e);
    game.mouse = w;
    game.hoverId = undefined;
    game.hoverIcon = undefined;
    const hit = !game.anim && !game.submitted ? entityAt(w.x, w.y) : undefined;
    if (hit?.kind === "ship" && hit.ownerId === playerId && !iconAt(w.x, w.y)) {
      // tažení z vlastní lodi = kreslení dráhy (rozhodne se až po pohybu)
      aimDrag = hit.id;
    } else {
      aimDrag = null;
      // podržení = info o objektu pod prstem
      longPress = window.setTimeout(() => {
        if (!game) return;
        longPressed = true;
        const ent = entityAt(w.x, w.y);
        game.hoverId = ent?.id;
        const ic = iconAt(w.x, w.y);
        game.hoverIcon = ic ? `${ic.shipId}:${ic.id}` : undefined;
        game.mouse = w;
      }, 450);
    }
  });

  const touchMove = (e: PointerEvent) => {
    if (!game || !cam) return;
    const f = fingers.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX;
    f.y = e.clientY;
    if (pinch && fingers.size >= 2) {
      const [a, b] = [...fingers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const rect = c.getBoundingClientRect();
      if (pinch.dist > 0) cam.zoomAt(mx - rect.left, my - rect.top, dist / pinch.dist);
      cam.panBy(mx - pinch.mx, my - pinch.my);
      cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
      pinch = { dist, mx, my };
      moved = true;
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (!moved && !aimDragMoved(e)) return;
    moved = true;
    clearTimeout(longPress);
    if (aimDrag) {
      if (game.aimingShipId !== aimDrag && !startAiming(aimDrag)) {
        aimDrag = null;
        return;
      }
      const w = worldPos({ clientX: e.clientX, clientY: e.clientY - AIM_OFFSET });
      game.mouse = w;
      aimAt(w.x, w.y);
      renderSide();
      return;
    }
    cam.panBy(dx, dy);
    cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  // pomocná: první pohyb nad mrtvou zónou (měří se od místa dotyku)
  let downX = 0;
  let downY = 0;
  const aimDragMoved = (e: PointerEvent) => Math.hypot(e.clientX - downX, e.clientY - downY) >= TAP_SLOP;
  c.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });

  c.addEventListener("pointermove", (e) => {
    lastInputAt = performance.now();
    if (e.pointerType === "mouse" && !isTouchMode()) return; // myš řeší window.mousemove
    e.preventDefault();
    touchMove(e);
  });

  const touchEnd = (e: PointerEvent) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.delete(e.pointerId);
    clearTimeout(longPress);
    if (fingers.size < 2) pinch = null;
    if (fingers.size > 0) return;
    if (!game || !cam) return;
    const g = game;
    if (aimDrag) {
      const id = aimDrag;
      aimDrag = null;
      if (moved) {
        // dotyk: nakreslená dráha platí hned; tlačítko MANÉVR zezelená a jeho stisk manévr resetuje
        g.mouse = null;
        if (g.aimingShipId === id && !confirmManeuver(id)) cancelAiming(id);
        renderSide();
        return;
      }
      // ťuknutí na vlastní loď = jen výběr
      g.selectedShipId = id;
      g.picking = null;
      renderSide();
      return;
    }
    if (moved || longPressed) {
      longPressed = false;
      return;
    }
    if (g.anim || g.submitted) return;
    tapAt(worldPos(e), true);
  };
  c.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse" && !isTouchMode()) return;
    touchEnd(e);
  });
  c.addEventListener("pointercancel", (e) => {
    fingers.delete(e.pointerId);
    pinch = null;
    aimDrag = null;
    clearTimeout(longPress);
  });

  window.addEventListener("mousemove", (e) => {
    if (!cam || !game || isTouchMode()) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (panning) {
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) {
        cam.panBy(dx, dy);
        cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
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
  }, { signal: inputAbort.signal });

  window.addEventListener("mouseup", () => {
    panning = false;
  }, { signal: inputAbort.signal });

  c.addEventListener("click", (e) => {
    if (isTouchMode() || moved || !cam || !game || game.anim || game.submitted) return;
    tapAt(worldPos(e), false);
  });

  /** Klik / ťuknutí na mapu. */
  function tapAt(w: { x: number; y: number; sx: number; sy: number }, touch: boolean) {
    const g = game!;
    // klik vedle otevřeného okénka (štít / náklad) = potvrdit a zavřít
    let closed = false;
    if (g.cargoOpen) {
      g.cargoOpen = false;
      closed = true;
    }
    // otevřená okénka droida / skeneru: klik vedle je zavře (volby v plánu zůstávají)
    if (g.droidOpen) {
      g.droidOpen = false;
      closed = true;
    }
    if (g.scanOpen && !g.scanPick) {
      g.scanOpen = false;
      closed = true;
    }
    if (g.rechargeOpen) {
      g.rechargeOpen = false;
      g.rechargePick = [0, 0, 0, 0];
      closed = true;
    }
    if (g.shieldEdit) {
      const sel = g.state.ships.find((s) => s.id === g.selectedShipId);
      const so = sel && g.orders.get(sel.id);
      if (sel && so && shieldInHand(sel, so) > 0) showNotice("Nejdřív polož všechny body štítu (+).");
      else {
        closeShieldEdit(g, sel?.id ?? null);
        closed = true;
      }
    }
    if (closed) renderSide();
    // 1) míření: klik / ťuknutí kamkoliv potvrdí dráhu
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
    // 3) vlastní loď: označit a začít kreslit dráhu (myš); na dotyku se kreslí tažením
    if (hit?.kind === "ship" && hit.ownerId === playerId) {
      if (touch) {
        g.selectedShipId = hit.id;
        g.picking = null;
        renderSide();
        return;
      }
      if (startAiming(hit.id)) renderSide();
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
    /** Cíl pro aktivní střelu (zvolený modul), jinak výchozí cíl lodi pro všechny střely bez vlastního cíle. */
    const setTarget = (id: string | undefined) => {
      const shots = shotsOf(sel, o);
      const idx = shots.findIndex((sh) => sh.moduleId === g.activeShot);
      if (idx >= 0) {
        const next = shots.map((sh, i) => (i === idx ? (id ? { ...sh, targetId: id } : { moduleId: sh.moduleId }) : sh));
        g.orders.set(sel.id, { ...o, shots: next });
      } else g.orders.set(sel.id, { ...o, preferredTargetId: id });
    };
    if (hit && (hit.kind === "debris" || hit.kind === "comet")) {
      const curShot = shotsOf(sel, o).find((sh) => sh.moduleId === g.activeShot);
      const cur = curShot ? curShot.targetId : o.preferredTargetId;
      setTarget(cur === hit.id ? undefined : hit.id);
      renderSide();
      return;
    }
    if (hit && hit.team !== sel.team) {
      if (o.special?.type === "torpedo" && dist(sel, hitPos(hit)) <= torpedoLockRange(sel)) {
        g.orders.set(sel.id, { ...o, special: { type: "torpedo", targetId: hit.id }, preferredTargetId: hit.id });
        g.picking = null;
      } else {
        setTarget(hit.id);
        // zvolený laser na cíl nedosáhne: říct proč (dostřel / výseč / asteroid / bouře)
        const act = shotsOf(sel, g.orders.get(sel.id)!).find((sh) => sh.moduleId === g.activeShot);
        const mod = act && sel.loadout.modules.find((x) => x.id === act.moduleId);
        const tShip = hit.kind === "ship" ? g.state.ships.find((x) => x.id === hit.id) : undefined;
        if (mod?.type === "laser" && tShip) {
          const why = laserReachShip(g.state, sel, tShip, mod.id);
          if (why) showNotice(`${MODULES.laser.name}${sel.loadout.modules.filter((x) => x.type === "laser").length > 1 ? ` ${sel.loadout.modules.filter((x) => x.type === "laser").indexOf(mod) + 1}` : ""}: ${why} – vystřelí na nejbližšího ve výseči.`);
        }
      }
      renderSide();
      return;
    }
    if (!hit && o.special?.type === "torpedo" && (g.picking === "torpedo" || !o.special.targetId)) {
      if (dist(sel, w) <= torpedoPointRange(sel)) {
        g.orders.set(sel.id, { ...o, special: { type: "torpedo", point: { x: Math.round(w.x), y: Math.round(w.y) } } });
        g.picking = null;
        renderSide();
      } else showError("Bod je dál než dolet torpéda (1200).");
    }
  }

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
          setManeuver(id, sp, cur.angle, cur.koiogran);
        }
        return;
      }
      cam.zoomAt(sx, sy, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      cam.clampTo(game.state.width, game.state.height, game.state.border ?? 0);
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
    if (musicOverlay) {
      if (e.key === "Escape") {
        closeMusicPanel();
        e.preventDefault();
      }
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
    if (e.key === "f" || e.key === "F") {
      lookAtShip(game.selectedShipId);
      return;
    }
    if (e.key === "p" || e.key === "P") {
      setAskConfirm(game.skipConfirm);
      return;
    }
    if (e.key === "m" || e.key === "M") {
      setMuted(!isMuted());
      showNotice(isMuted() ? "Zvuk ztlumen (M)" : "Zvuk zapnut (M)");
      return;
    }
    const id = game.selectedShipId;
    const o = id && game.orders.get(id);
    const cur = o ? parseManeuverId(o.maneuverId) : null;
    if (e.key === "Escape" && (game.submitted || !id || !cur || (!game.shieldEdit && !game.rechargeOpen && !game.minePick && !game.picking && !game.aimingShipId && !game.jettisonPick && !game.inventoryOpen && !tuningOpen && !game.scanPick && !game.cargoOpen))) {
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
      } else if (game.rechargeOpen) {
        game.rechargeOpen = false;
        game.rechargePick = [0, 0, 0, 0];
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
      setManeuver(id, Number(e.key), cur.angle, cur.koiogran);
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
  }, { signal: inputAbort.signal });
}

function hitPos(hit: Entity): { x: number; y: number } {
  const view = game!.view;
  const s = hit.kind === "ship" ? view.ships.find((x) => x.id === hit.id) : hit.kind === "torpedo" ? view.torpedoes.find((x) => x.id === hit.id) : hit.kind === "comet" ? view.comets.find((x) => x.id === hit.id) : view.debris.find((x) => x.id === hit.id);
  return s ?? { x: 0, y: 0 };
}

/* ------------------------------------------------------------------ */
/* Vykreslení                                                           */
/* ------------------------------------------------------------------ */

/** Úvodní obrazovka: jen logo a SPUSTIT HRU – klik povolí zvuk, pak v menu proběhne animace loga s hudbou. */
let splash = true;
function renderSplash() {
  clear(app);
  app.append(
    h(
      "div",
      { class: "screen splash" },
      h(
        "div",
        { class: "center" },
        logoCanvas(6, true),
        h("button", { class: "primary splash-btn", onclick: () => enterMenu() }, icon("play", "currentColor", 16), " ", label("Spustit hru")),
        h("div", { class: "muted txt splash-note" }, "Tahová vesmírná střílečka pro více hráčů"),
      ),
    ),
  );
}
function enterMenu() {
  splash = false;
  render();
  firstGesture();
}

function render() {
  if (screen === "game") {
    renderSide();
    return;
  }
  if (splash) {
    renderSplash();
    return;
  }
  renderLobby(app, { playerId, name: playerName, rooms, room, error: error || notice, connected }, net, setName);
}

applyTouchClass();
initTooltips();
render();
net.connect();
void loadLibrary();
// zvuk: odemknout prvním vstupem; v menu se pak znovu přehraje animace loga se zvukem a spustí hudba
let audioStarted = false;
const firstGesture = () => {
  if (audioStarted) return;
  // na úvodní obrazovce čekáme na tlačítko SPUSTIT HRU (klik = povolení zvuku prohlížečem)
  if (splash && screen !== "game") return;
  audioStarted = true;
  unlockAudio();
  if (screen === "game") {
    playMode("game");
    return;
  }
  // animaci spustit až s rozběhnutým audiem, jinak by zvuk zaostal za obrazem
  void audioReady().then(() => {
    const dur = replayLogo(true);
    setTimeout(() => playMode(screen === "game" ? "game" : "menu"), dur);
  });
};
// po přímém návratu do rozehrané bitvy (bez úvodní obrazovky) odemkne zvuk první vstup
window.addEventListener("pointerdown", firstGesture);
window.addEventListener("keydown", firstGesture);
window.addEventListener("keydown", (e) => {
  if (game) return;
  if (e.key === "Escape" && musicOverlay) closeMusicPanel();
  else if ((e.key === "m" || e.key === "M") && !(e.target instanceof HTMLInputElement)) setMuted(!isMuted());
});
// cvaknutí tlačítka hned při stisku (click přichází až po puštění myši a působí opožděně); klávesnice přes click
const uiClick = (e: Event) => {
  const b = (e.target as HTMLElement | null)?.closest?.("button");
  if (!b || b.disabled) return;
  if (b.closest(".bottombar, .scan-pop, .cargo-pop, .shield-pop, .confirm")) return;
  sfx("click");
};
document.addEventListener("pointerdown", (e) => e.button === 0 && uiClick(e));
document.addEventListener("click", (e) => e.detail === 0 && uiClick(e));
setSfxListener(() => {
  if (!game) return { points: [], radius: 960 };
  const view = game.anim ? game.anim.view : game.view;
  const mine = game.state.ships.filter((s) => s.alive && s.ownerId === playerId);
  return { points: mine.map((s) => view.ships.find((v) => v.id === s.id) ?? s).map((s) => ({ x: s.x, y: s.y })), radius: mine[0]?.stats.vision ?? 960 };
});
try {
  document.fonts?.load("15px Jersey");
  document.fonts?.load("8px PS2P");
} catch {
  /* ignore */
}

// Ladicí přístup ke stavu (pro automatické testy v prohlížeči).
(window as unknown as { __sg: () => unknown }).__sg = () => ({ game, cam, playerId, net, room });
