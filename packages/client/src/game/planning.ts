import {
  RULES,
  COMET,
  actionList,
  laserOdds,
  FACING_NAMES,
  inStorm,
  SCANNER,
  scannerModule,
  loadoutWeight,
  mgPreview,
  mineModule,
  mineSideOf,
  MODULES,
  profileOf,
  laserTarget,
  laserReach,
  parseManeuverId,
  resolveManeuver,
  STRESS,
  stressCost,
  TEAM_COLORS,
  type Difficulty,
  type GameState,
  type MineSide,
  type Segments,
  type ShipOrders,
} from "@wingfighter/shared";
import { clear, h } from "../dom.ts";
import { icon, label, segBar } from "../icons.ts";
import { ACTIONS, actionAvailable } from "./actions.ts";
import { SEGMENT_NAMES, shieldBubble, strengthColor } from "./shield-ui.ts";
import { pilotBadge } from "../pilot-ui.ts";

export interface PlanningCallbacks {
  select(shipId: string): void;
  setOrders(shipId: string, patch: Partial<ShipOrders>): void;
  chooseAction(shipId: string, actionId: string): void;
  aim(shipId: string): void;
  ready(): void;
  unready(): void;
  /** Otevře inventář s výběrem modulu k vyhození. */
  jettisonPick(shipId: string): void;
  /** Skener: vysunout/zasunout tlačítka, zapnout výběr cíle, provést hned. */
  scanToggle(shipId: string): void;
  scanPickTarget(shipId: string, on: boolean): void;
  scan(shipId: string, mode: "deep" | "cooldown"): void;
  /** Pozorovatel: tabulka skóre / opuštění hry. */
  showScore(): void;
  leave(): void;
  /** Přepnout potvrzování nevyužitých akcí (přepínač nad SPUSTIT KOLO, klávesa P). */
  toggleConfirm(): void;
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
  scanPick?: boolean;
  inventoryOpen?: boolean;
  /** Ptát se před spuštěním kola s nevyužitými akcemi. */
  askConfirm?: boolean;
}

/** Kolik bodů štítu je "v ruce" (odebráno, ale ještě nerozmístěno). */
export function shieldInHand(ship: { segments: Segments }, o: ShipOrders): number {
  if (o.action?.type !== "shield") return 0;
  const sum = (a: Segments) => a[0] + a[1] + a[2] + a[3];
  return sum(ship.segments) - sum(o.action.segments);
}

export const DIFFICULTY_COLOR: Record<Difficulty, string> = { green: "#4ade80", white: "#e2e8f0", red: "#f87171", danger: "#fb923c" };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  green: "zelený – vrátí 1 stresový bod",
  white: "bílý – bez vlivu",
  red: "červený – stojí 1 stresový bod",
  danger: `NEBEZPEČNÝ – stojí 2 body a ${STRESS.dangerHullPercent} % trupu`,
};
const DIFFICULTY_SHORT: Record<Difficulty, string> = { green: "zelený", white: "bílý", red: "červený", danger: "nebezpečný" };
/** Kategorie akcí v liště: zbraně · pohyb · speciální. */
const ACTION_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Zbraně", ids: ["laser", "mg", "torpedo", "mine"] },
  { label: "Pohyb", ids: ["move", "evade", "koiogran"] },
  { label: "Speciální", ids: ["shield", "jettison"] },
];
const FACING_GLYPH: Record<string, string> = { front: "↑", right: "→", back: "↓", left: "←" };
const ACTION_ICON: Record<string, string> = { move: "pen", laser: "laser", mg: "mg", torpedo: "torpedo", mine: "mine", koiogran: "turn", evade: "evade", shield: "segments", jettison: "debris" };

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

export function renderBottomBar(root: HTMLElement, m: PlanningModel, cb: PlanningCallbacks) {
  clear(root);
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
  if (m.animating) {
    root.append(
      h(
        "div",
        { class: "pnl bb-status" },
        h("div", { class: "bb-big" }, icon("play", "#7dd3fc", 18), label("Vyhodnocení kola")),
        h("div", { class: "txt muted" }, "Sleduj mapu…"),
      ),
    );
    return;
  }

  const o = m.orders.get(ship.id)!;
  const locked = m.submitted;
  const man = resolveManeuver(profileOf(ship.loadout), o.maneuverId, ship.speed);
  const cur = parseManeuverId(o.maneuverId) ?? { speed: ship.speed, angle: 0, koiogran: false };
  const acts = actionList(ship, o);
  const aiming = m.aimingShipId === ship.id;

  /* ---- 1. loď: pixelová bublina štítu + svislé ukazatele ---- */
  const planned = o.action?.type === "shield" ? o.action.segments : undefined;
  const inHand = shieldInHand(ship, o);
  const editing = !!planned && !locked; // akce ŠTÍT zapnutá → −/+ u segmentů, změny platí hned
  const teamColor = TEAM_COLORS[ship.team];
  const stormed = inStorm(m.state, ship);
  const bubbleSize = 110;
  const bubble = h("div", { class: "bubble-box", title: ship.shieldType === "whole" ? `Celolodní štít: zásoba ${ship.shields}/${ship.stats.shields}, účinnost ${ship.shieldEff} % (po každém zásahu −${RULES.wholeEffDrop} %)` : `Segmentový štít (předek / pravobok / záď / levobok): ${ship.segments.join(" / ")}. Každý zásah ubere 1 bod a je pohlcen celý; při 0 jde zranění do trupu.` }, shieldBubble({ ...ship, maxShields: ship.stats.shields }, teamColor, planned, bubbleSize, stormed));
  const shieldBox = h("div", { class: "shield-box" }, bubble);
  /** Vysouvací editor štítu nad tlačítkem ŠTÍT (stejný styl jako skener). */
  let shieldPop: HTMLElement | null = null;
  if (editing && planned) {
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
      { class: "shield-pop" },
      h("div", { class: "spair top" }, btn(0, -1), btn(0, 1)),
      h("div", { class: "smid" }, h("div", { class: "spair left" }, btn(3, 1), btn(3, -1)), popBubble, h("div", { class: "spair right" }, btn(1, 1), btn(1, -1))),
      h("div", { class: "spair bottom" }, btn(2, -1), btn(2, 1)),
      slots,
    );
    shieldBox.append(h("span", { class: "bubble-tag" }, label("plán")));
  } else if (planned) shieldBox.append(h("span", { class: "bubble-tag" }, label("plán")));
  const vgauge = (n: number, val: number, color: string, dark: string, name: string, num: string, title: string) => {
    const bar = h("div", { class: "vbar" });
    for (let i = 0; i < n; i++) bar.append(h("i", { style: `background:${i < val ? color : dark}` }));
    return h("div", { class: "vgauge", title }, bar, h("span", { class: "vname" }, label(name)), h("span", { class: "vnum", style: `color:${color}` }, num));
  };
  const hullBlocks = Math.max(ship.hull > 0 ? 1 : 0, Math.round((10 * ship.hull) / ship.stats.hull));
  const maxSp = profileOf(ship.loadout).maxSpeed;
  const gauges = h(
    "div",
    { class: "gauges" },
    vgauge(10, hullBlocks, ship.hull <= ship.stats.hull * 0.3 ? "#ef4444" : "#4ade80", "#14341f", "trup", String(ship.hull), `Trup ${ship.hull}/${ship.stats.hull}`),
    vgauge(STRESS.max, ship.stressPoints, "#f472b6", "#3b1a2e", "stres", `${ship.stressPoints}/${STRESS.max}`, "Stresové body: červený manévr −1, nebezpečný −2, zelený +1"),
    vgauge(5, ship.speed, "#94a3b8", "#1e293b", "rychlost", `${ship.speed}/${maxSp}`, `Aktuální rychlost ${ship.speed}, max. s touto váhou ${maxSp} (váha ${loadoutWeight(ship.loadout)})`),
  );
  const right = h("div", { class: "bb-shipinfo" }, gauges);
  const shieldLine =
    ship.shieldType === "whole"
      ? h("div", { class: `bb-row ${stormed ? "dim" : ""}` }, icon("shield", stormed ? "#64748b" : strengthColor(ship.shields / Math.max(1, ship.stats.shields))), h("span", { class: "num" }, `${Math.round((100 * ship.shields) / Math.max(1, ship.stats.shields))} %`), h("span", { class: "muted", title: "Účinnost: kolik % zranění štít pohltí" }, label(stormed ? "vypnuto" : `úč. ${ship.shieldEff} %`)))
      : ship.shieldType === "segment" && stormed
        ? h("div", { class: "bb-row dim" }, icon("shield", "#64748b"), h("span", { class: "pv" }, label("štít vypnut")))
        : null;
  if (shieldLine) right.append(shieldLine);
  if (stormed) right.append(h("div", { class: "storm-warn", title: "Elektromagnetická bouře: štíty a lasery mimo provoz, torpéda neřiditelná, skener nefunguje" }, "⚡ ", label("bouře")));
  // jméno hráče / lodi je na záložce nad panelem (na horní hraně lišty)
  const status = h(
    "div",
    { class: "pnl bb-ship" },
    h(
      "div",
      { class: "bb-tab", style: `color:${teamColor}` },
      h("span", { class: "txt" }, ship.name),
      my.length > 1 ? h("div", { class: "ship-tabs" }, ...my.map((s, i) => h("button", { class: `px ${s.id === ship.id ? "on" : ""}`, title: s.name, onclick: () => cb.select(s.id) }, String(i + 1)))) : null,
    ),
    h("div", { class: "bb-shipbody" }, shieldBox, right),
  );

  /* ---- 1b. výzbroj: munice každého modulu ---- */
  const ammoMods = ship.loadout.modules.filter((md) => md.ammo !== undefined || md.type === "laser");
  const weapons = h("div", { class: "pnl bb-ammo" }, h("div", { class: "ttl" }, label("Výzbroj")));
  if (ammoMods.length === 0) weapons.append(h("div", { class: "muted txt" }, "bez zbraní"));
  const counters: Record<string, number> = {};
  const typeCount: Record<string, number> = {};
  for (const md of ammoMods) typeCount[md.type] = (typeCount[md.type] ?? 0) + 1;
  for (const md of ammoMods) {
    const def = MODULES[md.type];
    counters[md.type] = (counters[md.type] ?? 0) + 1;
    const max = def.ammo ?? 0;
    const left = md.ammo ?? 0;
    const base = md.type === "torpedo" ? "TORP" : md.type === "mine" ? "MINY" : md.type === "mg" ? "KULOMET" : md.type === "laser" ? "LASER" : def.short;
    const name = `${base}${typeCount[md.type] > 1 ? ` ${counters[md.type]}` : ""}`;
    const icons = h("span", { class: "ammo-icons" });
    if (md.type === "laser") {
      // bez munice: nekonečno
      icons.append(h("span", { class: "inf", title: "Lasery nemají munici – střílí každé kolo" }, "∞"));
      weapons.append(h("div", { class: "ammo-row", title: `${def.name} – ${FACING_NAMES[md.facing ?? "front"]}: bez munice` }, h("span", { class: "ammo-name" }, label(name), h("span", { class: "muted" }, ` ${FACING_GLYPH[md.facing ?? "front"]}`)), icons));
      continue;
    }
    if (md.type === "mg") {
      const n = 10;
      const lit = Math.round((left / Math.max(1, max)) * n);
      for (let i = 0; i < n; i++) icons.append(h("i", { class: `mgpip ${i < lit ? "on" : ""}` }));
    } else for (let i = 0; i < max; i++) icons.append(icon(def.icon, i < left ? "#f87171" : "#334155", 10));
    weapons.append(
      h(
        "div",
        { class: "ammo-row", title: `${def.name} ${typeCount[md.type] > 1 ? counters[md.type] : ""} – ${FACING_NAMES[md.facing ?? "front"]}: munice ${left}/${max}` },
        h("span", { class: "ammo-name" }, label(name), h("span", { class: "muted" }, ` ${FACING_GLYPH[md.facing ?? "front"]}`)),
        icons,
        h("span", { class: "ammo-num muted" }, md.type === "mg" ? String(left) : `${left}/${max}`),
      ),
    );
  }

  /* ---- 2. manévr (svislý sloupec) ---- */
  const dcolor = man ? DIFFICULTY_COLOR[man.difficulty] : "#f87171";
  const maneuver = h(
    "div",
    { class: "pnl bb-maneuver" },
    h("div", { class: "ttl" }, label("Manévr")),
    h(
      "div",
      { class: "man-readout", title: man ? DIFFICULTY_LABEL[man.difficulty] : "Neplatný manévr" },
      h("span", { class: "man-glyph", style: `color:${dcolor}` }, angleGlyph(cur.angle, cur.koiogran)),
      h("span", { class: "man-speed" }, String(cur.speed)),
    ),
    h("div", { class: "man-angle" }, cur.koiogran ? "180°" : `${Math.abs(cur.angle)}°`),
    h("div", { class: "man-diff", style: `color:${dcolor}` }, label(man ? (stressCost(man.difficulty) > ship.stressPoints ? "chybí stres" : DIFFICULTY_SHORT[man.difficulty]) : "neplatný")),
    h("div", { class: "spacer" }),
    h("div", { class: "keycap", title: "Mezerník začne / potvrdí kreslení dráhy" }, label("mezerník")),
  );

  /* ---- 3. akce ---- */
  const apips = h("div", { class: "apip" });
  for (let i = 0; i < RULES.actionPoints; i++) apips.append(h("i", { class: i < RULES.actionPoints - acts.length ? "on" : "" }));
  /** Kolik akcí tlačítko právě stojí (tečky): otočka 2, manévr 1 (jen když se liší od rovně stejnou rychlostí), ostatní 1. */
  const dotsFor = (id: string) => (id === "koiogran" ? (acts.some((a) => a.id === "koiogran") ? 2 : 0) : id === "move" ? (acts.some((a) => a.id === "move") && !acts.some((a) => a.id === "koiogran") ? 1 : 0) : acts.some((a) => a.id === id) ? 1 : 0);
  const buttons = h("div", { class: "bb-weapons" });
  for (const grp of ACTION_GROUPS) {
    const avail = grp.ids.map((id) => ACTIONS.find((x) => x.id === id)!).filter((a) => actionAvailable(a, ship));
    if (avail.length === 0 && !(grp.label === "Speciální" && scannerModule(ship.loadout))) continue; // skupina bez dostupných akcí se neukazuje
    const box = h("div", { class: "act-group" }, h("span", { class: "act-cap" }, label(grp.label)));
    const row = h("div", { class: "act-row" });
    for (const a of avail) {
      const isMove = a.id === "move";
      const active = isMove ? aiming : a.active(o);
      const stormOff = stormed && (a.id === "laser" || a.id === "shield");
      const why = stormOff ? "systém je v bouři mimo provoz" : a.disabled(ship, m.state, o);
      const dots = dotsFor(a.id); // > 0 = akce je za toto tlačítko utracená
      const wbtn =
        h(
          "button",
          {
            class: `px bb-weapon ${active && !stormOff ? "on" : ""} ${stormOff ? "stormed" : ""} ${dots > 0 ? "spent" : ""}`,
            disabled: locked || stormOff || (!!why && !active && dots === 0),
            title: `${a.label}\n${a.description}${why ? `\nNelze: ${why}.` : ""}`,
            onclick: () => (isMove ? cb.aim(ship.id) : cb.chooseAction(ship.id, a.id)),
          },
          costPips(a.id === "koiogran" ? 2 : 1, dots > 0 ? "spent" : "red", a.id === "koiogran" ? "stojí 2 akce" : a.id === "move" ? "stojí 1 akci (rovně stejnou rychlostí zdarma)" : "stojí 1 akci"),
          icon(isMove && aiming ? "check" : (ACTION_ICON[a.id] ?? "target"), "currentColor", 22),
          h("span", { class: "lbl" }, label(isMove ? (aiming ? "Potvrdit" : "Manévr") : a.label.replace(/ \([12] akce\)/, "").replace(" 180°", "").replace("Úhybný manévr", "Úhyb").replace("Úprava štítu", "Štít").replace("Vyhodit modul", "Vyhodit"))),
          stormOff ? h("span", { class: "sb" }, "⚡") : null,
        );
      if (a.id === "shield" && shieldPop) row.append(h("div", { class: "scan-holder" }, wbtn, shieldPop));
      else row.append(wbtn);
    }
    if (grp.label === "Speciální") {
      const sc = scannerModule(ship.loadout);
      if (sc) {
        const charges = sc.charges ?? 0;
        const cd = sc.cooldown ?? 0;
        const pips = h("span", { class: "scan-pips" });
        // bez cooldownu: políčka = náboje; při cooldownu: políčka = délka cooldownu (červeně zbývající kola)
        const slots = cd > 0 ? SCANNER.cooldown : SCANNER.charges;
        for (let i = 0; i < slots; i++) pips.append(h("i", { class: cd > 0 ? (i < cd ? "red" : "") : i < charges ? "on" : "" }));
        const holder = h("div", { class: "scan-holder" });
        holder.append(
          h(
            "button",
            {
              class: `px bb-weapon scan-btn ${m.scanOpen && !stormed ? "on" : ""} ${cd > 0 ? "cool" : ""} ${stormed ? "stormed" : ""}`,
              disabled: locked || stormed,
              title: `${MODULES.scanner.name}\n${MODULES.scanner.description}\n${cd > 0 ? `Cooldown: ${cd} kol (pak plné náboje).` : `Náboje: ${charges}/${SCANNER.charges}.`}`,
              onclick: () => cb.scanToggle(ship.id),
            },
            icon("scan", "currentColor", 22),
            h("span", { class: "lbl" }, label("Skener")),
            pips,
            stormed ? h("span", { class: "sb" }, "⚡") : null,
          ),
        );
        if (m.scanOpen && cd === 0 && !stormed) {
          // tři tlačítka vyjedou nad tlačítko skeneru (přes okraj lišty), stejně velká jako ono
          const forceLen = Math.max(1, SCANNER.cooldown - charges);
          const cost = (n: number) => costPips(n, "yellow", `${n} ${n === 1 ? "náboj" : "náboje"} skeneru (nebere akci)`);
          holder.append(
            h(
              "div",
              { class: "scan-pop" },
              h("button", { class: `px bb-weapon sm ${m.scanPick ? "on" : ""}`, disabled: locked || charges < 1, title: `Sken lodi (1 náboj): klikni na cizí loď v dohledu do ${SCANNER.range}. Proběhne hned, nebere akci.`, onclick: () => cb.scanPickTarget(ship.id, !m.scanPick) }, icon("ship", "currentColor", 22), h("span", { class: "lbl" }, label("Sken lodi")), cost(1)),
              h("button", { class: "px bb-weapon sm", disabled: locked || charges < 2, title: `Hluboký sken (2 náboje): hned odkryje mapu do ${SCANNER.deepRange} celému týmu do konce kola, pak cooldown ${SCANNER.cooldown} kola.`, onclick: () => cb.scan(ship.id, "deep") }, icon("deep", "currentColor", 22), h("span", { class: "lbl" }, label("Vesmír")), cost(2)),
              h("button", { class: "px bb-weapon sm force", disabled: locked || charges >= SCANNER.charges, title: charges >= SCANNER.charges ? "Jde jen bez plné zásoby nábojů" : `Vynutit cooldown: ${SCANNER.cooldown} − ${charges} = ${forceLen} kola, pak plné náboje`, onclick: () => cb.scan(ship.id, "cooldown") }, icon("turn", "currentColor", 22), h("span", { class: "lbl" }, label("Cooldown")), h("span", { class: "c" }, `${forceLen}K`)),
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
      ...mods.map((m, i) => seg(`${i + 1}${FACING_GLYPH[m.facing ?? "front"]}${m.ammo !== undefined ? `·${m.ammo}` : ""}`, m.id === currentId, `${MODULES[type].name} ${i + 1} – ${FACING_NAMES[m.facing ?? "front"]}${m.ammo !== undefined ? ` (munice ${m.ammo})` : ""}`, () => onPick(m.id))),
    );
  };
  if (m.scanOpen && scannerModule(ship.loadout)) {
    const sc = scannerModule(ship.loadout)!;
    const cd = sc.cooldown ?? 0;
    details.append(icon("scan", "#7dd3fc"));
    if (cd > 0) details.append(h("span", { class: "muted" }, label(`cooldown ${cd} kol · pak plné náboje`)));
    else if (m.scanPick) details.append(h("span", { class: "warn" }, label(`klikni na cizí loď v dohledu (dosah ${SCANNER.range}) – sken proběhne hned`)), h("span", { class: "muted" }, label(`· ${sc.charges ?? 0} nábojů · nebere akci`)));
    else details.append(h("span", { class: "muted" }, label(`${sc.charges ?? 0} nábojů · nebere akci · +1 za zelený manévr`)));
  } else if (o.fireMg && o.special?.type !== "torpedo" && o.special?.type !== "mine") {
    const picker = modulePicker("mg", o.mgModuleId, (id) => cb.setOrders(ship.id, { mgModuleId: id }));
    if (picker) details.append(picker);
    const pv = mgPreview(m.state, ship, o.preferredTargetId, o.mgModuleId);
    const tname = pv ? (m.state.ships.find((x) => x.id === pv.targetId)?.name ?? (m.state.torpedoes.some((x) => x.id === pv.targetId) ? "torpédo" : "trosky")) : null;
    details.append(icon("target", pv ? "#4ade80" : "#fbbf24"), h("span", { class: "txt" }, pv ? `kulomet: ${tname}` : "nikdo ve výseči kulometu"));
    if (pv) {
      const pct = Math.round(pv.hitChance * 100);
      details.append(
        h("span", { class: "odds", style: `color:${pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171"}`, title: `Šance zásahu jednoho projektilu podle vzdálenosti; dávka ${pv.shots} projektilů.` }, label(`zásah ${pct} %`)),
        h("span", { class: "muted" }, label(`· ${pv.shots} projektilů · průměr ${Math.round(pv.expectedDamage)} zranění`)),
      );
    }
    details.append(h("span", { class: "muted" }, label("· klik na cíl = zaměřit")));
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
    const chosen = ship.loadout.modules.find((x) => x.id === cur);
    details.append(icon("debris", "#94a3b8"));
    if (chosen) {
      const after = { ...ship.loadout, modules: ship.loadout.modules.filter((x) => x.id !== cur) };
      details.append(h("span", { class: "txt" }, `vyhodit: ${MODULES[chosen.type].name}`), h("span", { class: "muted" }, label(`· váha ${loadoutWeight(ship.loadout)} → ${loadoutWeight(after)} · max. rychlost ${profileOf(ship.loadout).maxSpeed} → ${profileOf(after).maxSpeed}`)));
    } else details.append(h("span", { class: "warn" }, label("← vyber modul v inventáři")));
    details.append(h("button", { class: "px tiny", disabled: locked, onclick: () => cb.jettisonPick(ship.id) }, icon("inventory", "currentColor", 10), " ", label(chosen ? "změnit" : "inventář")));
  } else if (o.action?.type === "shield") {
    details.append(icon("segments", "#60a5fa"), h("span", { class: "txt" }, `štít ${o.action.segments.join(" / ")}`), inHand > 0 ? h("span", { class: "warn" }, label(`← rozmísti ${inHand} b. v panelu lodi`)) : h("span", { class: "muted" }, label("· platí od začátku kola")));
  } else if (o.fire) {
    const picker = modulePicker("laser", o.laserModuleId, (id) => cb.setOrders(ship.id, { laserModuleId: id }));
    if (picker) details.append(picker);
    const debrisTarget = o.preferredTargetId ? (m.state.debris ?? []).find((d) => d.id === o.preferredTargetId) : undefined;
    const cometTarget = o.preferredTargetId ? (m.state.comets ?? []).find((c) => c.id === o.preferredTargetId) : undefined;
    const tname = o.preferredTargetId ? (m.state.ships.find((x) => x.id === o.preferredTargetId)?.name ?? (debrisTarget ? `trosky ${MODULES[debrisTarget.type].short} (+${debrisTarget.value})` : cometTarget ? `kometa (${cometTarget.hull} HP, +${COMET.reward})` : "torpédo")) : null;
    const target = debrisTarget || cometTarget ? undefined : laserTarget(m.state, ship, o.preferredTargetId, o.laserModuleId);
    details.append(icon("target", target ? "#4ade80" : "#fbbf24"), h("span", { class: "txt" }, tname ?? (target ? `nejbližší: ${target.name}` : "nikdo ve výseči")));
    if (target) {
      const odds = laserOdds(ship, target);
      const pct = Math.round(odds.hitChance * 100);
      details.append(
        h(
          "span",
          { class: "odds", style: `color:${pct >= 60 ? "#4ade80" : pct >= 35 ? "#fbbf24" : "#f87171"}`, title: `Šance aspoň na jeden čistý zásah (zásahy − úhyby) ze současných pozic, pásmo ${odds.rangeBand}${odds.rangeBand === 1 ? " (+1 kostka útoku)" : odds.rangeBand === 3 ? " (+1 kostka obrany)" : ""}. Očekávané zranění ≈ ${Math.round(odds.expectedDamage)}.` },
          label(`zásah ${pct} %`),
        ),
        h("span", { class: "muted" }, label(`· průměr ${Math.round(odds.expectedDamage)} zranění`)),
      );
    } else if (o.preferredTargetId && !debrisTarget && !cometTarget) details.append(h("span", { class: "warn" }, label("cíl mimo výseč – střelí na nejbližšího")));
    const pt = cometTarget ?? debrisTarget;
    if (pt) {
      const why = laserReach(m.state, ship, pt, o.laserModuleId);
      details.append(why ? h("span", { class: "warn" }, label(`${why} – nevystřelí`)) : h("span", { class: "odds", style: "color:#4ade80" }, label("v dosahu")));
    }
    details.append(h("span", { class: "muted" }, label("· klik na nepřítele = cíl")));
  } else if (stormed) {
    details.append(h("span", { class: "pv" }, label("⚡ v bouři: lasery, štít a skener dočasně mimo provoz · torpéda letí rovně")));
  } else {
    details.append(h("span", { class: "muted" }, "—"));
  }
  const actions = h(
    "div",
    { class: "pnl bb-actions" },
    h("div", { class: "bb-head" }, h("span", { class: "ttl" }, label("Akce")), apips, h("span", { class: "muted bb-acts" }, label(`${RULES.actionPoints - acts.length}/${RULES.actionPoints} volné`))),
    buttons,
    details,
  );

  /* ---- 4. spuštění kola (úzký sloupec) ---- */
  const go = h(
    "div",
    { class: "pnl bb-go" },
    h(
      "div",
      { class: `launch-stack ${m.askConfirm ? "ask" : ""} ${locked ? "locked" : ""}` },
      h(
        "button",
        {
          class: "px bb-toggle",
          title: `Potvrzení nevyužitých akcí: ${m.askConfirm ? "ZAPNUTO – před spuštěním kola se hra zeptá, když zbývá volná akce." : "VYPNUTO – kolo se spustí rovnou."} Klik nebo klávesa P přepne; platí pro všechny bitvy v této místnosti.`,
          onclick: () => cb.toggleConfirm(),
        },
        h("span", { class: "sw" }, h("i")),
        h("span", { class: "q" }, "?"),
      ),
      locked
        ? h("button", { class: "px bb-launch waiting", title: "Klik = vrátit se k úpravám", onclick: () => cb.unready() }, icon("wait", "#e2e8f0", 18), h("span", { class: "l1" }, label("Čekám")), h("span", { class: "sub" }, label("klik = upravit")))
        : h("button", { class: "px bb-launch", disabled: inHand > 0, title: inHand > 0 ? "Nejdřív rozmísti body štítu" : "Spustit kolo (Enter)", onclick: () => cb.ready() }, icon("play", "#fff", 16), h("span", { class: "l1" }, label("Spustit")), h("span", { class: "l2" }, label("kolo"))),
    ),
    h("div", { class: "keycap" }, "ENTER"),
  );

  /* ---- 5. pilot (svislý sloupec) ---- */
  const pilot = h("div", { class: "pnl bb-pilot" }, pilotBadge(ship.loadout.pilotId, true));

  root.append(status, weapons, actions, maneuver, pilot, go);
}
