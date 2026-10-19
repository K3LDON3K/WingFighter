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
  type ShipOrders,
} from "@spacegame/shared";
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
}

interface RunningGame {
  state: GameState;
  orders: Map<string, ShipOrders[]>;
  rng: ReturnType<typeof createRng>;
  /** Fog of war: paměť asteroidů každého týmu. */
  memory: Map<number, AsteroidMemory>;
}

function memoryFor(g: RunningGame, team: number): AsteroidMemory {
  let m = g.memory.get(team);
  if (!m) g.memory.set(team, (m = new Map()));
  return m;
}

/** Tým hráče v běžící hře (v DM má každý vlastní). */
function teamOf(g: RunningGame, playerId: string): number {
  return g.state.players.find((p) => p.id === playerId)?.team ?? 0;
}

class Room {
  code: string;
  name: string;
  hostId: string;
  settings: GameSettings = { mode: "tdm", turnLimit: 0, shipsPerPlayer: 1 };
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
      players: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        team: m.team,
        isBot: m.isBot,
        ready: m.ready,
        connected: m.isBot ? true : !!clients.get(m.id)?.ws,
      })),
    };
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
        r.members.set(client.id, { id: client.id, name: client.name, team: 0, isBot: false, ready: false });
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
        r.members.set(client.id, { id: client.id, name: client.name, team, isBot: false, ready: false });
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
        const m = room.members.get(client.id);
        if (!m) return;
        m.team = clampInt(msg.team, 0, MAX_TEAMS_TDM - 1);
        this.broadcastRoom(room);
        return;
      }
      case "addBot": {
        if (!room || room.game || room.hostId !== client.id) return;
        if (room.members.size >= 12) return this.error(client, "Místnost je plná.");
        const id = `bot-${randomBytes(3).toString("hex")}`;
        const used = new Set([...room.members.values()].map((m) => m.name));
        const name = BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? randomBytes(2).toString("hex");
        room.members.set(id, { id, name: `Bot ${name}`, team: clampInt(msg.team, 0, MAX_TEAMS_TDM - 1), isBot: true, ready: true });
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
        if (typeof s.shipsPerPlayer === "number") room.settings.shipsPerPlayer = clampInt(s.shipsPerPlayer, 1, 6);
        this.broadcastRoom(room);
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
    const players: PlayerInfo[] = members.map((m) => ({ id: m.id, name: m.name, team: m.team, isBot: m.isBot }));
    const state = createGame({ players, settings: room.settings, tuning: room.tuning });
    const rng = createRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    room.game = { state, orders: new Map(), rng, memory: new Map() };
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
      s.stressPoints = Math.min(s.stressPoints, g.state.tuning.stressMax);
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
    const counts = Array.from({ length: MAX_TEAMS_TDM }, () => 0);
    for (const m of room.members.values()) counts[m.team]++;
    // obsazujeme jen první dva týmy automaticky, třetí si hráč vybere sám
    return counts[0] <= counts[1] ? 0 : 1;
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
