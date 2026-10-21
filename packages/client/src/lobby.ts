import {
  RULES,
  HULLS,
  PILOTS,
  type ShipLoadout, applyTuning, DEFAULT_MAP, MAP_SIZES, MAX_TEAMS_TDM, MODULE_TYPES, MODULES, TEAM_COLORS, TEAM_NAMES, fleetPoints, validateFleet, type MapSettings, type ModuleType, type RoomPlayer, type RoomState, type RoomSummary, type Placement, PLACEMENTS, PLACEMENT_LABEL, PLACEMENT_HINT, effectivePlacement, type BattleSettings, SERIES_MIN, SERIES_MAX, isSeries, newBattle, seriesStandings, seriesWinner } from "@wingfighter/shared";
import { logoCanvas } from "./logo.ts";
import { openRoadmap } from "./roadmap.ts";
import { openMusicPanel } from "./main.ts";
import { renderMapPreview } from "./map-preview.ts";
import { clearLoadoutPick, moduleHexSvg, renderLoadout, svgEl } from "./loadout-ui.ts";
import { pilotPortrait } from "./pilot-ui.ts";
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

let pickHooks = false;
export function renderLobby(root: HTMLElement, m: LobbyModel, net: Net, setName: (n: string) => void) {
  rerender = () => renderLobby(root, m, net, setName);
  if (!pickHooks) {
    pickHooks = true;
    // výběr slotu / modulu v editoru výbavy: Esc nebo klik mimo editor ho zruší
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && clearLoadoutPick()) rerender();
    });
    document.addEventListener("click", (e) => {
      if (!(e.target instanceof Element) || e.target.closest(".loadout")) return;
      if (clearLoadoutPick()) rerender();
    });
  }
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
    h("button", { class: "px music-btn roadmap-btn", title: "Roadmapa: na čem se pracuje a co se plánuje", onclick: () => openRoadmap() }, icon("target", "currentColor", 12), " ", label("Roadmapa")),
    screen,
  );
  screen.append(h("div", { class: `center ${m.room ? "room" : ""}` }, h("div", { class: "title" }, logoCanvas(5), h("div", { class: "sub" }, label("tahová vesmírná střílečka · prototyp"))), m.room ? roomView(m, net) : lobbyView(m, net, setName)));
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
                r.inGame ? h("span", { class: "muted" }, label("hra probíhá")) : !r.open ? h("span", { class: "muted txt", style: "font-size:13px", title: "Zakladatel ještě nastavuje mapu, lodě a moduly. Jakmile místnost otevře, půjde se připojit." }, "⏳ zakladatel dokončuje nastavení…") : h("button", { onclick: () => (commitName(), net.send({ type: "joinRoom", code: r.code })) }, label("Připojit")),
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
/** Vybraná loď (záložka) v „Tvoje výbava“ a v editoru bota. */
let fleetTab = 0;
let botTab = 0;
/** Stránka průvodce Nastavení hry (0 mapa, 1 bitva, 2 lodě a piloti, 3 moduly). */
let gamePage = 0;
/** Vybraná bitva série v nastavení (index). */
let battleSel = 0;
/** Komu host vybírá startovní bod (null = sobě). */
let startFor: string | null = null;

function roomView(m: LobbyModel, net: Net) {
  const room = m.room!;
  const isHost = room.hostId === m.playerId;
  const me = room.players.find((p) => p.id === m.playerId);
  const tdm = room.settings.mode === "tdm";
  const placement = effectivePlacement(room.settings);
  const teamManual = tdm && placement === "teamManual";
  const randomPlacement = placement === "random" || placement === "teamRandom";
  /** Místnost ještě není otevřená: host dokončuje nastavení, ostatní se nemohou připojit. */
  const setup = !room.open;

  applyTuning(room.tuning);
  const budget = room.tuning.startBudget;
  const settings = room.settings;
  const set = (patch: Partial<typeof settings>) => net.send({ type: "setSettings", settings: patch });
  const nTeams = tdm ? Math.max(2, Math.min(MAX_TEAMS_TDM, room.settings.teams ?? 2)) : 1;
  /** Loď jako čip: portrét pilota + ikonky modulů; najetí ukáže celou výbavu. */
  const shipChip = (l: ShipLoadout) => {
    const hull = HULLS[l.hullId]?.name ?? l.hullId;
    const pilot = PILOTS[l.pilotId]?.name ?? l.pilotId;
    const mods = l.modules.map((m) => `${MODULES[m.type].name}${m.hp !== undefined && m.hp <= 0 ? " (zničen)" : ""}`).join(", ") || "bez modulů";
    return h(
      "span",
      { class: "ship-chip", title: `${hull} · ${pilot}\n${mods}` },
      pilotPortrait(l.pilotId, 20),
      h("span", { class: "sc-mods" }, ...(l.modules.length ? l.modules.map((m) => icon(MODULES[m.type].icon, m.hp !== undefined && m.hp <= 0 ? "#f87171" : "#60a5fa", 10)) : [h("span", { class: "muted", style: "font-size:11px" }, "–")])),
    );
  };
  const fleetOf = (p: RoomPlayer) => (p.loadouts?.length ? p.loadouts : [p.loadout]);
  const canEditBot = (p: RoomPlayer) => p.isBot && isHost && room.settings.botLoadout === "manual";
  /** Řádek hráče v tabulce týmů. */
  const playerRow = (p: RoomPlayer, color: string) => {
    const fleet = fleetOf(p);
    const err = validateFleet(fleet, room.settings);
    const status = !p.connected ? ["off", "odpojen"] : err ? ["warn", `⚠ ${err}`] : ["ok", "✓ připraven"];
    const canMove = nTeams > 1 && (isHost || p.id === m.playerId);
    const open = botEdit === p.id;
    return h(
      "div",
      { class: `trow ${p.id === m.playerId ? "me" : ""}` },
      h("span", { class: "t-strip", style: `background:${color}` }),
      h("span", { class: "t-name" }, h("span", { class: `dot ${p.connected ? "" : "off"}` }), " ", teamManual && p.commander ? h("span", { class: "cmd-star", title: "Velitel týmu – vybírá startovní bod týmu" }, "★ ") : null, p.name, p.id === room.hostId ? h("span", { class: "host" }, " HOST") : null, p.isBot ? h("span", { class: "bot-tag" }, "BOT") : null),
      h("span", { class: "t-fleet" }, ...fleet.map(shipChip)),
      h("span", { class: `t-status txt ${status[0]}` }, status[1]),
      h(
        "span",
        { class: "t-act" },
        canMove ? h("button", { class: "px tiny", title: "Přesunout do dalšího týmu", onclick: () => net.send({ type: "setTeam", team: (p.team + 1) % nTeams, playerId: p.id }) }, "⇄") : null,
        teamManual && !p.commander && (isHost || (me?.commander && me.team === p.team)) ? h("button", { class: "px tiny", title: "Předat velení týmu tomuto hráči (bude vybírat startovní bod týmu)", onclick: () => net.send({ type: "setCommander", playerId: p.id }) }, "★") : null,
        canEditBot(p) ? h("button", { class: `px tiny ${open ? "on" : ""}`, title: "Naklikat výbavu bota", onclick: () => ((botEdit = open ? null : p.id), rerender()) }, "⚙") : null,
        p.isBot && isHost ? h("button", { class: "px tiny", title: "Odebrat bota", onclick: () => net.send({ type: "removeBot", botId: p.id }) }, "✕") : null,
      ),
    );
  };
  const teamHead = (team: number) => {
    const members = room.players.filter((p) => p.team === team);
    const ships = members.reduce((s, p) => s + fleetOf(p).length, 0);
    const pts = members.reduce((s, p) => s + fleetPoints(fleetOf(p)), 0);
    const color = TEAM_COLORS[team];
    const mine = me?.team === team;
    return h(
      "div",
      { class: `thead ${mine ? "mine" : ""}`, style: `--team:${color}` },
      h("span", { class: "th-name" }, label(TEAM_NAMES[team])),
      h("span", { class: "th-info txt" }, members.length ? `${members.length} ${members.length === 1 ? "hráč" : members.length < 5 ? "hráči" : "hráčů"} · ${ships} ${ships === 1 ? "loď" : ships < 5 ? "lodě" : "lodí"} · ${pts} ${pts === 1 ? "bod" : pts < 5 ? "body" : "bodů"}` : "prázdný tým ⚠"),
      h("span", { class: "spacer" }),
      mine ? h("span", { class: "muted txt", style: "font-size:12px" }, "tvůj tým") : h("button", { class: "px tiny", onclick: () => net.send({ type: "setTeam", team }) }, label("Přejít sem")),
      isHost ? h("button", { class: "px tiny", title: "Přidat bota do tohoto týmu", onclick: () => net.send({ type: "addBot", team }) }, "+ ", icon("bot", "currentColor", 10), " ", label("bot")) : null,
    );
  };
  const humans = room.players.filter((p) => !p.isBot).length;
  const bots = room.players.length - humans;
  const shipsAll = room.players.reduce((s, p) => s + fleetOf(p).length, 0);
  const teamsTable = () => h(
    "div",
    { class: "card teams-card" },
    h(
      "div",
      { class: "tt-top" },
      h("h3", {}, icon("people", "#7dd3fc", 12), " ", label(tdm ? "Hráči a týmy" : "Hráči")),
      h("span", { class: "muted txt", style: "font-size:12px" }, `${tdm ? "Týmový deathmatch" : "Každý sám za sebe"} · ${humans} ${humans === 1 ? "hráč" : humans < 5 ? "hráči" : "hráčů"} · ${bots} ${bots === 1 ? "bot" : bots < 5 ? "boti" : "botů"} · ${shipsAll} lodí`),
      h("span", { class: "spacer" }),
      isHost
        ? h("select", { class: "tt-sel", title: "Výbava botů", onchange: (e) => set({ botLoadout: (e.target as HTMLSelectElement).value as "default" | "random" | "manual" }) }, ...([["default", "boti: výchozí výbava"], ["random", "boti: náhodná"], ["manual", "boti: ruční (⚙ u bota)"]] as const).map(([v, t]) => h("option", { value: v, selected: room.settings.botLoadout === v }, t)))
        : null,
      isHost && tdm ? h("button", { class: "px tiny", disabled: nTeams >= MAX_TEAMS_TDM, title: "Přidat tým", onclick: () => set({ teams: nTeams + 1 }) }, "+ ", label("tým")) : null,
      isHost && tdm ? h("button", { class: "px tiny", disabled: nTeams <= 2, title: "Odebrat poslední tým (jeho hráči přejdou k modrým)", onclick: () => set({ teams: nTeams - 1 }) }, "− ", label("tým")) : null,
      isHost && tdm ? h("button", { class: "px tiny", title: "Rozdělit hráče do týmů rovnoměrně podle lodních bodů", onclick: () => net.send({ type: "balanceTeams" }) }, label("vyrovnat")) : null,
      isHost && tdm ? h("button", { class: "px tiny", title: "Náhodně zamíchat týmy", onclick: () => net.send({ type: "balanceTeams", shuffle: true }) }, label("zamíchat")) : null,
      isHost && !tdm ? h("button", { class: "px tiny", onclick: () => net.send({ type: "addBot", team: 0 }) }, "+ ", icon("bot", "currentColor", 10), " ", label("bot")) : null,
    ),
    h("div", { class: "trow th" }, h("span"), h("span", {}, label("hráč")), h("span", {}, label("letka (loď = pilot + moduly)")), h("span", {}, label("stav")), h("span")),
    ...(tdm
      ? Array.from({ length: nTeams }, (_, t) => [teamHead(t), ...room.players.filter((p) => p.team === t).flatMap((p) => [playerRow(p, TEAM_COLORS[t]), botEditor(p)])]).flat()
      : room.players.flatMap((p, i) => [playerRow(p, TEAM_COLORS[i % TEAM_COLORS.length]), botEditor(p)])),
    h("div", { class: "muted txt", style: "font-size:12px;margin-top:8px" }, `Najetí na loď ukáže celou výbavu. ⇄ = přesun do dalšího týmu (host kohokoli, ty sebe)${isHost ? ", ⚙ = výbava bota (v režimu „ruční“), ✕ = odebrat bota" : ""}${teamManual ? ", ★ = velitel týmu (vybírá start týmu; host nebo velitel může velení předat)" : ""}.${tdm ? " Prázdný tým se do bitvy nepočítá." : ""}`),
  );
  const botEditor = (p: RoomPlayer) =>
    botEdit === p.id && canEditBot(p)
      ? (() => {
          const fleet = p.loadouts?.length ? p.loadouts : [p.loadout];
          const t = Math.min(botTab, fleet.length - 1);
          return h(
            "div",
            { class: "bot-editor" },
            fleet.length > 1 ? fleetTabs(fleet, t, (i) => ((botTab = i), rerender())) : null,
            renderLoadout({ loadout: fleet[t], budget, allowed: room.settings.allowedModules, compact: true, hullChoices: allowedHullIds(), pilotChoices: allowedPilotIds(), pilotsTaken: fleet.filter((_, i) => i !== t).map((l) => l.pilotId), onChange: (lo) => net.send({ type: "setLoadout", loadout: lo, botId: p.id, index: t }) }),
          );
        })()
      : null;

  const allowedHullIds = () => Object.keys(HULLS).filter((id) => settings.allowedHulls?.[id] !== 0);
  const allowedPilotIds = () => Object.keys(PILOTS).filter((id) => settings.allowedPilots?.[id] !== 0);
  /** Záložky lodí letky: „LOĎ 1 · Stíhač · Kadet“. */
  const fleetTabs = (fleet: ShipLoadout[], active: number, onPick: (i: number) => void) =>
    h(
      "div",
      { class: "fleet-tabs" },
      ...fleet.map((l, i) =>
        h(
          "button",
          { class: `fleet-tab ${i === active ? "on" : ""}`, title: `${HULLS[l.hullId]?.name ?? l.hullId} · ${PILOTS[l.pilotId]?.name ?? l.pilotId} · ${l.modules.length} modulů`, onclick: () => onPick(i) },
          icon("ship", i === active ? "#7dd3fc" : "#64748b", 12),
          h("span", { class: "ft-n" }, label(`Loď ${i + 1}`)),
          h("span", { class: "ft-sub txt" }, `${HULLS[l.hullId]?.name ?? l.hullId} · ${PILOTS[l.pilotId]?.name ?? l.pilotId}`),
        ),
      ),
    );

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
      setup
        ? h("div", { class: "setup-note txt" }, "⏳ ", isHost ? "Místnost je zatím zavřená – nastav mapu, bitvu, lodě a moduly a pak ji tlačítkem OTEVŘÍT MÍSTNOST zpřístupni ostatním. Tým a svoje lodě si vybereš až potom, podle nastavení." : "Zakladatel upravuje nastavení místnosti. Jakmile ji znovu otevře, vyberete si tým a lodě.")
        : h("div", { class: "muted txt" }, "Řekni kód ostatním, nebo ať místnost najdou v seznamu."),
    ),
    setup ? null : teamsTable(),
    me && !setup
      ? h(
          "div",
          { class: "card" },
          h("h3", {}, icon("inventory", "#7dd3fc", 12), " ", label("Tvoje výbava"), h("span", { class: "spacer" }), h("span", { class: "lo-wallet", title: "Kredity: rozpočet místnosti + výdělky z bitev − utracené za výbavu. Výbava, munice i zničené moduly ti mezi bitvami zůstávají." }, icon("credits", "#fbbf24", 12), ` ${me.credits ?? budget}`)),
          h("div", { class: "muted txt", style: "font-size:13px", title: `Nové moduly kupuješ za plnou cenu (nový jde před bitvou vrátit za plnou cenu, použitý se prodá za ${RULES.usedSellPct} %, zničený za ${RULES.brokenSellPct} %). Munice se mezi bitvami nedoplňuje sama – dokoupíš ji tlačítkem +cena u modulu. Co neutratíš, máš ve hře jako kredity; další získáš za sestřely a přežitá kola. Váha modulů snižuje max. rychlost lodi.` }, "Klik na volný slot a pak na modul (nebo naopak) = modul do zvoleného slotu · ✕ = prodat · +cena = dokoupit munici · najetí sem = pravidla nákupu"),
          (() => {
            const fleet = me.loadouts?.length ? me.loadouts : [me.loadout];
            const t = Math.min(fleetTab, fleet.length - 1);
            const lo = fleet[t];
            const pts = fleet.reduce((s, l) => s + (HULLS[l.hullId]?.points ?? 1), 0);
            return h(
              "div",
              {},
              fleet.length > 1 || settings.shipPoints > 1 ? h("div", { class: "row", style: "align-items:center;gap:10px" }, fleetTabs(fleet, t, (i) => ((fleetTab = i), rerender())), h("span", { class: "txt muted", style: "font-size:13px" }, `lodní body ${pts}/${settings.shipPoints} · jedna peněženka pro celou letku`)) : null,
              renderLoadout({ loadout: lo, budget, wallet: me.credits ?? budget, showCargo: !!lo.cargo?.length, allowed: room.settings.allowedModules, hullChoices: allowedHullIds(), pilotChoices: allowedPilotIds(), pilotsTaken: fleet.filter((_, i) => i !== t).map((l) => l.pilotId), onChange: (nl) => net.send({ type: "setLoadout", loadout: nl, index: t }) }),
            );
          })(),
        )
      : null,
    (() => {
      const series = isSeries(settings);
      const battles = settings.battles ?? [];
      const played = room.series?.played ?? 0;
      if (!series) battleSel = 0;
      else if (!setup || battleSel >= battles.length) battleSel = Math.min(played, battles.length - 1); // otevřená místnost = vždy příští bitva
      /** Vybraná bitva (série) nebo jediná bitva z nastavení. */
      const battle: BattleSettings = series ? battles[battleSel] : { map: settings.map ?? DEFAULT_MAP, turnLimit: settings.turnLimit, placement: settings.placement };
      const map = battle.map;
      const setBattle = (patch: Partial<BattleSettings>) => {
        if (series) set({ battles: battles.map((b, i) => (i === battleSel ? { ...b, ...patch } : b)) });
        else set(patch);
      };
      const setMap = (patch: Partial<MapSettings>) => setBattle({ map: { ...map, ...patch } });
      /** Počet bitev: 1 = jedna bitva, 2–5 = série (nové bitvy dědí vybranou mapu s novým seedem). */
      const setBattleCount = (n: number) => {
        if (n <= 1) {
          set({ battles: null as unknown as undefined, map: battle.map, turnLimit: battle.turnLimit, placement: battle.placement });
          battleSel = 0;
          return;
        }
        const list: BattleSettings[] = [];
        for (let i = 0; i < n; i++) list.push(battles[i] ?? (i === 0 && !series ? { ...battle } : newBattle(battle)));
        set({ battles: list });
      };
      const battlePlacement = effectivePlacement({ mode: settings.mode, placement: battle.placement });
      /** Bitva vybraná v nastavení je ta, která se bude hrát (jinak jen náhled). */
      const selIsCurrent = !series || battleSel === Math.min(played, battles.length - 1);
      /** Řádek formuláře: popisek | prvek | „?“ s vysvětlivkou. */
      const frow = (lbl: string, ctl: Node, hint?: string) => h("div", { class: "frow" }, h("span", { class: "txt flbl" }, lbl), h("div", { class: "fctl" }, ctl), hint ? h("span", { class: "fhint", title: hint }, "?") : h("span"));
      const sel = (value: string, opts: [string, string][], onChange: (v: string) => void, width?: string) =>
        h("select", { class: "fsel", disabled: !isHost, style: width ? `width:${width}` : "", onchange: (e) => onChange((e.target as HTMLSelectElement).value) }, ...opts.map(([v, t]) => h("option", { value: v, selected: value === v }, t)));
      /** Pixelový přepínač ano / ne. */
      const toggle = (on: boolean, onChange: (v: boolean) => void, title?: string) =>
        h("button", { class: `ptoggle ${on ? "on" : ""}`, disabled: !isHost, title, onclick: () => onChange(!on) }, h("span", { class: "pt-sw" }, h("i")), h("span", { class: "txt pt-lbl" }, on ? "ano" : "ne"));
      const section = (title: string, ...rows: (Node | null)[]) => h("div", { class: "fsec" }, h("div", { class: "fsec-h" }, label(title)), ...rows);
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
      const AST_LEVELS: MapSettings["asteroids"][] = ["none", "few", "medium", "many"];
      /** Kameny: rozptýlené nebo ve shluku (pro políčka asteroidů a shluků). */
      const rockSvg = (lit: boolean, pts: [number, number, number][]) => {
        const s = svgEl("svg", { width: "26", height: "26", viewBox: "0 0 26 26" });
        for (const [x, y, r] of pts) s.append(svgEl("circle", { cx: String(x), cy: String(y), r: String(r), fill: lit ? "#b9ad8a" : "none", stroke: lit ? "#7a6f52" : "#334155", "stroke-width": lit ? "1" : "2", ...(lit ? {} : { "stroke-dasharray": "2 2" }) }));
        return s;
      };
      const ROCKS_SPREAD: [number, number, number][] = [[6, 7, 3], [19, 6, 2.5], [8, 19, 2.5], [20, 18, 3.5], [14, 12, 2]];
      const ROCKS_CLUSTER: [number, number, number][] = [[11, 12, 3.5], [17, 10, 2.5], [15, 17, 3], [9, 18, 2], [19, 16, 2]];
      const ROCK_LEVEL: [number, number, number][][] = [[[13, 13, 4]], [[8, 9, 3.5], [18, 17, 4]], [[7, 7, 3], [19, 8, 3.5], [9, 19, 3.5], [19, 19, 2.5], [14, 13, 2]]];
      const STORM_SIZES: MapSettings["stormSize"][] = ["small", "medium", "large"];
      // Startovní bod: hráč volí jen sobě; host navíc botům – klikne na čip bota, pak na kroužek v mapě.
      // Týmové ruční umístění: vybírá jen velitel týmu (★); host navíc za boty-velitele.
      const bots = room.players.filter((p) => p.isBot && (!teamManual || p.commander));
      const iPick = !randomPlacement && (!teamManual || !!me?.commander);
      if (startFor && !bots.some((b) => b.id === startFor)) startFor = null;
      const startChip = (p: RoomPlayer | null) => {
        const id = p?.id ?? null;
        const on = startFor === id;
        const set = p ? p.startIndex !== undefined : me?.startIndex !== undefined;
        return h(
          "button",
          { class: `start-chip ${on ? "on" : ""} ${set ? "set" : ""}`, style: `--team:${TEAM_COLORS[(p ?? me)?.team ?? 0]}`, title: p ? `${p.name}: ${set ? "start zvolen · klik = vybírat znovu" : "klikni a pak vyber kroužek na mapě"}` : set ? "Tvůj start je zvolený" : "Vyber si kroužek na mapě", onclick: () => ((startFor = id), rerender()) },
          p ? icon("bot", on ? "#0b1020" : "currentColor", 12) : pilotPortrait(me?.loadouts?.[0]?.pilotId ?? me?.loadout.pilotId ?? "kadet", 16),
          h("span", { class: "sc-name" }, p ? p.name.replace(/^Bot /, "") : "já"),
          set ? h("span", { class: "sc-tick" }, icon("tick", "#4ade80", 10)) : null,
        );
      };
      const startChips = isHost && bots.length && !randomPlacement ? h("div", { class: "start-chips" }, h("span", { class: "txt muted", style: "font-size:13px" }, "Start pro"), iPick ? startChip(null) : null, ...bots.map((b) => startChip(b))) : null;
      const myCommander = teamManual ? room.players.find((p) => p.team === me?.team && p.commander) : undefined;
      const startHelp = randomPlacement
        ? `${PLACEMENT_LABEL[placement]}: startovní body se rozdělí náhodně při startu bitvy${placement === "teamRandom" ? ", tým startuje ve formaci vedle sebe" : ""}.`
        : startFor
          ? `Vybíráš start pro ${room.players.find((p) => p.id === startFor)?.name ?? "bota"} – klikni na kroužek na okraji mapy.`
          : teamManual
            ? me?.commander
              ? "Jsi velitel týmu (★): klikni na kroužek na okraji = start celého týmu (spoluhráči budou ve formaci vedle tebe)."
              : `Start týmu vybírá velitel ${myCommander?.name ?? "týmu"} (★). Host nebo velitel může velení předat v tabulce týmů.`
            : "Klikni na kroužek na okraji = tvůj start (barva = tým, ostatní vidí, kde kdo startuje). Bez volby dostaneš volný bod.";
      const pickerId = startFor ?? (iPick ? m.playerId : "");
      // hvězdička velitele jen tam, kde má smysl
      const previewPlayers = teamManual ? room.players : room.players.map((p) => ({ ...p, commander: false }));
      const pickStart = (index: number | null) => {
        net.send({ type: "setStart", index, ...(startFor ? { botId: startFor } : {}) });
        startFor = null;
      };
      const TILE_COLOR: Record<ModuleType, string> = { laser: "#f87171", torpedo: "#fb923c", mine: "#fbbf24", "shield-segment": "#7dd3fc", mg: "#fde047", scanner: "#a78bfa", "shield-whole": "#38bdf8", droid: "#c084fc" };
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
        { class: "mod-hexes" },
        ...MODULE_TYPES.map((t) => {
          const on = allowedOn(t);
          return h(
            "button",
            { class: `lo-hexbuy mod-hex ${on ? "on" : "off"}`, disabled: !isHost, title: `${MODULES[t].name}\n${MODULES[t].description}\n${on ? "Ve hře · klik = vyřadit" : "Vyřazen · klik = povolit"}`, onclick: () => setAllowed(t, !on) },
            moduleHexSvg(t, on ? "VE HŘE" : "VYŘAZEN", !on),
          );
        }),
      );
      /** Souhrn nastavení: řádek čipů (ikona + hodnota) s pevnou výškou – změna textu neposune zbytek UI. */
      const sumChip = (ic: string, color: string, value: string, title: string) => h("span", { class: "sum-chip", title }, icon(ic, color, 11), h("b", {}, value));
      const B = "#7dd3fc";
      const Y = "#fbbf24";
      const summaryStrip = () =>
        h(
          "div",
          { class: "sum-strip" },
          sumChip("map", B, MAP_SIZES[map.size]?.label.split(" ")[0] ?? map.size, `Velikost mapy: ${MAP_SIZES[map.size]?.label ?? map.size}`),
          sumChip("rock", B, `${{ none: "žádné", few: "málo", medium: "střední", many: "hodně" }[map.asteroids] ?? map.asteroids}${map.clusters ? " · shluky" : ""}`, "Asteroidy"),
          sumChip("storm", B, map.storms === 0 ? "bez bouří" : `${map.storms} ${map.storms === 1 ? "bouře" : map.storms < 5 ? "bouře" : "bouří"}`, "Bouře"),
          sumChip("comet", B, { none: "žádné", few: "málo", medium: "středně", many: "hodně" }[map.comets ?? "none"] ?? "žádné", "Komety"),
          sumChip("seed", B, String(map.seed), "Seed mapy"),
          h("span", { class: "sum-sep" }),
          sumChip("people", Y, settings.mode === "tdm" ? `${settings.teams ?? 2} týmy` : "každý sám", settings.mode === "tdm" ? `Týmový deathmatch · ${settings.teams ?? 2} týmy` : "Deathmatch · všichni proti všem"),
          sumChip("place", Y, PLACEMENT_LABEL[placement].replace(" umístění", "").toLowerCase(), `Umístění na mapě: ${PLACEMENT_LABEL[placement]}`),
          sumChip("credits", Y, String(budget), "Startovní kredity"),
          sumChip("ship", Y, `${settings.shipPoints} ${settings.shipPoints === 1 ? "bod" : "body"}`, "Lodní body na hráče"),
          settings.turnLimit ? sumChip("clock", Y, `${settings.turnLimit} kol`, "Limit kol") : null,
          room.series ? sumChip("log", "#c084fc", room.series.finished ? `série ${room.series.total} bitev · konec` : `bitva ${room.series.played + 1}/${room.series.total}`, "Série bitev") : null,
        );
      /** Stav série v otevřené místnosti: příští bitva, průběžné pořadí, výsledky bitev. */
      const seriesBar = () => {
        const ss = room.series;
        if (!ss) return null;
        const sideName = (k: string) => (tdm ? TEAM_NAMES[Number(k)] : (room.players.find((p) => p.id === k)?.name ?? "?"));
        const sideColor = (k: string) => (tdm ? TEAM_COLORS[Number(k)] : TEAM_COLORS[room.players.findIndex((p) => p.id === k) % TEAM_COLORS.length] ?? "#e2e8f0");
        const sides = tdm ? [...new Set(room.players.map((p) => String(p.team)))].sort() : room.players.map((p) => p.id);
        const st = seriesStandings(ss.results, sides);
        const win = ss.finished ? seriesWinner(ss.results) : null;
        return h(
          "div",
          { class: "series-bar" },
          h("div", { class: "sb-head" }, icon("log", "#c084fc", 12), " ", label(ss.finished ? `Série skončila · ${win === null ? "remíza" : `vítěz ${sideName(win)}`}` : `Série · bitva ${ss.played + 1} ze ${ss.total}`), h("span", { class: "muted txt", style: "font-size:12px;margin-left:8px" }, "body: výhra 3 · remíza 1 · při rovnosti sestřely, pak zranění")),
          h(
            "div",
            { class: "sb-rows" },
            ...st.map((x, i) =>
              h(
                "div",
                { class: `sb-row ${win === x.key ? "win" : ""}` },
                h("span", { class: "sb-pos" }, `${i + 1}.`),
                h("span", { class: "sb-strip", style: `background:${sideColor(x.key)}` }),
                h("span", { class: "sb-name" }, label(sideName(x.key))),
                h("span", { class: "sb-pts" }, `${x.points} b.`),
                h("span", { class: "sb-rec txt muted" }, `${x.wins}V ${x.draws}R ${x.losses}P · ${x.kills} sestřelů · ${x.damage} zranění`),
              ),
            ),
            ss.results.length
              ? h("div", { class: "sb-res txt muted" }, ...ss.results.map((r) => h("span", { class: "sb-r" }, `B${r.index + 1}: `, r.winner === null ? "remíza" : h("b", { style: `color:${sideColor(r.winner)}` }, sideName(r.winner)))))
              : null,
          ),
        );
      };
      /** Pixelové pictogramy pro řádky Herní mód / Umístění / Výbava botů (26×26). */
      const dot = (s: SVGElement, x: number, y: number, c: string, r = 2.2) => s.append(svgEl("circle", { cx: String(x), cy: String(y), r: String(r), fill: c }));
      const ring = (s: SVGElement, x: number, y: number, c: string, r = 3) => s.append(svgEl("circle", { cx: String(x), cy: String(y), r: String(r), fill: "none", stroke: c, "stroke-width": "1.5", "stroke-dasharray": "2 1.5" }));
      const txt = (s: SVGElement, x: number, y: number, t: string, c: string, size = 11) => {
        const e = svgEl("text", { x: String(x), y: String(y), fill: c, "font-size": String(size), "font-family": "Jersey, monospace", "text-anchor": "middle", "font-weight": "700" });
        e.textContent = t;
        s.append(e);
      };
      const BLUE = "#60a5fa";
      const RED = "#f87171";
      const modeSvg = (mode: "tdm" | "dm", on: boolean) => {
        const s = svgEl("svg", { width: "26", height: "26", viewBox: "0 0 26 26" });
        const c = (k: string) => (on ? k : "#475569");
        if (mode === "tdm") {
          for (const [x, y] of [[5, 8], [9, 8], [7, 12]] as const) dot(s, x, y, c(BLUE));
          for (const [x, y] of [[17, 14], [21, 14], [19, 18]] as const) dot(s, x, y, c(RED));
          s.append(svgEl("line", { x1: "11", y1: "19", x2: "15", y2: "7", stroke: c("#94a3b8"), "stroke-width": "1", "stroke-dasharray": "2 2" }));
        } else {
          dot(s, 6, 6, c(BLUE));
          dot(s, 20, 7, c(RED));
          dot(s, 7, 19, c("#fbbf24"));
          dot(s, 19, 19, c("#4ade80"));
          dot(s, 13, 13, c("#c084fc"));
        }
        return s;
      };
      const placeSvg = (pl: Placement, on: boolean) => {
        const s = svgEl("svg", { width: "26", height: "26", viewBox: "0 0 26 26" });
        const c = (k: string) => (on ? k : "#475569");
        if (pl === "random") {
          ring(s, 6, 6, c("#94a3b8"));
          ring(s, 20, 8, c("#94a3b8"));
          ring(s, 7, 20, c("#94a3b8"));
          ring(s, 20, 20, c("#94a3b8"));
          txt(s, 13, 17, "?", c("#fbbf24"), 13);
        } else if (pl === "teamRandom") {
          dot(s, 5, 7, c(BLUE));
          dot(s, 9, 7, c(BLUE));
          dot(s, 17, 19, c(RED));
          dot(s, 21, 19, c(RED));
          txt(s, 13, 17, "?", c("#fbbf24"), 13);
        } else if (pl === "manual") {
          ring(s, 6, 6, c("#94a3b8"));
          ring(s, 20, 20, c("#94a3b8"));
          dot(s, 20, 7, c(BLUE), 3);
          // kurzor
          s.append(svgEl("path", { d: "M7 12 L7 22 L10 19 L12 23 L14 22 L12 18 L16 18 Z", fill: c("#e2e8f0"), stroke: c("#0b1020"), "stroke-width": "0.8" }));
        } else {
          dot(s, 8, 13, c(BLUE), 3);
          dot(s, 14, 13, c(BLUE));
          dot(s, 19, 13, c(BLUE));
          txt(s, 8, 9, "★", c("#fbbf24"), 9);
          s.append(svgEl("path", { d: "M12 15 L12 24 L14.5 21.5 L16 24.5 L17.5 23.5 L16 20.5 L19 20.5 Z", fill: c("#e2e8f0"), stroke: c("#0b1020"), "stroke-width": "0.8" }));
        }
        return s;
      };
      const botLoadSvg = (kind: "default" | "random" | "manual", on: boolean) => {
        const wrap = h("span", { class: "pip-combo" });
        wrap.append(icon("bot", on ? "#7dd3fc" : "#475569", 16));
        const badge = kind === "default" ? icon("tick", on ? "#4ade80" : "#475569", 9) : kind === "manual" ? icon("pen", on ? "#fbbf24" : "#475569", 9) : h("span", { class: "pip-q", style: `color:${on ? "#fbbf24" : "#475569"}` }, "?");
        badge.classList.add("pip-badge");
        wrap.append(badge);
        return wrap;
      };
      const pipRow = <T extends string>(cls: string, value: T, opts: [T, string, (on: boolean) => Node][], onPick: (v: T) => void, text: string) =>
        h(
          "div",
          { class: "pips-row" },
          ...opts.map(([v, title, draw]) => h("button", { class: `pip ${cls} ${value === v ? "on" : ""}`, disabled: !isHost, title, onclick: () => onPick(v) }, draw(value === v))),
          h("span", { class: "txt muted pips-txt" }, text),
        );
      const PAGES = ["Bitvy", "Pravidla", "Lodě a piloti", "Moduly"];
      /** Dlaždice bitev série: číslo, stav (odehraná / příští / další), zkrácený popis mapy. */
      /** Ikona bitvy: zkřížené střely; k malých křížků = počet bitev (volba počtu). */
      const crossAt = (sv: SVGElement, x: number, y: number, r: number, on: boolean) => {
        sv.append(svgEl("path", { d: `M${x - r} ${y - r} L${x + r} ${y + r}`, stroke: on ? "#f87171" : "#475569", "stroke-width": r > 3 ? "3" : "2", "stroke-linecap": "square" }));
        sv.append(svgEl("path", { d: `M${x + r} ${y - r} L${x - r} ${y + r}`, stroke: on ? "#7dd3fc" : "#475569", "stroke-width": r > 3 ? "3" : "2", "stroke-linecap": "square" }));
      };
      const battleCountSvg = (k: number, on: boolean) => {
        const sv = svgEl("svg", { width: "26", height: "26", viewBox: "0 0 26 26" });
        const pts: [number, number][] = k === 1 ? [[13, 13]] : k === 2 ? [[8, 13], [18, 13]] : k === 3 ? [[7, 8], [19, 8], [13, 18]] : k === 4 ? [[8, 8], [18, 8], [8, 18], [18, 18]] : [[13, 13], [7, 7], [19, 7], [7, 19], [19, 19]];
        for (const [x, y] of pts) crossAt(sv, x, y, k === 1 ? 5 : 3, on);
        return sv;
      };
      /** Záložky bitev série (T1): aktivní splývá s panelem mapy pod ní; stav pod názvem; 🎲 = nový seed té bitvy. */
      const battleTabs = () => {
        const list = series ? battles : [battle];
        return h(
          "div",
          { class: "bt-tabs" },
          ...list.map((b, i) => {
            const done = series && i < played;
            const next = series && i === played && !room.series?.finished;
            const res = series ? room.series?.results[i] : undefined;
            const resTxt = res ? (res.winner === null ? "remíza" : tdm ? TEAM_NAMES[Number(res.winner)] : (room.players.find((p) => p.id === res.winner)?.name ?? "?")) : "";
            const dice = isHost && !done
              ? h("span", { class: "bt-dice", title: series ? `Nová náhodná mapa pro bitvu ${i + 1}` : "Nová náhodná mapa", onclick: (ev: MouseEvent) => {
                  ev.stopPropagation();
                  const seed = Math.floor(Math.random() * 100000);
                  if (series) {
                    battleSel = i;
                    set({ battles: battles.map((x, j) => (j === i ? { ...x, map: { ...x.map, seed } } : x)) });
                  } else setMap({ seed });
                } }, "🎲")
              : null;
            const sub = done ? `✓ ${resTxt}` : next ? "příští" : `#${b.map.seed}`;
            return h(
              "button",
              { class: `bt-tab ${!series || i === battleSel ? "on" : ""} ${done ? "done" : ""} ${next ? "next" : ""}`, title: series ? `Bitva ${i + 1}: ${MAP_SIZES[b.map.size]?.label ?? b.map.size} · seed ${b.map.seed}${b.turnLimit ? ` · limit ${b.turnLimit} kol` : ""}${done ? ` · odehraná (${resTxt})` : next ? " · příští" : ""}` : "Jediná bitva", onclick: () => ((battleSel = i), rerender()) },
              h("span", { class: "bt-n" }, label(series ? `Bitva ${i + 1}` : "Bitva")),
              h("span", { class: "bt-sub txt" }, series ? sub : "jediná"),
              dice,
            );
          }),
          h("span", { class: "spacer" }),
          series && isHost ? h("button", { class: "px tiny bt-all", title: "Nové náhodné mapy pro všechny neodehrané bitvy", onclick: () => set({ battles: battles.map((b, i) => (i < played ? b : { ...b, map: { ...b.map, seed: Math.floor(Math.random() * 100000) } })) }) }, "🎲 ", label("vše")) : null,
        );
      };
      const pageBar = h(
        "div",
        { class: "wiz-bar" },
        ...PAGES.map((t, i) => h("button", { class: `wiz-step ${i === gamePage ? "on" : ""} ${i < gamePage ? "done" : ""}`, onclick: () => ((gamePage = i), rerender()) }, h("span", { class: "wiz-n" }, String(i + 1)), label(t))),
        h("span", { class: "spacer" }),
        h("button", { class: "px", disabled: gamePage === 0, onclick: () => ((gamePage = Math.max(0, gamePage - 1)), rerender()) }, "‹ ", label("zpět")),
        gamePage === PAGES.length - 1 && isHost
          ? h("button", { class: "px primary", onclick: () => net.send({ type: "openRoom", open: true }) }, icon("tick", "currentColor", 12), " ", label("Otevřít místnost"))
          : h("button", { class: "px primary", disabled: gamePage === PAGES.length - 1, onclick: () => ((gamePage = Math.min(PAGES.length - 1, gamePage + 1)), rerender()) }, label("další"), " ›"),
      );
      // otevřená místnost: nastavení jen jako souhrn (host může zpět do úprav), zůstává náhled mapy se startovním bodem
      if (!setup)
        return h(
          "div",
          { class: "card gamecard open" },
          h("h3", { style: "display:flex;align-items:center;gap:8px" }, icon("target", "#7dd3fc", 12), " ", label("Nastavení hry"), h("span", { class: "txt muted", style: "font-size:13px" }, "hotovo, místnost otevřená"), h("span", { class: "spacer" }), isHost ? h("button", { class: "px tiny", title: "Místnost se zavře pro nové hráče, dokud nastavení znovu nedokončíš", onclick: () => ((gamePage = 0), net.send({ type: "openRoom", open: false })) }, icon("pen", "currentColor", 10), " ", label("upravit")) : null),
          summaryStrip(),
          seriesBar(),
          randomPlacement
            ? h("div", { class: "game-side" }, h("div", { class: "fsec-h" }, label("Mapa · umístění")), h("div", { class: "muted txt place-note" }, icon("target", "#94a3b8", 12), " ", startHelp))
            : h(
                "div",
                { class: "game-side" },
                h("div", { class: "fsec-h" }, label(teamManual ? "Mapa · start týmu" : "Mapa · startovní bod"), h("span", { class: "spacer" }), startChips),
                renderMapPreview(map, previewPlayers, pickerId, pickStart, 1200, !!pickerId, room.tuning.borderWidth),
                h("div", { class: "muted txt" }, startHelp),
              ),
        );
      const pageOf = (i: number, ...nodes: (Node | null)[]) => (gamePage === i ? nodes : []);
      return h(
        "div",
        { class: "card gamecard" },
        h("h3", {}, icon("target", "#7dd3fc", 12), " ", label("Nastavení hry"), isHost ? "" : h("span", { class: "muted" }, label(" (mění host)"))),
        summaryStrip(),
        pageBar,
        h(
          "div",
          { class: `game-grid ${gamePage === 0 ? "" : "single"}` },
          h(
            "div",
            { class: "game-form" },
            ...pageOf(
              0,
            section(
              "Bitvy",
              frow(
                "Počet bitev",
                h(
                  "div",
                  { class: "pips-row" },
                  ...[1, 2, 3, 4, 5].map((n) => h("button", { class: `pip size ${(series ? battles.length : 1) === n ? "on" : ""}`, disabled: !isHost, title: n === 1 ? "Jedna bitva" : `Série ${n} bitev – každá má vlastní mapu, limit kol a umístění`, onclick: () => setBattleCount(n) }, battleCountSvg(n, (series ? battles.length : 1) === n))),
                  h("span", { class: "txt muted pips-txt", title: "Vítěz série podle bodů: výhra 3, remíza 1, prohra 0; při rovnosti sestřely, pak zranění" }, series ? `série ${battles.length} bitev` : "jedna bitva"),
                ),
                `Jedna bitva, nebo série ${SERIES_MIN}–${SERIES_MAX} bitev za sebou. V sérii má každá bitva vlastní mapu, limit kol a umístění; mód, kredity, lodní body a moduly jsou společné. Mezi bitvami se hraje v místnosti (nákupy, opravy), host zahájí další. Vítěz série: body (výhra 3, remíza 1, prohra 0), při rovnosti sestřely, pak zranění.`,
              ),
            ),
            battleTabs(),
            section(
              series ? `Bitva ${battleSel + 1} · mapa` : "Bitva · mapa",
              frow(
                "Velikost",
                h(
                  "div",
                  { class: "pips-row" },
                  ...(Object.keys(MAP_SIZES) as MapSettings["size"][]).map((k, i) => {
                    const on = map.size === k;
                    const sz = [10, 14, 18, 22][i] ?? 22;
                    const s = svgEl("svg", { width: "26", height: "26", viewBox: "0 0 26 26" });
                    // ovál podle velikosti mapy (poměr 3:2)
                    s.append(svgEl("ellipse", { cx: "13", cy: "13", rx: String(sz / 2), ry: String(sz / 3), fill: on ? "#1e3a5f" : "none", stroke: on ? "#7dd3fc" : "#334155", "stroke-width": "2" }));
                    return h("button", { class: `pip size ${on ? "on" : ""}`, disabled: !isHost, title: `${MAP_SIZES[k].label} · ${MAP_SIZES[k].starts} startovních bodů`, onclick: () => setMap({ size: k }) }, s);
                  }),
                  h("span", { class: "txt muted pips-txt" }, MAP_SIZES[map.size]?.label ?? map.size),
                ),
                "Velikost mapy v herních jednotkách; větší mapa = víc startovních bodů a delší přelety.",
              ),
              frow(
                "Asteroidy",
                pips(3, Math.max(0, AST_LEVELS.indexOf(map.asteroids)), "rock", (k) => rockSvg(true, ROCK_LEVEL[k - 1]), (k) => rockSvg(false, ROCK_LEVEL[k - 1]), (k) => ["málo", "střední", "hodně"][k - 1], (v) => setMap({ asteroids: AST_LEVELS[v] }), ["žádné", "málo", "střední", "hodně"][Math.max(0, AST_LEVELS.indexOf(map.asteroids))]),
                "Hustota asteroidů na mapě.",
              ),
              frow(
                "Rozložení",
                h("div", { class: "pips-row" }, h("button", { class: `pip rock ${!map.clusters ? "on" : ""}`, disabled: !isHost, title: "Rovnoměrně rozptýlené", onclick: () => setMap({ clusters: false }) }, rockSvg(true, ROCKS_SPREAD)), h("button", { class: `pip rock ${map.clusters ? "on" : ""}`, disabled: !isHost, title: "Ve shlucích", onclick: () => setMap({ clusters: true }) }, rockSvg(true, ROCKS_CLUSTER)), h("span", { class: "txt muted pips-txt" }, map.clusters ? "ve shlucích" : "rozptýlené")),
                "Asteroidy rovnoměrně rozptýlené, nebo v hustších shlucích s volnými koridory.",
              ),
              frow(
                "Bouře",
                pips(5, map.storms, "storm", () => stormSvg(9), () => emptySvg(), (k) => `${k} bouří`, (v) => setMap({ storms: v }), map.storms === 0 ? "žádná" : map.storms === 1 ? "1 bouře" : map.storms < 5 ? `${map.storms} bouře` : "5 bouří"),
                "Počet elektromagnetických bouří (fialové): uvnitř nefungují štíty ani lasery, torpéda letí rovně, skener jí nepronikne, loď v bouři není vidět.",
              ),
              frow(
                "Velikost bouří",
                h("div", { class: "pips-row" }, ...STORM_SIZES.map((sz, i) => h("button", { class: `pip storm ${map.stormSize === sz ? "on" : ""}`, disabled: !isHost, title: ["malé", "střední", "velké"][i] + " bouře", onclick: () => setMap({ stormSize: sz }) }, stormSvg([4, 7, 10][i])))),
              ),
              frow(
                "Symetrie",
                h(
                  "div",
                  { class: "pips-row" },
                  ...[false, true].map((sym) => {
                    const on = map.symmetric === sym;
                    const s = svgEl("svg", { width: "26", height: "26", viewBox: "0 0 26 26" });
                    const pts: [number, number, number][] = sym ? [[6, 8, 3], [20, 8, 3], [9, 18, 2.5], [17, 18, 2.5]] : [[6, 7, 3], [18, 10, 2], [10, 19, 2.5], [21, 19, 3.5]];
                    if (sym) s.append(svgEl("line", { x1: "13", y1: "3", x2: "13", y2: "23", stroke: on ? "#7dd3fc" : "#334155", "stroke-width": "1", "stroke-dasharray": "2 2" }));
                    for (const [x, y, r] of pts) s.append(svgEl("circle", { cx: String(x), cy: String(y), r: String(r), fill: on ? "#b9ad8a" : "none", stroke: on ? "#7a6f52" : "#334155", "stroke-width": on ? "1" : "2" }));
                    return h("button", { class: `pip size ${on ? "on" : ""}`, disabled: !isHost, title: sym ? "Zrcadlená mapa – obě strany mají stejné podmínky" : "Náhodná mapa bez zrcadlení", onclick: () => setMap({ symmetric: sym }) }, s);
                  }),
                  h("span", { class: "txt muted pips-txt" }, map.symmetric ? "zrcadlená" : "náhodná"),
                ),
                "Zrcadlená mapa dá oběma stranám stejné podmínky.",
              ),
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
              frow(
                "Limit kol",
                h("div", { class: "fpair" }, h("input", { class: "fsel", type: "number", value: String(battle.turnLimit), min: "0", max: "99", disabled: !isHost, style: "width:118px", onchange: (e) => setBattle({ turnLimit: Math.max(0, Math.min(99, Math.round(Number((e.target as HTMLInputElement).value) || 0))) }) }), ...(isHost ? [0, 20, 30, 40].map((n) => h("button", { class: `px tiny ${battle.turnLimit === n ? "on" : ""}`, onclick: () => setBattle({ turnLimit: n }) }, n === 0 ? "∞" : String(n))) : [])),
                "Po tolika kolech bitva končí (vítěz podle zbývajících lodí a zranění). 0 = bez limitu.",
              ),
              frow(
                "Umístění na mapě",
                pipRow("size", battlePlacement, PLACEMENTS.filter((p) => tdm || (p !== "teamRandom" && p !== "teamManual")).map((p) => [p, `${PLACEMENT_LABEL[p]}\n${PLACEMENT_HINT[p]}`, (on: boolean) => placeSvg(p, on)] as [Placement, string, (on: boolean) => Node]), (v) => setBattle({ placement: v }), PLACEMENT_LABEL[battlePlacement].toLowerCase()),
                `${PLACEMENT_HINT.random}\n${PLACEMENT_HINT.teamRandom}\n${PLACEMENT_HINT.manual}\n${PLACEMENT_HINT.teamManual}\nTýmové varianty jen v týmovém deathmatchi.`,
              ),
              frow("", h("span", { class: "txt muted fsub" }, PLACEMENT_HINT[battlePlacement])),
            ),
            ),
            ...pageOf(
              1,
            section(
              "Pravidla",
              frow(
                "Herní mód",
                pipRow("size", settings.mode, [["tdm", "Týmový deathmatch – týmy proti sobě", (on) => modeSvg("tdm", on)], ["dm", "Deathmatch – všichni proti všem", (on) => modeSvg("dm", on)]], (v) => set({ mode: v }), settings.mode === "tdm" ? "týmový deathmatch" : "deathmatch · všichni proti všem"),
                "Týmový deathmatch: týmy proti sobě. Deathmatch: každý sám za sebe.",
              ),
              frow(
                "Startovní kredity",
                h("div", { class: "fpair" }, h("input", { class: "fsel", type: "number", value: String(budget), min: "0", max: "5000", step: "50", disabled: !isHost, style: "width:118px", onchange: (e) => net.send({ type: "setTuning", tuning: { startBudget: Math.max(0, Math.min(5000, Math.round(Number((e.target as HTMLInputElement).value) || 0))) } }) }), ...(isHost ? [300, 500, 800, 1200].map((n) => h("button", { class: `px tiny ${budget === n ? "on" : ""}`, onclick: () => net.send({ type: "setTuning", tuning: { startBudget: n } }) }, String(n))) : [])),
                "Kredity každého hráče na začátku (výbava se z nich kupuje; výdělky z bitev se přičítají). Totéž co ladění → Ekonomika → Rozpočet na výbavu.",
              ),
              frow(
                "Lodní body na hráče",
                pips(3, settings.shipPoints, "size", () => icon("ship", "#7dd3fc", 18), () => icon("ship", "#334155", 18), (k) => `${k} lodní body`, (v) => set({ shipPoints: Math.max(1, v) }), `${settings.shipPoints} ${settings.shipPoints === 1 ? "bod" : "body"} · stíhač = 1`),
                "Každý hráč musí body využít přesně: stíhač stojí 1 bod (větší lodě víc). Všechny lodě hráče mají jednu peněženku.",
              ),
              frow(
                "Výbava botů",
                pipRow("size", settings.botLoadout, [["default", "Výchozí sestava", (on) => botLoadSvg("default", on)], ["random", "Náhodná výbava", (on) => botLoadSvg("random", on)], ["manual", "Ruční – host nakliká výbavu u bota (⚙ v tabulce týmů)", (on) => botLoadSvg("manual", on)]], (v) => set({ botLoadout: v }), { default: "výchozí sestava", random: "náhodná", manual: "ruční (naklikám u bota)" }[settings.botLoadout]),
                "Jakou výbavu dostanou boti: výchozí sestavu, náhodnou, nebo ji host nakliká ručně.",
              ),
            ),
            ),
            ...pageOf(
              2,
            section(
              "Dostupné lodě",
              h(
                "div",
                { class: "mod-tiles" },
                ...Object.values(HULLS).map((hd) => {
                  const on = settings.allowedHulls?.[hd.id] !== 0;
                  return h(
                    "button",
                    { class: `mod-tile ${on ? "on" : ""}`, disabled: !isHost, style: on ? "border-color:#7dd3fc #0b1020 #0b1020 #7dd3fc" : "", title: `${hd.name}\n${hd.description}\nLodní body: ${hd.points}\n${on ? "Klik = vyřadit z této hry" : "Klik = povolit"}`, onclick: () => set({ allowedHulls: { ...settings.allowedHulls, [hd.id]: on ? 0 : undefined } as Partial<Record<string, number>> }) },
                    icon("ship", on ? "#7dd3fc" : "#475569", 26),
                    h("span", { class: "mt-name" }, label(hd.name)),
                    h("span", { class: "mt-pts" }, `${hd.points} b.`),
                    h("span", { class: "mt-chk" }, on ? "✓" : ""),
                  );
                }),
              ),
              h("div", { class: "txt muted mt-foot" }, "Hráč skládá letku z povolených trupů tak, aby využil přesně své lodní body."),
            ),
            section(
              "Dostupní piloti",
              h(
                "div",
                { class: "mod-tiles" },
                ...Object.values(PILOTS).map((pd) => {
                  const on = settings.allowedPilots?.[pd.id] !== 0;
                  const locked = pd.id === "kadet";
                  return h(
                    "button",
                    { class: `mod-tile pilot ${on ? "on" : ""}`, disabled: !isHost || locked, style: on ? "border-color:#fbbf24 #0b1020 #0b1020 #fbbf24" : "", title: `${pd.name}\n${pd.description}${pd.abilities.length ? `\n${pd.abilities.join("\n")}` : ""}\n${pd.unique ? "Unikátní: v letce jen jednou." : "Může se v letce opakovat."}${locked ? "\nKadet je vždy k dispozici." : on ? "\nKlik = vyřadit z této hry" : "\nKlik = povolit"}`, onclick: () => set({ allowedPilots: { ...settings.allowedPilots, [pd.id]: on ? 0 : undefined } as Partial<Record<string, number>> }) },
                    h("span", { class: `mt-portrait ${on ? "" : "off"}` }, pilotPortrait(pd.id, 40)),
                    h("span", { class: "mt-name" }, label(pd.name)),
                    h("span", { class: "mt-chk" }, on ? "✓" : ""),
                  );
                }),
              ),
              h("div", { class: "txt muted mt-foot" }, "Piloti se schopnostmi jsou v letce unikátní, Kadet se může opakovat. Pilot zničené lodi zahyne – příští bitvu nastoupí Kadet. Piloty lze upravit v Ladění → Piloti."),
            ),
            ),
            ...pageOf(
              3,
            section(
              "Dostupné moduly",
              tiles,
              h("div", { class: "txt muted mt-foot" }, `${onCount} ze ${MODULE_TYPES.length} modulů ve hře`, isHost ? h("span", {}, " · ", h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), setAll(true)) }, "všechny"), " · ", h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), setAll(false)) }, "žádný")) : null, " · vyřazený modul nejde koupit; kdo ho má v sestavě, musí ho před bitvou prodat."),
            ),
            ),
          ),
          gamePage !== 0
            ? null
            : h(
            "div",
            { class: "game-side" },
            h("div", { class: "fsec-h" }, label(series ? `Náhled mapy · bitva ${battleSel + 1}` : randomPlacement ? "Náhled mapy" : teamManual ? "Náhled mapy · start týmu" : "Náhled mapy · startovní bod")),
            renderMapPreview(map, selIsCurrent ? previewPlayers : [], selIsCurrent ? pickerId : "", pickStart, 520, selIsCurrent && !!pickerId),
            h("div", { class: "muted txt" }, selIsCurrent ? startHelp : "Náhled jiné než příští bitvy – startovní body se vybírají až před ní."),
            selIsCurrent ? startChips : null,
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
          onSavePilots: (pilots) => net.send({ type: "setPilots", pilots }),
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
      setup
        ? isHost
          ? h("button", { class: "primary", onclick: () => net.send({ type: "openRoom", open: true }) }, icon("tick", "currentColor", 12), label("Otevřít místnost"))
          : h("span", { class: "muted txt" }, "Čeká se, až zakladatel dokončí nastavení…")
        : isHost
          ? h("button", { class: "primary", title: room.series?.finished ? "Stejné nastavení, nové mapy (seedy), skóre od nuly" : "", onclick: () => net.send({ type: "startGame" }) }, icon("play", "currentColor", 12), label(room.series ? (room.series.finished ? "Nová série" : `Zahájit bitvu ${room.series.played + 1}/${room.series.total}`) : "Zahájit bitvu"))
          : h("span", { class: "muted txt" }, room.series ? (room.series.finished ? "Série skončila – host může spustit novou." : `Čeká se, až host zahájí bitvu ${room.series.played + 1} ze ${room.series.total}…`) : "Čeká se, až host zahájí bitvu…"),
    ),
  );
}
