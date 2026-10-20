import type { Tuning } from "./tuning.ts";
import type { GameSettings, GameState, Ship, ShipLoadout, ShipOrders, TurnResult } from "./types.ts";

/** Stav místnosti v lobby. */
export interface RoomPlayer {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
  ready: boolean;
  connected: boolean;
  loadout: ShipLoadout;
  startIndex?: number;
  /** Kredity hráče v místnosti (rozpočet + výdělky z bitev − výbava). Boti nemají. */
  credits?: number;
}

export interface RoomState {
  code: string;
  name: string;
  hostId: string;
  settings: GameSettings;
  tuning: Tuning;
  /** Hodnoty uložené na serveru (tuning.json), pokud existují. */
  savedTuning: Tuning | null;
  players: RoomPlayer[];
  inGame: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  players: number;
  inGame: boolean;
}

/** Klient → server */
export type ClientMessage =
  | { type: "hello"; name: string; sessionId?: string }
  | { type: "setName"; name: string }
  | { type: "listRooms" }
  | { type: "createRoom"; name: string }
  | { type: "joinRoom"; code: string }
  | { type: "leaveRoom" }
  | { type: "setTeam"; team: number }
  /** Startovní bod (null = uvolnit); host může nastavit botovi. */
  | { type: "setStart"; index: number | null; botId?: string }
  /** Vlastní výbava, nebo (host) výbava bota. */
  | { type: "setLoadout"; loadout: ShipLoadout; botId?: string }
  | { type: "addBot"; team: number }
  | { type: "removeBot"; botId: string }
  | { type: "setSettings"; settings: Partial<GameSettings> }
  | { type: "setTuning"; tuning: Partial<Tuning> }
  | { type: "resetTuning" }
  | { type: "saveTuning" }
  | { type: "loadTuning" }
  | { type: "startGame" }
  | { type: "submitOrders"; orders: ShipOrders[] }
  /** Skener – vyhodnotí se hned: sken lodi (1 náboj), hluboký sken (2 náboje), vynucený cooldown. */
  | { type: "scan"; shipId: string; moduleId: string; mode: "ship" | "deep" | "cooldown"; targetId?: string }
  | { type: "unready" }
  | { type: "backToLobby" };

/** Server → klient */
export type ServerMessage =
  | { type: "welcome"; playerId: string; sessionId: string; name: string }
  | { type: "rooms"; rooms: RoomSummary[] }
  | { type: "room"; room: RoomState | null }
  | { type: "gameStart"; state: GameState }
  | { type: "gameState"; state: GameState; ready: string[] }
  | { type: "planningStatus"; ready: string[] }
  | { type: "tuning"; tuning: Tuning }
  | { type: "notice"; message: string }
  | { type: "turnResult"; result: TurnResult }
  /** Výsledek skenu lodi: plná loď včetně výbavy (jen pro skenujícího). */
  | { type: "scanResult"; shooterId: string; ship: Ship }
  | { type: "error"; message: string };
