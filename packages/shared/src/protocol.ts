import type { GameSettings, GameState, ShipOrders, TurnResult } from "./types.ts";

/** Stav místnosti v lobby. */
export interface RoomPlayer {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
  ready: boolean;
  connected: boolean;
}

export interface RoomState {
  code: string;
  name: string;
  hostId: string;
  settings: GameSettings;
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
  | { type: "addBot"; team: number }
  | { type: "removeBot"; botId: string }
  | { type: "setSettings"; settings: Partial<GameSettings> }
  | { type: "startGame" }
  | { type: "submitOrders"; orders: ShipOrders[] }
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
  | { type: "turnResult"; result: TurnResult }
  | { type: "error"; message: string };
