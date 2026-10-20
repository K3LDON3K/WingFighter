import {
  applyTuning,
  computeStats,
  DEFAULT_TUNING,
  sanitizeTuning,
  type Tuning,
  createGame,
  createRng,
  MAX_TEAMS_TDM,
  planBot,
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
  randomLoadout,
  refillLoadout,
  validateLoadout,
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
} from "@wingfighter/shared";
import { savePilots } from "./pilot-store.ts";
import { randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { getSavedTuning, initialTuning, saveTuning } from "./tuning-store.ts";

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
  ready: boolean;
  /** Letka: jedna výbava na loď (součet lodních bodů = settings.shipPoints). */
  loadouts: ShipLoadout[];
  /** Bot: výbavu nastavil host ručně (přepíše výchozí/náhodnou při startu). */
  manualLoadout?: boolean;
  /** Zvolený startovní bod. */
  startIndex?: number;
  /** Ekonomika mezi bitvami: kredity = rozpočet místnosti + vyděláno − utraceno. */
  earned: number;
  spent: number;
  /** Kredity při startu bitvy (rozdíl na konci = vyděláno). */
  walletAtStart?: number;
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
    modules.push({ id: mm.id.slice(0, 32), type: mm.type as ModuleType, slot: mm.slot as ShipLoadout["modules"][number]["slot"], ammo, facing });
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
      cargo.push({ id: mm.id.slice(0, 32), type: mm.type as ModuleType, slot: "front", ammo });
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
  settings: GameSettings = { mode: "tdm", turnLimit: 0, shipPoints: 1, teams: 2, allowedModules: {}, allowedHulls: {}, allowedPilots: {}, botLoadout: "default", map: { ...DEFAULT_MAP, seed: Math.floor(Math.random() * 100000) } };
  tuning: Tuning = initialTuning();
  members = new Map<string, RoomMember>();
  game: RunningGame | null = null;

  constructor(code: string, name: string, hostId: string) {
    this.code = code;
    this.name = name;
    this.hostId = hostId;
  }

  humans(): RoomMember[] {
    return [...this.members.values()].filter((m) => !m.isBot);
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
      pilots: pilotList(),
      players: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        team: m.team,
        isBot: m.isBot,
        ready: m.ready,
        loadout: m.loadouts[0],
        loadouts: m.loadouts,
        startIndex: m.startIndex,
        credits: m.isBot ? undefined : this.walletOf(m),
        connected: m.isBot ? true : !!clients.get(m.id)?.ws,
      })),
    };
  }

  /** Nová letka hráče: první loď výchozí sestava, další prázdné stíhače (podle lodních bodů). */
  newFleet(): ShipLoadout[] {
    const out: ShipLoadout[] = [structuredClone(DEFAULT_LOADOUT)];
    while (fleetPoints(out) < this.settings.shipPoints) out.push(emptyLoadout());
    return out;
  }

  /** Po změně lodních bodů: letky členů doplnit prázdnými loděmi, nebo oříznout (moduly se prodají). */
  resizeFleets(): void {
    for (const m of this.members.values()) {
      if (m.isBot) continue;
      while (fleetPoints(m.loadouts) < this.settings.shipPoints) m.loadouts.push(emptyLoadout());
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
    return { code: this.code, name: this.name, players: this.members.size, inGame: !!this.game };
  }
}

const DEFAULT_NAMES = ["Pilot"];
const BOT_NAMES = ["Rex", "Nova", "Kael", "Zara", "Orin", "Vex", "Lyra", "Dax", "Mira", "Juno"];

export class Hub {
  clients = new Map<string, Client>();
  rooms = new Map<string, Room>();

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
    this.send(client, { type: "welcome", playerId: client.id, sessionId: client.sessionId, name: client.name });
    const room = client.roomCode ? this.rooms.get(client.roomCode) : undefined;
    if (room) {
      const member = room.members.get(client.id);
      if (member) member.name = client.name;
      this.broadcastRoom(room);
      if (room.game) {
        const g = room.game;
        this.send(client, { type: "gameState", state: stateForTeam(g.state, teamOf(g, client.id), memoryFor(g, teamOf(g, client.id))), ready: this.readyList(room) });
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
        this.send(client, { type: "welcome", playerId: client.id, sessionId: client.sessionId, name: client.name });
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
        if (msg.index === null) {
          m.startIndex = undefined;
        } else {
          const n = generateMap(room.settings.map).starts.length;
          const i = clampInt(msg.index, 0, Math.max(0, n - 1));
          if ([...room.members.values()].some((o) => o.id !== m.id && o.startIndex === i)) return this.error(client, "Tenhle startovní bod už někdo má.");
          m.startIndex = i;
        }
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
          m.loadouts[idx] = lo;
          m.manualLoadout = true;
        } else {
          // hráč: změna je obchod – nákup, prodej, dokoupení munice z kreditů (jedna peněženka pro celou letku)
          const trade = applyLoadoutTrade(m.loadouts[idx], lo);
          if (trade.error) return this.error(client, `Výbava: ${trade.error}.`);
          const err = validateLoadout(trade.loadout, { allowed: room.settings.allowedModules });
          if (err) return this.error(client, `Výbava: ${err}.`);
          if (room.settings.allowedHulls?.[trade.loadout.hullId] === 0) return this.error(client, `${HULLS[trade.loadout.hullId]?.name ?? trade.loadout.hullId}: v této hře zakázán.`);
          if (room.settings.allowedPilots?.[trade.loadout.pilotId] === 0) return this.error(client, `${PILOTS[trade.loadout.pilotId]?.name ?? trade.loadout.pilotId}: v této hře zakázán.`);
          const pilot = PILOTS[trade.loadout.pilotId];
          if (pilot?.unique && m.loadouts.some((l, i) => i !== idx && l.pilotId === pilot.id)) return this.error(client, `${pilot.name} může být v letce jen jednou.`);
          if (trade.cost > room.walletOf(m)) return this.error(client, `Nedostatek kreditů (potřeba ${trade.cost}, máš ${room.walletOf(m)}).`);
          m.spent += trade.cost;
          m.loadouts[idx] = trade.loadout;
        }
        this.broadcastRoom(room);
        return;
      }
      case "addBot": {
        if (!room || room.game || room.hostId !== client.id) return;
        if (room.members.size >= 12) return this.error(client, "Místnost je plná.");
        const id = `bot-${randomBytes(3).toString("hex")}`;
        const used = new Set([...room.members.values()].map((m) => m.name));
        const name = BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? randomBytes(2).toString("hex");
        room.members.set(id, { id, name: `Bot ${name}`, team: clampInt(msg.team, 0, (room.settings.teams ?? 2) - 1), isBot: true, ready: true, loadouts: this.botFleet(room), earned: 0, spent: 0 });
        this.broadcastRoom(room);
        this.broadcastRooms();
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
        if (typeof s.turnLimit === "number") room.settings.turnLimit = clampInt(s.turnLimit, 0, 99);
        if (typeof s.teams === "number") {
          room.settings.teams = clampInt(s.teams, 2, MAX_TEAMS_TDM);
          for (const m of room.members.values()) if (m.team >= room.settings.teams) m.team = 0;
        }
        if (typeof s.shipPoints === "number") {
          room.settings.shipPoints = clampInt(s.shipPoints, 1, 3);
          room.resizeFleets();
          for (const m of room.members.values()) if (m.isBot && !m.manualLoadout) m.loadouts = this.botFleet(room);
        }
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
        if (s.map && typeof s.map === "object") {
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
      case "startGame":
        if (!room || room.hostId !== client.id || room.game) return;
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
        // nový stav všem (náboje, odkrytá mapa pro tým)
        for (const m of room.members.values()) {
          if (m.isBot) continue;
          const c = this.clients.get(m.id);
          if (!c) continue;
          const t = teamOf(g, m.id);
          this.send(c, { type: "gameState", state: stateForTeam(g.state, t, memoryFor(g, t)), ready: this.readyList(room) });
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
        for (const m of room.members.values()) m.ready = m.isBot;
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
    if (members.length < 2) return this.error(host, "Potřebujete alespoň dva hráče (nebo bota).");
    if (room.settings.mode === "tdm" && new Set(members.map((m) => m.team)).size < 2) {
      return this.error(host, "V týmovém módu musí být obsazené alespoň dva týmy.");
    }
    for (const m of members) {
      if (m.isBot && !m.manualLoadout) m.loadouts = this.botFleet(room);
      const err = validateFleet(m.loadouts, room.settings, m.isBot ? room.tuning.startBudget : undefined);
      if (err) return this.error(host, `${m.name} – letka: ${err}.`);
      if (!m.isBot) m.walletAtStart = room.walletOf(m);
    }
    const players: PlayerInfo[] = members.map((m) => ({ id: m.id, name: m.name, team: m.team, isBot: m.isBot, loadout: refillLoadout(m.loadouts[0]), loadouts: m.loadouts.map(refillLoadout), credits: m.isBot ? undefined : room.walletOf(m), startIndex: m.startIndex }));
    const state = createGame({ players, settings: room.settings, tuning: room.tuning });
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
    this.maybeResolve(room);
  }

  /** Výbava bota podle nastavení místnosti. */
  /** Letka bota: tolik lodí, kolik je lodních bodů (každá podle nastavení výbavy botů). */
  private botFleet(room: Room): ShipLoadout[] {
    const out: ShipLoadout[] = [];
    while (fleetPoints(out) < room.settings.shipPoints) {
      const k = out.length;
      const lo = this.botLoadout(room);
      // id modulů musí být v letce unikátní
      lo.modules = lo.modules.map((m) => ({ ...m, id: `s${k}-${m.id}` }));
      out.push(lo);
    }
    return out;
  }

  private botLoadout(room: Room): ShipLoadout {
    applyTuning(room.tuning);
    const allowed = room.settings.allowedModules;
    if (room.settings.botLoadout === "random") return randomLoadout(Math.random, allowed, room.tuning.startBudget);
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
    for (const m of room.members.values()) {
      if (!m.isBot) continue;
      g.orders.set(m.id, sanitizeOrders(g.state, m.id, planBot(g.state, m.id, g.rng)));
      m.ready = true;
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
    if (g.state.status === "finished") this.settleBattle(room);
    if (g.state.status !== "finished") {
      this.planBots(room);
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
    for (const m of room.members.values()) {
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
    this.broadcast(room, { type: "room", room: room.toState(this.clients) });
  }

  private broadcastPlanning(room: Room) {
    this.broadcast(room, { type: "planningStatus", ready: this.readyList(room) });
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
