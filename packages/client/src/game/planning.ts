import {
  HULLS,
  PILOTS,
  moduleHp,
  moduleMaxHp,
  moduleWorking,
  type ModuleInstance,
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
  effEvadeCost,
  droidModule,
  droidCost,
  DROID,
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
} from "@wingfighter/shared";
import { clear, h } from "../dom.ts";
import { actionTip } from "./tips.ts";
import { tipAttr } from "../tooltip.ts";
import { infoDialog } from "../dialog.ts";
import { icon, label, segBar } from "../icons.ts";
import { ACTIONS, actionAvailable } from "./actions.ts";
import { SEGMENT_NAMES, shieldBubble, strengthColor } from "./shield-ui.ts";
import { pilotBadge } from "../pilot-ui.ts";
import { renderLoadout } from "../loadout-ui.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  chooseAction(shipId: string, actionId: string): void;
  /** Zrušit naplánovanou akci (křížek pod tlačítkem s podnabídkou). */
  cancelAction(shipId: string): void;
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
  /** Dobití štítu technologií: nabídka, výběr segmentu (+1 / −1), provést hned. */
  /** Okénko štítu: režim přesunu (akce) / dobití (technologie) / zavřít. */
  shieldMode(shipId: string, mode: "move" | "recharge" | "close"): void;
  rechargePick(shipId: string, seg: number): void;
  recharge(shipId: string): void;
  scanPickTarget(shipId: string, on: boolean): void;
  scan(shipId: string, mode: "deep" | "cooldown"): void;
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
  { label: "Pohyb", ids: ["move", "evade", "koiogran"] },
  { label: "Loď", ids: [] },
  { label: "Speciální", ids: ["shield"] },
];
const FACING_GLYPH: Record<string, string> = { front: "↑", right: "→", back: "↓", left: "←" };
const ACTION_ICON: Record<string, string> = { pickup: "cargo", move: "pen", laser: "laser", mg: "mg", torpedo: "torpedo", mine: "mine", koiogran: "turn", evade: "evade", shield: "segments", jettison: "debris" };

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
const popClass = (key: string) => (popsNow.add(key), openPops.has(key) ? "noanim" : "");

/** Obsah nápovědy k manévrům (rychlosti, úhly, barvy, stres, akce). */
function maneuverHelp(ship: Ship): HTMLElement {
  const prof = profileOf(ship.loadout);
  const sw = (col: string) => h("i", { class: "hswatch", style: `background:${col}` });
  const li = (...c: (Node | string)[]) => h("li", {}, ...c);
  const limits = [1, 2, 3, 4, 5].map((s) => `${s}: ±${FIGHTER_PROFILE.maxAngle[s]}°`).join(" · ");
  return h(
    "div",
    { class: "mhelp" },
    h("h4", {}, label("Dráha")),
    h("ul", {}, li(`Manévr = rychlost + změna kurzu. Dráha je oblouk: délka = rychlost × ${MOVE_UNIT} jednotek, loď se po ní otočí o zvolený úhel.`), li("Kreslení: klik na loď, směr podle polohy myši (úhel = 2× směr k myši), rychlost podle vzdálenosti. Kolečko / klávesy 1–5 rychlost zamknou, K = otočka, mezerník potvrdí.")),
    h("h4", {}, label("Rychlost")),
    h("ul", {}, li(`1–5; tvoje loď teď max. ${prof.maxSpeed} (váha výbavy: každých ${WEIGHT.perSpeed} váhy = −1; overdrive droida váhu ignoruje).`), li(`Otočka o 180° jde jen z rychlosti ${prof.koiogranSpeeds.length ? `${Math.min(...prof.koiogranSpeeds)}–${Math.max(...prof.koiogranSpeeds)}` : "–"}, stojí 2 akce (s overdrivem 1) a po ní rychlost klesne o ${RULES.koiogranSpeedDrop}.`)),
    h("h4", {}, label("Úhel")),
    h("ul", {}, li(`Krok ${ANGLE_STEP}°, max. ±${MAX_ANGLE}°. Čím rychleji, tím míň: ${limits}.`)),
    h("h4", {}, label("Barvy (náročnost)")),
    h(
      "ul",
      { class: "hcolors" },
      li(sw(DIFFICULTY_COLOR.green), h("b", {}, "zelený"), ` – mírný: rychlost 1–2 do 40°, nebo rychlost 3 rovně. Vrátí +${STRESS.regenGreen} stres (autopilot droida +${DROID.autopilotRegen}).`),
      li(sw(DIFFICULTY_COLOR.white), h("b", {}, "bílý"), " – vše ostatní, co není ostré. Nic nestojí."),
      li(sw(DIFFICULTY_COLOR.red), h("b", {}, "oranžový"), ` – ostrý úhel (od 70°, při rychlosti 4+ od 40°) nebo změna rychlosti o 2+. Stojí ${STRESS.costRed} stres.`),
      li(sw(DIFFICULTY_COLOR.danger), h("b", {}, "nebezpečný (červený)"), ` – ostrý úhel a zároveň změna rychlosti o 2+. Stojí ${STRESS.costDanger} stres a ${STRESS.dangerHullPercent} % trupu.`),
      li(h("span", { class: "man-koi" }, "⟲"), h("b", {}, "otočka"), " – vždy aspoň oranžová: 1 stres na zelené/bílé křivce, 2 na oranžové, 3 na nebezpečné."),
    ),
    h("h4", {}, label("Stres a akce")),
    h("ul", {}, li(`Stresové body ${ship.stressPoints}/${ship.stats.stressMax}: bez dostatku se manévr vůbec nenabídne.`), li("Rovně stejnou rychlostí je zdarma; jakákoli změna rychlosti nebo úhlu stojí 1 akci „úprava pohybu“ (akce na kolo: 2)."), li("Dráha nehlídá překážky: srážka s lodí, asteroidem, kometou nebo okrajem = 15 zranění a odmrštění; bouře vypne štíty a lasery.")),
  );
}

/** Panel „Manévr“ (náhled nakreslené dráhy: směr, rychlost, úhel, náročnost). */
function maneuverPanel(ship: Ship, o: ShipOrders, man: Maneuver | null): HTMLElement {
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false };
  const dcolor = man ? (o.droid?.overdrive && maneuverStress(man) > 0 ? DIFFICULTY_COLOR.white : DIFFICULTY_COLOR[man.difficulty]) : "#f87171";
  return h(
    "div",
    { class: "pnl bb-maneuver" },
    h("div", { class: "ttl man-ttl" }, label("Manévr"), h("button", { class: "px tiny qbtn", title: "Nápověda: rychlosti, úhly a barvy manévrů", onclick: () => infoDialog({ title: "Manévry – nápověda", body: maneuverHelp(ship), wide: true }) }, "?")),
    h(
      "div",
      { class: "man-readout", title: man ? DIFFICULTY_LABEL[man.difficulty] : "Neplatný manévr" },
      h("span", { class: "man-glyph", style: `color:${dcolor}` }, angleGlyph(cur.angle, false), cur.koiogran ? h("span", { class: "man-koi", title: "Otočka 180° na konci" }, "⟲") : null),
      h("span", { class: "man-speed" }, String(cur.speed)),
    ),
    h("div", { class: "man-angle" }, `${Math.abs(cur.angle)}°${cur.koiogran ? " +180°" : ""}`),
    h("div", { class: "man-diff", style: `color:${dcolor}` }, label(man ? (effStressCost(man, o) > ship.stressPoints ? "chybí stres" : o.droid?.overdrive && maneuverStress(man) > 0 ? "overdrive" : DIFFICULTY_SHORT[man.difficulty]) : "neplatný")),
    h("div", { class: "spacer" }),
    h("div", { class: "keycap", title: "Mezerník začne / potvrdí kreslení dráhy" }, label("mezerník")),
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

export function renderBottomBar(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
  clear(root);
  popsNow.clear();
  try {
    renderBottomBarInner(root, m, cb);
  } finally {
    openPops = new Set(popsNow);
  }
}

function renderBottomBarInner(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
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
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false };
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
  const bubbleSize = 110;
  const bubble = h("div", { class: "bubble-box", title: ship.shieldType === "whole" ? `Energetický štít: zásoba ${ship.shields}/${ship.stats.shields}${RULES.shieldRecharge > 0 ? `, dobíjí se +${RULES.shieldRecharge} za kolo` : ""}${RULES.wholeEffDrop > 0 ? `, účinnost ${ship.shieldEff} % (po každém zásahu −${RULES.wholeEffDrop} %)` : ""}. Lasery pole jen vybíjejí; projektily prorazí ${RULES.wholePiercePct} % do trupu.` : `Segmentový štít (předek / pravobok / záď / levobok): ${ship.segments.join(" / ")}. Projektil zachytí segment celý za 1 bod; laser ubere 1 bod a ${RULES.segmentPassPct} % pronikne do trupu; při 0 jde vše do trupu.` }, shieldBubble({ ...ship, maxShields: ship.stats.shields }, teamColor, planned, bubbleSize, stormed));
  const shieldBox = h("div", { class: "shield-box" }, bubble);
  /** Vysouvací editor štítu nad tlačítkem ŠTÍT (stejný styl jako skener). */
  let shieldPop: HTMLElement | null = null;
  /** Záložky režimů nahoře v okénku štítu: PŘESUNOUT (1 akce) / DOBÍT (technologie). */
  const shieldTabs = () => {
    const act = ACTIONS.find((x) => x.id === "shield")!;
    const moveWhy = act.disabled(ship, m.state, o);
    const pick = m.rechargePick ?? [0, 0, 0, 0];
    const picked = pick.reduce((a, b) => a + b, 0);
    const moveTab = h(
      "button",
      { class: `px seg stab ${!rechargeMode ? "on" : ""}`, disabled: locked || (!!moveWhy && !planned), ...tipAttr({ ...actionTip("shield", ship, o, man, moveWhy && !planned ? moveWhy : null), note: "přesun bodů štítu – 1 akce, platí od začátku kola" }), onclick: () => cb.shieldMode(ship.id, "move") },
      label("Přesunout"),
      costPipsAll({ actions: 1 }, !!planned && !rechargeMode, "1 akce"),
    );
    const canGo = rechargeMode && picked > 0;
    const doTab = h(
      "button",
      { class: `px seg stab ${rechargeMode ? "on" : ""} ${canGo ? "go" : ""}`, disabled: locked || !!rechargeWhy, ...tipAttr({ ...actionTip("recharge", ship, o, man, rechargeWhy ?? null), note: rechargeMode ? (picked > 0 ? `klik = dobít hned (+${picked} ${picked === 1 ? "bod" : "body"} do zvolených segmentů)${picked < RULES.rechargeSegments ? " · nevyužitý bod propadne" : ""}` : `klikni na + u segmentů (${RULES.rechargeSegments} body), pak znovu DOBÍT`) : "dobití technologií – nebere akci, 1× za kolo, hned" }), onclick: () => (canGo ? cb.recharge(ship.id) : cb.shieldMode(ship.id, "recharge")) },
      label(rechargeMode ? `Dobít ${picked}/${RULES.rechargeSegments}` : "Dobít"),
      costPipsAll({ tech: RULES.rechargeTechCost }, false, `${RULES.rechargeTechCost} body technologie`),
    );
    return h("div", { class: "stabs" }, moveTab, doTab);
  };
  if (rechargeMode) {
    // režim DOBÍT: žluté + u segmentů, dole body k rozdělení
    const pick = m.rechargePick ?? [0, 0, 0, 0];
    const picked = pick.reduce((a, b) => a + b, 0);
    const cap = RULES.segmentHp * ship.stats.segmentModules;
    const preview = ship.segments.map((v, i) => v + pick[i]) as Segments;
    const pbtn = (seg: number) => {
      const full = ship.segments[seg] + pick[seg] >= cap;
      const can = pick[seg] > 0 || (picked < RULES.rechargeSegments && !full);
      return h("button", { class: `px sbtn y ${pick[seg] > 0 ? "on" : ""}`, disabled: !can, title: full && pick[seg] === 0 ? `${SEGMENT_NAMES[seg]}: segment je plný` : pick[seg] > 0 ? `${SEGMENT_NAMES[seg]}: +${pick[seg]} · klik = ubrat` : picked >= RULES.rechargeSegments ? "všechny body rozdělené – klikem na + jinde je ubereš" : `${SEGMENT_NAMES[seg]}: přidat bod`, onclick: () => cb.rechargePick(ship.id, seg) }, pick[seg] > 0 ? `+${pick[seg]}` : icon("plus", "currentColor", 9));
    };
    const slots = h("div", { class: "hand-slots y", title: `${RULES.rechargeSegments - picked} ${RULES.rechargeSegments - picked === 1 ? "bod" : "body"} k rozdělení` });
    for (let i = 0; i < RULES.rechargeSegments; i++) slots.append(h("i", { class: i < RULES.rechargeSegments - picked ? "on" : "" }));
    const popBubble = shieldBubble({ ...ship, maxShields: ship.stats.shields }, teamColor, preview, 84, stormed);
    shieldPop = h(
      "div",
      { class: `shield-pop ${popClass(`shield:${ship.id}`)}` },
      shieldTabs(),
      h("div", { class: "spair top" }, pbtn(0)),
      h("div", { class: "smid" }, h("div", { class: "spair left" }, pbtn(3)), popBubble, h("div", { class: "spair right" }, pbtn(1))),
      h("div", { class: "spair bottom" }, pbtn(2)),
      slots,
      h("div", { class: "muted snote" }, label(picked > 0 ? "potvrď tlačítkem DOBÍT nahoře" : "klik na + dá bod do segmentu")),
    );
  } else if (editing && planned) {
    const btn = (seg: number, d: 1 | -1) => {
      const v = planned[seg];
      const can = d < 0 ? v > 0 : inHand > 0 && v < RULES.segmentMax;
      return h("button", { class: "px sbtn", disabled: !can, title: d < 0 ? `${SEGMENT_NAMES[seg]}: odebrat bod` : inHand <= 0 ? "nejdřív bod někde odeber" : `${SEGMENT_NAMES[seg]}: přidat bod (max. ${RULES.segmentMax})`, onclick: () => cb.shieldDelta(ship.id, seg, d) }, icon(d < 0 ? "minus" : "plus", "currentColor", 8));
    };
    // příď a záď: − vlevo, + vpravo; boky: + nahoře, − dole
    const total = ship.segments.reduce((a, b) => a + b, 0);
    const slots = h("div", { class: "hand-slots", title: inHand > 0 ? `${inHand} bodů v ruce – polož je tlačítkem +` : "body štítu v ruce (odebrané, ještě nepoložené)" });
    for (let i = 0; i < total; i++) slots.append(h("i", { class: i < inHand ? "on" : "" }));
    const popBubble = shieldBubble({ ...ship, maxShields: ship.stats.shields }, teamColor, planned, 84, stormed);
    shieldPop = h(
      "div",
      { class: `shield-pop ${popClass(`shield:${ship.id}`)}` },
      shieldTabs(),
      h("div", { class: "spair top" }, btn(0, -1), btn(0, 1)),
      h("div", { class: "smid" }, h("div", { class: "spair left" }, btn(3, 1), btn(3, -1)), popBubble, h("div", { class: "spair right" }, btn(1, 1), btn(1, -1))),
      h("div", { class: "spair bottom" }, btn(2, -1), btn(2, 1)),
      slots,
      h("button", { class: "px tiny sreset", title: "Zrušit úpravu – zpět na původní rozložení", onclick: () => cb.cancelAction(ship.id) }, "↺ ", label("reset")),
    );
  }
  const shieldPopOpen = !!shieldPop;
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
      h("span", { class: "txt" }, ship.name),
      my.length > 1 ? h("div", { class: "ship-tabs" }, ...my.map((s, i) => h("button", { class: `px ${s.id === ship.id ? "on" : ""}`, title: `${s.name} · ${HULLS[s.loadout.hullId]?.name ?? ""} · trup ${s.hull}/${s.stats.hull}`, onclick: () => cb.select(s.id) }, `${i + 1} ${PILOTS[s.loadout.pilotId]?.name ?? ""}`))) : null,
    ),
    h("div", { class: "bb-shipbody" }, shieldBox, right),
  );

  /** Vysouvací inventář nad tlačítkem VYHODIT: klik na modul = vybrat k vyhození. */
  let jettisonPop: HTMLElement | null = null;
  if (o.action?.type === "jettison" && !locked) {
    const curId = o.action.moduleId;
    const chosen = ship.loadout.modules.find((x) => x.id === curId) ?? (ship.loadout.cargo ?? []).find((x) => x.id === curId);
    jettisonPop = h(
      "div",
      { class: "jettison-pop" },
      h("div", { class: "jp-head" }, icon("debris", "#7dd3fc", 12), label(chosen ? `vyhodit: ${MODULES[chosen.type].name}` : "klikni na modul, který vyhodíš")),
      renderLoadout({ loadout: ship.loadout, readonly: true, hideHead: true, budget: m.state.tuning.startBudget, allowed: m.state.settings.allowedModules, compact: true, showCargo: true, selectedId: curId, onSelect: (id) => cb.setOrders(ship.id, { action: { type: "jettison", moduleId: id } }) }),
    );
  }

  /* ---- 1b. výzbroj: munice každého modulu ---- */
  // všechny moduly: zbraně s municí, ostatní jen se stavem; každý má ukazatel životů (zničený = červený, nefunguje)
  const ammoMods = [...ship.loadout.modules].sort((a, b) => Number(b.ammo !== undefined || b.type === "laser") - Number(a.ammo !== undefined || a.type === "laser"));
  const weapons = h("div", { class: "pnl bb-ammo" }, h("div", { class: "ttl" }, label("Výzbroj")));
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
    weapons.append(h("div", { class: `ammo-row ${broken ? "broken" : ""}`, title: `${nameFull}\n${hpTxt}${ammoTxt ? `\n${ammoTxt}` : ""}` }, hpGauge(md), tile, icons));
  }

  /* ---- 2. manévr (svislý sloupec) ---- */
  const maneuver = maneuverPanel(ship, o, man);

  /* ---- 3. akce ---- */
  const apips = h("div", { class: "apip" });
  for (let i = 0; i < RULES.actionPoints; i++) apips.append(h("i", { class: i < RULES.actionPoints - acts.length ? "on" : "" }));
  /** Skupina suroviny v hlavičce (varianta C): popisek nad pilulkami. */
  const resGroup = (name: string, pips: HTMLElement, title: string, cls = "") => h("div", { class: `res-grp ${cls}`, title }, h("span", { class: "res-lbl" }, label(name)), pips);
  const spips = h("div", { class: "apip pink" });
  for (let i = 0; i < ship.stats.stressMax; i++) spips.append(h("i", { class: i < ship.stressPoints ? "on" : "" }));
  const inStormNow = inStorm(m.state, ship);
  const tpips = h("div", { class: `apip yellow ${inStormNow ? "storm" : ""}` });
  const reserved = droidCost(o); // v plánu (droid) – odečte se při SPUSTIT KOLO
  for (let i = 0; i < ship.stats.techMax; i++) tpips.append(h("i", { class: i < ship.techPoints - reserved ? "on" : i < ship.techPoints ? "plan" : "" }));
  const resources = h(
    "div",
    { class: "res-row" },
    resGroup("Akce", apips, `Akce: ${RULES.actionPoints - acts.length}/${RULES.actionPoints} volné. Dobíjí se každé kolo.`),
    resGroup("Stres", spips, `Stresové body ${ship.stressPoints}/${ship.stats.stressMax}: oranžový manévr −1, nebezpečný (červený) −2, zelený +1.`),
    resGroup(inStormNow ? "Technologie ⚡ bouře" : "Technologie", tpips, `Technologie ${ship.techPoints}/${ship.stats.techMax}: body na celou bitvu, nedobíjí se (průlet ocasem komety +${COMET.tailTech}). Sken lodi ${SCANNER.shipCost}, hluboký sken ${SCANNER.deepCost}.${inStormNow ? "\nV bouři je technologie deaktivovaná – skener nefunguje." : ""}`, inStormNow ? "storm" : ""),
  );
  /** Kolik akcí tlačítko právě stojí (tečky): otočka 2, manévr 1 (jen když se liší od rovně stejnou rychlostí), ostatní 1. */
  const dotsFor = (id: string) => (id === "koiogran" ? (acts.some((a) => a.id === "koiogran") ? 2 : 0) : id === "move" ? (acts.some((a) => a.id === "move") && !acts.some((a) => a.id === "koiogran") ? 1 : 0) : acts.some((a) => a.id === id) ? 1 : 0);
  const buttons = h("div", { class: "bb-weapons" });
  for (const grp of ACTION_GROUPS) {
    const avail = grp.ids.map((id) => ACTIONS.find((x) => x.id === id)!).filter((a) => actionAvailable(a, ship));
    // skupina bez dostupných akcí se neukazuje; Loď = NÁKLAD (vyhodit / zvednout), Speciální = štít, skener, droid
    if (grp.label === "Loď" && ship.loadout.modules.length === 0) continue;
    if (avail.length === 0 && grp.label !== "Loď" && !(grp.label === "Speciální" && (scannerModule(ship.loadout) || ship.loadout.modules.some((x) => x.type === "droid") || ship.shieldType === "whole"))) continue;
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
          const noAp = !on && actionCost(ship, o) >= RULES.actionPoints;
          const why = destroyed ? "ZNIČENO – modul nefunguje" : stormOff ? "systém je v bouři mimo provoz" : noAmmo ? "došly náboje" : noAp ? `žádná volná akce (max. ${RULES.actionPoints} za kolo)` : null;
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
      const moveDone = isMove && !aiming && o.maneuverId !== defaultOrders(ship).maneuverId;
      // štít: upraveno a okénko zavřené = hotovo (zelené), stisk = reset (zrušit úpravu)
      const shieldDone = a.id === "shield" && !!planned && !editing && !rechargeMode;
      const done = moveDone || shieldDone;
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
              ...(moveDone ? { note: "nakresleno a platí · stisk = reset (rovně stejnou rychlostí, zdarma)" } : shieldDone ? { note: "úprava platí · stisk = otevřít (upravit, dobít, reset)" } : a.id === "shield" && rechargeMode ? { note: "režim DOBÍT – klik vedle = zavřít" } : a.id === "shield" && editing ? { note: "rozmísti body −/+ a klikni vedle – úprava se potvrdí" } : {}),
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
            const manStress = a.id === "koiogran" ? (man?.koiogran ? effStressCost(man, o) : effStressCost("red", o)) : a.id === "move" && man && !man.koiogran ? effStressCost(man, o) : 0;
            const c = { actions: a.id === "koiogran" ? (o.droid?.overdrive ? 1 : 2) : 1, stress: a.id === "evade" ? effEvadeCost(o) : manStress };
            const parts = [`${c.actions} ${c.actions === 1 ? "akci" : "akce"}`];
            if (c.stress > 0) parts.push(`${c.stress} stres`);
            if (c.stress < 0) parts.push(`vrací ${-c.stress} stres`);
            // během kreslení manévru (aiming) ukazujeme cenu bez fajfek – zaplaceno je až po potvrzení
            return costPipsAll(c, dots > 0 && !(isMove && aiming), `stojí ${parts.join(" + ")}${a.id === "move" ? " (rovně stejnou rychlostí zdarma)" : ""}`);
          })(),
          icon(isMove && aiming ? "check" : (ACTION_ICON[a.id] ?? "target"), "currentColor", 22),
          h("span", { class: "lbl" }, label(isMove ? (aiming ? "Potvrdit" : "Manévr") : a.label.replace(/ \([12] akce\)/, "").replace(" 180°", "").replace("Úhybný manévr", "Úhyb").replace("Úprava štítu", "Štít").replace("Vyhodit modul", "Vyhodit").replace("Zvednout náklad", "Náklad"))),
          done ? h("span", { class: "reset-strip" }, "↺ ", label("reset")) : null,
          stormOff ? h("span", { class: "sb" }, "⚡") : null,
          destroyed ? h("span", { class: "dead-x" }, "✕") : null,
        );
      if (a.id === "shield" && shieldPopOpen) row.append(h("div", { class: "scan-holder stack" }, shieldPop, wbtn));
      else row.append(wbtn);
    }
    if (grp.label === "Loď") {
      // spojené tlačítko NÁKLAD: vyhodit modul / zvednout náklad
      const jet = ACTIONS.find((x) => x.id === "jettison")!;
      const pick = ACTIONS.find((x) => x.id === "pickup")!;
      const jetOn = o.action?.type === "jettison";
      const pickOn = o.action?.type === "pickup";
      const cargoActive = jetOn || pickOn;
      const cargoSpent = dotsFor("jettison") + dotsFor("pickup");
      const whyJet = jet.disabled(ship, m.state, o);
      const whyPick = pick.disabled(ship, m.state, o);
      const sub = (a: typeof jet, on: boolean, why: string | null, lbl: string) =>
        h(
          "button",
          { class: `px bb-weapon sm ${on ? "on" : ""}`, disabled: locked || (!!why && !on), ...tipAttr(actionTip(a.id, ship, o, man, on ? null : why)), onclick: () => cb.chooseAction(ship.id, a.id) },
          costPips(1, on ? "spent" : "red", "stojí 1 akci"),
          icon(ACTION_ICON[a.id] ?? "target", "currentColor", 22),
          h("span", { class: "lbl" }, label(lbl)),
        );
      const cargoDone = cargoActive && !m.cargoOpen; // akce zvolená, okénko zavřené = hotovo, stisk = reset
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
              title: "Náklad",
              cost: { actions: 1 },
              fx: [
                { icon: "debris", text: "vyhodit modul z lodi / nákladu" },
                { icon: "cargo", text: `zvednout trosky do ${CARGO.range}` },
              ],
              note: cargoDone ? `${jetOn ? "vyhození" : "zvednutí"} platí · stisk = reset` : "klik vedle okénko zavře a volba platí",
            }),
            onclick: () => (cargoDone ? cb.cancelAction(ship.id) : cb.cargoToggle(ship.id)),
          },
          costPips(1, cargoSpent > 0 ? "spent" : "red", "stojí 1 akci"),
          icon("cargo", "currentColor", 22),
          h("span", { class: "lbl" }, label(jetOn ? "Vyhodit" : pickOn ? "Zvednout" : "Náklad")),
          cargoDone ? h("span", { class: "reset-strip" }, "↺ ", label("reset")) : null,
        ),
      );
      if (m.cargoOpen && !locked) {
        const pop = h("div", { class: `cargo-pop ${popClass(`cargo:${ship.id}`)}` }, h("div", { class: "cargo-tabs" }, sub(jet, jetOn, whyJet, "Vyhodit"), sub(pick, pickOn, whyPick, "Zvednout")));
        if (jetOn) {
          const curId = o.action?.type === "jettison" ? o.action.moduleId : undefined;
          const chosen = ship.loadout.modules.find((x) => x.id === curId) ?? (ship.loadout.cargo ?? []).find((x) => x.id === curId);
          pop.append(
            chosen
              ? h("div", { class: "jp-head ok" }, icon("check", "#4ade80", 12), label(`vyhodí se: ${MODULES[chosen.type].name}`), h("span", { class: "muted" }, label("· na začátku kola · jiný modul = klik")))
              : h("div", { class: "jp-head warn" }, icon("debris", "#fbbf24", 12), label("klikni na modul, který vyhodíš")),
            renderLoadout({ loadout: ship.loadout, readonly: true, hideHead: true, budget: m.state.tuning.startBudget, allowed: m.state.settings.allowedModules, compact: true, showCargo: true, selectedId: curId, onSelect: (id) => cb.jettisonChosen(ship.id, id) }),
          );
        } else if (pickOn) {
          const wantId = o.action?.type === "pickup" ? o.action.targetId : undefined;
          const tgt = wantId ? (m.state.debris ?? []).find((d) => d.id === wantId) : undefined;
          const sp = cur.speed;
          const near = (m.state.debris ?? []).some((d) => dist(ship, d) <= CARGO.range);
          pop.append(
            tgt
              ? h("div", { class: "jp-head ok" }, icon("check", "#4ade80", 12), label(`zvedne se: ${MODULES[tgt.type].name}`), h("span", { class: "muted" }, label(`· ${Math.round(dist(ship, tgt))} / ${CARGO.range}`)))
              : h("div", { class: "jp-head warn" }, icon("cargo", "#fbbf24", 12), label(near ? "klikni na trosky v dosahu" : "v dosahu nejsou žádné trosky – akce se nevykoná")),
            h("div", { class: `cargo-note ${sp > CARGO.maxSpeed ? "warn" : "muted"}` }, label(sp > CARGO.maxSpeed ? `rychlost ${sp} > ${CARGO.maxSpeed} – zpomal, jinak se nezvedne` : `dosah ${CARGO.range} · rychlost ${sp} ok · po střelbě, před pohybem`)),
          );
        } else pop.append(h("div", { class: "muted cargo-note" }, label(`náklad ${(ship.loadout.cargo ?? []).length}/${cargoCapacity(ship.loadout)}`)));
        holder.append(pop);
      }
      row.append(holder);
    }
    if (grp.label === "Speciální") {
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
          // dvě tlačítka vyjedou nad tlačítko skeneru (přes okraj lišty), stejně velká jako ono
          const cost = (n: number) => costPipsAll({ tech: n }, false, `${n} ${n === 1 ? "bod" : "body"} technologie (nebere akci)`);
          holder.append(
            h(
              "div",
              { class: `scan-pop ${popClass(`scan:${ship.id}`)}` },
              h("button", { class: `px bb-weapon sm ${m.scanPick ? "on" : ""}`, disabled: locked || tech < SCANNER.shipCost, ...tipAttr({ ...actionTip("scan-ship", ship, o, man), ...(tech < SCANNER.shipCost ? { warn: "Nelze: nedostatek technologie." } : {}) }), onclick: () => cb.scanPickTarget(ship.id, !m.scanPick) }, icon("ship", "currentColor", 22), h("span", { class: "lbl" }, label("Sken lodi")), cost(SCANNER.shipCost)),
              h("button", { class: "px bb-weapon sm", disabled: locked || tech < SCANNER.deepCost, ...tipAttr({ ...actionTip("scan-deep", ship, o, man), ...(tech < SCANNER.deepCost ? { warn: "Nelze: nedostatek technologie." } : {}) }), onclick: () => cb.scan(ship.id, "deep") }, icon("deep", "currentColor", 22), h("span", { class: "lbl" }, label("Vesmír")), cost(SCANNER.deepCost)),
            ),
          );
        }
        row.append(holder);
      }
      // Energetický štít: tlačítko ŠTÍT s okénkem DOBÍT (segmentový má ŠTÍT jako akci výš v řádku)
      if (ship.shieldType === "whole") {
        const tech = ship.techPoints;
        const why = rechargeWhy;
        const room = shieldRechargeRoom(ship);
        const add = Math.min(RULES.rechargeWhole, room);
        const open = !!m.rechargeOpen && !why;
        const holder = h("div", { class: "scan-holder stack" });
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
              { class: `shield-pop ${popClass(`shield:${ship.id}`)}` },
              h("div", { class: "stabs" }, h("button", { class: "px seg stab on go", disabled: locked, ...tipAttr({ ...actionTip("recharge", ship, o, man), note: `klik = dobít hned: ${ship.shields} → ${ship.shields + add} / ${max} · nebere akci · 1× za kolo` }), onclick: () => cb.recharge(ship.id) }, label("Dobít"), costPipsAll({ tech: RULES.rechargeTechCost }, false, `${RULES.rechargeTechCost} body technologie`))),
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
        row.append(holder);
      }
      // Droid – pilot: tlačítko s okénkem Overdrive / Autopilot (platí se technologií až při SPUSTIT KOLO)
      const hasDroid = ship.loadout.modules.some((x) => x.type === "droid");
      if (hasDroid) {
        const dmod = droidModule(ship);
        const dDestroyed = !dmod;
        const tech = ship.techPoints;
        const od = o.droid ?? {};
        const planned = droidCost(o);
        const anyOn = !!od.overdrive || !!od.autopilot;
        const holder = h("div", { class: "scan-holder" });
        const dtip = tipAttr({ ...actionTip("droid", ship, o, man), note: `technologie ${tech}/${ship.stats.techMax}${planned ? ` (v plánu −${planned})` : ""} · nebere akci · v bouři nefunguje`, ...(dDestroyed ? { warn: "ZNIČENO – modul nefunguje" } : stormed ? { warn: "Nelze: v bouři droid nefunguje." } : {}) });
        holder.append(
          h(
            "button",
            {
              class: `px bb-weapon droid-btn ${m.droidOpen && !stormed && !dDestroyed ? "on" : ""} ${anyOn && !m.droidOpen ? "done" : ""} ${stormed ? "stormed" : ""} ${dDestroyed ? "destroyed" : ""}`,
              disabled: locked || stormed || dDestroyed,
              ...dtip,
              onclick: () => cb.droidToggle(ship.id),
            },
            icon("bot", "currentColor", 22),
            h("span", { class: "lbl" }, label("Droid")),
            anyOn ? costPipsAll({ tech: planned }, true, `v plánu: ${planned} technologie`) : null,
            anyOn && !m.droidOpen ? h("span", { class: "reset-strip" }, label(`${[od.overdrive ? "overdrive" : "", od.autopilot ? "autopilot" : ""].filter(Boolean).join(" + ")}`)) : null,
            stormed ? h("span", { class: "sb" }, "⚡") : null,
            dDestroyed ? h("span", { class: "dead-x" }, "✕") : null,
          ),
        );
        if (m.droidOpen && !stormed && !dDestroyed) {
          const cost = (n: number, on: boolean) => costPipsAll({ tech: n }, on, `${n} ${n === 1 ? "bod" : "body"} technologie – platí se až při SPUSTIT KOLO`);
          const canOver = od.overdrive || tech - planned >= DROID.overdriveCost;
          const canAuto = od.autopilot || tech - planned >= DROID.autopilotCost;
          holder.append(
            h(
              "div",
              { class: `scan-pop ${popClass(`droid:${ship.id}`)}` },
              h("button", { class: `px bb-weapon sm ${od.overdrive ? "on" : ""}`, disabled: locked || !canOver, ...tipAttr({ ...actionTip("overdrive", ship, o, man), ...(!canOver ? { warn: "Nelze: nedostatek technologie." } : {}) }), onclick: () => cb.setOrders(ship.id, { droid: { ...od, overdrive: !od.overdrive } }) }, icon("speed", "currentColor", 22), h("span", { class: "lbl" }, label("Overdrive")), cost(DROID.overdriveCost, !!od.overdrive)),
              h("button", { class: `px bb-weapon sm ${od.autopilot ? "on" : ""}`, disabled: locked || !canAuto, ...tipAttr({ ...actionTip("autopilot", ship, o, man), ...(!canAuto ? { warn: "Nelze: nedostatek technologie." } : {}) }), onclick: () => cb.setOrders(ship.id, { droid: { ...od, autopilot: !od.autopilot } }) }, icon("turn", "currentColor", 22), h("span", { class: "lbl" }, label("Autopilot")), cost(DROID.autopilotCost, !!od.autopilot)),
            ),
          );
        }
        row.append(holder);
      }
    }
    box.append(row);
    buttons.append(box);
  }
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
    const cur = o.action.moduleId;
    const chosen = ship.loadout.modules.find((x) => x.id === cur) ?? (ship.loadout.cargo ?? []).find((x) => x.id === cur);
    details.append(icon("debris", "#94a3b8"));
    if (chosen) {
      const after = { ...ship.loadout, modules: ship.loadout.modules.filter((x) => x.id !== cur), cargo: (ship.loadout.cargo ?? []).filter((x) => x.id !== cur) };
      details.append(h("span", { class: "odds", style: "color:#4ade80" }, label(`✔ vyhodí se: ${MODULES[chosen.type].name}`)), h("span", { class: "muted" }, label(`· váha ${loadoutWeight(ship.loadout)} → ${loadoutWeight(after)} · max. rychlost ${profileOf(ship.loadout).maxSpeed} → ${profileOf(after).maxSpeed}`)));
    } else details.append(h("span", { class: "warn" }, label("↑ vyber modul v okénku nad tlačítkem – jinak se nic nevyhodí")));
  } else if (o.action?.type === "pickup") {
    const wantId = o.action.targetId;
    const tgt = wantId ? (m.state.debris ?? []).find((d) => d.id === wantId) : undefined;
    const sp = cur.speed;
    details.append(icon("cargo", "#a7f3d0"));
    if (tgt) details.append(h("span", { class: "txt" }, `zvednout: ${MODULES[tgt.type].name}`), h("span", { class: "muted" }, label(`· ${Math.round(dist(ship, tgt))} / ${CARGO.range}`)));
    else details.append(h("span", { class: "warn" }, label("klikni na trosky v dosahu")));
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
    h("div", { class: "bb-head res-head" }, resources),
    buttons,
    details,
  );

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
    h("div", { class: "keycap" }, "ENTER"),
  );

  /* ---- 5. pilot (svislý sloupec) ---- */
  const pilot = h("div", { class: "pnl bb-pilot" }, pilotBadge(ship.loadout.pilotId, true));

  root.append(status, weapons, actions, maneuver, pilot, go);
}
