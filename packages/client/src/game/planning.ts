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
  { label: "Pohyb", ids: ["evade", "koiogran"] },
  { label: "Speciální", ids: ["shield", "jettison"] },
];
const FACING_GLYPH: Record<string, string> = { front: "↑", right: "→", back: "↓", left: "←" };
const ACTION_ICON: Record<string, string> = { laser: "laser", mg: "mg", torpedo: "torpedo", mine: "mine", koiogran: "turn", evade: "evade", shield: "segments", jettison: "debris" };

function angleGlyph(angle: number, koiogran: boolean): string {
  if (koiogran) return "⟲";
  if (angle === 0) return "↑";
  const a = Math.abs(angle);
  if (a <= 45) return angle < 0 ? "↖" : "↗";
  return angle < 0 ? "↰" : "↱";
}

/** Spodní lišta: stav lodi, manévr, zbraně, spuštění kola. Pevné rozměry – text nemění velikost UI. */
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

  /* ---- 1. loď: pixelová bublina štítu + stav ---- */
  const planned = o.action?.type === "shield" ? o.action.segments : undefined;
  const inHand = shieldInHand(ship, o);
  const editing = !!m.shieldEdit && !!planned && !locked;
  const teamColor = TEAM_COLORS[ship.team];
  const stormed = inStorm(m.state, ship);
  const bubble = h("div", { class: `bubble-box ${editing ? "editing" : ""}`, title: ship.shieldType === "whole" ? `Celolodní štít: zásoba ${ship.shields}/${ship.stats.shields}, účinnost ${ship.shieldEff} % (po každém zásahu −${RULES.wholeEffDrop} %)` : `Segmentový štít (předek / pravobok / záď / levobok): ${ship.segments.join(" / ")}. Každý zásah ubere 1 bod a je pohlcen celý; při 0 jde zranění do trupu.` }, shieldBubble({ ...ship, maxShields: ship.stats.shields }, teamColor, planned, 118, stormed));
  if (planned && !editing) bubble.append(h("span", { class: "bubble-tag" }, label("plán")));
  const right = h("div", { class: "bb-shipinfo" });
  if (editing && planned) {
    for (let i = 0; i < 4; i++) {
      const v = planned[i];
      right.append(
        h(
          "div",
          { class: "bb-row seg-edit" },
          h("span", { class: "seg-name" }, label(SEGMENT_NAMES[i])),
          h("button", { class: "px tiny", disabled: v <= 0, title: "odebrat bod", onclick: () => cb.shieldDelta(ship.id, i, -1) }, "–"),
          h("span", { class: "num", style: `color:${v === 0 ? "#f87171" : v > ship.segments[i] ? "#4ade80" : v < ship.segments[i] ? "#fb923c" : "#e2e8f0"}` }, String(v)),
          h("button", { class: "px tiny", disabled: inHand <= 0 || v >= RULES.segmentMax, title: inHand <= 0 ? "nejdřív bod někde odeber" : `přidat bod (max. ${RULES.segmentMax})`, onclick: () => cb.shieldDelta(ship.id, i, 1) }, "+"),
        ),
      );
    }
    right.append(
      h(
        "div",
        { class: "bb-row" },
        h("span", { class: `hand ${inHand > 0 ? "warn" : ""}`, title: "Odebrané body, které musíš znovu rozmístit" }, label(`v ruce ${inHand}`)),
        h("button", { class: "px tiny", disabled: inHand > 0, title: inHand > 0 ? "Nejdřív rozmísti všechny body" : "Potvrdit rozložení (Esc = zpět na původní)", onclick: () => cb.shieldConfirm(ship.id) }, icon("check", "currentColor", 12), label("potvrdit")),
      ),
    );
  } else {
    const shieldRow =
      stormed && ship.shieldType !== "none"
        ? h("div", { class: "bb-row dim" }, icon("shield", "#64748b"), h("s", { class: "num" }, ship.shieldType === "whole" ? `${Math.round((100 * ship.shields) / Math.max(1, ship.stats.shields))} %` : ship.segments.join("·")), h("span", { class: "pv" }, label("vypnuto")))
        : ship.shieldType === "whole"
        ? h("div", { class: "bb-row" }, icon("shield", strengthColor(ship.shields / Math.max(1, ship.stats.shields))), h("span", { class: "num" }, `${Math.round((100 * ship.shields) / Math.max(1, ship.stats.shields))} %`), h("span", { class: "muted", title: "Účinnost: kolik % zranění štít pohltí (po každém zásahu −" + RULES.wholeEffDrop + " %)" }, label(`· úč. ${ship.shieldEff} %`)))
        : h("div", { class: "bb-row", title: "Štít: předek / pravobok / záď / levobok" }, icon("shield", "#60a5fa"), h("span", { class: "num" }, ship.segments.join("·")), planned ? h("span", { style: "color:#fb923c" }, label("→ " + planned.join("·"))) : null);
    right.append(
      h("div", { class: "bb-row", title: `Trup ${ship.hull}/${ship.stats.hull}` }, icon("hull", "#4ade80"), segBar(10, Math.round((10 * ship.hull) / ship.stats.hull), ship.hull <= ship.stats.hull * 0.3 ? "#ef4444" : "#22c55e", "#14341f"), h("span", { class: "num" }, String(ship.hull))),
      shieldRow,
      h(
        "div",
        { class: "bb-row" },
        h("span", { class: "stat", title: "Stresové body: červený manévr −1, nebezpečný −2, zelený +1" }, icon("stress", "#f472b6"), segBar(STRESS.max, ship.stressPoints, "#f472b6", "#3b1a2e")),
        h("span", { class: "stat", title: `Aktuální rychlost / max. s touto váhou (${loadoutWeight(ship.loadout)})` }, icon("speed", "#94a3b8"), `${ship.speed}/${profileOf(ship.loadout).maxSpeed}`),
      ),
      h(
        "div",
        { class: "bb-row" },
        h("span", { class: "stat", title: "Torpéda" }, icon("torpedo", "#94a3b8"), String(ship.ammo.torpedoes)),
        h("span", { class: "stat", title: "Miny" }, icon("mine", "#94a3b8"), String(ship.ammo.mines)),
      ),
    );
  }
  if (inStorm(m.state, ship)) right.prepend(h("div", { class: "storm-warn", title: "Elektromagnetická bouře: štíty a lasery mimo provoz, torpéda neřiditelná, skener a dohled nefungují" }, "⚡ ", label("bouře: štíty a lasery mimo")));
  const status = h(
    "div",
    { class: "pnl bb-ship" },
    h(
      "div",
      { class: "bb-head" },
      h("span", { class: "bb-name txt", style: `color:${teamColor}` }, ship.name),
      my.length > 1
        ? h("div", { class: "ship-tabs" }, ...my.map((s, i) => h("button", { class: `px ${s.id === ship.id ? "on" : ""}`, title: s.name, onclick: () => cb.select(s.id) }, String(i + 1))))
        : h("span", { class: "muted", style: "margin-left:auto" }, "1/1"),
    ),
    h("div", { class: "bb-shipbody" }, bubble, right),
  );

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
    h("button", { class: `px ${aiming ? "on" : ""}`, disabled: locked, title: "Klikni na loď na mapě, nebo sem (mezerník). Pohyb myši = dráha, klik = potvrdit.", onclick: () => cb.aim(ship.id) }, icon(aiming ? "check" : "pen", "currentColor", 10), label(aiming ? "potvrdit" : "nakreslit")),
    h("div", { class: "keycap" }, label("mezerník")),
  );

  /* ---- 3. akce ---- */
  const apips = h("div", { class: "apip" });
  for (let i = 0; i < RULES.actionPoints; i++) apips.append(h("i", { class: i < acts.length ? "on" : "" }));
  const buttons = h("div", { class: "bb-weapons" });
  for (const grp of ACTION_GROUPS) {
    const avail = grp.ids.map((id) => ACTIONS.find((x) => x.id === id)!).filter((a) => actionAvailable(a, ship));
    if (avail.length === 0 && !(grp.label === "Speciální" && scannerModule(ship.loadout))) continue; // skupina bez dostupných akcí se neukazuje
    const box = h("div", { class: "act-group" }, h("span", { class: "act-cap" }, label(grp.label)));
    const row = h("div", { class: "act-row" });
    for (const a of avail) {
      const active = a.active(o);
      const stormOff = stormed && (a.id === "laser" || a.id === "shield");
      const why = stormOff ? "systém je v bouři mimo provoz" : a.disabled(ship, m.state, o);
      row.append(
        h(
          "button",
          {
            class: `px bb-weapon ${active && !stormOff ? "on" : ""} ${stormOff ? "stormed" : ""}`,
            disabled: locked || stormOff || (!!why && !active),
            title: `${a.label}\n${a.description}${why ? `\nNelze: ${why}.` : ""}`,
            onclick: () => cb.chooseAction(ship.id, a.id),
          },
          icon(ACTION_ICON[a.id] ?? "target", "currentColor", 22),
          h("span", { class: "lbl" }, label(a.label.replace(/ \(1 akce\)/, "").replace(" 180°", "").replace("Úhybný manévr", "Úhyb").replace("Úprava štítu", "Štít").replace("Vyhodit modul", "Vyhodit"))),
          stormOff ? h("span", { class: "sb" }, "⚡") : null,
        ),
      );
    }
    if (grp.label === "Speciální") {
      const sc = scannerModule(ship.loadout);
      if (sc) {
        const charges = sc.charges ?? 0;
        const cd = sc.cooldown ?? 0;
        const pips = h("span", { class: "scan-pips" });
        const slots = Math.max(SCANNER.charges, SCANNER.cooldown);
        for (let i = 0; i < slots; i++) pips.append(h("i", { class: cd > 0 ? (i < cd ? "red" : "") : i < charges ? "on" : "" }));
        row.append(
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
          const forceLen = Math.max(1, SCANNER.cooldown - charges);
          row.append(
            h(
              "div",
              { class: "scan-slide" },
              h("button", { class: `px sm ${m.scanPick ? "on" : ""}`, disabled: locked || charges < 1, title: `Sken lodi (1 náboj): klikni na cizí loď v dohledu do ${SCANNER.range}. Proběhne hned, nebere akci.`, onclick: () => cb.scanPickTarget(ship.id, !m.scanPick) }, icon("ship", "currentColor", 9), label("sken lodi"), h("span", { class: "c" }, "·1")),
              h("button", { class: "px sm", disabled: locked || charges < 2, title: `Hluboký sken (2 náboje): hned odkryje mapu do ${SCANNER.deepRange} celému týmu do konce kola, pak cooldown ${SCANNER.cooldown} kola.`, onclick: () => cb.scan(ship.id, "deep") }, icon("deep", "currentColor", 9), label("sken vesmíru"), h("span", { class: "c" }, "·2")),
              h("button", { class: "px sm force", disabled: locked || charges >= SCANNER.charges, title: charges >= SCANNER.charges ? "Jde jen bez plné zásoby nábojů" : `Vynutit cooldown: ${SCANNER.cooldown} − ${charges} = ${forceLen} kola, pak plné náboje`, onclick: () => cb.scan(ship.id, "cooldown") }, icon("turn", "currentColor", 9), label("vynutit cooldown"), h("span", { class: "c" }, `${forceLen} K`)),
            ),
          );
        }
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
    h("div", { class: "bb-head" }, h("span", { class: "ttl" }, label("Akce")), apips, h("span", { class: "muted bb-acts" }, label(acts.map((a) => a.label).join(" · ")))),
    buttons,
    details,
  );

  /* ---- 4. spuštění kola (úzký sloupec) ---- */
  const go = h(
    "div",
    { class: "pnl bb-go" },
    locked
      ? h("button", { class: "px bb-launch waiting", title: "Klik = vrátit se k úpravám", onclick: () => cb.unready() }, icon("wait", "#e2e8f0", 18), h("span", { class: "l1" }, label("Čekám")), h("span", { class: "sub" }, label("klik = upravit")))
      : h("button", { class: "px bb-launch", disabled: inHand > 0, title: inHand > 0 ? "Nejdřív rozmísti body štítu" : "Spustit kolo (Enter)", onclick: () => cb.ready() }, icon("play", "#fff", 16), h("span", { class: "l1" }, label("Spustit")), h("span", { class: "l2" }, label("kolo"))),
    h("div", { class: "keycap" }, "ENTER"),
  );

  /* ---- 5. pilot (svislý sloupec) ---- */
  const pilot = h("div", { class: "pnl bb-pilot" }, pilotBadge(ship.loadout.pilotId, true));

  root.append(status, actions, maneuver, pilot, go);
}
