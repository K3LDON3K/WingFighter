import {
  HULLS,
  PILOTS,
  moduleHp,
  moduleMaxHp,
  moduleWorking,
  type ModuleInstance,
  type Debris,
  RULES,
  COMET,
  CARGO,
  cargoCapacity,
  dist,
  actionList,
  laserOdds,
  FACING_NAMES,
  inStorm,
  SCANNER,
  scannerModule,
  shieldRechargeBlocked,
  shieldRechargeRoom,
  loadoutWeight,
  mgPreview,
  mineModule,
  mineSideOf,
  MODULES,
  profileOf,
  WEIGHT,
  FIGHTER_PROFILE,
  MOVE_UNIT,
  MAX_ANGLE,
  ANGLE_STEP,
  laserTarget,
  laserReach,
  parseManeuverId,
  resolveManeuver,
  type Maneuver,
  type Ship,
  STRESS,
  maneuverStress,
  effStressCost,
  profileFor,
  makeManeuver,
  effEvadeCost,
  droidModule,
  reservedTech,
  DROID,
  REPAIR,
  hullOf,
  occupiedSlots,
  repairModule,
  repairBlocked,
  repairableModules,
  ammoModules,
  repairHullAmount,
  repairCost,
  botPredictActive,
  HACK,
  hackerModule,
  hackAccess,
  hackBlocked,
  hackCost,
  type HackOrder,
  type ModuleType,
  MODULE_TYPES,
  stationInPickupRange,
  type RepairOrder,
  type SlotId,
  TEAM_COLORS,
  type Difficulty,
  type GameState,
  type MineSide,
  type Segments,
  type ShipOrders,
  defaultOrders,
  shotsOfType,
  shotTargetId,
  actionCost,
  actionPointsOf,
} from "@wingfighter/shared";
import { clear, h } from "../dom.ts";
import { isTouchMode } from "../touch.ts";
import { actionTip } from "./tips.ts";
import { tipAttr } from "../tooltip.ts";
import { infoDialog } from "../dialog.ts";
import { icon, label, segBar } from "../icons.ts";
import { ACTIONS, actionAvailable, stoppedNow } from "./actions.ts";
import { SEGMENT_NAMES, shieldBubble, strengthColor } from "./shield-ui.ts";
import { pilotBadge } from "../pilot-ui.ts";
import { moduleColor, moduleStateHex, renderLoadout, showTip, slotHexOffset } from "../loadout-ui.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  chooseAction(shipId: string, actionId: string): void;
  /** Zrušit naplánovanou akci (křížek pod tlačítkem s podnabídkou). */
  cancelAction(shipId: string): void;
  /** Komunikace se stanicí: okénko, objednávka modulu. */
  commToggle(shipId: string): void;
  commOrder(shipId: string, stationId: string, moduleType: ModuleType): void;
  aim(shipId: string): void;
  /** ✕ pod MANÉVR: při kreslení vrátí původní dráhu, jinak nastaví rovně stejnou rychlostí (zdarma). */
  cancelManeuver(shipId: string): void;
  ready(): void;
  unready(): void;
  /** Otevře inventář s výběrem modulu k vyhození. */
  jettisonPick(shipId: string): void;
  /** Skener: vysunout/zasunout tlačítka, zapnout výběr cíle, provést hned. */
  scanToggle(shipId: string): void;
  /** Otevřít / zavřít podmenu zbraně s více moduly. */
  weaponToggle(shipId: string, type: "laser" | "mg"): void;
  droidToggle(shipId: string): void;
  /** Droid – opravář: otevřít/zavřít okénko, zvolit úkon, zvolit modul z nákladu (instalace), provést hned. */
  repairToggle(shipId: string): void;
  repairMode(shipId: string, kind: RepairOrder["kind"] | null): void;
  repairPickCargo(shipId: string, moduleId: string | null): void;
  repair(shipId: string, order: RepairOrder): void;
  /** Droid – hacker: okénko, volba úkonu (zapne výběr cíle na mapě), zrušení výběru, provedení. */
  hackToggle(shipId: string): void;
  hackMode(shipId: string, kind: HackOrder["kind"] | null): void;
  hack(shipId: string, order: HackOrder): void;
  /** Dobití štítu technologií: nabídka, výběr segmentu (+1 / −1), provést hned. */
  /** Okénko štítu: režim přesunu (akce) / dobití (technologie) / zavřít. */
  shieldMode(shipId: string, mode: "move" | "recharge" | "close"): void;
  rechargePick(shipId: string, seg: number): void;
  recharge(shipId: string): void;
  scanPickTarget(shipId: string, on: boolean): void;
  scan(shipId: string, mode: "deep" | "cooldown" | "predict"): void;
  /** Pozorovatel: tabulka skóre / opuštění hry. */
  showScore(): void;
  leave(): void;
  cargoToggle(shipId: string): void;
  /** Vybraný modul k vyhození – potvrdí a zavře okénko nákladu. */
  jettisonChosen(shipId: string, moduleId: string): void;
  /** Přepnout potvrzování nevyužitých akcí (přepínač nad SPUSTIT KOLO, klávesa P). */
  toggleConfirm(): void;
  confirmLaunch(go: boolean): void;
  /** Úprava štítu: změna bodů segmentu o ±1, potvrzení rozložení. */
  shieldDelta(shipId: string, segment: number, delta: number): void;
  shieldConfirm(shipId: string): void;
  centerOn(shipId: string): void;
  inventory(): void;
}

export interface PlanningModel {
  state: GameState;
  myId: string;
  orders: Map<string, ShipOrders>;
  aimingShipId: string | null;
  /** Aktivní střela (id modulu) – klik na nepřítele jí přiřadí cíl. */
  activeShot?: string;
  selectedShipId?: string;
  submitted: boolean;
  ready: string[];
  animating: boolean;
  picking?: "torpedo" | "lock";
  minePick?: "side" | "timer" | null;
  /** Otevřený režim úpravy štítu (–/+ u segmentů). */
  shieldEdit?: boolean;
  /** Skener: vysunutá tlačítka, čeká se na klik na loď. */
  scanOpen?: boolean;
  /** Otevřené podmenu zbraně (víc modulů stejného typu): "laser" | "mg". */
  weaponOpen?: "laser" | "mg" | null;
  droidOpen?: boolean;
  repairOpen?: boolean;
  repairKind?: RepairOrder["kind"] | null;
  repairCargoId?: string | null;
  hackOpen?: boolean;
  commOpen?: boolean;
  turnPick?: boolean;
  hackKind?: HackOrder["kind"] | null;
  /** Vybraný cíl hacku na mapě: mina / torpédo / cizí loď (id). */
  hackSel?: { kind: "mine" | "torpedo" | "ship"; id: string } | null;
  rechargeOpen?: boolean;
  rechargePick?: number[];
  scanPick?: boolean;
  /** Vysunutá nabídka nákladu (vyhodit / zvednout). */
  cargoOpen?: boolean;
  inventoryOpen?: boolean;
  /** Ptát se před spuštěním kola s nevyužitými akcemi. */
  askConfirm?: boolean;
  /** Otevřené potvrzení nevyužitých akcí nad tlačítkem SPUSTIT KOLO (volné / celkem). */
  confirm?: { unused: number; total: number } | null;
}

/** Kolik bodů štítu je "v ruce" (odebráno, ale ještě nerozmístěno). */
export function shieldInHand(ship: { segments: Segments }, o: ShipOrders): number {
  if (o.action?.type !== "shield") return 0;
  const sum = (a: Segments) => a[0] + a[1] + a[2] + a[3];
  return sum(ship.segments) - sum(o.action.segments);
}

/** Barvy náročnosti: zelený, bílý, oranžový („red“ = stres), červený (nebezpečný = stres + zranění). */
export const DIFFICULTY_COLOR: Record<Difficulty, string> = { green: "#4ade80", white: "#e2e8f0", red: "#fb923c", danger: "#f87171" };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  green: "zelený – vrátí 1 stresový bod",
  white: "bílý – bez vlivu",
  red: "oranžový – stojí 1 stresový bod",
  danger: `NEBEZPEČNÝ – stojí 2 body a ${STRESS.dangerHullPercent} % trupu`,
};
const DIFFICULTY_SHORT: Record<Difficulty, string> = { green: "zelený", white: "bílý", red: "oranžový", danger: "nebezpečný (červený)" };
/** Kategorie akcí v liště: zbraně · pohyb · speciální. */
const ACTION_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Zbraně", ids: ["laser", "mg", "torpedo", "mine"] },
  { label: "Pohyb", ids: ["move", "stop", "evade", "koiogran"] },
];
const FACING_GLYPH: Record<string, string> = { front: "↑", right: "→", back: "↓", left: "←" };
const ACTION_ICON: Record<string, string> = { pickup: "cargo", move: "pen", stop: "stop", laser: "laser", mg: "mg", torpedo: "torpedo", mine: "mine", koiogran: "turn", evade: "evade", shield: "segments", jettison: "debris" };

function angleGlyph(angle: number, koiogran: boolean): string {
  if (koiogran) return "⟲";
  if (angle === 0) return "↑";
  const a = Math.abs(angle);
  if (a <= 45) return angle < 0 ? "↖" : "↗";
  return angle < 0 ? "↰" : "↱";
}

/** Spodní lišta: stav lodi, manévr, zbraně, spuštění kola. Pevné rozměry – text nemění velikost UI. */
/** Cena akce vpravo nahoře na tlačítku: červené čtverečky = akce, žluté = náboje skeneru. */
function costPips(n: number, color: "red" | "yellow" | "spent", title: string): HTMLElement {
  const el = h("span", { class: `cost-pips ${color}`, title });
  for (let i = 0; i < n; i++) el.append(h("i", {}, color === "spent" ? icon("tick", "#86efac", 9) : null));
  return el;
}
/**
 * Cena akce ve všech surovinách: červené = akce, růžové = stres, žluté = technologie.
 * `spent` = akce už je zaplacená (čtverečky tmavé s fajfkou). Zelený manévr stres vrací – růžový čtvereček s „+“.
 */
function costPipsAll(c: { actions?: number; stress?: number; tech?: number }, spent: boolean, title: string): HTMLElement {
  const el = h("span", { class: `cost-pips multi ${spent ? "spent" : ""}`, title });
  for (let i = 0; i < (c.actions ?? 0); i++) el.append(h("i", { class: "red" }, spent ? icon("tick", "#86efac", 9) : null));
  if ((c.stress ?? 0) < 0) el.append(h("i", { class: "pink plus" }, "+"));
  for (let i = 0; i < (c.stress ?? 0); i++) el.append(h("i", { class: "pink" }, spent ? icon("tick", "#86efac", 9) : null));
  for (let i = 0; i < (c.tech ?? 0); i++) el.append(h("i", { class: "yellow" }, spent ? icon("tick", "#86efac", 9) : null));
  return el;
}

/** Okénka otevřená při minulém vykreslení – při překreslení (klik na +/−) se znovu neanimují. */
let openPops = new Set<string>();
const popsNow = new Set<string>();
type ModuleInstanceLike = { id: string; type: import("@wingfighter/shared").ModuleType; slot: SlotId; ammo?: number; hp?: number };
const popClass = (key: string) => (popsNow.add(key), openPops.has(key) ? "noanim" : "");

/** Obsah nápovědy k manévrům (rychlosti, úhly, barvy, stres, akce). */
function maneuverHelp(ship: Ship): HTMLElement {
  const prof = profileOf(ship.loadout);
  const sw = (col: string) => h("i", { class: "hswatch", style: `background:${col}` });
  const li = (...c: (Node | string)[]) => h("li", {}, ...c);
  const hullProf = HULLS[ship.loadout.hullId]?.profile ?? FIGHTER_PROFILE;
  const limits = Array.from({ length: hullProf.maxSpeed }, (_, i) => i + 1).map((s) => `${s}: ±${hullProf.maxAngle[s]}°`).join(" · ");
  return h(
    "div",
    { class: "mhelp" },
    h("h4", {}, label("Dráha")),
    h("ul", {}, li(`Manévr = rychlost + změna kurzu. Dráha je oblouk: délka = rychlost × ${MOVE_UNIT} jednotek, loď se po ní otočí o zvolený úhel.`), li("Kreslení: klik na loď, směr podle polohy myši (úhel = 2× směr k myši), rychlost podle vzdálenosti. Kolečko / klávesy 0–5 rychlost zamknou, K = otočka, mezerník potvrdí."), li(`Zastavení: ZASTAVIT bez nakreslené dráhy zastaví hned (z rychlosti 1 bílé${prof.stopMax >= 2 ? ", stíhač i z 2 oranžově +1 stres" : ""}; také klávesa 0 nebo myš těsně u lodi). Nakreslíš-li nejdřív dráhu a pak stiskneš ZASTAVIT, loď ji proletí a na jejím konci zastaví (dráha rychlostí 1 bílé${prof.stopMax >= 2 ? ", rychlostí 2 oranžové" : ""}; 1 akce navíc, duch má odznak ■, panel ukáže „2 → 0“).`), li(`Stojící loď nemůže uhýbat ani dělat otočku 180°; tlačítkem OTOČKA (= OTOČIT) se za 1 akci otočí na místě do libovolného směru (myš: loď se otáčí za kurzorem, klik potvrdí; dotyk: táhni prstem po mapě) – i v kole, kdy právě zastavila – a pak vyrazí: ${prof.startMax >= 2 ? "stíhač na 1 (zelený) nebo rovnou na 2 (oranžový)" : "bitevník jen na 1"}.`), ship.loadout.hullId === "battleship" ? li("Bitevník úhybný manévr neumí.") : null),
    h("h4", {}, label("Rychlost")),
    h("ul", {}, li(`${HULLS[ship.loadout.hullId]?.name ?? "Loď"}: 1–${hullProf.maxSpeed}; tvoje loď teď max. ${prof.maxSpeed} (váha výbavy: každých ${WEIGHT.perSpeed} váhy = −1; overdrive droida váhu ignoruje).`), li(`Otočka o 180° jde jen z rychlosti ${prof.koiogranSpeeds.length ? `${Math.min(...prof.koiogranSpeeds)}–${Math.max(...prof.koiogranSpeeds)}` : "–"}, stojí 2 akce (s overdrivem 1) a po ní rychlost klesne o ${RULES.koiogranSpeedDrop}.`)),
    h("h4", {}, label("Úhel")),
    h("ul", {}, li(`Krok ${ANGLE_STEP}°, max. ±${MAX_ANGLE}°. Čím rychleji, tím míň: ${limits}.`)),
    h("h4", {}, label("Barvy (náročnost)")),
    h(
      "ul",
      { class: "hcolors" },
      li(sw(DIFFICULTY_COLOR.green), h("b", {}, "zelený"), ` – mírný: rychlost 1–2 do 40°, nebo rychlost 3 rovně. Vrátí +${STRESS.regenGreen} stres (autopilot droida +${DROID.autopilotRegen}).`),
      li(sw(DIFFICULTY_COLOR.white), h("b", {}, "bílý"), " – vše ostatní, co není ostré. Nic nestojí."),
      li(sw(DIFFICULTY_COLOR.red), h("b", {}, "oranžový"), ` – ostrý úhel (od 70°, při rychlosti 4+ od 40°) nebo změna rychlosti o 2. Stojí ${STRESS.costRed} stres.`),
      li(sw(DIFFICULTY_COLOR.danger), h("b", {}, "nebezpečný (červený)"), ` – ostrý úhel a zároveň změna rychlosti o 2, nebo změna rychlosti o ${prof.deltaDanger}${prof.deltaDanger === prof.deltaMax ? "" : " a víc"} (bitevník už o 2); změna o víc než ${prof.deltaMax} nejde. Stojí ${STRESS.costDanger} stres a ${STRESS.dangerHullPercent} % trupu.`),
      li(h("span", { class: "man-koi" }, "⟲"), h("b", {}, "otočka"), " – vždy aspoň oranžová: 1 stres na zelené/bílé křivce, 2 na oranžové, 3 na nebezpečné."),
    ),
    h("h4", {}, label("Stres a akce")),
    h("ul", {}, li(`Stresové body ${ship.stressPoints}/${ship.stats.stressMax}: bez dostatku se manévr vůbec nenabídne.`), li("Rovně stejnou rychlostí je zdarma; jakákoli změna rychlosti nebo úhlu stojí 1 akci „úprava pohybu“ (akce na kolo: 2)."), li("Dráha nehlídá překážky: srážka s lodí (i dotykem štítů), asteroidem nebo stanicí = 15 zranění a zastavení na místě (rychlost 0, náraz do asteroidu i nuluje stres); kometa odmrští; okraj odrazí. Bouře vypne štíty a lasery.")),
  );
}

/** Panel „Manévr“ (náhled nakreslené dráhy: směr, rychlost, úhel, náročnost). */
function maneuverPanel(ship: Ship, o: ShipOrders, man: Maneuver | null): HTMLElement {
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false, stop: false };
  const dcolor = man ? (o.droid?.overdrive && maneuverStress(man) > 0 ? DIFFICULTY_COLOR.white : DIFFICULTY_COLOR[man.difficulty]) : "#f87171";
  return h(
    "div",
    { class: "pnl bb-maneuver" },
    h("div", { class: "ttl man-ttl" }, label("Manévr")),
    h(
      "div",
      { class: "man-readout", title: man ? DIFFICULTY_LABEL[man.difficulty] : "Neplatný manévr" },
      h("span", { class: "man-glyph", style: `color:${dcolor}` }, angleGlyph(cur.angle, false), cur.koiogran ? h("span", { class: "man-koi", title: "Otočka 180° na konci" }, "⟲") : null),
      h("span", { class: "man-speed" }, cur.stop ? `${cur.speed}→0` : String(cur.speed)),
    ),
    h("div", { class: "man-angle" }, `${Math.abs(cur.angle)}°${cur.koiogran ? " +180°" : ""}`),
    h("div", { class: "man-diff", style: `color:${dcolor}` }, label(man ? (effStressCost(man, o) > ship.stressPoints ? "chybí stres" : o.droid?.overdrive && maneuverStress(man) > 0 ? "overdrive" : DIFFICULTY_SHORT[man.difficulty]) : "neplatný")),
    h("div", { class: "spacer" }),
    // dole vedle sebe: otazník nápovědy a klávesa mezerník
    h(
      "div",
      { class: "man-foot" },
      h("div", { class: "keycap", title: "Mezerník začne / potvrdí kreslení dráhy" }, label("mezerník")),
      h("button", { class: "px tiny qbtn", title: "Nápověda: rychlosti, úhly, barvy manévrů, zastavení a otočení", onclick: () => infoDialog({ title: "Manévry – nápověda", body: maneuverHelp(ship), wide: true }) }, "?"),
    ),
  );
}

/**
 * Lehká aktualizace při kreslení dráhy: vymění jen panel Manévr (celá lišta se překreslí až po potvrzení).
 * Vrací false, když panel v liště není (pak je potřeba plné překreslení).
 */
export function updateManeuverPanel(root: HTMLElement, m: PlanningModel): boolean {
  const old = root.querySelector(".bb-maneuver");
  if (!old) return false;
  const my = m.state.ships.filter((s) => s.alive && s.ownerId === m.myId);
  const ship = my.find((s) => s.id === m.selectedShipId) ?? my[0];
  if (!ship) return false;
  const o = m.orders.get(ship.id) ?? defaultOrders(ship);
  const man = resolveManeuver(profileFor(ship, o), o.maneuverId, ship.speed);
  old.replaceWith(maneuverPanel(ship, o, man));
  return true;
}

/** Spodní lišta (root) + podlišta pod ní (sub): ukazatele akce/stres/technologie a popisek k vybrané akci. */
export function renderBottomBar(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks, sub?: HTMLElement) {
  clear(root);
  if (sub) clear(sub);
  popsNow.clear();
  renderBottomBarInner(root, m, cb, sub);
}
/** Po vykreslení lišty i postranních segmentů: zapamatovat otevřená okénka (ať se při překreslení znovu neanimují). */
export function finishPops() {
  openPops = new Set(popsNow);
}

function renderBottomBarInner(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks, sub?: HTMLElement) {
  const my = m.state.ships.filter((s) => s.alive && s.ownerId === m.myId);
  const ship = my.find((s) => s.id === m.selectedShipId) ?? my[0];

  if (m.state.status === "finished") return;
  if (!ship) {
    root.append(
      h(
        "div",
        { class: "pnl bb-status bb-spectator" },
        h("div", { class: "bb-big" }, icon("wait", "#7dd3fc", 18), label("Pozorovatel")),
        h("div", { class: "txt muted" }, m.animating ? "Přehrává se kolo… Všechny tvoje lodě byly zničeny; sleduješ zbytek bitvy a vidíš celou mapu." : "Všechny tvoje lodě byly zničeny. Bitva pokračuje – sleduješ ji jako pozorovatel a vidíš celou mapu."),
        h(
          "div",
          { class: "row" },
          h("button", { class: "px", onclick: () => cb.showScore() }, icon("log", "currentColor", 10), " ", label("Tabulka skóre"), h("span", { class: "k" }, "TAB")),
          h("button", { class: "px danger", onclick: () => cb.leave() }, icon("wait", "currentColor", 10), " ", label("Opustit hru")),
        ),
      ),
    );
    return;
  }
  const o = m.orders.get(ship.id) ?? defaultOrders(ship);
  // po odeslání i během vyhodnocování kola zůstává lišta vidět, jen jsou všechna tlačítka vypnutá
  const locked = m.submitted || m.animating;
  const man = resolveManeuver(profileFor(ship, o), o.maneuverId, ship.speed);
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false, stop: false };
  const acts = actionList(ship, o);
  const aiming = m.aimingShipId === ship.id;

  /* ---- 1. loď: pixelová bublina štítu + svislé ukazatele ---- */
  const planned = o.action?.type === "shield" ? o.action.segments : undefined;
  const inHand = shieldInHand(ship, o);
  const editing = !!planned && !locked && !!m.shieldEdit; // okénko −/+ otevřené; klik vedle = potvrdit
  const rechargeMode = !!m.rechargeOpen && !locked && ship.shieldType === "segment"; // okénko štítu v režimu DOBÍT (technologie)
  const rechargeWhy = shieldRechargeBlocked(m.state, ship);
  const teamColor = TEAM_COLORS[ship.team];
  const stormed = inStorm(m.state, ship);
  const bubbleSize = 106;
  const bubble = h("div", { class: "bubble-box", title: ship.shieldType === "whole" ? `Energetický štít: zásoba ${ship.shields}/${ship.stats.shields}${RULES.shieldRecharge > 0 ? `, dobíjí se +${RULES.shieldRecharge} za kolo` : ""}${RULES.wholeEffDrop > 0 ? `, účinnost ${ship.shieldEff} % (po každém zásahu −${RULES.wholeEffDrop} %)` : ""}. Lasery pole jen vybíjejí; projektily prorazí ${RULES.wholePiercePct} % do trupu.` : `Segmentový štít (předek / pravobok / záď / levobok): ${ship.segments.join(" / ")}. Projektil zachytí segment celý za 1 bod; laser ubere 1 bod a ${RULES.segmentPassPct} % pronikne do trupu; při 0 jde vše do trupu.` }, shieldBubble({ ...ship, maxShields: ship.stats.shields, hullId: ship.loadout.hullId }, teamColor, planned, bubbleSize, stormed));
  const shieldBox = h("div", { class: "shield-box" }, bubble);
  const shieldPopOpen = false; // štít je v segmentu LOĎ vpravo (renderInventoryBar)
  const vgauge = (n: number, val: number, color: string, dark: string, name: string, num: string | Node, title: string, blockedFrom = n) => {
    const bar = h("div", { class: "vbar" });
    // dílky nad blockedFrom jsou blokované váhou (tmavě červené s rámečkem)
    for (let i = 0; i < n; i++) bar.append(h("i", { class: i >= blockedFrom ? "blocked" : "", style: i >= blockedFrom ? "" : `background:${i < val ? color : dark}` }));
    return h("div", { class: "vgauge", title }, bar, h("span", { class: "vname" }, label(name)), h("span", { class: "vnum", style: `color:${color}` }, num));
  };
  const hullBlocks = Math.max(ship.hull > 0 ? 1 : 0, Math.round((10 * ship.hull) / ship.stats.hull));
  const maxSp = profileFor(ship, o).maxSpeed;
  const gauges = h(
    "div",
    { class: "gauges" },
    vgauge(10, hullBlocks, ship.hull <= ship.stats.hull * 0.3 ? "#ef4444" : "#4ade80", "#14341f", "trup", String(ship.hull), `Trup ${ship.hull}/${ship.stats.hull}`),
    (() => {
      // plánovaná rychlost: hned podle nakresleného manévru (modře), po kole se ukáže nová aktuální
      const planSp = man ? man.speed : ship.speed;
      const changed = planSp !== ship.speed;
      const col = changed ? "#7dd3fc" : "#94a3b8";
      const num = h("span", {}, changed ? h("span", { class: "vplan" }, `${planSp}`) : `${ship.speed}`, "/", maxSp < 5 ? h("span", { class: "vmax-blocked" }, String(maxSp)) : String(maxSp), maxSp < 5 ? " " : "", maxSp < 5 ? icon("weight", "#f87171", 9) : "");
      return vgauge(
        5,
        planSp,
        col,
        "#1e293b",
        "rychlost",
        num,
        `${changed ? `Plán: rychlost ${planSp} (teď ${ship.speed}).` : `Aktuální rychlost ${ship.speed}.`} ${maxSp < 5 ? `Váha výbavy (${loadoutWeight(ship.loadout)}) blokuje rychlost ${maxSp + 1}–5: max. ${maxSp}. Lehčí výbava = vyšší rychlost.` : `Max. ${maxSp} (váha ${loadoutWeight(ship.loadout)}).`}`,
        maxSp,
      );
    })(),
  );
  const right = h("div", { class: "bb-shipinfo" }, gauges);
  // štít vypnutý bouří je vidět přímo v nákresu lodi (štítek „štít vypnut“) – samostatný popisek vpravo dole už není
  const shieldLine =
    ship.shieldType === "whole" && !stormed
      ? h("div", { class: "bb-row" }, icon("shield", strengthColor(ship.shields / Math.max(1, ship.stats.shields))), h("span", { class: "num" }, `${Math.round((100 * ship.shields) / Math.max(1, ship.stats.shields))} %`), h("span", { class: "muted", title: "Účinnost: kolik % zranění štít pohltí" }, label(`úč. ${ship.shieldEff} %`)))
      : null;
  if (shieldLine) right.append(shieldLine);
  // jméno hráče / lodi je na záložce nad panelem (na horní hraně lišty)
  const status = h(
    "div",
    { class: "pnl bb-ship" },
    h(
      "div",
      { class: "bb-tab", style: `color:${teamColor}` },
      (() => {
        const cr = m.state.players.find((p) => p.id === m.myId)?.credits;
        return cr !== undefined ? h("div", { class: "bb-cr", title: "Kredity: zbytek rozpočtu + odměny (za sestřely, trosky, přežití)" }, icon("credits", "#fbbf24", 10), ` ${cr} CR`) : null;
      })(),
      h("span", { class: "txt" }, ship.name),
      my.length > 1 ? h("div", { class: "ship-tabs" }, ...my.map((s, i) => h("button", { class: `px ${s.id === ship.id ? "on" : ""}`, title: `${s.name} · ${HULLS[s.loadout.hullId]?.name ?? ""} · ${PILOTS[s.loadout.pilotId]?.name ?? ""} · trup ${s.hull}/${s.stats.hull}`, onclick: () => cb.select(s.id) }, icon(s.loadout.hullId === "battleship" ? "battleship" : "ship", "currentColor", 9), ` ${i + 1}`))) : null,
    ),
    h("div", { class: "bb-shipbody" }, shieldBox, right),
  );

  /* ---- 1b. výzbroj: munice každého modulu ---- */
  // všechny moduly: zbraně s municí, ostatní jen se stavem; každý má ukazatel životů (zničený = červený, nefunguje)
  const ammoMods = [...ship.loadout.modules].sort((a, b) => Number(b.ammo !== undefined || b.type === "laser") - Number(a.ammo !== undefined || a.type === "laser"));
  // víc než 4 moduly: kompaktní řádky (nižší dlaždice, munice číslem), aby se vešly všechny
  const many = ammoMods.length > 4;
  const weapons = h("div", { class: `pnl bb-ammo ${many ? "compact" : ""}` }, h("div", { class: "ttl" }, label("Výzbroj")));
  if (ammoMods.length === 0) weapons.append(h("div", { class: "muted txt" }, "bez modulů"));
  const counters: Record<string, number> = {};
  const typeCount: Record<string, number> = {};
  for (const md of ammoMods) typeCount[md.type] = (typeCount[md.type] ?? 0) + 1;
  /** Životy modulu: svislá „baterie“ – 5 segmentů po 20 % (zelená > 60 %, žlutá > 30 %, jinak červená). */
  const hpGauge = (md: ModuleInstance) => {
    const hp = moduleHp(md);
    const max = moduleMaxHp(md.type);
    const pct = hp / max;
    const lit = Math.ceil(pct * 5 - 1e-9);
    const col = pct > 0.6 ? "g" : pct > 0.3 ? "y" : "r";
    const g = h("span", { class: `mod-hpv ${hp === 0 ? "dead" : ""}` });
    for (let i = 0; i < 5; i++) g.append(h("i", { class: i < lit ? col : "" }));
    return g;
  };
  const WEAPON_COL: Record<string, string> = { laser: "#f87171", torpedo: "#f87171", mine: "#f87171", mg: "#fde047", scanner: "#a78bfa", "shield-segment": "#60a5fa", "shield-whole": "#60a5fa" };
  for (const md of ammoMods) {
    const def = MODULES[md.type];
    counters[md.type] = (counters[md.type] ?? 0) + 1;
    const max = def.ammo ?? 0;
    const left = md.ammo ?? 0;
    const broken = !moduleWorking(md);
    const nameFull = `${def.name}${typeCount[md.type] > 1 ? ` ${counters[md.type]}` : ""}${md.facing ? ` – ${FACING_NAMES[md.facing]}` : ""}`;
    const hp = moduleHp(md);
    const hpTxt = broken ? "ZNIČENÝ – nefunguje" : `životy ${hp}/${moduleMaxHp(md.type)}`;
    const ammoTxt = md.type === "laser" ? "bez munice (střílí každé kolo)" : md.ammo !== undefined ? `munice ${left}/${max}` : "";
    const tile = h("span", { class: `wtile ${broken ? "dead" : ""}` }, icon(def.icon, broken ? "#f87171" : (WEAPON_COL[md.type] ?? "#e2e8f0"), 12), md.facing ? h("span", { class: "wfac" }, FACING_GLYPH[md.facing]) : null);
    const icons = h("span", { class: "ammo-icons" });
    if (!broken) {
      if (md.type === "laser") icons.append(h("span", { class: "inf" }, "∞"));
      else if (md.type === "mg") {
        const lit = Math.round((left / Math.max(1, max)) * 10);
        for (let i = 0; i < 10; i++) icons.append(h("i", { class: `mgpip ${i < lit ? "on" : ""}` }));
      } else if (md.ammo !== undefined) for (let i = 0; i < max; i++) icons.append(icon(def.icon, i < left ? "#f87171" : "#334155", 10));
    }
    if (many && !broken && md.ammo !== undefined && md.type !== "laser") {
      // kompaktní řádek: munice číslem místo ikon
      icons.replaceChildren(h("span", { class: "ammo-num", style: `color:${left === 0 ? "#f87171" : "#e2e8f0"}` }, `${left}/${max}`));
    }
    weapons.append(h("div", { class: `ammo-row ${broken ? "broken" : ""}`, title: `${nameFull}\n${hpTxt}${ammoTxt ? `\n${ammoTxt}` : ""}` }, hpGauge(md), tile, icons));
  }

  /* ---- 2. manévr (svislý sloupec) ---- */
  const maneuver = maneuverPanel(ship, o, man);

  /* ---- 3. akce ---- */
  const apips = h("div", { class: "apip" });
  for (let i = 0; i < actionPointsOf(ship); i++) apips.append(h("i", { class: i < actionPointsOf(ship) - acts.length ? "on" : "" }));
  /** Skupina suroviny v hlavičce (varianta C): popisek nad pilulkami. */
  const resGroup = (name: string, pips: HTMLElement, title: string, cls = "") => h("div", { class: `res-grp ${cls}`, title }, h("span", { class: "res-lbl" }, label(name)), pips);
  const spips = h("div", { class: "apip pink" });
  for (let i = 0; i < ship.stats.stressMax; i++) spips.append(h("i", { class: i < ship.stressPoints ? "on" : "" }));
  const inStormNow = inStorm(m.state, ship);
  const tpips = h("div", { class: `apip yellow ${inStormNow ? "storm" : ""}` });
  const reserved = reservedTech(o); // v plánu (droid, zvednout + nasadit) – odečte se při SPUSTIT KOLO
  for (let i = 0; i < ship.stats.techMax; i++) tpips.append(h("i", { class: i < ship.techPoints - reserved ? "on" : i < ship.techPoints ? "plan" : "" }));
  const resources = h(
    "div",
    { class: "res-row" },
    resGroup("Akce", apips, `Akce: ${actionPointsOf(ship) - acts.length}/${actionPointsOf(ship)} volné. Dobíjí se každé kolo.`),
    resGroup("Stres", spips, `Stresové body ${ship.stressPoints}/${ship.stats.stressMax}: oranžový manévr −1, nebezpečný (červený) −2, zelený +1.`),
    resGroup(inStormNow ? "Technologie ⚡ bouře" : "Technologie", tpips, `Technologie ${ship.techPoints}/${ship.stats.techMax}: body na celou bitvu, nedobíjí se (průlet ocasem komety: los – buď štít, nebo +${COMET.tailTech}). Sken lodi ${SCANNER.shipCost}, hluboký sken ${SCANNER.deepCost}.${inStormNow ? "\nV bouři je technologie deaktivovaná – skener nefunguje." : ""}`, inStormNow ? "storm" : ""),
  );
  /** Kolik akcí tlačítko právě stojí (tečky): otočka 2, manévr 1 (jen když se liší od rovně stejnou rychlostí), ostatní 1. */
  const dotsFor = (id: string) => (id === "koiogran" ? (acts.some((a) => a.id === "koiogran") ? 2 : 0) : id === "move" ? (acts.some((a) => a.id === "move") && !acts.some((a) => a.id === "koiogran") ? 1 : 0) : acts.some((a) => a.id === id) ? 1 : 0);
  // dva řádky: nahoře zbraně (při mnoha modulech se zalamují), dole pohyb · loď · speciální
  const rowTop = h("div", { class: "act-line act-line-top" });
  const rowBot = h("div", { class: "act-line" });
  const buttons = h("div", { class: "bb-weapons" }, rowTop, rowBot);
  for (const grp of ACTION_GROUPS) {
    const avail = grp.ids.map((id) => ACTIONS.find((x) => x.id === id)!).filter((a) => actionAvailable(a, ship));
    // skupina bez dostupných akcí se neukazuje; Loď = NÁKLAD (vyhodit / zvednout), Speciální = štít, skener, droid
    if (avail.length === 0) continue;
    const box = h("div", { class: "act-group" }, h("span", { class: "act-cap" }, label(grp.label)));
    const row = h("div", { class: "act-row" });
    for (const a of avail) {
      if (a.id === "laser" || a.id === "mg") {
        // jedna dlaždice na typ zbraně; víc modulů = vyjížděcí podmenu s jedním tlačítkem na modul (vlastní akce a cíl)
        const type = a.id;
        const mods = ship.loadout.modules.filter((x) => x.type === type);
        const shots = shotsOfType(ship, o, type);
        const stormOff = stormed && type === "laser";
        const allDestroyed = mods.length > 0 && mods.every((x) => !moduleWorking(x));
        const modTile = (mod: ModuleInstance, i: number, small: boolean) => {
          const shot = shots.find((x) => x.mod.id === mod.id);
          const on = !!shot;
          const isActive = on && m.activeShot === mod.id;
          const destroyed = !moduleWorking(mod);
          const noAmmo = type === "mg" && (mod.ammo ?? 0) <= 0;
          const noAp = !on && actionCost(ship, o) >= actionPointsOf(ship);
          const why = destroyed ? "ZNIČENO – modul nefunguje" : stormOff ? "systém je v bouři mimo provoz" : noAmmo ? "došly náboje" : noAp ? `žádná volná akce (max. ${actionPointsOf(ship)} za kolo)` : null;
          const name = `${MODULES[type].name}${mods.length > 1 ? ` ${i + 1}` : ""} · ${FACING_NAMES[mod.facing ?? "front"]}`;
          const tid = shot ? shotTargetId(o, shot.shot) : undefined;
          const tname = tid ? (m.state.ships.find((x) => x.id === tid)?.name ?? "cíl") : null;
          return h(
            "button",
            {
              class: `px bb-weapon ${small ? "sm" : ""} ${on && !stormOff ? "on" : ""} ${isActive ? "aim" : ""} ${stormOff ? "stormed" : ""} ${on ? "spent" : ""} ${destroyed ? "destroyed" : ""}`,
              disabled: locked || stormOff || destroyed || (!!why && !on),
              ...tipAttr({
                ...actionTip(a.id, ship, o, man, destroyed ? null : why),
                ...(on ? { note: `${name}${tname ? ` → ${tname}` : " → výchozí cíl / nejbližší"}${isActive ? " · zvolený: klik na nepřítele = jeho cíl · stisk = vypnout" : " · stisk = zvolit (pak klik na nepřítele = jeho cíl)"}` } : { note: `${name} · stisk = střílet (1 akce)` }),
                ...(destroyed ? { warn: "ZNIČENO – modul nefunguje" } : {}),
              }),
              onclick: () => cb.chooseAction(ship.id, `shot:${mod.id}`),
            },
            costPipsAll({ actions: 1 }, on, "stojí 1 akci"),
            icon(ACTION_ICON[a.id] ?? "target", "currentColor", 22),
            h("span", { class: "lbl" }, label(small ? `${i + 1}` : type === "laser" ? "Lasery" : "Kulomet"), h("span", { class: "wfac" }, FACING_GLYPH[mod.facing ?? "front"]), small ? h("span", { class: "wammo" }, mod.ammo !== undefined ? ` ${mod.ammo}` : "") : null),
            on ? h("span", { class: "shot-tick" }, "✓") : null,
            stormOff ? h("span", { class: "sb" }, "⚡") : null,
            destroyed ? h("span", { class: "dead-x" }, "✕") : null,
          );
        };
        if (mods.length <= 1) {
          if (mods[0]) row.append(modTile(mods[0], 0, false));
          continue;
        }
        // souhrnná dlaždice: počet střílejících modulů; klik otevře podmenu
        const onCount = shots.length;
        const open = m.weaponOpen === type;
        const holder = h("div", { class: `scan-holder ${open ? "stack" : ""}` });
        holder.append(
          h(
            "button",
            {
              class: `px bb-weapon ${onCount > 0 && !stormOff ? "on" : ""} ${onCount > 0 && onCount < mods.filter((x) => moduleWorking(x)).length ? "partial" : ""} ${open ? "open" : ""} ${stormOff ? "stormed" : ""} ${onCount > 0 ? "spent" : ""} ${allDestroyed ? "destroyed" : ""}`,
              disabled: locked || stormOff || allDestroyed,
              ...tipAttr({ ...actionTip(a.id, ship, o, man, allDestroyed ? null : stormOff ? "systém je v bouři mimo provoz" : null), note: `${mods.length}× ${MODULES[type].name} · stisk otevře volbu modulů (každý modul = 1 akce, vlastní cíl)${onCount ? ` · střílí ${onCount}` : ""}` }),
              onclick: () => cb.weaponToggle(ship.id, type),
            },
            costPipsAll({ actions: onCount || 1 }, onCount > 0, onCount ? `utraceno ${onCount} ${onCount === 1 ? "akce" : "akce"}` : "1 akce za každý modul"),
            icon(ACTION_ICON[a.id] ?? "target", "currentColor", 22),
            h("span", { class: "lbl" }, label(type === "laser" ? "Lasery" : "Kulomet")),
            // stav jednotlivých modulů i bez rozbalení: zeleně střílí, bílý rám = zvolený, šedě nestřílí, přeškrtnuté = zničený
            h(
              "span",
              { class: "wmods" },
              ...mods.map((mod, i) => {
                const on = shots.some((x) => x.mod.id === mod.id);
                return h("i", { class: `${on ? "on" : ""} ${on && m.activeShot === mod.id ? "aim" : ""} ${moduleWorking(mod) ? "" : "dead"}` }, `${i + 1}${FACING_GLYPH[mod.facing ?? "front"]}`);
              }),
            ),
            onCount > 0 ? h("span", { class: "shot-tick" }, onCount > 1 ? `✓${onCount}` : "✓") : null,
            stormOff ? h("span", { class: "sb" }, "⚡") : null,
            allDestroyed ? h("span", { class: "dead-x" }, "✕") : null,
          ),
        );
        if (open && !stormOff) holder.append(h("div", { class: `scan-pop ${popClass(`weapon:${type}:${ship.id}`)}` }, ...mods.map((mod, i) => modTile(mod, i, true))));
        row.append(holder);
        continue;
      }
      const isMove = a.id === "move";
      const active = isMove ? aiming : a.active(o, ship);
      // manévr nakreslen a potvrzen: zelené tlačítko, stisk = reset na rovně stejnou rychlostí
      const moveDone = isMove && !aiming && (o.maneuverId !== defaultOrders(ship).maneuverId || !!o.pathDrawn);
      // štít: upraveno a okénko zavřené = hotovo (zelené), stisk = reset (zrušit úpravu)
      const shieldDone = a.id === "shield" && !!planned && !editing && !rechargeMode;
      const stopDone = a.id === "stop" && !!parseManeuverId(o.maneuverId)?.stop;
      const done = moveDone || shieldDone || stopDone;
      const stormOff = stormed && (a.id === "laser" || a.id === "shield");
      // všechny moduly, které akce potřebuje, jsou zničené → tlačítko „zničeno“ (šrafování + křížek)
      const destroyed = !!a.requiresModule && ship.loadout.modules.some((x) => x.type === a.requiresModule) && !ship.loadout.modules.some((x) => x.type === a.requiresModule && moduleWorking(x));
      let why = destroyed ? "ZNIČENO – modul nefunguje" : stormOff ? "systém je v bouři mimo provoz" : a.disabled(ship, m.state, o);
      // ŠTÍT: i bez volné akce jde otevřít kvůli dobití technologií
      const shieldAlt = a.id === "shield" && !!why && !stormOff && !destroyed && !rechargeWhy;
      if (shieldAlt) why = null;
      const dots = dotsFor(a.id); // > 0 = akce je za toto tlačítko utracená
      const wbtn =
        h(
          "button",
          {
            class: `px bb-weapon ${(active || (a.id === "shield" && shieldPopOpen)) && !stormOff && !done ? "on" : ""} ${done ? "done" : ""} ${stormOff ? "stormed" : ""} ${dots > 0 ? "spent" : ""} ${destroyed ? "destroyed" : ""}`,
            disabled: locked || stormOff || destroyed || (!!why && !active && !done && dots === 0),
            ...tipAttr({
              ...actionTip(a.id, ship, o, man, destroyed ? null : why),
              ...(stopDone ? { note: "loď proletí dráhu a na jejím konci zastaví · stisk = zrušit zastavení" } : moveDone ? { note: "nakresleno a platí · stisk = reset (rovně stejnou rychlostí, zdarma)" } : shieldDone ? { note: "úprava platí · stisk = otevřít (upravit, dobít, reset)" } : a.id === "shield" && rechargeMode ? { note: "režim DOBÍT – klik vedle = zavřít" } : a.id === "shield" && editing ? { note: "rozmísti body −/+ a klikni vedle – úprava se potvrdí" } : {}),
              ...(destroyed ? { warn: "ZNIČENO – modul nefunguje" } : {}),
            }),
            onclick: () =>
              moveDone
                ? cb.cancelManeuver(ship.id)
                : a.id === "shield"
                  ? shieldPopOpen
                    ? cb.shieldConfirm(ship.id)
                    : shieldDone
                      ? cb.shieldMode(ship.id, "move")
                      : shieldAlt
                        ? cb.shieldMode(ship.id, "recharge")
                        : cb.chooseAction(ship.id, a.id)
                  : isMove
                    ? cb.aim(ship.id)
                    : cb.chooseAction(ship.id, a.id),
          },
          (() => {
            // cena ve všech surovinách: otočka 2 akce + stres oranžového manévru, úhyb 1 akce + stres, manévr 1 akce + stres podle nakreslené dráhy
            const turnInPlace = a.id === "koiogran" && stoppedNow(ship, o);
            const stopMan = a.id === "stop" ? (() => { const cur = parseManeuverId(o.maneuverId); const atEnd = !!cur && cur.speed > 0 && (!!o.pathDrawn || cur.speed !== ship.speed || cur.angle !== 0 || cur.stop); return atEnd ? makeManeuver(profileFor(ship, o), cur!.speed, cur!.angle, false, ship.speed, true) : makeManeuver(profileFor(ship, o), 0, 0, false, ship.speed); })() : null;
            const manStress = turnInPlace ? 0 : a.id === "koiogran" ? (man?.koiogran ? effStressCost(man, o) : effStressCost("red", o)) : a.id === "move" && man && !man.koiogran ? effStressCost(man, o) : stopMan ? effStressCost(stopMan, o) : 0;
            const c = { actions: a.id === "koiogran" && !turnInPlace ? (o.droid?.overdrive ? 1 : 2) : 1, stress: a.id === "evade" ? effEvadeCost(o) : manStress };
            const parts = [`${c.actions} ${c.actions === 1 ? "akci" : "akce"}`];
            if (c.stress > 0) parts.push(`${c.stress} stres`);
            if (c.stress < 0) parts.push(`vrací ${-c.stress} stres`);
            // během kreslení manévru (aiming) ukazujeme cenu bez fajfek – zaplaceno je až po potvrzení
            return costPipsAll(c, dots > 0 && !(isMove && aiming), `stojí ${parts.join(" + ")}${a.id === "move" ? " (rovně stejnou rychlostí zdarma)" : ""}`);
          })(),
          icon(isMove && aiming ? "check" : a.id === "koiogran" && stoppedNow(ship, o) ? "center" : (ACTION_ICON[a.id] ?? "target"), "currentColor", 22),
          h("span", { class: "lbl" }, label(isMove ? (aiming ? "Potvrdit" : "Manévr") : a.id === "koiogran" && stoppedNow(ship, o) ? "Otočit" : a.label.replace(/ \([12] akce\)/, "").replace(" 180°", "").replace("Úhybný manévr", "Úhyb").replace("Úprava štítu", "Štít").replace("Vyhodit modul", "Vyhodit").replace("Zvednout náklad", "Náklad"))),
          stopDone ? h("span", { class: "reset-strip" }, label("na konci dráhy")) : done ? h("span", { class: "reset-strip" }, "↺ ", label("reset")) : null,
          stormOff ? h("span", { class: "sb" }, "⚡") : null,
          destroyed ? h("span", { class: "dead-x" }, "✕") : null,
        );
      row.append(wbtn);
    }
    if (grp.label === "Speciální") {
      // Komunikace se stanicí: funkční stanice v dohledu → objednávka modulu (1 akce, cena jako v obchodě)
      const stnComm = (m.state.stations ?? []).filter((x) => !x.broken && dist(ship, x) <= ship.stats.vision + x.radius);
      if (stnComm.length) {
        const commOn = o.action?.type === "comm";
        const credits = m.state.players.find((p) => p.id === m.myId)?.credits ?? 0;
        const allowed = m.state.settings.allowedModules ?? {};
        const busy = stnComm.every((x) => x.orderedTurn === m.state.turn);
        const holder = h("div", { class: `scan-holder ${m.commOpen ? "stack" : ""}` });
        const cur = commOn ? (o.action as { moduleType: ModuleType }).moduleType : undefined;
        holder.append(
          h(
            "button",
            {
              class: `px bb-weapon ${commOn ? "done" : ""} ${m.commOpen ? "on open" : ""} ${dotsFor("comm") ? "spent" : ""}`,
              disabled: locked || busy,
              ...tipAttr({ icon: "scan", iconColor: "#a5f3fc", title: "Komunikace se stanicí", cost: { actions: 1 }, fx: [{ icon: "credits", text: "objednáš modul za cenu z obchodu" }, { icon: "debris", text: "stanice ho vypustí jako trosky směrem k tobě – sebrat ho může kdokoliv" }], note: busy ? "stanice už tento kolo objednávku vyřídila" : `kredity ${credits} · 1 objednávka na stanici za kolo · funkční stanice v dohledu: ${stnComm.length}`, ...(busy ? { warn: "Nelze: linka obsazena." } : {}) }),
              onclick: () => (commOn && !m.commOpen ? cb.cancelAction(ship.id) : cb.commToggle(ship.id)),
            },
            costPips(1, dotsFor("comm") ? "spent" : "red", "stojí 1 akci"),
            icon("scan", "currentColor", 22),
            h("span", { class: "lbl" }, label(commOn ? "Objednáno" : "Komunikace")),
            commOn && !m.commOpen ? h("span", { class: "reset-strip" }, label(`${MODULES[cur!].short} ↺`)) : null,
          ),
        );
        if (m.commOpen && !locked) {
          const pop = h("div", { class: "cargo-pop comm-pop" });
          pop.append(h("div", { class: "jp-head" }, icon("credits", "#fbbf24", 12), label(`kredity ${credits} · stanice vypustí modul k tobě na konci kola`)));
          const list = h("div", { class: "comm-list" });
          for (const t of MODULE_TYPES) {
            if (allowed[t] === 0) continue;
            const def = MODULES[t];
            const can = credits >= def.price;
            list.append(
              h("button", { class: `px rmod ${cur === t ? "on" : ""}`, disabled: !can, title: can ? `${def.name}: objednat za ${def.price} kreditů` : `${def.name}: nedostatek kreditů (${def.price})`, onclick: () => cb.commOrder(ship.id, stnComm[0].id, t) }, icon(def.icon, moduleColor(t), 14), h("span", { class: "lbl" }, label(def.name)), h("span", { class: "rx" }, icon("credits", "#fbbf24", 10), ` ${def.price}`)),
            );
          }
          pop.append(list);
          holder.append(pop);
        }
        row.append(holder);
      }
    }
    box.append(row);
    (grp.label === "Zbraně" ? rowTop : rowBot).append(box);
  }
  if (!rowTop.childElementCount) rowTop.remove();
  const details = h("div", { class: "bb-details" });
  const seg = (content: Node | string, active: boolean, title: string, onclick: () => void) => h("button", { class: `px seg ${active ? "on" : ""}`, disabled: locked, title, onclick }, content);
  /** Výběr modulu (když je jich víc stejného typu): 1, 2, … s municí. */
  const modulePicker = (type: "laser" | "torpedo" | "mg", currentId: string | undefined, onPick: (id: string) => void) => {
    const mods = ship.loadout.modules.filter((m) => m.type === type);
    if (mods.length < 2) return null;
    return h(
      "div",
      { class: "segs-btn", title: `Ze kterého modulu (${MODULES[type].name}) – jeden za akci` },
      ...mods.map((m, i) =>
        moduleWorking(m)
          ? seg(`${i + 1}${FACING_GLYPH[m.facing ?? "front"]}${m.ammo !== undefined ? `·${m.ammo}` : ""}`, m.id === currentId, `${MODULES[type].name} ${i + 1} – ${FACING_NAMES[m.facing ?? "front"]}${m.ammo !== undefined ? ` (munice ${m.ammo})` : ""}`, () => onPick(m.id))
          : h("button", { class: "px seg destroyed", disabled: true, title: `${MODULES[type].name} ${i + 1} – ${FACING_NAMES[m.facing ?? "front"]}: ZNIČENÝ – nefunguje` }, `${i + 1}${FACING_GLYPH[m.facing ?? "front"]}`, h("span", { class: "dead-x" }, "✕")),
      ),
    );
  };
  if (m.scanOpen && scannerModule(ship.loadout)) {
    details.append(icon("scan", "#7dd3fc"));
    if (m.turnPick && o.action?.type === "turn") details.append(h("span", { class: "warn" }, label(isTouchMode() ? "otočení na místě: táhni prstem po mapě – loď se otáčí, zvednutí prstu potvrdí (ťuknutí = kurz k místu)" : "otočení na místě: loď se otáčí za myší – klik na mapě potvrdí (Esc = ponechat)")), h("span", { class: "muted" }, label(` · kurz ${Math.round((((o.action.heading * 180) / Math.PI) % 360 + 360) % 360)}°`)));
    if (m.scanPick) details.append(h("span", { class: "warn" }, label(`klikni na cizí loď v dohledu (dosah ${SCANNER.range}) – sken proběhne hned`)), h("span", { class: "muted" }, label(`· technologie ${ship.techPoints}/${ship.stats.techMax} · nebere akci`)));
    else details.append(h("span", { class: "muted" }, label(`technologie ${ship.techPoints}/${ship.stats.techMax} · nedobíjí se · nebere akci`)));
  } else if (shotsOfType(ship, o, "mg").length && o.special?.type !== "torpedo" && o.special?.type !== "mine" && (!shotsOfType(ship, o, "laser").length || shotsOfType(ship, o, "mg").some((x) => x.mod.id === m.activeShot))) {
    // kulomet: aktivní (zvolený) kulomet, jinak první
    const list = shotsOfType(ship, o, "mg");
    const cur = list.find((x) => x.mod.id === m.activeShot) ?? list[0];
    const mgs = ship.loadout.modules.filter((x) => x.type === "mg");
    const pv = mgPreview(m.state, ship, shotTargetId(o, cur.shot), cur.mod.id);
    const tname = pv ? (m.state.ships.find((x) => x.id === pv.targetId)?.name ?? (m.state.torpedoes.some((x) => x.id === pv.targetId) ? "torpédo" : "trosky")) : null;
    details.append(icon("target", pv ? "#4ade80" : "#fbbf24"), h("span", { class: "txt" }, `kulomet${mgs.length > 1 ? ` ${mgs.indexOf(cur.mod) + 1}` : ""}: ${pv ? tname : "nikdo ve výseči"}`));
    if (pv) {
      const pct = Math.round(pv.hitChance * 100);
      details.append(
        h("span", { class: "odds", style: `color:${pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171"}`, title: `Šance zásahu jednoho projektilu podle vzdálenosti; dávka ${pv.shots} projektilů.` }, label(`zásah ${pct} %`)),
        h("span", { class: "muted" }, label(`· ${pv.shots} projektilů · průměr ${Math.round(pv.expectedDamage)} zranění`)),
      );
    }
    details.append(h("span", { class: "muted" }, label(list.length > 1 ? "· klik na nepřítele = cíl zvoleného kulometu" : "· klik na cíl = zaměřit")));
  } else if (o.special?.type === "torpedo") {
    const sp = o.special;
    const tname = sp.targetId ? (m.state.ships.find((x) => x.id === sp.targetId)?.name ?? "torpédo") : null;
    const picker = modulePicker("torpedo", sp.moduleId, (id) => cb.setOrders(ship.id, { special: { ...sp, moduleId: id } }));
    if (picker) details.append(picker);
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
    const side: MineSide = mineSideOf(mineModule(ship)?.facing);
    const setMine = (patch: Partial<{ timer: number | undefined }>) => cb.setOrders(ship.id, { special: { type: "mine", timer: "timer" in patch ? patch.timer : timer, side } });
    details.append(
      icon("mine", "#94a3b8"),
      h("span", { class: "muted", title: "Stranu určuje natočení minového zásobníku (mění se v místnosti)" }, icon(side === "left" ? "left" : side === "right" ? "right" : "down", "currentColor", 12), " ", label(side === "left" ? "vlevo" : side === "right" ? "vpravo" : "za sebe")),
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
    if (m.minePick === "timer") details.append(h("span", { class: "warn" }, label("← klikni na mapě na čas výbuchu (✕ = jiné místo)")));
  } else if (o.action?.type === "jettison") {
    const ids = o.action.moduleIds;
    const chosenAll = ids.map((id) => ship.loadout.modules.find((x) => x.id === id) ?? (ship.loadout.cargo ?? []).find((x) => x.id === id)).filter((x): x is ModuleInstance => !!x);
    const chosen = chosenAll[0];
    details.append(icon("debris", "#94a3b8"));
    if (chosen) {
      const after = { ...ship.loadout, modules: ship.loadout.modules.filter((x) => !ids.includes(x.id)), cargo: (ship.loadout.cargo ?? []).filter((x) => !ids.includes(x.id)) };
      details.append(h("span", { class: "odds", style: "color:#4ade80" }, label(`✔ vyhodí se: ${chosenAll.map((x) => MODULES[x.type].name).join(", ")}`)), h("span", { class: "muted" }, label(`· váha ${loadoutWeight(ship.loadout)} → ${loadoutWeight(after)} · max. rychlost ${profileOf(ship.loadout).maxSpeed} → ${profileOf(after).maxSpeed}`)));
    } else details.append(h("span", { class: "warn" }, label("↑ přetáhni modul na vyhazovací slot v inventáři – jinak se nic nevyhodí")));
  } else if (o.action?.type === "pickup") {
    const wantId = o.action.targetId;
    const tgt = wantId ? (m.state.debris ?? []).find((d) => d.id === wantId) : undefined;
    const sp = cur.speed;
    details.append(icon("cargo", "#a7f3d0"));
    const stnTgt = wantId ? (m.state.stations ?? []).find((x) => x.id === wantId) : undefined;
    if (tgt) details.append(h("span", { class: "txt" }, `zvednout${o.action.installSlot ? " + nasadit" : ""}: ${MODULES[tgt.type].name}`), h("span", { class: "muted" }, label(`· ${Math.round(dist(ship, tgt))} / ${CARGO.range}`)));
    else if (stnTgt) details.append(h("span", { class: "txt" }, "nabrat náhodný modul ze stanice"));
    else details.append(h("span", { class: "warn" }, label("nic v dosahu – akce se nepočítá; přetáhni trosky do nákladu v inventáři")));
    if (sp > CARGO.maxSpeed) details.append(h("span", { class: "warn" }, label(`rychlost ${sp} > ${CARGO.maxSpeed} – nezvedne!`)));
    else details.append(h("span", { class: "muted" }, label(`· rychlost ${sp} ok · po střelbě, před pohybem`)));
  } else if (o.action?.type === "shield") {
    details.append(icon("segments", "#60a5fa"), h("span", { class: "txt" }, `štít ${o.action.segments.join(" / ")}`), inHand > 0 ? h("span", { class: "warn" }, label(`← rozmísti ${inHand} b. v panelu lodi`)) : h("span", { class: "muted" }, label("· platí od začátku kola")));
  } else if (shotsOfType(ship, o, "laser").length) {
    // lasery: aktivní (zvolený) laser, jinak první; každý má vlastní cíl
    const list = shotsOfType(ship, o, "laser");
    const cur = list.find((x) => x.mod.id === m.activeShot) ?? list[0];
    const lasers = ship.loadout.modules.filter((x) => x.type === "laser");
    const tid = shotTargetId(o, cur.shot);
    const debrisTarget = tid ? (m.state.debris ?? []).find((d) => d.id === tid) : undefined;
    const cometTarget = tid ? (m.state.comets ?? []).find((c) => c.id === tid) : undefined;
    const tname = tid ? (m.state.ships.find((x) => x.id === tid)?.name ?? (debrisTarget ? `trosky ${MODULES[debrisTarget.type].short} (+${debrisTarget.value})` : cometTarget ? `kometa (${cometTarget.hull} HP, +${COMET.reward})` : "torpédo")) : null;
    const target = debrisTarget || cometTarget ? undefined : laserTarget(m.state, ship, tid, cur.mod.id);
    details.append(icon("target", target ? "#4ade80" : "#fbbf24"), h("span", { class: "txt" }, `${lasers.length > 1 ? `laser ${lasers.indexOf(cur.mod) + 1}${FACING_GLYPH[cur.mod.facing ?? "front"]}: ` : ""}${tname ?? (target ? `nejbližší: ${target.name}` : "nikdo ve výseči")}`));
    if (target) {
      const odds = laserOdds(ship, target, cur.mod.id);
      const pct = Math.round(odds.hitChance * 100);
      const cov = Math.round(odds.coverage * 100);
      details.append(
        h(
          "span",
          { class: "odds", style: `color:${pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171"}`, title: `Šance aspoň na jeden čistý zásah (zásahy − úhyby) ze současných pozic, pásmo ${odds.rangeBand}${odds.rangeBand === 1 ? " (+1 kostka útoku)" : odds.rangeBand === 3 ? " (+1 kostka obrany)" : ""}.${odds.coverage < 1 ? ` Cíl je ve výseči jen z ${cov} % – šance je tím vynásobená.` : ""} Očekávané zranění ≈ ${Math.round(odds.expectedDamage)}.` },
          label(`zásah ${pct} %`),
        ),
        ...(odds.coverage < 1 ? [h("span", { class: "muted" }, label(`· ${cov} % v dosahu`))] : []),
        h("span", { class: "muted" }, label(`· průměr ${Math.round(odds.expectedDamage)} zranění`)),
      );
    } else if (tid && !debrisTarget && !cometTarget) details.append(h("span", { class: "warn" }, label("cíl mimo výseč – střelí na nejbližšího")));
    const pt = cometTarget ?? debrisTarget;
    if (pt) {
      const why = laserReach(m.state, ship, pt, cur.mod.id);
      details.append(why ? h("span", { class: "warn" }, label(`${why} – nevystřelí`)) : h("span", { class: "odds", style: "color:#4ade80" }, label("v dosahu")));
    }
    details.append(h("span", { class: "muted" }, label(list.length > 1 ? "· klik na nepřítele = cíl zvoleného laseru" : "· klik na nepřítele = cíl")));
  } else if (stormed) {
    details.append(h("span", { class: "pv" }, label("⚡ v bouři: lasery, štít a skener dočasně mimo provoz · torpéda letí rovně")));
  } else {
    details.append(h("span", { class: "muted" }, "—"));
  }
  const actions = h(
    "div",
    { class: "pnl bb-actions" },
    buttons,
  );
  // podlišta: ukazatele úplně vlevo, vedle popisek k vybrané akci
  if (sub) sub.append(resources, details);
  else actions.append(details);

  /* ---- 4. spuštění kola (úzký sloupec) ---- */
  let confirmPop: HTMLElement | null = null;
  if (m.confirm && !locked) {
    const { unused, total } = m.confirm;
    confirmPop = h(
      "div",
      { class: "confirm-pop", title: "Zbývají volné akce. Enter / klik = přesto spustit, Esc = zpět k plánování." },
      h("div", { class: "cp-title" }, label("Volné akce")),
      h("div", { class: "cp-text" }, h("b", {}, String(unused)), h("span", { class: "muted" }, ` / ${total}`)),
      h("button", { class: "px cp-go", onclick: () => cb.confirmLaunch(true) }, icon("play", "#fff", 10), label("spustit"), h("span", { class: "k" }, "ENTER")),
      h("div", { class: "cp-esc muted" }, label("esc = zpět")),
    );
  }
  const go = h(
    "div",
    { class: `pnl bb-go ${confirmPop ? "confirming" : ""}` },
    confirmPop,
    h(
      "div",
      { class: `launch-stack ${m.askConfirm ? "ask" : ""} ${locked ? "locked" : ""}` },
      h(
        "button",
        {
          class: "px bb-toggle",
          disabled: m.animating,
          title: `Potvrzení nevyužitých akcí: ${m.askConfirm ? "ZAPNUTO – před spuštěním kola se hra zeptá, když zbývá volná akce." : "VYPNUTO – kolo se spustí rovnou."} Klik nebo klávesa P přepne; platí pro všechny bitvy v této místnosti.`,
          onclick: () => cb.toggleConfirm(),
        },
        h("span", { class: "sw" }, h("i")),
        h("span", { class: "q" }, "?"),
      ),
      m.animating
        ? h("button", { class: "px bb-launch waiting", disabled: true }, icon("play", "#e2e8f0", 18), h("span", { class: "l1" }, label("Kolo")), h("span", { class: "sub" }, label("probíhá…")))
        : locked
        ? h("button", { class: "px bb-launch waiting", title: "Klik = vrátit se k úpravám", onclick: () => cb.unready() }, icon("wait", "#e2e8f0", 18), h("span", { class: "l1" }, label("Čekám")), h("span", { class: "sub" }, label("klik = upravit")))
        : h("button", { class: "px bb-launch", disabled: inHand > 0, title: inHand > 0 ? "Nejdřív rozmísti body štítu" : "Spustit kolo (Enter)", onclick: () => cb.ready() }, icon("play", "#fff", 16), h("span", { class: "l1" }, label("Spustit")), h("span", { class: "l2" }, label("kolo"))),
    ),
    h("div", { class: "keycap-row" }, h("div", { class: "keycap" }, "ENTER"), h("span", { class: "bb-turn", title: "Číslo kola" }, label(`kolo ${m.state.turn}${m.state.settings.turnLimit ? ` / ${m.state.settings.turnLimit}` : ""}`))),
  );

  /* ---- 5. pilot (svislý sloupec) ---- */
  const pilot = h("div", { class: "pnl bb-pilot" }, pilotBadge(ship.loadout.pilotId, true));

  root.append(status, weapons, actions, maneuver, pilot, go);
}

/**
 * Tažení hexu (myš i dotyk): po 6 px se objeví duch pod kurzorem; `onDrop` dostane element pod kurzorem při puštění,
 * `over` se volá při pohybu (zvýraznění cíle). Pouhý klik nic nedělá.
 */
function dragHex(ev: PointerEvent, ghostOf: () => SVGSVGElement, onDrop: (under: Element | null) => void, over?: (under: Element | null) => void) {
  if (ev.pointerType === "mouse" && ev.button !== 0) return;
  ev.preventDefault();
  const start = { x: ev.clientX, y: ev.clientY };
  let ghost: SVGSVGElement | null = null;
  let moved = false;
  const under = (e: PointerEvent) => {
    if (ghost) ghost.style.display = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (ghost) ghost.style.display = "";
    return el;
  };
  const onMove = (e: PointerEvent) => {
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!moved) {
      moved = true;
      ghost = ghostOf();
      ghost.classList.add("drag-ghost-html");
      document.body.append(ghost);
      document.body.classList.add("drag-on");
    }
    const w = ghost!.width.baseVal.value;
    const hh = ghost!.height.baseVal.value;
    ghost!.style.left = `${e.clientX - w / 2}px`;
    ghost!.style.top = `${e.clientY - hh / 2}px`;
    over?.(under(e));
  };
  const onUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (!moved) return;
    const el = under(e);
    ghost?.remove();
    document.body.classList.remove("drag-on");
    over?.(null);
    onDrop(el);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/* ===================== svislá lišta droidů (pravý okraj mapy) ===================== */

/** Plástev hexů slotů lodi (stejné rozložení jako v nákresu): `render(slot)` vrátí hex pro daný slot. */
function slotHoneycomb(slots: SlotId[], r: number, render: (slot: SlotId) => SVGSVGElement): HTMLElement {
  const w = 2 * r + 6;
  const hh = Math.sqrt(3) * r + 6;
  const offs = slots.map((s) => ({ s, ...slotHexOffset(s, r) }));
  const minX = Math.min(...offs.map((o) => o.x));
  const minY = Math.min(...offs.map((o) => o.y));
  const maxX = Math.max(...offs.map((o) => o.x));
  const maxY = Math.max(...offs.map((o) => o.y));
  const comb = h("div", { class: "dr-comb", style: `width:${maxX - minX + w}px;height:${maxY - minY + hh}px` });
  for (const o of offs) {
    const el = render(o.s);
    el.style.position = "absolute";
    el.style.left = `${o.x - minX}px`;
    el.style.top = `${o.y - minY}px`;
    comb.append(el);
  }
  return comb;
}

/**
 * Lišta droidů: Droid (pilot) · Opravář · Hacker pod sebou na pravém okraji mapy. Klik na droida vysune vlevo sloupec
 * podtlačítek (úkony s cenou v technologii); zvolený úkon otevře dál vlevo panel s hexy modulů (jako v nákladu).
 */
export function renderDroidBar(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
  clear(root);
  if (m.state.status === "finished") return;
  const my = m.state.ships.filter((s) => s.alive && s.ownerId === m.myId);
  const ship = my.find((s) => s.id === m.selectedShipId) ?? my[0];
  if (!ship) return;
  const has = (t: ModuleType) => ship.loadout.modules.some((x) => x.type === t);
  if (!has("droid") && !has("repair") && !has("hacker")) return;
  const o = m.orders.get(ship.id) ?? defaultOrders(ship);
  const locked = m.submitted || m.animating;
  const man = resolveManeuver(profileFor(ship, o), o.maneuverId, ship.speed);
  const stormed = inStorm(m.state, ship);
  const tech = ship.techPoints;
  const techNote = `technologie ${tech}/${ship.stats.techMax} · nebere akci · provede se hned`;
  root.append(h("div", { class: "cap" }, label("Droidi")));

  /** Podtlačítko úkonu (dlaždice se jménem a cenou v technologii). */
  const sub = (name: string, ic: string, cost: number, on: boolean, can: boolean, tip: Parameters<typeof tipAttr>[0], onclick: () => void, spent = false) =>
    h("button", { class: `px bb-weapon sm ${on ? "on" : ""}`, disabled: locked || !can, ...tipAttr(tip), onclick }, icon(ic, "currentColor", 22), h("span", { class: "lbl" }, label(name)), costPipsAll({ tech: cost }, spent, `${cost} ${cost === 1 ? "bod" : cost < 5 ? "body" : "bodů"} technologie`));
  const panelEl = (cap: string, ...body: (Node | null)[]) => h("div", { class: "dr-panel" }, h("div", { class: "cap" }, label(cap)), ...body, h("div", { class: "note" }, label(techNote)));
  const row = (main: HTMLElement, subs: HTMLElement[] | null, panel: HTMLElement | null, key: string) => {
    const r = h("div", { class: "dr-row" });
    if (subs) r.append(h("div", { class: `dr-fly ${popClass(key)}` }, panel, panel ? h("span", { class: "dr-conn" }) : null, h("div", { class: "dr-subs" }, ...subs)));
    r.append(main);
    root.append(r);
  };
  const slotName = (id: SlotId) => hullOf(ship.loadout).slots.find((x) => x.id === id)?.name ?? id;

  /* ---- Droid – pilot: Overdrive / Autopilot (platí se technologií až při SPUSTIT KOLO) ---- */
  if (has("droid")) {
    const dDestroyed = !droidModule(ship);
    const od = o.droid ?? {};
    const planned = reservedTech(o);
    const anyOn = !!od.overdrive || !!od.autopilot;
    const open = !!m.droidOpen && !stormed && !dDestroyed;
    const canOver = od.overdrive || tech - planned >= DROID.overdriveCost;
    const canAuto = od.autopilot || tech - planned >= DROID.autopilotCost;
    const main = h(
      "button",
      {
        class: `px bb-weapon droid-btn ${open ? "on" : ""} ${anyOn && !open ? "done" : ""} ${stormed ? "stormed" : ""} ${dDestroyed ? "destroyed" : ""}`,
        disabled: locked || stormed || dDestroyed,
        ...tipAttr({ ...actionTip("droid", ship, o, man), note: `technologie ${tech}/${ship.stats.techMax}${planned ? ` (v plánu −${planned})` : ""} · nebere akci · v bouři nefunguje`, ...(dDestroyed ? { warn: "ZNIČENO – modul nefunguje" } : stormed ? { warn: "Nelze: v bouři droid nefunguje." } : {}) }),
        onclick: () => cb.droidToggle(ship.id),
      },
      icon("bot", "currentColor", 22),
      h("span", { class: "lbl" }, label("Pilot")),
      anyOn ? costPipsAll({ tech: planned }, true, `v plánu: ${planned} technologie`) : null,
      anyOn && !open ? h("span", { class: "reset-strip" }, label(`${[od.overdrive ? "overdrive" : "", od.autopilot ? "autopilot" : ""].filter(Boolean).join(" + ")}`)) : null,
      stormed ? h("span", { class: "sb" }, "⚡") : null,
      dDestroyed ? h("span", { class: "dead-x" }, "✕") : null,
    );
    const subs = open
      ? [
          sub("Overdrive", "speed", DROID.overdriveCost, !!od.overdrive, canOver, { ...actionTip("overdrive", ship, o, man), ...(!canOver ? { warn: "Nelze: nedostatek technologie." } : {}) }, () => cb.setOrders(ship.id, { droid: { ...od, overdrive: !od.overdrive } }), !!od.overdrive),
          sub("Autopilot", "turn", DROID.autopilotCost, !!od.autopilot, canAuto, { ...actionTip("autopilot", ship, o, man), ...(!canAuto ? { warn: "Nelze: nedostatek technologie." } : {}) }, () => cb.setOrders(ship.id, { droid: { ...od, autopilot: !od.autopilot } }), !!od.autopilot),
        ]
      : null;
    row(main, subs, null, `droid:${ship.id}`);
  }

  /* ---- Droid – opravář: Modul / Munice / Trup / Nasadit, provádí se hned ---- */
  if (has("repair")) {
    const rDestroyed = !repairModule(ship);
    const why = repairBlocked(m.state, ship);
    const open = !!m.repairOpen && !why;
    const kind = m.repairKind ?? null;
    const main = h(
      "button",
      {
        class: `px bb-weapon droid-btn ${open ? "on" : ""} ${stormed ? "stormed" : ""} ${rDestroyed ? "destroyed" : ""}`,
        disabled: locked || !!why,
        ...tipAttr({ icon: "wrench", iconColor: "#c084fc", title: "Droid – opravář", fx: [], note: `${techNote} · v bouři nefunguje`, ...(rDestroyed ? { warn: "ZNIČENO – modul nefunguje" } : why ? { warn: `Nelze: ${why}.` } : {}) }),
        onclick: () => cb.repairToggle(ship.id),
      },
      icon("wrench", "currentColor", 22),
      h("span", { class: "lbl" }, label("Opravář")),
      (ship.autoRepair ?? 0) > 0 ? h("span", { class: "reset-strip" }, label(`oprava ${ship.autoRepair}`)) : null,
      stormed ? h("span", { class: "sb" }, "⚡") : null,
      rDestroyed ? h("span", { class: "dead-x" }, "✕") : null,
    );
    let subs: HTMLElement[] | null = null;
    let panel: HTMLElement | null = null;
    if (open) {
      const fixable = repairableModules(ship);
      const ammoable = ammoModules(ship);
      const hullAdd = repairHullAmount(ship);
      const cargo = ship.loadout.cargo ?? [];
      const tab = (k: RepairOrder["kind"], ic: string, name: string, avail: boolean, note: string) => {
        const c = repairCost(k);
        const can = avail && tech >= c;
        return sub(name, ic, c, kind === k, can, { icon: ic, iconColor: "#c084fc", title: `Opravář – ${name}`, fx: [], note, ...(tech < c ? { warn: "Nelze: nedostatek technologie." } : !avail ? { warn: "Nelze: není co dělat." } : {}) }, () => cb.repairMode(ship.id, kind === k ? null : k));
      };
      const running = ship.autoRepair ?? 0;
      subs = [
        tab("module", "wrench", "Modul", fixable.length > 0, `plně opraví vybraný modul (i zničený) · ${REPAIR.moduleCost} body technologie`),
        tab("ammo", "torpedo", "Munice", ammoable.length > 0, `vyrobí 1 náboj do torpédometu nebo min · ${REPAIR.ammoCost} body technologie`),
        tab("hull", "hull", "Trup", hullAdd > 0, `opraví trup o ${REPAIR.hullPct} % maxima (${Math.max(0, hullAdd)}) · ${REPAIR.hullCost} body technologie`),
        tab("auto", "hull", "Oprava", running <= 0 && ship.hull < ship.stats.hull, `pasivní oprava: ${REPAIR.autoTurns} kola po ${REPAIR.autoPct} % trupu za kolo (jen dokud opravář funguje) · ${REPAIR.autoCost} body technologie${running > 0 ? ` · už běží (zbývá ${running} kol)` : ""}`),
      ];
      // nasazení, přesun a odpojení modulů se dělá přetahováním v INVENTÁŘI
      if (kind === "module") {
        const hexes = h("div", { class: "dr-hexes" }, ...fixable.map((x) => moduleStateHex(x, { sub: moduleHp(x) <= 0 ? "ZNIČEN" : `${moduleHp(x)}/${moduleMaxHp(x.type)}`, title: `${MODULES[x.type].name} (${slotName(x.slot)}): opravit ${moduleHp(x)} → ${moduleMaxHp(x.type)} za ${REPAIR.moduleCost} body technologie`, onClick: locked ? undefined : () => cb.repair(ship.id, { kind: "module", moduleId: x.id }) })));
        panel = panelEl("Opravit modul – který?", fixable.length ? hexes : h("div", { class: "muted" }, label("žádný poškozený modul")));
      } else if (kind === "ammo") {
        const hexes = h("div", { class: "dr-hexes" }, ...ammoable.map((x) => moduleStateHex(x, { sub: `${x.ammo ?? 0}/${MODULES[x.type].ammo}`, title: `${MODULES[x.type].name} (${slotName(x.slot)}): +1 náboj (${x.ammo ?? 0} → ${(x.ammo ?? 0) + 1}) za ${REPAIR.ammoCost} body technologie`, onClick: locked ? undefined : () => cb.repair(ship.id, { kind: "ammo", moduleId: x.id }) })));
        panel = panelEl("Vyrobit náboj – kam?", ammoable.length ? hexes : h("div", { class: "muted" }, label("všechny zásobníky plné")));
      } else if (kind === "hull") {
        panel = panelEl(
          "Opravit trup",
          h("div", { class: "snote" }, label(`trup ${ship.hull} → `), h("b", { style: "color:#fbbf24" }, `${ship.hull + Math.max(0, hullAdd)}`), label(` / ${ship.stats.hull} · +${Math.max(0, hullAdd)}`)),
          h("button", { class: "px seg stab on go", disabled: locked || hullAdd <= 0, onclick: () => cb.repair(ship.id, { kind: "hull" }) }, label("Opravit trup"), costPipsAll({ tech: REPAIR.hullCost }, false, `${REPAIR.hullCost} body technologie`)),
        );
      } else if (kind === "auto") {
        const add = Math.min(Math.max(1, Math.round((ship.stats.hull * REPAIR.autoPct) / 100)), ship.stats.hull - ship.hull);
        panel = panelEl(
          "Pasivní oprava",
          h("div", { class: "snote" }, label(`trup ${ship.hull} / ${ship.stats.hull} · +${Math.max(0, add)} za kolo, ${REPAIR.autoTurns} kola`)),
          h("button", { class: "px seg stab on go", disabled: locked, onclick: () => cb.repair(ship.id, { kind: "auto" }) }, label("Zapnout opravu"), costPipsAll({ tech: REPAIR.autoCost }, false, `${REPAIR.autoCost} body technologie`)),
        );
      }
    }
    row(main, subs, panel, `repair:${ship.id}`);
  }

  /* ---- Droid – hacker: mina/torpédo · modul lodi · pasivní oprava; cíle se vybírají klikem na mapě ---- */
  if (has("hacker")) {
    const hDestroyed = !hackerModule(ship);
    const why = hackBlocked(m.state, ship);
    const open = !!m.hackOpen && !why;
    const kind = m.hackKind ?? null;
    const sel = m.hackSel ?? null;
    const main = h(
      "button",
      {
        class: `px bb-weapon droid-btn ${open ? "on" : ""} ${stormed ? "stormed" : ""} ${hDestroyed ? "destroyed" : ""}`,
        disabled: locked || !!why,
        ...tipAttr({ icon: "hack", iconColor: "#c084fc", title: "Droid – hacker", fx: [], note: `${techNote} · v bouři nefunguje`, ...(hDestroyed ? { warn: "ZNIČENO – modul nefunguje" } : why ? { warn: `Nelze: ${why}.` } : {}) }),
        onclick: () => cb.hackToggle(ship.id),
      },
      icon("hack", "currentColor", 22),
      h("span", { class: "lbl" }, label("Hacker")),
      stormed ? h("span", { class: "sb" }, "⚡") : null,
      hDestroyed ? h("span", { class: "dead-x" }, "✕") : null,
    );
    let subs: HTMLElement[] | null = null;
    let panel: HTMLElement | null = null;
    if (open) {
      const anyOrdnance = m.state.mines.length > 0 || m.state.torpedoes.length > 0;
      // hack modulu: jen loď, do které má tým skenem přístup, nebo loď bez funkčního štítu (a ne v bouři)
      const hackable = (x: Ship) => x.alive && x.team !== ship.team && hackAccess(m.state, ship.team, x) && !inStorm(m.state, x);
      const anyEnemy = m.state.ships.some(hackable);
      const tab = (k: HackOrder["kind"], ic: string, name: string, avail: boolean, note: string, warn?: string) => {
        const c = hackCost(k);
        const can = avail && tech >= c;
        return sub(name, ic, c, kind === k, can, { icon: ic, iconColor: "#c084fc", title: `Hacker – ${name}`, fx: [], note, ...(tech < c ? { warn: "Nelze: nedostatek technologie." } : !avail ? { warn: warn ?? "Nelze." } : {}) }, () => cb.hackMode(ship.id, kind === k ? null : k));
      };
      subs = [
        tab("mine", "mine", "Mina", anyOrdnance, `mina se stane tvou (jde nastavit odpočet nebo odpálit na startu kola); torpédu určíš nový cíl a dostane +${HACK.torpedoLife} kola života · ${HACK.ordnanceCost} body technologie`, "Nelze: v dohledu není žádná mina ani torpédo."),
        tab("module", "scan", "Modul", anyEnemy, `vybraný modul cizí lodi na toto kolo nefunguje (zbraň nevystřelí, štít nechrání, droid/skener nejde použít); jde jen u lodi, kterou někdo z týmu naskenoval (značka skeneru u jména), nebo u lodi bez funkčního štítu; oběť se to dozví až při vyhodnocení · ${HACK.moduleCost} body technologie`, "Nelze: v dohledu není hacknutelná loď (naskenovaná, nebo bez funkčního štítu)."),
      ];
      if (kind === "mine" || kind === "torpedo") {
        if (!sel) panel = panelEl("Mina / torpédo", h("div", { class: "warn snote" }, label("klikni na minu nebo torpédo v dohledu")));
        else if (sel.kind === "mine") {
          const mine = m.state.mines.find((x) => x.id === sel.id);
          const opts = h("div", { class: "rslots" });
          const opt = (name: string, timer: number | undefined, hint: string) => opts.append(h("button", { class: "px rslot free", disabled: locked, title: hint, onclick: () => cb.hack(ship.id, { kind: "mine", mineId: sel.id, timer }) }, h("span", { class: "lbl" }, label(name))));
          opt("Odpálit na startu kola", 1, "vybuchne hned na začátku vyhodnocení tohoto kola");
          opt("Za 1 kolo", 2, "vybuchne na začátku příštího kola");
          opt("Za 2 kola", 3, "vybuchne na začátku přespříštího kola");
          opt("Reakční (nechat)", undefined, "mina přejde k tobě a reaguje na vstup nepřítele (odpočet beze změny)");
          panel = panelEl(`Mina ${mine?.team === ship.team ? "(vlastní)" : "(cizí)"} – odpočet`, opts);
        } else panel = panelEl("Torpédo", h("div", { class: "warn snote" }, icon("torpedo", "#fb923c", 12), label(" torpédo vybráno – klikni na nový cíl (loď nebo torpédo)")), h("button", { class: "px tiny", title: "Jiné torpédo", onclick: () => cb.hackMode(ship.id, "mine") }, label("✕ jiné torpédo")));
      } else if (kind === "module") {
        if (!sel || sel.kind !== "ship") panel = panelEl("Modul cizí lodi", h("div", { class: "warn snote" }, label("klikni na naskenovanou loď (značka skeneru) nebo loď bez štítu")));
        else {
          const victim = m.state.ships.find((x) => x.id === sel.id);
          if (!victim) panel = panelEl("Modul cizí lodi", h("div", { class: "muted" }, label("loď už není v dohledu")));
          else if (!hackable(victim)) panel = panelEl(`${victim.name ?? "loď"}`, h("div", { class: "warn snote" }, label(inStorm(m.state, victim) ? "loď je v bouři – hack nejde" : "není naskenovaná a má funkční štít – nejdřív ji někdo z týmu musí skenovat")), h("button", { class: "px tiny", title: "Jiná loď", onclick: () => cb.hackMode(ship.id, "module") }, label("✕ jiná loď")));
          else {
            const vslot = (id: SlotId) => hullOf(victim.loadout).slots.find((x) => x.id === id)?.name ?? id;
            const hexes = h(
              "div",
              { class: "dr-hexes" },
              ...victim.loadout.modules.map((x) => {
                const broken = moduleHp(x) <= 0;
                const off = broken || !!x.hacked;
                return moduleStateHex(x, { sub: x.hacked ? "HACKNUT" : broken ? "ZNIČEN" : `${moduleHp(x)}/${moduleMaxHp(x.type)}`, dim: off, title: broken ? `${MODULES[x.type].name}: už zničený` : x.hacked ? `${MODULES[x.type].name}: už hacknutý` : `${MODULES[x.type].name} (${vslot(x.slot)}): vypnout na toto kolo za ${HACK.moduleCost} body technologie`, onClick: locked || off ? undefined : () => cb.hack(ship.id, { kind: "module", shipId: victim.id, moduleId: x.id }) });
              }),
            );
            panel = panelEl(`${victim.name ?? "loď"} – který modul vypnout?`, hexes, h("button", { class: "px tiny", title: "Jiná loď", onclick: () => cb.hackMode(ship.id, "module") }, label("✕ jiná loď")));
          }
        }
      }
    }
    row(main, subs, panel, `hack:${ship.id}`);
  }
}

/* ===================== INVENTÁŘ (pravý okraj mapy pod droidy) ===================== */

/**
 * Tlačítko INVENTÁŘ + okénko s nákresem lodi. Všechno tažením: trosky v dosahu → náklad (zvednout) nebo volný slot
 * (zvednout + nasadit opravářem); náklad → slot (nasadit / vyměnit); modul lodi → náklad (odpojit) nebo jiný slot (přesun);
 * modul lodi / nákladu → vyhazovací oblast (vyhodit, i víc najednou). Úkony opraváře se dějí hned a stojí technologii.
 */
export function renderInventoryBar(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
  clear(root);
  if (m.state.status === "finished") return;
  const my = m.state.ships.filter((s) => s.alive && s.ownerId === m.myId);
  const ship = my.find((s) => s.id === m.selectedShipId) ?? my[0];
  if (!ship) return;
  const o = m.orders.get(ship.id) ?? defaultOrders(ship);
  const locked = m.submitted || m.animating;
  const acts = actionList(ship, o);
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false, stop: false };
  const jetOn = o.action?.type === "jettison";
  const pickTgt = o.action?.type === "pickup" ? o.action.targetId : undefined;
  const installSlot = o.action?.type === "pickup" ? o.action.installSlot : undefined;
  const cargoActive = jetOn || !!pickTgt;
  const cargoSpent = acts.filter((a) => a.id === "jettison" || a.id === "pickup").length;
  const cargoDone = cargoActive && !m.cargoOpen; // akce zvolená, okénko zavřené = hotovo, stisk = reset
  const cargo = ship.loadout.cargo ?? [];
  const cap = cargoCapacity(ship.loadout);
  const canInstall = !repairBlocked(m.state, ship);
  const tech = ship.techPoints;
  const reserved = reservedTech(o);
  const jetIds = o.action?.type === "jettison" ? o.action.moduleIds : [];
  const jetMods = jetIds.map((id) => ship.loadout.modules.find((x) => x.id === id) ?? cargo.find((x) => x.id === id)).filter((x): x is ModuleInstance => !!x);
  const tgtDebris = pickTgt ? m.state.debris.find((d) => d.id === pickTgt) : undefined;
  const tgtStation = pickTgt ? (m.state.stations ?? []).find((x) => x.id === pickTgt) : undefined;
  root.append(h("div", { class: "cap" }, label("Loď")));
  renderShieldButton(root, m, cb, ship, o, locked);
  renderScannerButton(root, m, cb, ship, o, locked);
  const holder = h("div", { class: `scan-holder ${m.cargoOpen ? "stack" : ""}` });
  holder.append(
    h(
      "button",
      {
        class: `px bb-weapon ${cargoActive && !cargoDone ? "on" : ""} ${cargoDone ? "done" : ""} ${cargoSpent > 0 ? "spent" : ""} ${m.cargoOpen ? "open" : ""}`,
        disabled: locked,
        ...tipAttr({
          icon: "cargo",
          iconColor: "#94a3b8",
          title: "Inventář",
          cost: { actions: 1 },
          fx: [
            { icon: "debris", text: "modul lodi / nákladu → vyhazovací oblast = vyhodit (trosky)" },
            { icon: "cargo", text: `trosky v dosahu ${CARGO.range} → náklad = zvednout (1 akce)` },
            { icon: "wrench", text: `s opravářem: trosky / náklad → slot = nasadit, slot → náklad = odpojit, slot → slot = přesun (${REPAIR.installCost} tech, hned)` },
          ],
          note: cargoDone ? `${jetOn ? "vyhození" : installSlot ? "zvednutí a nasazení" : "zvednutí"} platí · stisk = reset` : "klik vedle okénko zavře a volba platí",
        }),
        onclick: () => (cargoDone ? cb.cancelAction(ship.id) : cb.cargoToggle(ship.id)),
      },
      costPips(1, cargoSpent > 0 ? "spent" : "red", "stojí 1 akci (jen vyhození / zvednutí)"),
      icon("cargo", "currentColor", 22),
      h("span", { class: "lbl" }, label("Inventář")),
      cargoDone ? h("span", { class: "reset-strip" }, "↺ ", label("reset")) : null,
    ),
  );
  if (m.cargoOpen && !locked) {
    const sp = cur.speed;
    const near = m.state.debris.filter((d) => dist(ship, d) <= CARGO.range).sort((a, b) => dist(ship, a) - dist(ship, b));
    const stn = stationInPickupRange(m.state, ship);
    const debrisModule = (d: Debris): ModuleInstance => d.module ?? { id: d.id, type: d.type, slot: "front", ammo: MODULES[d.type].ammo };
    const cancelBtn = () => h("button", { class: "px tiny inv-cancel", title: "Zrušit", onclick: () => cb.setOrders(ship.id, { action: undefined }) }, "✕ ", label("zrušit"));
    const slotName = (id: SlotId) => hullOf(ship.loadout).slots.find((x) => x.id === id)?.name ?? id;
    const hpSub = (x: ModuleInstance) => (moduleHp(x) <= 0 ? "ZNIČEN" : moduleHp(x) < moduleMaxHp(x.type) ? `${moduleHp(x)}/${moduleMaxHp(x.type)}` : undefined);
    const techOk = tech - reserved >= REPAIR.installCost;
    const immediateOk = canInstall && techOk; // nasadit / odpojit / přesunout hned (opravář + technologie)

    /* --- hlavička: název, technologie s cenou --- */
    const tpips = h("div", { class: "apip yellow" });
    for (let i = 0; i < ship.stats.techMax; i++) tpips.append(h("i", { class: i < tech - reserved ? "on" : i < tech ? "plan" : "" }));
    const head = h(
      "div",
      { class: "inv-title" },
      icon("cargo", "#7dd3fc", 12),
      label("Inventář · přetahuj moduly"),
      h("div", { class: "inv-tech", title: `Technologie ${tech}/${ship.stats.techMax}${reserved ? ` (v plánu −${reserved})` : ""} · nasazení, odpojení a přesun modulu opravářem stojí ${REPAIR.installCost} bod a provedou se hned` }, label(`Technologie ${tech}/${ship.stats.techMax}`), tpips, h("span", { class: "cost" }, label("· nasazení / přesun / odpojení = "), h("i", { class: "tp" }), ` ${REPAIR.installCost}`)),
    );

    /* --- vlevo: trosky (a stanice) v dosahu – tažením do lodi --- */
    const reachList = h("div", { class: "inv-list" });
    const dragIn: { el: SVGSVGElement; id: string; mod: ModuleInstance | null }[] = [];
    for (const d of near) {
      const mod = debrisModule(d);
      const planned = pickTgt === d.id;
      const el = moduleStateHex(mod, { r: 26, sub: planned ? (installSlot ? "NASADIT" : "ZVEDNOUT") : hpSub(mod), subColor: planned ? "#86efac" : undefined, selected: planned, title: `${MODULES[mod.type].name} · ${Math.round(dist(ship, d))} / ${CARGO.range} · přetáhni do nákladu${canInstall ? " nebo na volný slot" : ""}` });
      el.classList.add("inv-drag");
      reachList.append(el);
      dragIn.push({ el, id: d.id, mod });
    }
    if (stn) {
      const planned = pickTgt === stn.id;
      const el = moduleStateHex(null, { r: 26, empty: planned ? "ZVEDNOUT" : "STANICE", selected: planned, title: `Stanice: nabere náhodný modul ze zásoby (${stn.stock}) – přetáhni do nákladu` });
      el.classList.add("inv-drag");
      reachList.append(el);
      dragIn.push({ el, id: stn.id, mod: null });
    }
    if (!near.length && !stn) reachList.append(h("div", { class: "inv-none" }, label("nic v dosahu")));
    const reach = h("div", { class: "inv-reach" }, h("div", { class: "inv-cap" }, label(`V dosahu${near.length + (stn ? 1 : 0) ? ` · ${near.length + (stn ? 1 : 0)}` : ""}`)), reachList);

    /* --- uprostřed: nákres lodi (jen k tažení) --- */
    const lo = renderLoadout({ loadout: ship.loadout, team: ship.team, readonly: true, hideHead: true, budget: m.state.tuning.startBudget, allowed: m.state.settings.allowedModules, compact: true, showCargo: false, selectedId: jetMods[0]?.id });
    for (const g of lo.querySelectorAll<SVGGElement>(".lo-g.mod[data-slot]")) {
      const sl = g.getAttribute("data-slot") as SlotId;
      const mod = ship.loadout.modules.find((x) => occupiedSlots(x).includes(sl));
      if (mod && jetIds.includes(mod.id)) g.classList.add("sel");
    }

    /* --- vpravo: vyhazovací oblast (všechny vyhazované moduly; tažením zpět na loď = zrušit) --- */
    const jetList = h("div", { class: "inv-list" });
    const dragBack: { el: Element; mod: ModuleInstance }[] = [];
    for (const x of jetMods) {
      const el = moduleStateHex(x, { r: 26, sub: "VYHODIT", subColor: "#fca5a5", title: `${MODULES[x.type].name} se vyhodí na začátku kola – přetáhni zpět na loď = rozmyslet si to` });
      el.classList.add("inv-drag");
      jetList.append(el);
      dragBack.push({ el, mod: x });
    }
    jetList.append(moduleStateHex(null, { r: 26, empty: jetMods.length ? "DALŠÍ" : "SEM", title: "Přetáhni sem modul z lodi nebo z nákladu" }));
    const jetBox = h(
      "div",
      { class: `inv-jet ${jetMods.length ? "has" : ""}`, dataset: { drop: "jettison" } },
      h("div", { class: "inv-cap" }, label(`Vyhodit${jetMods.length ? ` · ${jetMods.length}` : ""}`)),
      jetMods.length ? h("div", { class: "inv-lbl ok" }, label("vyhodí se na začátku kola · zpět na loď = zrušit")) : h("div", { class: "inv-lbl" }, label("přetáhni sem modul z lodi nebo z nákladu (i víc najednou)")),
      jetList,
      jetMods.length ? cancelBtn() : null,
    );

    /* --- dole: náklad (hexy modulů v nákladu + volná místa = cíl pro zvednutí / odpojení) --- */
    const cargoRow = h("div", { class: "inv-cargo", dataset: { drop: "cargo" } }, h("div", { class: "inv-cap" }, label(`Náklad ${cargo.length}/${cap}`)));
    const dragCargo: { el: Element; mod: ModuleInstance }[] = [];
    for (const x of cargo) {
      const el = moduleStateHex(x, { r: 26, sub: jetIds.includes(x.id) ? "VYHODIT" : hpSub(x), subColor: jetIds.includes(x.id) ? "#fca5a5" : undefined, selected: jetIds.includes(x.id), title: `${MODULES[x.type].name} v nákladu (nefunguje, jen váží) – přetáhni na slot lodi = nasadit${canInstall ? "" : " (chybí opravář)"}, na vyhazovací oblast = vyhodit` });
      el.classList.add("inv-drag");
      cargoRow.append(el);
      dragCargo.push({ el, mod: x });
    }
    const pickedToCargo = pickTgt && !installSlot ? (tgtDebris ? debrisModule(tgtDebris) : null) : undefined;
    for (let i = cargo.length; i < cap; i++) {
      if (i === cargo.length && pickTgt && !installSlot) {
        cargoRow.append(
          h(
            "div",
            { class: "inv-planned" },
            pickedToCargo ? moduleStateHex(pickedToCargo, { r: 26, sub: "ZVEDNOUT", subColor: "#86efac", selected: true }) : moduleStateHex(null, { r: 26, empty: tgtStation ? "STANICE" : "?", selected: true }),
            h("div", { class: "inv-lbl ok" }, label(tgtStation ? "nabere se náhodný modul ze stanice" : "zvedne se v tomto kole")),
            cancelBtn(),
          ),
        );
      } else cargoRow.append(h("div", { class: "inv-free" }, moduleStateHex(null, { r: 26, empty: "VOLNÉ", title: "Volné místo v nákladu – přetáhni sem trosky z dosahu (zvednout) nebo modul lodi (odpojit, opravář)" })));
    }
    if (cap <= 0) cargoRow.append(h("div", { class: "inv-none" }, label("loď nemá nákladový prostor")));

    /* --- dole: checklist --- */
    const ck = (ok: boolean) => h("i", { class: `ck ${ok ? "on" : "off"}` }, ok ? "✓" : "✕");
    const cargoFree = cargo.length < cap;
    const check = h(
      "div",
      { class: "inv-check" },
      h("span", {}, label("dosah: "), h("b", {}, String(CARGO.range))),
      h("span", {}, label("rychlost: "), h("b", {}, String(sp)), ck(sp <= CARGO.maxSpeed), h("span", { class: sp <= CARGO.maxSpeed ? "ok" : "bad" }, label(sp <= CARGO.maxSpeed ? "OK" : `zpomal na ≤ ${CARGO.maxSpeed}`))),
      h("span", {}, label("opravář "), ck(canInstall), h("span", { class: canInstall ? "ok" : "bad" }, label(canInstall ? "OK, lze i nasadit" : "chybí · trosky jen do nákladu"))),
      h("span", {}, label("náklad: "), h("b", {}, `${cargo.length}/${cap}`), ck(cargoFree), h("span", { class: cargoFree ? "ok" : "bad" }, label(cargoFree ? "místo" : "plný"))),
    );

    const pop = h("div", { class: `cargo-pop inv-pop ${popClass(`cargo:${ship.id}`)}` }, head, h("div", { class: "inv-body" }, reach, h("div", { class: "inv-mid" }, lo, cargoRow), jetBox), check);

    /* --- tažení --- */
    const targetOf = (el: Element | null): { kind: "jettison" | "cargo" | "slot" | "ship"; slot?: SlotId; empty?: boolean; el: Element } | null => {
      const g = el?.closest?.("[data-slot]");
      if (g && pop.contains(g)) return { kind: "slot", slot: g.getAttribute("data-slot") as SlotId, empty: g.classList.contains("empty"), el: g };
      const drop = el?.closest?.("[data-drop]");
      if (drop) return { kind: drop.getAttribute("data-drop") as "jettison" | "cargo", el: drop };
      const dia = el?.closest?.(".inv-mid");
      if (dia && pop.contains(dia)) return { kind: "ship", el: dia };
      return null;
    };
    const mark = (t: ReturnType<typeof targetOf>, ok: boolean) => {
      pop.querySelectorAll(".drop-target, .drop-bad").forEach((x) => x.classList.remove("drop-target", "drop-bad"));
      if (t) t.el.classList.add(ok ? "drop-target" : "drop-bad");
    };
    const setJet = (ids: string[]) => cb.setOrders(ship.id, { action: ids.length ? { type: "jettison", moduleIds: ids } : undefined });
    const noRepair = () => showTip(canInstall ? `nedostatek technologie (${tech - reserved}/${REPAIR.installCost})` : "chybí funkční droid opravář – modul jde jen vyhodit");
    // moduly lodi: → vyhodit, → náklad (odpojit), → jiný slot (přesun / prohození)
    for (const g of lo.querySelectorAll<SVGGElement>(".lo-g.mod[data-slot]")) {
      const sl = g.getAttribute("data-slot") as SlotId;
      const mod = ship.loadout.modules.find((x) => occupiedSlots(x).includes(sl));
      if (!mod) continue;
      g.classList.add("inv-drag");
      g.addEventListener("pointerdown", (ev) =>
        dragHex(
          ev as PointerEvent,
          () => moduleStateHex(mod, { r: 26 }),
          (under) => {
            const t = targetOf(under);
            if (t?.kind === "jettison") {
              if (!jetIds.includes(mod.id)) setJet([...jetIds, mod.id]);
            } else if (t?.kind === "cargo") {
              if (!immediateOk) noRepair();
              else if (!cargoFree) showTip("náklad je plný");
              else cb.repair(ship.id, { kind: "uninstall", moduleId: mod.id });
            } else if (t?.kind === "slot" && t.slot && !occupiedSlots(mod).includes(t.slot)) {
              if (!immediateOk) noRepair();
              else cb.repair(ship.id, { kind: "move", moduleId: mod.id, slot: t.slot });
            }
          },
          (under) => {
            const t = targetOf(under);
            mark(t, t?.kind === "jettison" || (t?.kind === "cargo" && immediateOk && cargoFree) || (t?.kind === "slot" && immediateOk && !!t.slot && !occupiedSlots(mod).includes(t.slot)));
          },
        ),
      );
    }
    // náklad: → vyhodit, → slot (nasadit / vyměnit)
    for (const { el, mod } of dragCargo) {
      el.addEventListener("pointerdown", (ev) =>
        dragHex(
          ev as PointerEvent,
          () => moduleStateHex(mod, { r: 26 }),
          (under) => {
            const t = targetOf(under);
            if (t?.kind === "jettison") {
              if (!jetIds.includes(mod.id)) setJet([...jetIds, mod.id]);
            } else if (t?.kind === "slot" && t.slot) {
              if (!immediateOk) noRepair();
              else cb.repair(ship.id, { kind: "install", moduleId: mod.id, slot: t.slot });
            }
          },
          (under) => {
            const t = targetOf(under);
            mark(t, t?.kind === "jettison" || (t?.kind === "slot" && immediateOk));
          },
        ),
      );
    }
    // z vyhazovací oblasti zpět na loď / do nákladu = rozmyslet si to (modul je pořád nainstalovaný, opravář netřeba)
    for (const { el, mod } of dragBack) {
      el.addEventListener("pointerdown", (ev) =>
        dragHex(
          ev as PointerEvent,
          () => moduleStateHex(mod, { r: 26 }),
          (under) => {
            const t = targetOf(under);
            if (t && t.kind !== "jettison") setJet(jetIds.filter((x) => x !== mod.id));
          },
          (under) => {
            const t = targetOf(under);
            mark(t, !!t && t.kind !== "jettison");
          },
        ),
      );
    }
    // trosky: → náklad (zvednout), → volný slot (zvednout + nasadit opravářem)
    for (const { el, id, mod } of dragIn) {
      el.addEventListener("pointerdown", (ev) =>
        dragHex(
          ev as PointerEvent,
          () => (mod ? moduleStateHex(mod, { r: 26 }) : moduleStateHex(null, { r: 26, empty: "STANICE" })),
          (under) => {
            const t = targetOf(under);
            if (t?.kind === "cargo") cb.setOrders(ship.id, { action: { type: "pickup", targetId: id } });
            else if (t?.kind === "slot" && t.empty && mod) {
              if (!canInstall) noRepair();
              else cb.setOrders(ship.id, { action: { type: "pickup", targetId: id, installSlot: t.slot } });
            }
          },
          (under) => {
            const t = targetOf(under);
            mark(t, t?.kind === "cargo" || (t?.kind === "slot" && !!t.empty && !!mod && canInstall));
          },
        ),
      );
    }
    /* --- naplánované zvednutí + nasazení: modul se ukáže ve volném slotu (po vykreslení, podle polohy hexu) --- */
    if (installSlot && tgtDebris) {
      const mod = debrisModule(tgtDebris);
      requestAnimationFrame(() => {
        const g = lo.querySelector<SVGGElement>(`[data-slot="${installSlot}"]`);
        const dia = lo.querySelector<HTMLElement>(".lo-diagram");
        if (!g || !dia) return;
        const rb = g.getBoundingClientRect();
        const rd = dia.getBoundingClientRect();
        dia.append(
          h(
            "div",
            { class: "inv-installed", style: `left:${rb.left - rd.left + rb.width / 2}px;top:${rb.top - rd.top + rb.height / 2}px` },
            moduleStateHex(mod, { r: 42, sub: "NASADIT", subColor: "#86efac", selected: true, title: `${MODULES[mod.type].name}: zvedne se a opravář ho nasadí do slotu ${slotName(installSlot)} (${REPAIR.installCost} technologie)` }),
            h("div", { class: "inv-lbl ok" }, label(`zvedne se a opravář ho nasadí (${REPAIR.installCost} tech)`)),
            cancelBtn(),
          ),
        );
      });
    }
    holder.append(pop);
  }
  root.append(holder);
}

/**
 * Tlačítko ŠTÍT v segmentu LOĎ. Segmentový štít: okénko s −/+ u segmentů (změna platí hned jako naplánovaná akce
 * PŘESUN, 1 akce; návrat na původní = akce zmizí), nahoře DOBÍT (technologie, hned), vpravo dole červený reset po změně.
 * Energetický štít: okénko DOBÍT.
 */
function renderShieldButton(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks, ship: Ship, o: ShipOrders, locked: boolean) {
  if (ship.shieldType !== "segment" && ship.shieldType !== "whole") return;
  const man = resolveManeuver(profileFor(ship, o), o.maneuverId, ship.speed);
  const stormed = inStorm(m.state, ship);
  const teamColor = TEAM_COLORS[ship.team];
  const rechargeWhy = shieldRechargeBlocked(m.state, ship);
  const tech = ship.techPoints;
  const holder = h("div", { class: "scan-holder stack" });
  if (ship.shieldType === "whole") {
    const why = rechargeWhy;
    const room = shieldRechargeRoom(ship);
    const add = Math.min(RULES.rechargeWhole, room);
    const open = !!m.rechargeOpen && !why;
    if (open) {
      const max = ship.stats.shields;
      const cells = 16;
      const gauge = h("div", { class: "sgauge", title: `zásoba ${ship.shields} → ${ship.shields + add} / ${max}` });
      for (let i = 0; i < cells; i++) {
        const lo = (i / cells) * max;
        gauge.append(h("i", { class: lo < ship.shields ? "on" : lo < ship.shields + add ? "add" : "" }));
      }
      holder.append(
        h(
          "div",
          { class: `shield-pop big ${popClass(`shield:${ship.id}`)}` },
          h("div", { class: "stabs" }, h("button", { class: "px seg stab on go wide", disabled: locked, ...tipAttr({ ...actionTip("recharge", ship, o, man), note: `klik = dobít hned: ${ship.shields} → ${ship.shields + add} (+${add}) za ${RULES.rechargeTechCost} technologie` }), onclick: () => cb.recharge(ship.id) }, label("Dobít"), costPipsAll({ tech: RULES.rechargeTechCost }, false, `${RULES.rechargeTechCost} body technologie`))),
          gauge,
          h("div", { class: "snote" }, label(`zásoba ${ship.shields} → `), h("b", { style: "color:#fbbf24" }, `${ship.shields + add}`), label(` / ${max} · +${add}`)),
          h("div", { class: "muted snote" }, label(`technologie ${tech}/${ship.stats.techMax} · nebere akci · 1× za kolo`)),
        ),
      );
    }
    holder.append(
      h(
        "button",
        {
          class: `px bb-weapon shield-btn ${open ? "on" : ""} ${stormed ? "stormed" : ""} ${why ? "cool" : ""}`,
          disabled: locked || !!why,
          ...tipAttr({ ...actionTip("recharge", ship, o, man), ...(why ? { warn: `Nelze: ${why}.` } : { note: `energetický štít ${ship.shields}/${ship.stats.shields} · dobití: ${RULES.rechargeTechCost} tech → +${RULES.rechargeWhole}` }) }),
          onclick: () => cb.shieldMode(ship.id, open ? "close" : "recharge"),
        },
        icon("shield", "currentColor", 22),
        h("span", { class: "lbl" }, label("Štít")),
        stormed ? h("span", { class: "sb" }, "⚡") : null,
      ),
    );
    root.append(holder);
    return;
  }
  /* ---- segmentový štít ---- */
  const planned = o.action?.type === "shield" ? o.action.segments : undefined;
  const segsNow = planned ?? ship.segments;
  const inHand = planned ? shieldInHand(ship, o) : 0;
  const editing = !locked && !!m.shieldEdit; // okénko −/+ otevřené (akce vznikne až změnou); klik vedle = zavřít
  const rechargeMode = !!m.rechargeOpen && !locked;
  const changed = !!planned && planned.some((v, i) => v !== ship.segments[i]);
  const act = ACTIONS.find((x) => x.id === "shield")!;
  const moveWhy = act.disabled(ship, m.state, o);
  const stormOff = stormed;
  const destroyed = ship.loadout.modules.some((x) => x.type === "shield-segment") && !ship.loadout.modules.some((x) => x.type === "shield-segment" && moduleWorking(x));
  /** DOBÍT přes celou šířku nahoře: přepne do režimu dobití; s rozdělenými body = provede. */
  const doTab = () => {
    const pick = m.rechargePick ?? [0, 0, 0, 0];
    const picked = pick.reduce((a, b) => a + b, 0);
    const canGo = rechargeMode && picked > 0;
    return h(
      "div",
      { class: "stabs" },
      h(
        "button",
        { class: `px seg stab wide ${rechargeMode ? "on" : ""} ${canGo ? "go" : ""}`, disabled: locked || !!rechargeWhy, ...tipAttr({ ...actionTip("recharge", ship, o, man, rechargeWhy ?? null), note: rechargeMode ? (picked > 0 ? `klik = dobít hned (+${picked} ${picked === 1 ? "bod" : "body"} do zvolených segmentů)${picked < RULES.rechargeSegments ? " · nevyužitý bod propadne" : ""}` : `klikni na + u segmentů (${RULES.rechargeSegments} body), pak znovu DOBÍT`) : "dobití technologií – nebere akci, 1× za kolo, hned" }), onclick: () => (canGo ? cb.recharge(ship.id) : cb.shieldMode(ship.id, rechargeMode ? "move" : "recharge")) },
        label(rechargeMode ? `Dobít ${picked}/${RULES.rechargeSegments}` : "Dobít"),
        costPipsAll({ tech: RULES.rechargeTechCost }, false, `${RULES.rechargeTechCost} body technologie`),
      ),
    );
  };
  let pop: HTMLElement | null = null;
  if (rechargeMode) {
    const pick = m.rechargePick ?? [0, 0, 0, 0];
    const picked = pick.reduce((a, b) => a + b, 0);
    const cap = RULES.segmentHp * ship.stats.segmentModules;
    const preview = ship.segments.map((v, i) => v + pick[i]) as Segments;
    const pbtn = (seg: number) => {
      const full = ship.segments[seg] + pick[seg] >= cap;
      const can = pick[seg] > 0 || (picked < RULES.rechargeSegments && !full);
      return h("button", { class: `px sbtn y ${pick[seg] > 0 ? "on" : ""}`, disabled: !can, title: full && pick[seg] === 0 ? `${SEGMENT_NAMES[seg]}: segment je plný` : pick[seg] > 0 ? `${SEGMENT_NAMES[seg]}: +${pick[seg]} · klik = ubrat` : picked >= RULES.rechargeSegments ? "všechny body rozdělené – klikem na + jinde je ubereš" : `${SEGMENT_NAMES[seg]}: přidat bod`, onclick: () => cb.rechargePick(ship.id, seg) }, pick[seg] > 0 ? `+${pick[seg]}` : icon("plus", "currentColor", 12));
    };
    const slots = h("div", { class: "hand-slots y", title: `${RULES.rechargeSegments - picked} ${RULES.rechargeSegments - picked === 1 ? "bod" : "body"} k rozdělení` });
    for (let i = 0; i < RULES.rechargeSegments; i++) slots.append(h("i", { class: i < RULES.rechargeSegments - picked ? "on" : "" }));
    const popBubble = shieldBubble({ ...ship, maxShields: ship.stats.shields, hullId: ship.loadout.hullId }, teamColor, preview, 84, stormed);
    pop = h(
      "div",
      { class: `shield-pop big ${popClass(`shield:${ship.id}`)}` },
      doTab(),
      h("div", { class: "spair top" }, pbtn(0)),
      h("div", { class: "smid" }, h("div", { class: "spair left" }, pbtn(3)), popBubble, h("div", { class: "spair right" }, pbtn(1))),
      h("div", { class: "spair bottom" }, pbtn(2)),
      slots,
      h("div", { class: "muted snote" }, label(picked > 0 ? "potvrď tlačítkem DOBÍT nahoře" : "klik na + dá bod do segmentu")),
    );
  } else if (editing) {
    const btn = (seg: number, d: 1 | -1) => {
      const v = segsNow[seg];
      const can = d < 0 ? v > 0 : inHand > 0 && v < RULES.segmentMax;
      return h("button", { class: "px sbtn", disabled: !can, title: d < 0 ? `${SEGMENT_NAMES[seg]}: odebrat bod` : inHand <= 0 ? "nejdřív bod někde odeber" : `${SEGMENT_NAMES[seg]}: přidat bod (max. ${RULES.segmentMax})`, onclick: () => cb.shieldDelta(ship.id, seg, d) }, icon(d < 0 ? "minus" : "plus", "currentColor", 12));
    };
    // příď a záď: − vlevo, + vpravo; boky: + nahoře, − dole
    const total = ship.segments.reduce((a, b) => a + b, 0);
    const slots = h("div", { class: "hand-slots", title: inHand > 0 ? `${inHand} bodů v ruce – polož je tlačítkem +` : "body štítu v ruce (odebrané, ještě nepoložené)" });
    for (let i = 0; i < total; i++) slots.append(h("i", { class: i < inHand ? "on" : "" }));
    const popBubble = shieldBubble({ ...ship, maxShields: ship.stats.shields, hullId: ship.loadout.hullId }, teamColor, segsNow, 84, stormed);
    pop = h(
      "div",
      { class: `shield-pop big ${popClass(`shield:${ship.id}`)}` },
      doTab(),
      h("div", { class: "spair top" }, btn(0, -1), btn(0, 1)),
      h("div", { class: "smid" }, h("div", { class: "spair left" }, btn(3, 1), btn(3, -1)), popBubble, h("div", { class: "spair right" }, btn(1, 1), btn(1, -1))),
      h("div", { class: "spair bottom" }, btn(2, -1), btn(2, 1)),
      slots,
      changed ? h("button", { class: "px sreset icon", title: "Reset – vrátit původní rozložení štítu (akce se zruší)", onclick: () => cb.cancelAction(ship.id) }, "↺") : null,
    );
  }
  const open = !!pop;
  const done = !!planned && changed && !open;
  let why = destroyed ? "ZNIČENO – modul nefunguje" : stormOff ? "systém je v bouři mimo provoz" : moveWhy;
  const alt = !!why && !stormOff && !destroyed && !rechargeWhy; // bez volné akce jde aspoň dobít
  if (alt) why = null;
  if (pop) holder.append(pop);
  holder.append(
    h(
      "button",
      {
        class: `px bb-weapon ${open && !stormOff ? "on" : ""} ${done ? "done" : ""} ${stormOff ? "stormed" : ""} ${changed ? "spent" : ""} ${destroyed ? "destroyed" : ""}`,
        disabled: locked || stormOff || destroyed || (!!why && !open && !done),
        ...tipAttr({
          ...actionTip("shield", ship, o, man, destroyed ? null : why),
          ...(done ? { note: "úprava platí · stisk = otevřít (upravit, dobít, reset)" } : rechargeMode ? { note: "režim DOBÍT – klik vedle = zavřít" } : editing ? { note: "−/+ přesouvá body hned (1 akce) · klik vedle = zavřít" } : { note: "otevře okénko štítu: −/+ přesun bodů (1 akce), DOBÍT technologií" }),
          ...(destroyed ? { warn: "ZNIČENO – modul nefunguje" } : {}),
        }),
        onclick: () => (open ? cb.shieldConfirm(ship.id) : done ? cb.shieldMode(ship.id, "move") : alt ? cb.shieldMode(ship.id, "recharge") : cb.shieldMode(ship.id, "move")),
      },
      changed ? costPipsAll({ actions: 1 }, true, "1 akce (přesun bodů štítu)") : null,
      icon("segments", "currentColor", 22),
      h("span", { class: "lbl" }, label("Štít")),
      done ? h("span", { class: "reset-strip" }, label(`${planned!.join("/")}`)) : null,
      stormOff ? h("span", { class: "sb" }, "⚡") : null,
      destroyed ? h("span", { class: "dead-x" }, "✕") : null,
    ),
  );
  root.append(holder);
}

/** Tlačítko SKENER v segmentu LOĎ: podtlačítka (sken lodi · hluboký sken · manévry botů) vyjedou vlevo. */
function renderScannerButton(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks, ship: Ship, o: ShipOrders, locked: boolean) {
  const man = resolveManeuver(profileFor(ship, o), o.maneuverId, ship.speed);
  const stormed = inStorm(m.state, ship);
  const row = root;
  const sc = scannerModule(ship.loadout);
  if (sc) {
        const tech = ship.techPoints;
        const holder = h("div", { class: "scan-holder" });
        holder.append(
          h(
            "button",
            {
              class: `px bb-weapon scan-btn ${m.scanOpen && !stormed ? "on" : ""} ${stormed ? "stormed" : ""} ${tech < SCANNER.shipCost ? "cool" : ""}`,
              disabled: locked || stormed || tech < Math.min(SCANNER.shipCost, SCANNER.deepCost),
              ...tipAttr({ ...actionTip("scanner", ship, o, man), note: `technologie ${tech}/${ship.stats.techMax} · nebere akci · v bouři nefunguje`, ...(tech < Math.min(SCANNER.shipCost, SCANNER.deepCost) ? { warn: "Nelze: nedostatek technologie." } : {}) }),
              onclick: () => cb.scanToggle(ship.id),
            },
            icon("scan", "currentColor", 22),
            h("span", { class: "lbl" }, label("Skener")),
            stormed ? h("span", { class: "sb" }, "⚡") : null,
          ),
        );
        if (m.scanOpen && !stormed) {
          const predictOn = botPredictActive(m.state, m.myId);
          // dvě tlačítka vyjedou nad tlačítko skeneru (přes okraj lišty), stejně velká jako ono
          const cost = (n: number) => costPipsAll({ tech: n }, false, `${n} ${n === 1 ? "bod" : "body"} technologie (nebere akci)`);
          holder.append(
            h(
              "div",
              { class: `scan-pop ${popClass(`scan:${ship.id}`)}` },
              h("button", { class: `px bb-weapon sm ${m.scanPick ? "on" : ""}`, disabled: locked || tech < SCANNER.shipCost, ...tipAttr({ ...actionTip("scan-ship", ship, o, man), ...(tech < SCANNER.shipCost ? { warn: "Nelze: nedostatek technologie." } : {}) }), onclick: () => cb.scanPickTarget(ship.id, !m.scanPick) }, icon("ship", "currentColor", 22), h("span", { class: "lbl" }, label("Sken lodi")), cost(SCANNER.shipCost)),
              h("button", { class: "px bb-weapon sm", disabled: locked || tech < SCANNER.deepCost, ...tipAttr({ ...actionTip("scan-deep", ship, o, man), ...(tech < SCANNER.deepCost ? { warn: "Nelze: nedostatek technologie." } : {}) }), onclick: () => cb.scan(ship.id, "deep") }, icon("deep", "currentColor", 22), h("span", { class: "lbl" }, label("Vesmír")), cost(SCANNER.deepCost)),
              h("button", { class: `px bb-weapon sm ${predictOn ? "done" : ""}`, disabled: locked || predictOn || tech < SCANNER.predictCost, ...tipAttr({ ...actionTip("scan-predict", ship, o, man), ...(predictOn ? { note: `předpověď běží do kola ${m.state.botPredict?.[m.myId] ?? 0}` } : tech < SCANNER.predictCost ? { warn: "Nelze: nedostatek technologie." } : {}) }), onclick: () => cb.scan(ship.id, "predict") }, icon("turn", "currentColor", 22), h("span", { class: "lbl" }, label("Manévry")), predictOn ? h("span", { class: "reset-strip" }, label("běží")) : cost(SCANNER.predictCost)),
            ),
          );
        }
        row.append(holder);
      }
}
