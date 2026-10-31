import {
  type BotLevel,
  AMMO_TYPES,
  applyTuning,
  computeStats,
  DEFAULT_TUNING,
  sanitizeTuning,
  type Tuning,
  createGame,
  createRng,
  MAX_TEAMS_TDM,
  planBot,
  plannedPaths,
  applyHack,
  applyRepair,
  botPredictActive,
  applyShieldRecharge,
  type Pose,
  resolveTurn,
  resultForTeam,
  sanitizeOrders,
  stateForTeam,
  type AsteroidMemory,
  type ClientMessage,
  type GameSettings,
  type GameState,
  type PlayerInfo,
  type RoomState,
  type RoomSummary,
  type ServerMessage,
  type ShipLoadout,
  type ShipOrders,
  type TurnEvent,
  applyScan,
  DEFAULT_MAP,
  generateMap,
  sanitizeMapSettings,
  type ModuleType,
  DEFAULT_LOADOUT,
  MODULE_TYPES,
  MODULES,
  hullLargePairs,
  freeSlots,
  hasFacing,
  allowedFacings,
  defaultFacing,
  type ModuleInstance,
  randomLoadout,
  refillLoadout,
  validateLoadout,
  normalizeShields,
  applyLoadoutTrade,
  moduleCost,
  settleLoadoutAfterBattle,
  needsBailout,
  bailoutLoadout,
  moduleSellPrice,
  emptyLoadout,
  fleetPoints,
  validateFleet,
  HULLS,
  PILOTS,
  pilotList,
  sanitizePilots,
  PLACEMENTS,
  effectivePlacement,
  battleResult,
  currentBattle,
  isSeries,
  newBattle,
  sanitizeBattles,
  type SeriesBattleResult,
  type SeriesState,
} from "@wingfighter/shared";
import { savePilots } from "./pilot-store.ts";
import { randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { getSavedTuning, initialTuning, saveTuning } from "./tuning-store.ts";
import { deleteMap, getMap, listMaps, saveMap } from "./maps-store.ts";

export interface Client {
  id: string;
  sessionId: string;
  name: string;
  ws: WebSocket | null;
  roomCode: string | null;
}

interface RoomMember {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
  botLevel?: BotLevel;
  ready: boolean;
  /** Potvrzená připravenost v místnosti (false po každé vlastní změně, po změně nastavení a po návratu z bitvy). */
  lobbyReady?: boolean;
  /** Letka: jedna výbava na loď (součet lodních bodů = settings.shipPoints). */
  loadouts: ShipLoadout[];
  /** Bot: výbavu nastavil host ručně (přepíše výchozí/náhodnou při startu). */
  manualLoadout?: boolean;
  /** Zvolený startovní bod. */
  startIndex?: number;
  /** Velitel týmu (týmové ruční umístění). */
  commander?: boolean;
  /** Ekonomika mezi bitvami: kredity = rozpočet místnosti + vyděláno − utraceno. */
  earned: number;
  spent: number;
  /** Kredity při startu bitvy (rozdíl na konci = vyděláno). */
  walletAtStart?: number;
  /** Výbava při startu bitvy – u samostatné bitvy (bez série) se po konci vrátí beze změn. */
  loadoutsAtStart?: ShipLoadout[];
}

interface RunningGame {
  state: GameState;
  orders: Map<string, ShipOrders[]>;
  rng: ReturnType<typeof createRng>;
  /** Fog of war: paměť asteroidů každého týmu. */
  memory: Map<number, AsteroidMemory>;
  /** Události provedené hned při plánování (skener) – přidají se do výsledku příštího kola. */
  pendingEvents: TurnEvent[];
  /** Výbava a kredity už byly po bitvě zapsány členům. */
  settled?: boolean;
}

function memoryFor(g: RunningGame, team: number): AsteroidMemory {
  let m = g.memory.get(team);
  if (!m) g.memory.set(team, (m = new Map()));
  return m;
}

/** Tým hráče v běžící hře (v DM má každý vlastní). */
/** Ověří tvar sestavy od klienta (obsahová pravidla řeší validateLoadout). */
function cleanLoadout(raw: unknown): ShipLoadout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.hullId !== "string" || typeof r.pilotId !== "string" || !Array.isArray(r.modules)) return null;
  const modules: ShipLoadout["modules"] = [];
  for (const m of r.modules as unknown[]) {
    if (!m || typeof m !== "object") return null;
    const mm = m as Record<string, unknown>;
    if (typeof mm.id !== "string" || typeof mm.type !== "string" || typeof mm.slot !== "string") return null;
    if (!MODULE_TYPES.includes(mm.type as ModuleType)) return null;
    const def = MODULES[mm.type as ModuleType];
    const facing = typeof mm.facing === "string" ? (mm.facing as ShipLoadout["modules"][number]["facing"]) : undefined;
    const ammo = def.ammo === undefined ? undefined : typeof mm.ammo === "number" && Number.isFinite(mm.ammo) ? Math.max(0, Math.min(def.ammo, Math.round(mm.ammo))) : def.ammo;
    // sklad munice: zásoba po druzích (jen čísla; kapacitu a cenu hlídá obchod)
    const rawStore = mm.type === "ammostore" && mm.store && typeof mm.store === "object" ? (mm.store as Record<string, unknown>) : undefined;
    const store = rawStore ? Object.fromEntries(AMMO_TYPES.filter((t) => typeof rawStore[t] === "number" && Number.isFinite(rawStore[t] as number)).map((t) => [t, Math.max(0, Math.round(rawStore[t] as number))])) : undefined;
    modules.push({ id: mm.id.slice(0, 32), type: mm.type as ModuleType, slot: mm.slot as ShipLoadout["modules"][number]["slot"], ammo, facing, ...(mm.off === true ? { off: true } : {}), ...(mm.repair === true ? { repair: true } : {}), ...(store && Object.keys(store).length ? { store } : {}) });
  }
  if (modules.length > 8) return null;
  let cargo: ShipLoadout["cargo"];
  if (Array.isArray(r.cargo)) {
    cargo = [];
    for (const m of r.cargo as unknown[]) {
      if (!m || typeof m !== "object") return null;
      const mm = m as Record<string, unknown>;
      if (typeof mm.id !== "string" || typeof mm.type !== "string" || !MODULE_TYPES.includes(mm.type as ModuleType)) return null;
      const def = MODULES[mm.type as ModuleType];
      const ammo = def.ammo === undefined ? undefined : typeof mm.ammo === "number" && Number.isFinite(mm.ammo) ? Math.max(0, Math.min(def.ammo, Math.round(mm.ammo))) : def.ammo;
      const rawStore = mm.type === "ammostore" && mm.store && typeof mm.store === "object" ? (mm.store as Record<string, unknown>) : undefined;
      const store = rawStore ? Object.fromEntries(AMMO_TYPES.filter((t) => typeof rawStore[t] === "number" && Number.isFinite(rawStore[t] as number)).map((t) => [t, Math.max(0, Math.round(rawStore[t] as number))])) : undefined;
      cargo.push({ id: mm.id.slice(0, 32), type: mm.type as ModuleType, slot: "front", ammo, ...(store && Object.keys(store).length ? { store } : {}) });
    }
    if (cargo.length > 8) return null;
  }
  return { hullId: r.hullId, pilotId: r.pilotId, modules, cargo: cargo?.length ? cargo : undefined };
}

function teamOf(g: RunningGame, playerId: string): number {
  return g.state.players.find((p) => p.id === playerId)?.team ?? 0;
}

class Room {
  code: string;
  name: string;
  hostId: string;
  settings: GameSettings = { mode: "tdm", turnLimit: 0, shipPoints: 1, teams: 2, allowedModules: {}, allowedHulls: {}, allowedPilots: {}, botLoadout: "random", map: { ...DEFAULT_MAP, seed: Math.floor(Math.random() * 100000) } };
  tuning: Tuning = initialTuning();
  /** Odehrané bitvy série (prázdné = série nezačala / jedna bitva). */
  seriesResults: SeriesBattleResult[] = [];
  members = new Map<string, RoomMember>();
  game: RunningGame | null = null;
  /** Host dokončil nastavení → ostatní se mohou připojit. */
  open = false;

  constructor(code: string, name: string, hostId: string) {
    this.code = code;
    this.name = name;
    this.hostId = hostId;
  }

  humans(): RoomMember[] {
    return [...this.members.values()].filter((m) => !m.isBot);
  }

  seriesState(): SeriesState | undefined {
    if (!isSeries(this.settings)) return undefined;
    const total = this.settings.battles!.length;
    const played = Math.min(this.seriesResults.length, total);
    return { total, played, results: this.seriesResults.slice(0, total), finished: played >= total };
  }

  /** Mapa / limit kol / umístění v nastavení = bitva, která se bude hrát (série: podle odehraných). */
  syncBattle(): void {
    const b = currentBattle(this.settings, this.seriesResults.length);
    this.settings.map = b.map;
    this.settings.turnLimit = b.turnLimit;
    this.settings.placement = b.placement;
  }

  /** Každý tým má právě jednoho velitele: stávající, pokud je pořád v týmu (a není bot, když je v týmu člověk), jinak první člověk, jinak první bot. */
  refreshCommanders(): void {
    const all = [...this.members.values()];
    const teams = new Set(all.map((m) => m.team));
    for (const team of teams) {
      const members = all.filter((m) => m.team === team);
      const hasHuman = members.some((m) => !m.isBot);
      let cmd = members.find((m) => m.commander && (!hasHuman || !m.isBot));
      if (!cmd) cmd = members.find((m) => !m.isBot) ?? members[0];
      for (const m of members) m.commander = m === cmd;
    }
    // týmové ruční umístění: startovní bod má jen velitel
    if (effectivePlacement(this.settings) === "teamManual") for (const m of all) if (!m.commander) m.startIndex = undefined;
  }

  /** Předání velení: zvolený startovní bod týmu přejde na nového velitele. */
  passCommand(to: RoomMember): void {
    const old = [...this.members.values()].find((m) => m.team === to.team && m.commander);
    if (old && old !== to) {
      to.startIndex = old.startIndex;
      old.startIndex = undefined;
      old.commander = false;
    }
    to.commander = true;
  }

  toState(clients: Map<string, Client>): RoomState {
    return {
      code: this.code,
      name: this.name,
      hostId: this.hostId,
      settings: this.settings,
      tuning: this.tuning,
      savedTuning: getSavedTuning(),
      inGame: !!this.game,
      open: this.open,
      pilots: pilotList(),
      series: this.seriesState(),
      players: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        team: m.team,
        isBot: m.isBot,
        botLevel: m.isBot ? (m.botLevel ?? "kadet") : undefined,
        ready: m.ready,
        lobbyReady: m.isBot || m.id === this.hostId || !!m.lobbyReady,
        loadout: m.loadouts[0],
        loadouts: m.loadouts,
        startIndex: m.startIndex,
        commander: m.commander,
        credits: m.isBot ? undefined : this.walletOf(m),
        connected: m.isBot ? true : !!clients.get(m.id)?.ws,
      })),
    };
  }

  /** Nová letka hráče: jedna loď s výchozí sestavou; další si hráč přidá sám (lodní body jsou strop). */
  newFleet(): ShipLoadout[] {
    return [structuredClone(DEFAULT_LOADOUT)];
  }

  /**
   * Letka po změně trupu jedné lodi (idx): větší trup vytlačí prázdné lodě od konce, menší doplní prázdné stíhače.
   * Vrací upravenou letku, nebo text chyby, když se body nevejdou ani po odebrání prázdných lodí.
   */
  fitFleet(loadouts: ShipLoadout[], idx: number): ShipLoadout[] | string {
    const out = loadouts.map((l) => l);
    while (fleetPoints(out) > this.settings.shipPoints) {
      let j = -1;
      for (let i = out.length - 1; i >= 0; i--) if (i !== idx && out[i].modules.length === 0 && !(out[i].cargo?.length)) { j = i; break; }
      if (j < 0) break;
      out.splice(j, 1);
    }
    if (fleetPoints(out) > this.settings.shipPoints) return `příliš mnoho lodních bodů (${fleetPoints(out)}/${this.settings.shipPoints}) – nejdřív odeber nebo prodej jinou loď letky`;
    return out;
  }

  /** Po snížení lodních bodů: letky členů oříznout (moduly odebraných lodí se prodají). */
  resizeFleets(): void {
    for (const m of this.members.values()) {
      if (m.isBot) continue;
      while (fleetPoints(m.loadouts) > this.settings.shipPoints && m.loadouts.length > 1) {
        const gone = m.loadouts.pop()!;
        m.spent -= [...gone.modules, ...(gone.cargo ?? [])].reduce((s, mod) => s + moduleSellPrice(mod), 0);
      }
    }
  }

  /** Kredity člena: rozpočet místnosti + vyděláno v bitvách − utraceno za výbavu. */
  walletOf(m: RoomMember): number {
    return Math.round(this.tuning.startBudget + m.earned - m.spent);
  }

  toSummary(): RoomSummary {
    return { code: this.code, name: this.name, players: this.members.size, inGame: !!this.game, open: this.open };
  }
}

const DEFAULT_NAMES = ["Pilot"];
const BOT_NAMES = ["Rex", "Nova", "Kael", "Zara", "Orin", "Vex", "Lyra", "Dax", "Mira", "Juno"];

export class Hub {
  clients = new Map<string, Client>();
  rooms = new Map<string, Room>();
  /** Identifikace sestavení klienta (název hlavního skriptu v dist/index.html) – klient se starší verzí se sám obnoví. Čte se při každém připojení (dist se může přebudovat za běhu). */
  clientBuild: () => string = () => "";

  /* ---------------- připojení ---------------- */

  connect(ws: WebSocket): Client {
    const client: Client = { id: randomUUID(), sessionId: randomUUID(), name: DEFAULT_NAMES[0], ws, roomCode: null };
    return client;
  }

  /** Zpracuje "hello": buď obnoví sezení, nebo zaregistruje nového hráče. */
  hello(temp: Client, msg: { name: string; sessionId?: string }): Client {
    let client = temp;
    if (msg.sessionId) {
      const existing = [...this.clients.values()].find((c) => c.sessionId === msg.sessionId);
      if (existing) {
        existing.ws = temp.ws;
        client = existing;
      }
    }
    client.name = cleanName(msg.name) || client.name;
    this.clients.set(client.id, client);
    this.send(client, { type: "welcome", playerId: client.id, sessionId: client.sessionId, name: client.name, build: this.clientBuild() || undefined });
    const room = client.roomCode ? this.rooms.get(client.roomCode) : undefined;
    if (room) {
      const member = room.members.get(client.id);
      if (member) member.name = client.name;
      this.broadcastRoom(room);
      if (room.game) {
        const g = room.game;
        this.send(client, { type: "gameState", state: stateForTeam(g.state, teamOf(g, client.id), memoryFor(g, teamOf(g, client.id))), ready: this.readyList(room), alive: this.aliveList(room) });
      }
    } else {
      client.roomCode = null;
      this.sendRooms(client);
    }
    return client;
  }

  disconnect(client: Client) {
    client.ws = null;
    const room = client.roomCode ? this.rooms.get(client.roomCode) : undefined;
    if (!room) {
      this.clients.delete(client.id);
      return;
    }
    if (!room.game) {
      // v lobby odpojeného hráče rovnou odebereme
      this.leaveRoom(client);
      this.clients.delete(client.id);
    } else {
      // ve hře necháme místo pro návrat; nečekáme na jeho rozkazy
      this.broadcastRoom(room);
      this.maybeResolve(room);
    }
  }

  /* ---------------- zprávy ---------------- */

  handle(client: Client, msg: ClientMessage) {
    const room = client.roomCode ? this.rooms.get(client.roomCode) : undefined;
    switch (msg.type) {
      case "hello":
        return; // řeší se zvlášť
      case "setName": {
        client.name = cleanName(msg.name) || client.name;
        if (room) {
          const m = room.members.get(client.id);
          if (m) m.name = client.name;
          this.broadcastRoom(room);
        }
        this.send(client, { type: "welcome", playerId: client.id, sessionId: client.sessionId, name: client.name, build: this.clientBuild() || undefined });
        return;
      }
      case "listRooms":
        return this.sendRooms(client);
      case "createRoom": {
        if (room) this.leaveRoom(client);
        const code = this.newCode();
        const r = new Room(code, cleanName(msg.name) || `Místnost ${client.name}`, client.id);
        this.rooms.set(code, r);
        r.members.set(client.id, { id: client.id, name: client.name, team: 0, isBot: false, ready: false, loadouts: r.newFleet(), earned: 0, spent: moduleCost(DEFAULT_LOADOUT) });
        client.roomCode = code;
        this.broadcastRoom(r);
        this.broadcastRooms();
        return;
      }
      case "joinRoom": {
        const r = this.rooms.get(msg.code.trim().toUpperCase());
        if (!r) return this.error(client, "Místnost s tímto kódem neexistuje.");
        if (r.game) return this.error(client, "V této místnosti už probíhá hra.");
        if (!r.open) return this.error(client, "Zakladatel ještě dokončuje nastavení místnosti. Zkus to za chvíli.");
        if (room && room !== r) this.leaveRoom(client);
        const team = r.settings.mode === "tdm" ? this.smallestTeam(r) : 0;
        r.members.set(client.id, { id: client.id, name: client.name, team, isBot: false, ready: false, loadouts: r.newFleet(), earned: 0, spent: moduleCost(DEFAULT_LOADOUT) });
        client.roomCode = r.code;
        this.broadcastRoom(r);
        this.broadcastRooms();
        return;
      }
      case "leaveRoom":
        this.leaveRoom(client);
        this.sendRooms(client);
        return;
      case "setTeam": {
        if (!room || room.game) return;
        // host může přesunout kohokoli (i bota), hráč jen sebe
        const targetId = msg.playerId && room.hostId === client.id ? msg.playerId : client.id;
        const m = room.members.get(targetId);
        if (!m) return;
        m.team = clampInt(msg.team, 0, (room.settings.teams ?? 2) - 1);
        m.lobbyReady = false;
        this.broadcastRoom(room);
        return;
      }
      case "balanceTeams": {
        if (!room || room.game || room.hostId !== client.id) return;
        const n = room.settings.teams ?? 2;
        const members = [...room.members.values()];
        if (msg.shuffle) for (let i = members.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [members[i], members[j]] = [members[j], members[i]];
        } else members.sort((a, b) => fleetPoints(b.loadouts) - fleetPoints(a.loadouts));
        // greedy: každého dalšího do týmu s nejmenším součtem lodních bodů
        const sums = Array.from({ length: n }, () => 0);
        for (const m of members) {
          let best = 0;
          for (let t = 1; t < n; t++) if (sums[t] < sums[best]) best = t;
          m.team = best;
          m.lobbyReady = false;
          sums[best] += fleetPoints(m.loadouts);
        }
        this.broadcastRoom(room);
        return;
      }
      case "setStart": {
        if (!room || room.game || !room.settings.map) return;
        const targetId = msg.botId ?? client.id;
        const m = room.members.get(targetId);
        if (!m) return;
        if (msg.botId && (room.hostId !== client.id || !m.isBot)) return;
        const placement = effectivePlacement(room.settings);
        if (placement === "random" || placement === "teamRandom") return this.error(client, "Startovní body se rozdělí náhodně při startu bitvy.");
        if (placement === "teamManual") {
          room.refreshCommanders();
          if (!m.commander) return this.error(client, "Startovní bod týmu vybírá velitel (★).");
        }
        if (msg.index === null) {
          m.startIndex = undefined;
        } else {
          const n = generateMap(room.settings.map).starts.length;
          const i = clampInt(msg.index, 0, Math.max(0, n - 1));
          if ([...room.members.values()].some((o) => o.id !== m.id && o.startIndex === i)) return this.error(client, "Tenhle startovní bod už někdo má.");
          m.startIndex = i;
        }
        m.lobbyReady = false;
        this.broadcastRoom(room);
        return;
      }
      case "setCommander": {
        if (!room || room.game) return;
        const target = room.members.get(msg.playerId);
        if (!target) return;
        room.refreshCommanders();
        const me = room.members.get(client.id);
        const myCommand = !!me?.commander && me.team === target.team;
        if (room.hostId !== client.id && !myCommand) return this.error(client, "Velení může předat jen host nebo velitel týmu.");
        room.passCommand(target);
        this.broadcastRoom(room);
        return;
      }
      case "setLoadout": {
        if (!room || room.game) return;
        const targetId = msg.botId ?? client.id;
        const m = room.members.get(targetId);
        if (!m) return;
        if (msg.botId && (room.hostId !== client.id || !m.isBot)) return;
        const lo = cleanLoadout(msg.loadout);
        if (!lo) return this.error(client, "Neplatná výbava.");
        const idx = clampInt(msg.index ?? 0, 0, m.loadouts.length - 1);
        if (m.isBot) {
          // bot: výbava zdarma (jen platnost a rozpočet)
          const err = validateLoadout(lo, { allowed: room.settings.allowedModules, budget: room.tuning.startBudget });
          if (err) return this.error(client, `Výbava: ${err}.`);
          const next = [...m.loadouts];
          next[idx] = normalizeShields(lo);
          const fit = room.fitFleet(next, idx);
          if (typeof fit === "string") return this.error(client, `Letka: ${fit}.`);
          m.loadouts = fit;
          m.manualLoadout = true;
        } else {
          // hráč: změna je obchod – nákup, prodej, dokoupení munice z kreditů (jedna peněženka pro celou letku)
          const trade = applyLoadoutTrade(m.loadouts[idx], normalizeShields(lo));
          if (trade.error) return this.error(client, `Výbava: ${trade.error}.`);
          const err = validateLoadout(trade.loadout, { allowed: room.settings.allowedModules });
          if (err) return this.error(client, `Výbava: ${err}.`);
          if (room.settings.allowedHulls?.[trade.loadout.hullId] === 0) return this.error(client, `${HULLS[trade.loadout.hullId]?.name ?? trade.loadout.hullId}: v této hře zakázán.`);
          if (room.settings.allowedPilots?.[trade.loadout.pilotId] === 0) return this.error(client, `${PILOTS[trade.loadout.pilotId]?.name ?? trade.loadout.pilotId}: v této hře zakázán.`);
          const pilot = PILOTS[trade.loadout.pilotId];
          if (pilot?.unique && m.loadouts.some((l, i) => i !== idx && l.pilotId === pilot.id)) return this.error(client, `${pilot.name} může být v letce jen jednou.`);
          if (trade.cost > room.walletOf(m)) return this.error(client, `Nedostatek kreditů (potřeba ${trade.cost}, máš ${room.walletOf(m)}).`);
          const next = [...m.loadouts];
          next[idx] = trade.loadout;
          const fit = room.fitFleet(next, idx);
          if (typeof fit === "string") return this.error(client, `Letka: ${fit}.`);
          m.spent += trade.cost;
          m.loadouts = fit;
          m.lobbyReady = false;
        }
        this.broadcastRoom(room);
        return;
      }
      case "addShip": {
        if (!room || room.game) return;
        const targetId = msg.botId ?? client.id;
        const m = room.members.get(targetId);
        if (!m) return;
        if (msg.botId && (room.hostId !== client.id || !m.isBot)) return;
        const hull = HULLS[String(msg.hullId)];
        if (!hull) return this.error(client, "Neznámý trup.");
        if (room.settings.allowedHulls?.[hull.id] === 0) return this.error(client, `${hull.name}: v této hře zakázán.`);
        if (fleetPoints(m.loadouts) + hull.points > room.settings.shipPoints) return this.error(client, `${hull.name} se nevejde do lodních bodů (${fleetPoints(m.loadouts)} + ${hull.points} > ${room.settings.shipPoints}).`);
        m.loadouts.push(emptyLoadout(hull.id));
        if (m.isBot) m.manualLoadout = true;
        else m.lobbyReady = false;
        this.broadcastRoom(room);
        return;
      }
      case "removeShip": {
        if (!room || room.game) return;
        const targetId = msg.botId ?? client.id;
        const m = room.members.get(targetId);
        if (!m) return;
        if (msg.botId && (room.hostId !== client.id || !m.isBot)) return;
        if (m.loadouts.length <= 1) return this.error(client, "Letka musí mít aspoň jednu loď.");
        const idx = clampInt(msg.index, 0, m.loadouts.length - 1);
        const [gone] = m.loadouts.splice(idx, 1);
        // moduly odebrané lodi se prodají (bot má výbavu zdarma)
        if (!m.isBot) m.spent -= [...gone.modules, ...(gone.cargo ?? [])].reduce((s, mod) => s + moduleSellPrice(mod), 0);
        if (m.isBot) m.manualLoadout = true;
        else m.lobbyReady = false;
        this.broadcastRoom(room);
        return;
      }
      case "moveModule": {
        if (!room || room.game) return;
        const targetId = msg.botId ?? client.id;
        const m = room.members.get(targetId);
        if (!m) return;
        if (msg.botId && (room.hostId !== client.id || !m.isBot)) return;
        const from = clampInt(msg.fromIndex, 0, m.loadouts.length - 1);
        const to = clampInt(msg.toIndex, 0, m.loadouts.length - 1);
        if (from === to) return;
        const src = m.loadouts[from];
        const dst = m.loadouts[to];
        const mod = src.modules.find((x) => x.id === msg.moduleId);
        if (!mod) return this.error(client, "Přesun: modul nenalezen.");
        const def = MODULES[mod.type];
        const slot = def.size === "large" ? hullLargePairs(HULLS[dst.hullId]).find((p) => p.every((s) => freeSlots(dst).includes(s)))?.[0] : freeSlots(dst)[0];
        if (!slot) return this.error(client, `Přesun: loď ${to + 1} nemá volný slot.`);
        const moved: ModuleInstance = { ...mod, slot, facing: hasFacing(mod.type) ? (mod.facing && allowedFacings(mod.type, slot).includes(mod.facing) ? mod.facing : defaultFacing(mod.type, slot)) : undefined };
        const nextSrc = normalizeShields({ ...src, modules: src.modules.filter((x) => x.id !== mod.id) });
        const nextDst = normalizeShields({ ...dst, modules: [...dst.modules, moved] });
        const err = validateLoadout(nextDst, { allowed: room.settings.allowedModules }) ?? validateLoadout(nextSrc, { allowed: room.settings.allowedModules });
        if (err) return this.error(client, `Přesun: ${err}.`);
        m.loadouts[from] = nextSrc;
        m.loadouts[to] = nextDst;
        if (!m.isBot) m.lobbyReady = false;
        this.broadcastRoom(room);
        return;
      }
      case "addBot": {
        if (!room || room.game || room.hostId !== client.id) return;
        if (room.members.size >= 12) return this.error(client, "Místnost je plná.");
        const id = `bot-${randomBytes(3).toString("hex")}`;
        const used = new Set([...room.members.values()].map((m) => m.name));
        const name = BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? randomBytes(2).toString("hex");
        const level: BotLevel = msg.level === "pilot" || msg.level === "eso" ? msg.level : "kadet";
        room.members.set(id, { id, name: `Bot ${name}`, team: clampInt(msg.team, 0, (room.settings.teams ?? 2) - 1), isBot: true, botLevel: level, ready: true, loadouts: this.botFleet(room), earned: 0, spent: 0 });
        this.broadcastRoom(room);
        this.broadcastRooms();
        return;
      }
      case "setBotLevel": {
        if (!room || room.game || room.hostId !== client.id) return;
        const bm = room.members.get(msg.botId);
        if (!bm || !bm.isBot) return;
        bm.botLevel = msg.level === "pilot" || msg.level === "eso" ? msg.level : "kadet";
        this.broadcastRoom(room);
        return;
      }
      case "removeBot": {
        if (!room || room.game || room.hostId !== client.id) return;
        const m = room.members.get(msg.botId);
        if (m?.isBot) room.members.delete(msg.botId);
        this.broadcastRoom(room);
        this.broadcastRooms();
        return;
      }
      case "setSettings": {
        if (!room || room.game || room.hostId !== client.id) return;
        const s = msg.settings;
        if (s.mode === "tdm" || s.mode === "dm") room.settings.mode = s.mode;
        if ("battles" in s) {
          const fallback = currentBattle(room.settings, 0);
          const list = sanitizeBattles(s.battles, room.settings.battles, fallback);
          const prevCount = room.settings.battles?.length ?? 0;
          if (list) room.settings.battles = list;
          else delete room.settings.battles;
          // změna počtu bitev = nová série
          if ((room.settings.battles?.length ?? 0) !== prevCount) room.seriesResults = [];
        }
        const series = isSeries(room.settings);
        if (typeof s.turnLimit === "number" && !series) room.settings.turnLimit = clampInt(s.turnLimit, 0, 99);
        if (typeof s.teams === "number") {
          room.settings.teams = clampInt(s.teams, 2, MAX_TEAMS_TDM);
          for (const m of room.members.values()) if (m.team >= room.settings.teams) m.team = 0;
        }
        if (typeof s.shipPoints === "number") {
          room.settings.shipPoints = clampInt(s.shipPoints, 1, 3);
          room.resizeFleets();
          for (const m of room.members.values()) if (m.isBot && !m.manualLoadout) m.loadouts = this.botFleet(room);
        }
        if (s.placement && PLACEMENTS.includes(s.placement) && !series) room.settings.placement = s.placement;
        if (s.botLoadout === "default" || s.botLoadout === "random" || s.botLoadout === "manual") {
          room.settings.botLoadout = s.botLoadout;
          for (const m of room.members.values()) if (m.isBot && !m.manualLoadout) m.loadouts = this.botFleet(room);
        }
        if (s.allowedHulls && typeof s.allowedHulls === "object") {
          const out: Partial<Record<string, number>> = {};
          for (const id of Object.keys(HULLS)) if ((s.allowedHulls as Record<string, unknown>)[id] === 0) out[id] = 0;
          if (Object.keys(HULLS).every((id) => out[id] === 0)) delete out[Object.keys(HULLS)[0]]; // aspoň jeden trup musí zůstat
          room.settings.allowedHulls = out;
        }
        if (s.allowedPilots && typeof s.allowedPilots === "object") {
          const out: Partial<Record<string, number>> = {};
          for (const id of Object.keys(PILOTS)) if ((s.allowedPilots as Record<string, unknown>)[id] === 0 && id !== "kadet") out[id] = 0; // Kadet vždy
          room.settings.allowedPilots = out;
        }
        if (s.map && typeof s.map === "object" && !series) {
          room.settings.map = sanitizeMapSettings(s.map, room.settings.map ?? DEFAULT_MAP);
          // startovní body se po změně mapy přepočítají – neplatné volby zrušit
          const n = generateMap(room.settings.map).starts.length;
          for (const m of room.members.values()) if (m.startIndex !== undefined && m.startIndex >= n) m.startIndex = undefined;
        }
        if (s.allowedModules && typeof s.allowedModules === "object") {
          const out: Partial<Record<ModuleType, number>> = {};
          for (const t of MODULE_TYPES) {
            const v = (s.allowedModules as Record<string, unknown>)[t];
            if (typeof v === "number" && Number.isFinite(v)) out[t] = clampInt(v, 0, 6);
          }
          room.settings.allowedModules = out;
        }
        for (const m of room.members.values()) m.lobbyReady = false;
        this.broadcastRoom(room);
        return;
      }
      case "setPilots": {
        if (!room || room.hostId !== client.id) return;
        const list = sanitizePilots(msg.pilots);
        if (!list) return this.error(client, "Neplatný seznam pilotů.");
        savePilots(list);
        // piloti, kteří zmizeli, se v letkách nahradí Kadetem
        for (const r of this.rooms.values()) {
          for (const m of r.members.values()) for (const l of m.loadouts) if (!PILOTS[l.pilotId]) l.pilotId = "kadet";
          this.broadcastRoom(r);
        }
        return;
      }
      case "setTuning":
      case "resetTuning":
      case "loadTuning": {
        if (!room || room.hostId !== client.id) return;
        if (msg.type === "loadTuning") {
          const saved = getSavedTuning();
          if (!saved) return this.error(client, "Na serveru nejsou žádné uložené parametry.");
          room.tuning = { ...saved };
        } else room.tuning = msg.type === "resetTuning" ? { ...DEFAULT_TUNING } : sanitizeTuning(msg.tuning, room.tuning);
        if (room.game) this.retune(room);
        this.broadcastRoom(room);
        return;
      }
      case "saveTuning": {
        if (!room || room.hostId !== client.id) return;
        try {
          saveTuning(room.tuning);
          this.send(client, { type: "notice", message: "Parametry uloženy (tuning.json) – platí pro všechny nové místnosti." });
          this.broadcastRoom(room);
        } catch (e) {
          console.error("Uložení tuning.json selhalo", e);
          this.error(client, "Uložení se nepodařilo.");
        }
        return;
      }
      case "listMaps":
        this.send(client, { type: "maps", maps: listMaps() });
        return;
      case "getMap":
        this.send(client, { type: "map", map: getMap(String(msg.id)) ?? null });
        return;
      case "saveMap": {
        const res = saveMap(msg.map, client.name);
        if (res.error || !res.map) return this.error(client, `Mapu se nepodařilo uložit: ${res.error ?? "?"}.`);
        this.send(client, { type: "map", map: res.map, saved: true });
        // seznam map se změnil – všem (lobby i editor)
        this.broadcastAll({ type: "maps", maps: listMaps() });
        return;
      }
      case "deleteMap": {
        const m = getMap(String(msg.id));
        if (!m) return;
        // mazat smí autor (podle jména) nebo kdokoliv, když autor není znám
        if (m.author && m.author !== client.name) return this.error(client, `Mapu může smazat jen její autor (${m.author}).`);
        deleteMap(m.id);
        this.broadcastAll({ type: "maps", maps: listMaps() });
        return;
      }
      case "openRoom": {
        if (!room || room.game || room.hostId !== client.id) return;
        room.open = !!msg.open;
        for (const m of room.members.values()) m.lobbyReady = false;
        this.broadcastRoom(room);
        this.broadcastRooms();
        return;
      }
      case "setLobbyReady": {
        if (!room || room.game || !room.open) return;
        const m = room.members.get(client.id);
        if (!m) return;
        if (msg.ready) {
          const err = validateFleet(m.loadouts, room.settings);
          if (err) return this.error(client, `Letka: ${err}.`);
        }
        m.lobbyReady = !!msg.ready;
        this.broadcastRoom(room);
        return;
      }
      case "startGame":
        if (!room || room.hostId !== client.id || room.game || !room.open) return;
        return this.startGame(room, client);
      case "submitOrders": {
        if (!room?.game) return;
        const m = room.members.get(client.id);
        if (!m) return;
        room.game.orders.set(client.id, sanitizeOrders(room.game.state, client.id, Array.isArray(msg.orders) ? msg.orders : []));
        m.ready = true;
        this.broadcastPlanning(room);
        this.maybeResolve(room);
        return;
      }
      case "scan": {
        if (!room?.game) return;
        const g = room.game;
        if (g.state.status === "finished") return;
        const ship = g.state.ships.find((x) => x.id === msg.shipId && x.ownerId === client.id && x.alive);
        if (!ship) return this.error(client, "Skener: to není tvoje loď.");
        const team = teamOf(g, client.id);
        if (msg.mode === "ship") {
          const visible = stateForTeam(g.state, team, memoryFor(g, team)).ships.some((x) => x.id === msg.targetId && x.alive);
          if (!visible) return this.error(client, "Skener: cíl není v dohledu.");
        }
        const res = applyScan(g.state, ship, String(msg.moduleId), msg.mode, msg.targetId);
        if (res.error) return this.error(client, `Skener: ${res.error}.`);
        g.pendingEvents.push({ type: "scan", shipId: ship.id, mode: msg.mode, targetId: res.target?.id });
        if (res.target) this.send(client, { type: "scanResult", shooterId: ship.id, ship: structuredClone(res.target) });
        if (msg.mode === "predict") this.sendBotPlans(room, client.id);
        // nový stav všem (náboje, odkrytá mapa pro tým)
        for (const m of room.members.values()) {
          if (m.isBot) continue;
          const c = this.clients.get(m.id);
          if (!c) continue;
          const t = teamOf(g, m.id);
          this.send(c, { type: "gameState", state: stateForTeam(g.state, t, memoryFor(g, t)), ready: this.readyList(room), alive: this.aliveList(room) });
        }
        return;
      }
      case "rechargeShield": {
        if (!room?.game) return;
        const g = room.game;
        if (g.state.status === "finished") return;
        const ship = g.state.ships.find((x) => x.id === msg.shipId && x.ownerId === client.id && x.alive);
        if (!ship) return this.error(client, "Dobití štítu: to není tvoje loď.");
        const res = applyShieldRecharge(g.state, ship, Array.isArray(msg.segments) ? msg.segments.map(Number) : undefined);
        if (res.error) return this.error(client, `Dobití štítu: ${res.error}.`);
        g.pendingEvents.push(res.event!);
        for (const m of room.members.values()) {
          if (m.isBot) continue;
          const c = this.clients.get(m.id);
          if (!c) continue;
          const t = teamOf(g, m.id);
          this.send(c, { type: "gameState", state: stateForTeam(g.state, t, memoryFor(g, t)), ready: this.readyList(room), alive: this.aliveList(room) });
        }
        return;
      }
      case "repair": {
        if (!room?.game) return;
        const g = room.game;
        if (g.state.status === "finished") return;
        const ship = g.state.ships.find((x) => x.id === msg.shipId && x.ownerId === client.id && x.alive);
        if (!ship) return this.error(client, "Opravář: to není tvoje loď.");
        const ord = msg.order;
        if (!ord || typeof ord !== "object" || !["module", "ammo", "hull", "install", "uninstall", "move", "auto"].includes((ord as { kind?: string }).kind ?? "")) return this.error(client, "Opravář: neplatný úkon.");
        const res = applyRepair(g.state, ship, ord);
        if (res.error) return this.error(client, `Opravář: ${res.error}.`);
        g.pendingEvents.push(res.event!);
        for (const m of room.members.values()) {
          if (m.isBot) continue;
          const c = this.clients.get(m.id);
          if (!c) continue;
          const t = teamOf(g, m.id);
          this.send(c, { type: "gameState", state: stateForTeam(g.state, t, memoryFor(g, t)), ready: this.readyList(room), alive: this.aliveList(room) });
        }
        return;
      }
      case "hack": {
        if (!room?.game) return;
        const g = room.game;
        if (g.state.status === "finished") return;
        const ship = g.state.ships.find((x) => x.id === msg.shipId && x.ownerId === client.id && x.alive);
        if (!ship) return this.error(client, "Hacker: to není tvoje loď.");
        const ord = msg.order;
        if (!ord || typeof ord !== "object" || !["mine", "torpedo", "module"].includes((ord as { kind?: string }).kind ?? "")) return this.error(client, "Hacker: neplatný úkon.");
        const team = teamOf(g, client.id);
        const res = applyHack(g.state, stateForTeam(g.state, team, memoryFor(g, team)), ship, ord);
        if (res.error) return this.error(client, `Hacker: ${res.error}.`);
        g.pendingEvents.push(res.event!);
        for (const m of room.members.values()) {
          if (m.isBot) continue;
          const c = this.clients.get(m.id);
          if (!c) continue;
          const t = teamOf(g, m.id);
          this.send(c, { type: "gameState", state: stateForTeam(g.state, t, memoryFor(g, t)), ready: this.readyList(room), alive: this.aliveList(room) });
        }
        return;
      }
      case "unready": {
        if (!room?.game) return;
        const m = room.members.get(client.id);
        if (!m) return;
        m.ready = false;
        room.game.orders.delete(client.id);
        this.broadcastPlanning(room);
        return;
      }
      case "backToLobby": {
        if (!room || room.hostId !== client.id) return;
        this.settleBattle(room);
        room.game = null;
        for (const m of room.members.values()) {
          m.ready = m.isBot;
          m.lobbyReady = false;
        }
        // odpojené hráče vyhodíme
        for (const m of [...room.members.values()]) {
          if (!m.isBot && !this.clients.get(m.id)?.ws) {
            room.members.delete(m.id);
            this.clients.delete(m.id);
          }
        }
        this.broadcastRoom(room);
        this.broadcastRooms();
        return;
      }
    }
  }

  /* ---------------- hra ---------------- */

  private startGame(room: Room, host: Client) {
    const members = [...room.members.values()];
    const ss = room.seriesState();
    if (ss?.finished) {
      // nová série: stejné nastavení, nové seedy map
      room.seriesResults = [];
      room.settings.battles = room.settings.battles!.map((b) => newBattle(b));
    }
    room.syncBattle();
    if (members.length < 2) return this.error(host, "Potřebujete alespoň dva hráče (nebo bota).");
    const notReady = members.filter((m) => !m.isBot && m.id !== host.id && !m.lobbyReady);
    if (notReady.length) return this.error(host, `Ještě nejsou připraveni: ${notReady.map((m) => m.name).join(", ")}.`);
    if (room.settings.mode === "tdm" && new Set(members.map((m) => m.team)).size < 2) {
      return this.error(host, "V týmovém módu musí být obsazené alespoň dva týmy.");
    }
    for (const m of members) {
      if (m.isBot && !m.manualLoadout) m.loadouts = this.botFleet(room);
      const err = validateFleet(m.loadouts, room.settings, m.isBot ? room.tuning.startBudget : undefined);
      if (err) return this.error(host, `${m.name} – letka: ${err}.`);
      if (!m.isBot) m.walletAtStart = room.walletOf(m);
      m.loadoutsAtStart = structuredClone(m.loadouts);
    }
    const players: PlayerInfo[] = members.map((m) => ({ id: m.id, name: m.name, team: m.team, isBot: m.isBot, botLevel: m.isBot ? (m.botLevel ?? "kadet") : undefined, loadout: refillLoadout(m.loadouts[0]), loadouts: m.loadouts.map(refillLoadout), credits: m.isBot ? undefined : room.walletOf(m), startIndex: m.startIndex, commander: m.commander }));
    const customMap = room.settings.map?.customId ? getMap(room.settings.map.customId) : undefined;
    if (room.settings.map?.customId && !customMap) {
      this.error(host, "Vlastní mapa už na serveru není – vyber jinou.");
      return;
    }
    const state = createGame({ players, settings: room.settings, tuning: room.tuning, customMap });
    const rng = createRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    room.game = { state, orders: new Map(), rng, memory: new Map(), pendingEvents: [] };
    const g = room.game;
    for (const m of room.members.values()) m.ready = m.isBot;
    this.broadcastRoom(room);
    for (const m of room.members.values()) {
      if (m.isBot) continue;
      const c = this.clients.get(m.id);
      if (c) this.send(c, { type: "gameStart", state: stateForTeam(state, teamOf(g, m.id), memoryFor(g, teamOf(g, m.id))) });
    }
    this.broadcastRooms();
    this.planBots(room);
    this.broadcastPlanning(room); // panel hráčů: kdo má živou loď (i mimo dohled)
    this.maybeResolve(room);
  }

  /** Výbava bota podle nastavení místnosti. */
  /** Letka bota: tolik lodí, kolik je lodních bodů (každá podle nastavení výbavy botů). */
  private botFleet(room: Room): ShipLoadout[] {
    const out: ShipLoadout[] = [];
    while (fleetPoints(out) < room.settings.shipPoints) {
      const k = out.length;
      const lo = this.botLoadout(room, room.settings.shipPoints - fleetPoints(out));
      // id modulů musí být v letce unikátní
      lo.modules = lo.modules.map((m) => ({ ...m, id: `s${k}-${m.id}` }));
      out.push(lo);
    }
    return out;
  }

  private botLoadout(room: Room, pointsLeft = 1): ShipLoadout {
    applyTuning(room.tuning);
    const allowed = room.settings.allowedModules;
    if (room.settings.botLoadout === "random") {
      // s dostatkem bodů má bot šanci na bitevník (pokud je povolený)
      const hull = pointsLeft >= HULLS.battleship.points && room.settings.allowedHulls?.battleship !== 0 && Math.random() < 0.5 ? "battleship" : "fighter";
      return randomLoadout(Math.random, allowed, room.tuning.startBudget, hull);
    }
    // výchozí sestava ořezaná o zakázané moduly a rozpočet
    const lo = structuredClone(DEFAULT_LOADOUT);
    lo.modules = lo.modules.filter((m) => (allowed[m.type] ?? 99) > 0);
    while (lo.modules.reduce((sum, m) => sum + MODULES[m.type].price, 0) > room.tuning.startBudget && lo.modules.length) lo.modules.pop();
    return lo;
  }

  /** Změna parametrů během bitvy: přepočítá maxima lodí a rozešle nové hodnoty. */
  private retune(room: Room) {
    const g = room.game!;
    g.state.tuning = { ...room.tuning };
    applyTuning(g.state.tuning);
    for (const s of g.state.ships) {
      const stats = computeStats(s.loadout);
      s.stats = stats;
      s.hull = Math.min(s.hull, stats.hull);
      s.shields = Math.min(s.shields, stats.shields);
      s.stressPoints = Math.min(s.stressPoints, stats.stressMax);
    }
    this.broadcast(room, { type: "tuning", tuning: g.state.tuning });
  }

  private planBots(room: Room) {
    const g = room.game!;
    // dráhy spoluhráčů, které už jsou známé (odeslané rozkazy lidí i dřív naplánovaní boti) – ať si boti nelétají do cesty
    const teamPaths = new Map<number, Map<string, (t: number) => Pose>>();
    const pathsOf = (team: number) => {
      let m = teamPaths.get(team);
      if (!m) {
        m = new Map();
        for (const [pid, orders] of g.orders) {
          const owner = room.members.get(pid);
          if (owner?.team === team) for (const [id, p] of plannedPaths(g.state, orders)) m.set(id, p);
        }
        teamPaths.set(team, m);
      }
      return m;
    };
    for (const m of room.members.values()) {
      if (!m.isBot) continue;
      // bot nepodvádí: plánuje ze stavu svého týmu (mlha války), podle své obtížnosti
      const seen = stateForTeam(g.state, m.team, memoryFor(g, m.team));
      const allyPaths = pathsOf(m.team);
      const planned = planBot(seen, m.id, g.rng, m.botLevel ?? "kadet", { allyPaths });
      // dobití štítu technologií a úkony opraváře se provádí hned (jako u lidí), ne až při vyhodnocení
      for (const o of planned) {
        const ship = g.state.ships.find((x) => x.id === o.shipId && x.alive);
        if (!ship) continue;
        if (o.rechargeShield) {
          const res = applyShieldRecharge(g.state, ship, o.rechargeShield.segments);
          if (res.event) g.pendingEvents.push(res.event);
        }
        for (const r of o.repair ?? []) {
          const res = applyRepair(g.state, ship, r);
          if (res.event) g.pendingEvents.push(res.event);
        }
      }
      const orders = sanitizeOrders(g.state, m.id, planned);
      g.orders.set(m.id, orders);
      for (const [id, p] of plannedPaths(g.state, orders)) allyPaths.set(id, p);
      m.ready = true;
    }
    this.sendBotPlans(room);
  }

  /** Předpověď skeneru: hráčům s aktivní předpovědí pošle manévry nepřátelských botů, které jejich tým vidí. */
  private sendBotPlans(room: Room, onlyId?: string) {
    const g = room.game!;
    for (const m of room.members.values()) {
      if (m.isBot || (onlyId && m.id !== onlyId)) continue;
      if (!botPredictActive(g.state, m.id)) continue;
      const c = this.clients.get(m.id);
      if (!c) continue;
      const seen = stateForTeam(g.state, m.team, memoryFor(g, m.team));
      const plans: { shipId: string; maneuverId: string }[] = [];
      for (const [pid, orders] of g.orders) {
        const owner = room.members.get(pid);
        if (!owner?.isBot || owner.team === m.team) continue;
        for (const o of orders) if (seen.ships.some((x) => x.id === o.shipId && x.alive)) plans.push({ shipId: o.shipId, maneuverId: o.maneuverId });
      }
      this.send(c, { type: "botPlans", turn: g.state.turn, plans });
    }
  }

  /** Kdo musí ještě odeslat rozkazy: připojení lidé s živou lodí. */
  private waitingFor(room: Room): RoomMember[] {
    const g = room.game!;
    return [...room.members.values()].filter((m) => {
      if (m.isBot || m.ready) return false;
      if (!this.clients.get(m.id)?.ws) return false;
      return g.state.ships.some((s) => s.alive && s.ownerId === m.id);
    });
  }

  private readyList(room: Room): string[] {
    return [...room.members.values()].filter((m) => m.ready).map((m) => m.id);
  }

  /** Hráči s živou lodí – pro panel hráčů (klient cizí lodě mimo dohled nevidí, takže to sám nepozná). */
  private aliveList(room: Room): string[] {
    const g = room.game;
    if (!g) return [];
    return [...room.members.values()].filter((m) => g.state.ships.some((s) => s.alive && s.ownerId === m.id)).map((m) => m.id);
  }

  private maybeResolve(room: Room) {
    const g = room.game;
    if (!g || g.state.status === "finished") return;
    if (this.waitingFor(room).length > 0) return;
    const orders = [...g.orders.values()].flat();
    const prev = g.state;
    const result = resolveTurn(g.state, orders, g.rng);
    if (g.pendingEvents.length) {
      result.events.unshift(...g.pendingEvents);
      g.pendingEvents = [];
    }
    g.state = result.state;
    g.orders.clear();
    for (const m of room.members.values()) m.ready = m.isBot;
    // každý tým dostane jen to, co viděl
    const perTeam = new Map<number, ReturnType<typeof resultForTeam>>();
    for (const m of room.members.values()) {
      if (m.isBot) continue;
      const c = this.clients.get(m.id);
      if (!c) continue;
      const team = teamOf(g, m.id);
      let r = perTeam.get(team);
      if (!r) perTeam.set(team, (r = resultForTeam(result, prev, team, memoryFor(g, team))));
      this.send(c, { type: "turnResult", result: r });
    }
    if (g.state.status === "finished") {
      this.settleBattle(room);
      this.broadcastRoom(room); // stav série (výsledek bitvy) pro přehled v závěrečném okně
    }
    if (g.state.status !== "finished") {
      this.planBots(room);
      // nový seznam připravených/živých pro panel hráčů (kdo padl, už nic neposílá)
      this.broadcastPlanning(room);
      // pokud už nikdo nemusí nic poslat (např. všichni lidé odpojeni), pokračujeme automaticky
      if (this.waitingFor(room).length === 0 && room.humans().some((m) => this.clients.get(m.id)?.ws)) {
        setTimeout(() => this.maybeResolve(room), 3000);
      } else if (this.waitingFor(room).length === 0) {
        // nikdo není připojen – nic nevyhodnocujeme, hra počká
      }
    }
  }

  /**
   * Po bitvě (konec nebo předčasný návrat): hráčům zůstane výbava z lodi (munice, zničené moduly, náklad),
   * poškozené moduly se opraví, moduly ve vraku zničené lodi jsou zničené (prodej za zlomek); kredity z bitvy se připíší.
   */
  private settleBattle(room: Room) {
    const g = room.game;
    if (!g || g.settled) return;
    g.settled = true;
    if (!isSeries(room.settings)) {
      // samostatná bitva: všem (hráčům i ručně vybaveným botům) se vrátí výbava, munice, životy modulů,
      // náklad, pilot i peněženka přesně do stavu před bitvou – jako by se nestala
      for (const m of room.members.values()) {
        if (m.loadoutsAtStart) m.loadouts = structuredClone(m.loadoutsAtStart);
        m.loadoutsAtStart = undefined;
        m.walletAtStart = undefined;
      }
      return;
    }
    if (room.seriesResults.length < room.settings.battles!.length) room.seriesResults.push(battleResult(g.state, room.seriesResults.length));
    for (const m of room.members.values()) {
      m.loadoutsAtStart = undefined;
      if (m.isBot) continue;
      const mine = g.state.ships.filter((s) => s.ownerId === m.id);
      if (mine.length) {
        m.loadouts = mine.map((ship) => {
          const lo = structuredClone(ship.loadout);
          if (!ship.alive) {
            // vrak: co nevypadlo, je zničené; pilot zahynul → příště Kadet
            for (const mod of [...lo.modules, ...(lo.cargo ?? [])]) mod.hp = 0;
            lo.pilotId = "kadet";
          }
          return settleLoadoutAfterBattle(lo);
        });
      }
      const p = g.state.players.find((x) => x.id === m.id);
      if (p && p.credits !== undefined && m.walletAtStart !== undefined) m.earned += p.credits - m.walletAtStart;
      m.walletAtStart = undefined;
      // krach: bez funkčních modulů a bez kreditů → startovní loď zdarma (zničené zbytky se automaticky prodají)
      const allMods = m.loadouts.flatMap((l) => [...l.modules, ...(l.cargo ?? [])]);
      if (needsBailout({ ...m.loadouts[0], modules: allMods, cargo: undefined }, room.walletOf(m))) {
        const scrap = allMods.reduce((s, mod) => s + moduleSellPrice(mod), 0);
        m.spent -= scrap;
        m.loadouts = m.loadouts.map((l, i) => (i === 0 ? bailoutLoadout(l) : { ...emptyLoadout(l.hullId), pilotId: l.pilotId }));
        const c = this.clients.get(m.id);
        if (c) this.send(c, { type: "notice", message: `Přišel jsi o všechno – dostáváš startovní loď zdarma (záchranná výbava nejde prodat). Kredity: ${room.walletOf(m)}.` });
      }
    }
  }

  /* ---------------- pomocné ---------------- */

  private leaveRoom(client: Client) {
    const room = client.roomCode ? this.rooms.get(client.roomCode) : undefined;
    client.roomCode = null;
    if (!room) return;
    room.members.delete(client.id);
    room.game?.orders.delete(client.id);
    if (room.humans().length === 0) {
      this.rooms.delete(room.code);
    } else {
      if (room.hostId === client.id) room.hostId = room.humans()[0].id;
      this.broadcastRoom(room);
      if (room.game) this.maybeResolve(room);
    }
    this.send(client, { type: "room", room: null });
    this.broadcastRooms();
  }

  private smallestTeam(room: Room): number {
    const n = room.settings.teams ?? 2;
    const counts = Array.from({ length: n }, () => 0);
    for (const m of room.members.values()) if (m.team < n) counts[m.team]++;
    let best = 0;
    for (let t = 1; t < n; t++) if (counts[t] < counts[best]) best = t;
    return best;
  }

  private newCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  send(client: Client, msg: ServerMessage) {
    if (client.ws && client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  error(client: Client, message: string) {
    this.send(client, { type: "error", message });
  }

  private broadcast(room: Room, msg: ServerMessage) {
    for (const m of room.members.values()) {
      const c = this.clients.get(m.id);
      if (c) this.send(c, msg);
    }
  }

  private broadcastRoom(room: Room) {
    room.syncBattle();
    room.refreshCommanders();
    this.broadcast(room, { type: "room", room: room.toState(this.clients) });
  }

  private broadcastPlanning(room: Room) {
    this.broadcast(room, { type: "planningStatus", ready: this.readyList(room), alive: this.aliveList(room) });
  }

  private roomList(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => r.toSummary());
  }

  private sendRooms(client: Client) {
    this.send(client, { type: "rooms", rooms: this.roomList() });
  }

  private broadcastRooms() {
    const msg: ServerMessage = { type: "rooms", rooms: this.roomList() };
    for (const c of this.clients.values()) if (!c.roomCode) this.send(c, msg);
  }

  /** Všem připojeným (seznam vlastních map). */
  private broadcastAll(msg: ServerMessage) {
    for (const c of this.clients.values()) this.send(c, msg);
  }
}

function cleanName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
}

function clampInt(v: number, lo: number, hi: number): number {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
