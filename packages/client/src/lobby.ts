import {
  RULES, applyTuning, DEFAULT_MAP, MAP_SIZES, MAX_TEAMS_TDM, MODULE_TYPES, MODULES, TEAM_COLORS, TEAM_NAMES, type MapSettings, type ModuleType, type RoomPlayer, type RoomState, type RoomSummary } from "@wingfighter/shared";
import { logoCanvas } from "./logo.ts";
import { openMusicPanel } from "./main.ts";
import { renderMapPreview } from "./map-preview.ts";
import { loadoutTag, renderLoadout, svgEl } from "./loadout-ui.ts";
import { clear, h } from "./dom.ts";
import { icon, label } from "./icons.ts";
import { renderTuningPanel } from "./tuning-panel.ts";

let tuningOpen = false;
import type { Net } from "./net.ts";

export interface LobbyModel {
  playerId: string;
  name: string;
  rooms: RoomSummary[];
  room: RoomState | null;
  error: string;
  connected: boolean;
}

/** Rozepsané hodnoty formulářů – přežijí překreslení při každé zprávě ze serveru. */
const drafts = { name: null as string | null, roomName: "", code: "" };

export function renderLobby(root: HTMLElement, m: LobbyModel, net: Net, setName: (n: string) => void) {
  rerender = () => renderLobby(root, m, net, setName);
  const activeId = (document.activeElement as HTMLElement | null)?.id;
  const selStart = (document.activeElement as HTMLInputElement | null)?.selectionStart ?? null;
  // při překreslení zachovat posun stránky (jinak každá změna v místnosti skočí nahoru)
  const prevScreen = root.querySelector<HTMLElement>(".screen");
  const scrollTop = prevScreen?.scrollTop ?? 0;
  clear(root);
  const screen = h("div", { class: "screen" });
  root.append(
    h("div", { class: `status ${m.connected ? "ok" : "bad"}` }, m.connected ? "ONLINE" : "OFFLINE..."),
    h("button", { class: "px music-btn", title: "Hudba a zvuk (vlastní skladby, hlasitost)", onclick: () => openMusicPanel() }, icon("log", "currentColor", 12), " ", label("Hudba")),
    screen,
  );
  screen.append(h("div", { class: "center" }, h("div", { class: "title" }, logoCanvas(5), h("div", { class: "sub" }, label("tahová vesmírná střílečka · prototyp"))), m.room ? roomView(m, net) : lobbyView(m, net, setName)));
  screen.scrollTop = scrollTop;
  // obnova fokusu nesmí stránku odrolovat
  if (activeId) {
    const el = document.getElementById(activeId) as HTMLInputElement | null;
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart !== null && typeof el.setSelectionRange === "function") {
        try {
          el.setSelectionRange(selStart, selStart);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function lobbyView(m: LobbyModel, net: Net, setName: (n: string) => void) {
  const nameInput = h("input", { id: "in-name", value: drafts.name ?? m.name, maxLength: 20, placeholder: "Tvoje jméno" });
  nameInput.oninput = () => (drafts.name = nameInput.value);
  const commitName = () => {
    const n = nameInput.value.trim();
    drafts.name = null;
    if (n && n !== m.name) {
      setName(n);
      net.send({ type: "setName", name: n });
    }
  };
  nameInput.onblur = commitName;
  nameInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      commitName();
      nameInput.blur();
    }
  };

  const roomName = h("input", { id: "in-room", value: drafts.roomName, placeholder: "Název místnosti (nepovinný)", maxLength: 20 });
  roomName.oninput = () => (drafts.roomName = roomName.value);
  const codeInput = h("input", { id: "in-code", value: drafts.code, placeholder: "KÓD", maxLength: 4, style: "width:90px;text-transform:uppercase;letter-spacing:2px" });
  codeInput.oninput = () => (drafts.code = codeInput.value);
  const join = () => codeInput.value.trim() && (commitName(), net.send({ type: "joinRoom", code: codeInput.value.trim().toUpperCase() }));
  codeInput.onkeydown = (e) => {
    if (e.key === "Enter") join();
  };

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h("div", { class: "card" }, h("h3", {}, label("Pilot")), h("div", { class: "row" }, nameInput, h("span", { class: "muted txt" }, "jméno uvidí ostatní hráči"))),
    h(
      "div",
      { class: "card" },
      h("h3", {}, label("Nová místnost")),
      h(
        "div",
        { class: "row" },
        roomName,
        h("button", { class: "primary", onclick: () => (commitName(), net.send({ type: "createRoom", name: roomName.value })) }, label("Vytvořit místnost")),
      ),
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("h3", {}, label("Otevřené místnosti")), h("div", { class: "spacer" }), codeInput, h("button", { onclick: join }, label("Připojit kódem"))),
      m.rooms.length === 0
        ? h("div", { class: "muted txt", style: "padding:8px 0" }, "Zatím žádná místnost. Vytvoř první!")
        : h(
            "div",
            { class: "room-list" },
            ...m.rooms.map((r) =>
              h(
                "div",
                { class: "room-item" },
                h("span", { class: "code" }, r.code),
                h("span", {}, r.name),
                h("span", { class: "muted" }, `${r.players} hráčů`),
                h("div", { class: "spacer" }),
                r.inGame ? h("span", { class: "muted" }, label("hra probíhá")) : h("button", { onclick: () => (commitName(), net.send({ type: "joinRoom", code: r.code })) }, label("Připojit")),
              ),
            ),
          ),
      h("div", { class: "error" }, m.error),
    ),
    h(
      "div",
      { class: "card muted txt" },
      "Hráči na stejné síti otevřou stejnou adresu jako ty (viz výpis serveru). Místnosti vidí všichni, kód slouží k přímému připojení.",
    ),
  );
}

let rerender: () => void = () => {};
/** Trvalý prvek ladicího panelu – při překreslení lobby se nestaví znovu (neztrácí rozepsané hodnoty). */
const lobbyTunePanel = h("div", { style: "margin-top:10px" });
/** Bot, kterému host právě kliká výbavu. */
let botEdit: string | null = null;
/** Komu host vybírá startovní bod (null = sobě). */
let startFor: string | null = null;

function roomView(m: LobbyModel, net: Net) {
  const room = m.room!;
  const isHost = room.hostId === m.playerId;
  const me = room.players.find((p) => p.id === m.playerId);
  const tdm = room.settings.mode === "tdm";

  const teamBox = (team: number) => {
    const members = room.players.filter((p) => p.team === team);
    return h(
      "div",
      { class: `team ${me?.team === team ? "mine" : ""}`, style: `--team:${TEAM_COLORS[team]}` },
      h("h3", {}, label(TEAM_NAMES[team])),
      ...members.map((p) =>
        h(
          "div",
          { class: "player" },
          h("span", { class: `dot ${p.connected ? "" : "off"}` }),
          h("span", {}, p.name),
          p.id === room.hostId ? h("span", { class: "host" }, "HOST") : null,
          shieldPick(p),
          p.isBot && isHost ? h("button", { class: "x", onclick: () => net.send({ type: "removeBot", botId: p.id }) }, "✕") : null,
        ),
      ),
      ...members.map((p) => botEditor(p)),
      h(
        "div",
        { class: "row", style: "margin-top:8px" },
        me?.team !== team ? h("button", { onclick: () => net.send({ type: "setTeam", team }) }, label("Přejít sem")) : null,
        isHost ? h("button", { onclick: () => net.send({ type: "addBot", team }) }, icon("bot", "currentColor", 12), label("bot")) : null,
      ),
    );
  };

  applyTuning(room.tuning);
  const budget = room.tuning.startBudget;
  /** Výbava v řádku hráče: vlastní = editor níže, ostatní = štítek; bot v ručním režimu = host může rozkliknout. */
  const shieldPick = (p: RoomPlayer) => {
    const tag = loadoutTag(p.loadout);
    if (p.isBot && isHost && room.settings.botLoadout === "manual") {
      const open = botEdit === p.id;
      return h("span", { class: "lo-tagwrap" }, tag, h("button", { class: open ? "on" : "", title: "Naklikat výbavu bota", onclick: () => ((botEdit = open ? null : p.id), rerender()) }, icon("inventory", "currentColor", 10), label(open ? "zavřít" : "výbava")));
    }
    return tag;
  };
  const botEditor = (p: RoomPlayer) =>
    botEdit === p.id && p.isBot && isHost && room.settings.botLoadout === "manual"
      ? h("div", { class: "bot-editor" }, renderLoadout({ loadout: p.loadout, budget, allowed: room.settings.allowedModules, compact: true, onChange: (lo) => net.send({ type: "setLoadout", loadout: lo, botId: p.id }) }))
      : null;

  const settings = room.settings;
  const set = (patch: Partial<typeof settings>) => net.send({ type: "setSettings", settings: patch });

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("h2", {}, room.name),
        h("span", { class: "muted" }, "KOD "),
        h("span", { class: "code", style: "font-size:22px;font-weight:700;color:var(--accent);letter-spacing:3px" }, room.code),
        h("div", { class: "spacer" }),
        h("button", { onclick: () => net.send({ type: "leaveRoom" }) }, label("Opustit")),
      ),
      h("div", { class: "muted txt" }, "Řekni kód ostatním, nebo ať místnost najdou v seznamu."),
    ),
    tdm
      ? h("div", { class: "teams" }, ...Array.from({ length: MAX_TEAMS_TDM }, (_, i) => teamBox(i)))
      : h(
          "div",
          { class: "card" },
          h("h3", {}, label("Hráči (každý sám za sebe)")),
          ...room.players.map((p, i) =>
            h(
              "div",
              { class: "player" },
              h("span", { class: `dot ${p.connected ? "" : "off"}` }),
              h("span", { style: `color:${TEAM_COLORS[i % TEAM_COLORS.length]}` }, p.name),
              p.id === room.hostId ? h("span", { class: "host" }, "HOST") : null,
              shieldPick(p),
              p.isBot && isHost ? h("button", { class: "x", onclick: () => net.send({ type: "removeBot", botId: p.id }) }, "✕") : null,
            ),
          ),
          ...room.players.map((p) => botEditor(p)),
          isHost ? h("div", { class: "row", style: "margin-top:8px" }, h("button", { onclick: () => net.send({ type: "addBot", team: 0 }) }, icon("bot", "currentColor", 12), label("bot"))) : null,
        ),
    me
      ? h(
          "div",
          { class: "card" },
          h("h3", {}, icon("inventory", "#7dd3fc", 12), " ", label("Tvoje výbava"), h("span", { class: "spacer" }), h("span", { class: "lo-wallet", title: "Kredity: rozpočet místnosti + výdělky z bitev − utracené za výbavu. Výbava, munice i zničené moduly ti mezi bitvami zůstávají." }, icon("credits", "#fbbf24", 12), ` ${me.credits ?? budget}`)),
          h("div", { class: "muted txt" }, `Nové moduly kupuješ za plnou cenu (nový jde před bitvou vrátit za plnou cenu, použitý se prodá za ${RULES.usedSellPct} %, zničený za ${RULES.brokenSellPct} %). Munice se mezi bitvami nedoplňuje sama – dokoupíš ji tlačítkem +cena u modulu (levnější než nový modul). Co neutratíš, máš ve hře jako kredity; další získáš za sestřely a přežitá kola. Váha modulů snižuje max. rychlost lodi.`),
          renderLoadout({ loadout: me.loadout, budget, wallet: me.credits ?? budget, showCargo: !!me.loadout.cargo?.length, allowed: room.settings.allowedModules, onChange: (lo) => net.send({ type: "setLoadout", loadout: lo }) }),
        )
      : null,
    (() => {
      const map = settings.map ?? DEFAULT_MAP;
      const setMap = (patch: Partial<MapSettings>) => set({ map: { ...map, ...patch } });
      /** Řádek formuláře: popisek | prvek | „?“ s vysvětlivkou. */
      const frow = (lbl: string, ctl: Node, hint?: string) => h("div", { class: "frow" }, h("span", { class: "txt flbl" }, lbl), h("div", { class: "fctl" }, ctl), hint ? h("span", { class: "fhint", title: hint }, "?") : h("span"));
      const sel = (value: string, opts: [string, string][], onChange: (v: string) => void, width?: string) =>
        h("select", { class: "fsel", disabled: !isHost, style: width ? `width:${width}` : "", onchange: (e) => onChange((e.target as HTMLSelectElement).value) }, ...opts.map(([v, t]) => h("option", { value: v, selected: value === v }, t)));
      /** Pixelový přepínač ano / ne. */
      const toggle = (on: boolean, onChange: (v: boolean) => void, title?: string) =>
        h("button", { class: `ptoggle ${on ? "on" : ""}`, disabled: !isHost, title, onclick: () => onChange(!on) }, h("span", { class: "pt-sw" }, h("i")), h("span", { class: "txt pt-lbl" }, on ? "ano" : "ne"));
      const section = (title: string, ...rows: Node[]) => h("div", { class: "fsec" }, h("div", { class: "fsec-h" }, label(title)), ...rows);
      /** Fialová bouře (SVG) v dané velikosti. */
      const stormSvg = (r: number, box = 26) => {
        const s = svgEl("svg", { width: String(box), height: String(box), viewBox: `0 0 ${box} ${box}` });
        s.append(svgEl("circle", { cx: String(box / 2), cy: String(box / 2), r: String(r), fill: "#a21caf", opacity: "0.8" }), svgEl("circle", { cx: String(box / 2), cy: String(box / 2), r: String(r * 0.55), fill: "#d946ef", opacity: "0.7" }));
        return s;
      };
      const emptySvg = (box = 26, dashed = true) => {
        const s = svgEl("svg", { width: String(box), height: String(box), viewBox: `0 0 ${box} ${box}` });
        s.append(svgEl("circle", { cx: String(box / 2), cy: String(box / 2), r: String(box / 2 - 5), fill: "none", stroke: "#334155", "stroke-width": "2", ...(dashed ? { "stroke-dasharray": "3 3" } : {}) }));
        return s;
      };
      /** Řada políček: kolik svítí, tolik je hodnota; klik na poslední rozsvícené = o jednu míň. */
      const pips = (n: number, value: number, cls: string, lit: (k: number) => Node, dim: (k: number) => Node, title: (k: number) => string, onPick: (v: number) => void, text: string) =>
        h(
          "div",
          { class: "pips-row" },
          ...Array.from({ length: n }, (_, i) => i + 1).map((k) => h("button", { class: `pip ${cls} ${k <= value ? "on" : ""}`, disabled: !isHost, title: title(k), onclick: () => onPick(k === value ? k - 1 : k) }, k <= value ? lit(k) : dim(k))),
          h("span", { class: "txt muted pips-txt" }, text),
        );
      const cometSvg = (lit: boolean) => {
        const s = svgEl("svg", { width: "26", height: "26", viewBox: "0 0 26 26" });
        if (lit) s.append(svgEl("rect", { x: "2", y: "16", width: "12", height: "2", fill: "#67e8f9", opacity: "0.5" }), svgEl("rect", { x: "6", y: "13", width: "9", height: "2", fill: "#67e8f9", opacity: "0.7" }), svgEl("rect", { x: "15", y: "9", width: "7", height: "7", fill: "#e2e8f0" }), svgEl("rect", { x: "17", y: "11", width: "3", height: "3", fill: "#94a3b8" }));
        else s.append(svgEl("rect", { x: "15", y: "9", width: "7", height: "7", fill: "none", stroke: "#334155", "stroke-width": "2", "stroke-dasharray": "2 2" }));
        return s;
      };
      const COMET_LEVELS: MapSettings["comets"][] = ["none", "few", "medium", "many"];
      const STORM_SIZES: MapSettings["stormSize"][] = ["small", "medium", "large"];
      const bots = room.players.filter((p) => p.isBot);
      const targetSel = isHost && bots.length ? h("select", { class: "fsel", style: "width:150px", onchange: (e) => (startFor = (e.target as HTMLSelectElement).value || null) }, h("option", { value: "", selected: !startFor }, "já"), ...bots.map((b) => h("option", { value: b.id, selected: startFor === b.id }, b.name))) : null;
      const TILE_COLOR: Record<ModuleType, string> = { laser: "#f87171", torpedo: "#fb923c", mine: "#fbbf24", "shield-segment": "#7dd3fc", mg: "#fde047", scanner: "#a78bfa", "shield-whole": "#38bdf8" };
      const allowedOn = (t: ModuleType) => settings.allowedModules[t] !== 0;
      const setAllowed = (t: ModuleType, on: boolean) => {
        const next: Partial<Record<ModuleType, number>> = { ...settings.allowedModules };
        if (on) delete next[t];
        else next[t] = 0;
        set({ allowedModules: next });
      };
      const setAll = (on: boolean) => {
        const next: Partial<Record<ModuleType, number>> = {};
        if (!on) for (const t of MODULE_TYPES) next[t] = 0;
        set({ allowedModules: next });
      };
      const onCount = MODULE_TYPES.filter(allowedOn).length;
      const tiles = h(
        "div",
        { class: "mod-tiles" },
        ...MODULE_TYPES.map((t) => {
          const on = allowedOn(t);
          const col = TILE_COLOR[t];
          return h(
            "button",
            { class: `mod-tile ${on ? "on" : ""}`, disabled: !isHost, style: on ? `border-color:${col} #0b1020 #0b1020 ${col}` : "", title: `${MODULES[t].name}\n${MODULES[t].description}\n${on ? "Klik = vyřadit z této hry" : "Klik = povolit v této hře"}`, onclick: () => setAllowed(t, !on) },
            icon(MODULES[t].icon, on ? col : "#475569", 26),
            h("span", { class: "mt-name" }, label(MODULES[t].name)),
            h("span", { class: "mt-chk" }, on ? "✓" : ""),
          );
        }),
      );
      const summary = `${MAP_SIZES[map.size]?.label ?? map.size} · asteroidy ${{ none: "žádné", few: "málo", medium: "střední", many: "hodně" }[map.asteroids] ?? map.asteroids} · ${map.storms === 0 ? "bez bouří" : `${map.storms} bouře`} · komety ${{ none: "žádné", few: "málo", medium: "středně", many: "hodně" }[map.comets ?? "none"]} · seed ${map.seed} · ${settings.mode === "tdm" ? "týmový deathmatch" : "deathmatch"}${settings.turnLimit ? ` · ${settings.turnLimit} kol` : ""} · startovní kredity ${budget}`;
      return h(
        "div",
        { class: "card gamecard" },
        h("h3", {}, icon("target", "#7dd3fc", 12), " ", label("Nastavení hry"), isHost ? "" : h("span", { class: "muted" }, label(" (mění host)"))),
        h(
          "div",
          { class: "game-grid" },
          h(
            "div",
            { class: "game-form" },
            section(
              "Mapa",
              frow("Velikost", sel(map.size, Object.entries(MAP_SIZES).map(([k, v]) => [k, v.label]), (v) => setMap({ size: v as MapSettings["size"] }))),
              frow("Asteroidy", sel(map.asteroids, [["none", "žádné"], ["few", "málo"], ["medium", "střední"], ["many", "hodně"]], (v) => setMap({ asteroids: v as MapSettings["asteroids"] })), "Hustota asteroidů na mapě."),
              frow("Shluky asteroidů", toggle(map.clusters, (v) => setMap({ clusters: v })), "Asteroidy v hustších shlucích místo rovnoměrného rozptylu."),
              frow(
                "Bouře",
                pips(5, map.storms, "storm", () => stormSvg(9), () => emptySvg(), (k) => `${k} bouří`, (v) => setMap({ storms: v }), map.storms === 0 ? "žádná" : map.storms === 1 ? "1 bouře" : map.storms < 5 ? `${map.storms} bouře` : "5 bouří"),
                "Počet elektromagnetických bouří (fialové): uvnitř nefungují štíty ani lasery, torpéda letí rovně, skener jí nepronikne, loď v bouři není vidět.",
              ),
              frow(
                "Velikost bouří",
                h("div", { class: "pips-row" }, ...STORM_SIZES.map((sz, i) => h("button", { class: `pip storm ${map.stormSize === sz ? "on" : ""}`, disabled: !isHost, title: ["malé", "střední", "velké"][i] + " bouře", onclick: () => setMap({ stormSize: sz }) }, stormSvg([4, 7, 10][i])))),
              ),
              frow("Symetrická", toggle(map.symmetric, (v) => setMap({ symmetric: v })), "Zrcadlená mapa – obě strany mají stejné podmínky."),
              frow(
                "Komety",
                pips(3, Math.max(0, COMET_LEVELS.indexOf(map.comets ?? "none")), "comet", () => cometSvg(true), () => cometSvg(false), (k) => ["málo", "středně", "hodně"][k - 1], (v) => setMap({ comets: COMET_LEVELS[v] }), ["žádné", "málo", "středně", "hodně"][Math.max(0, COMET_LEVELS.indexOf(map.comets ?? "none"))]),
                "Komety přilétají na okraj mapy a letí přes ni rychleji než torpéda: náraz zraní loď, sestřel dává kredity, průlet ocasem doplní štít.",
              ),
              frow("", h("div", { class: "fpair" }, h("span", { class: "txt muted fsub" }, "komety naráží do asteroidů"), toggle(!!map.cometsHitAsteroids, (v) => setMap({ cometsHitAsteroids: v }))), "Zapnuto: kometa se o asteroid roztříští a vykousne kráter. Vypnuto: proletí jím."),
              frow(
                "Seed",
                h("div", { class: "fpair" }, h("input", { class: "fsel", type: "number", value: String(map.seed), min: "0", max: "999999", disabled: !isHost, style: "width:118px", onchange: (e) => setMap({ seed: Number((e.target as HTMLInputElement).value) || 0 }) }), isHost ? h("button", { class: "fdice", title: "Nová náhodná mapa", onclick: () => setMap({ seed: Math.floor(Math.random() * 100000) }) }, "🎲") : null),
                "Stejný seed = stejná mapa.",
              ),
            ),
            section(
              "Bitva",
              frow("Herní mód", sel(settings.mode, [["tdm", "Týmový deathmatch"], ["dm", "Deathmatch (všichni proti všem)"]], (v) => set({ mode: v as "tdm" | "dm" }))),
              frow("Limit kol", sel(String(settings.turnLimit), [0, 10, 15, 20, 30, 40].map((n) => [String(n), n === 0 ? "bez limitu" : `${n} kol`]), (v) => set({ turnLimit: Number(v) })), "Při limitu kol vyhrává tým s největším součtem zbývajícího trupu a štítů."),
              frow("Lodí na hráče", sel(String(settings.shipsPerPlayer), [1, 2, 3, 4].map((n) => [String(n), String(n)]), (v) => set({ shipsPerPlayer: Number(v) }))),
              frow("Výbava botů", sel(settings.botLoadout, [["default", "výchozí sestava"], ["random", "náhodná"], ["manual", "ruční (naklikám u bota)"]], (v) => set({ botLoadout: v as "default" | "random" | "manual" }))),
            ),
            section(
              "Dostupné moduly",
              tiles,
              h("div", { class: "txt muted mt-foot" }, `${onCount} ze ${MODULE_TYPES.length} modulů ve hře`, isHost ? h("span", {}, " · ", h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), setAll(true)) }, "všechny"), " · ", h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), setAll(false)) }, "žádný")) : null, " · vyřazený modul nejde koupit; kdo ho má v sestavě, musí ho před bitvou prodat."),
            ),
          ),
          h(
            "div",
            { class: "game-side" },
            h("div", { class: "fsec-h" }, label("Náhled mapy · startovní bod")),
            renderMapPreview(map, room.players, startFor ?? m.playerId, (index) => net.send({ type: "setStart", index, ...(startFor ? { botId: startFor } : {}) })),
            h("div", { class: "muted txt" }, "Klikni na kroužek na okraji = tvůj start (barva = tým, ostatní vidí, kde kdo startuje). Bez volby dostaneš volný bod."),
            targetSel ? h("div", { class: "frow" }, h("span", { class: "txt flbl" }, "Start pro"), h("div", { class: "fctl" }, targetSel), h("span")) : null,
            h("div", { class: "txt muted game-summary" }, summary),
          ),
        ),
      );
    })(),
    (() => {
      const wrap = h("div");
      const toggle = h("button", { onclick: () => ((tuningOpen = !tuningOpen), rerender()) }, icon("target", "currentColor", 12), label(tuningOpen ? "Skrýt ladění" : "Ladění parametrů"));
      wrap.append(toggle);
      if (tuningOpen) {
        const panel = lobbyTunePanel;
        renderTuningPanel(panel, room.tuning, room.savedTuning, isHost, {
          onChange: (patch) => net.send({ type: "setTuning", tuning: patch }),
          onReset: () => net.send({ type: "resetTuning" }),
          onSave: () => net.send({ type: "saveTuning" }),
          onLoad: () => net.send({ type: "loadTuning" }),
          onClose: () => ((tuningOpen = false), rerender()),
        });
        wrap.append(panel);
      }
      return wrap;
    })(),
    h(
      "div",
      { class: "row" },
      h("div", { class: "error" }, m.error),
      h("div", { class: "spacer" }),
      isHost ? h("button", { class: "primary", onclick: () => net.send({ type: "startGame" }) }, icon("play", "currentColor", 12), label("Zahájit bitvu")) : h("span", { class: "muted txt" }, "Čeká se, až host zahájí bitvu…"),
    ),
  );
}
