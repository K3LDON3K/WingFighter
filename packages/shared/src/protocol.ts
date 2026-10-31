import type { Tuning } from "./tuning.ts";
import type { SeriesState } from "./series.ts";
import type { CustomMap, CustomMapSummary } from "./custommap.ts";
import type { BotLevel, GameSettings, GameState, HackOrder, PilotDef, RepairOrder, Ship, ShipLoadout, ShipOrders, TurnResult } from "./types.ts";

/** Stav místnosti v lobby. */
export interface RoomPlayer {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
  /** Obtížnost bota. */
  botLevel?: BotLevel;
  ready: boolean;
  /** V místnosti: hráč potvrdil, že je připravený (bitva jde spustit až když jsou všichni). Boti a host vždy true. */
  lobbyReady: boolean;
  connected: boolean;
  /** První loď letky (kompatibilita); celá letka je v `loadouts`. */
  loadout: ShipLoadout;
  loadouts: ShipLoadout[];
  startIndex?: number;
  /** Velitel týmu (★) – vybírá start týmu u týmového ručního umístění; host nebo velitel může velení předat. */
  commander?: boolean;
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
  /** Místnost otevřená pro ostatní (host dokončil nastavení). */
  open: boolean;
  /** Piloti platní na serveru (editovatelní v ladění). */
  pilots: PilotDef[];
  /** Série bitev (chybí = jedna bitva). */
  series?: SeriesState;
}

export interface RoomSummary {
  code: string;
  name: string;
  players: number;
  inGame: boolean;
  /** false = zakladatel ještě dokončuje nastavení, připojit se nejde. */
  open: boolean;
}

/** Klient → server */
export type ClientMessage =
  | { type: "hello"; name: string; sessionId?: string }
  | { type: "setName"; name: string }
  | { type: "listRooms" }
  | { type: "createRoom"; name: string }
  | { type: "joinRoom"; code: string }
  | { type: "leaveRoom" }
  | { type: "setTeam"; team: number; playerId?: string }
  | { type: "balanceTeams"; shuffle?: boolean }
  /** Host otevře místnost pro ostatní (open=true) nebo se vrátí k nastavení (open=false). */
  | { type: "openRoom"; open: boolean }
  /** Hráč v místnosti potvrdí (nebo vezme zpět), že je připravený. */
  | { type: "setLobbyReady"; ready: boolean }
  /** Startovní bod (null = uvolnit); host může nastavit botovi. */
  | { type: "setStart"; index: number | null; botId?: string }
  /** Předat velení týmu jinému členovi (host komukoli, velitel ve svém týmu). */
  | { type: "setCommander"; playerId: string }
  /** Vlastní výbava, nebo (host) výbava bota. */
  | { type: "setLoadout"; loadout: ShipLoadout; botId?: string; index?: number }
  | { type: "setPilots"; pilots: PilotDef[] }
  | { type: "addBot"; team: number; level?: BotLevel }
  /** Host změní obtížnost bota. */
  | { type: "setBotLevel"; botId: string; level: BotLevel }
  | { type: "removeBot"; botId: string }
  | { type: "setSettings"; settings: Partial<GameSettings> }
  /** Letka: přidat prázdnou loď daného trupu (musí se vejít do lodních bodů) / odebrat loď (moduly se prodají). */
  | { type: "addShip"; hullId: string; botId?: string }
  | { type: "removeShip"; index: number; botId?: string }
  /** Přesun modulu mezi loděmi letky (bez prodeje): do prvního volného slotu cílové lodi. */
  | { type: "moveModule"; fromIndex: number; toIndex: number; moduleId: string; botId?: string }
  | { type: "setTuning"; tuning: Partial<Tuning> }
  | { type: "resetTuning" }
  | { type: "saveTuning" }
  /** Vlastní mapy (editor): seznam, celá mapa, uložení, smazání. */
  | { type: "listMaps" }
  | { type: "getMap"; id: string }
  | { type: "saveMap"; map: CustomMap }
  | { type: "deleteMap"; id: string }
  | { type: "loadTuning" }
  | { type: "startGame" }
  | { type: "submitOrders"; orders: ShipOrders[] }
  /** Skener – vyhodnotí se hned: sken lodi (1 náboj), hluboký sken (2 náboje), vynucený cooldown. */
  | { type: "scan"; shipId: string; moduleId: string; mode: "ship" | "deep" | "cooldown" | "predict"; targetId?: string }
  /** Dobití štítu technologií (hned, nebere akci). U segmentového: kolik bodů do kterého segmentu. */
  | { type: "rechargeShield"; shipId: string; segments?: number[] }
  /** Droid – opravář: úkon (hned, nebere akci, platí se technologií). */
  | { type: "repair"; shipId: string; order: RepairOrder }
  /** Droid – hacker: úkon (hned, nebere akci, platí se technologií; cíle v dohledu týmu). */
  | { type: "hack"; shipId: string; order: HackOrder }
  | { type: "unready" }
  | { type: "backToLobby" };

/** Server → klient */
export type ServerMessage =
  | { type: "welcome"; playerId: string; sessionId: string; name: string; /** Sestavení klienta, které server servíruje (klient se starší verzí se obnoví). */ build?: string }
  | { type: "rooms"; rooms: RoomSummary[] }
  | { type: "room"; room: RoomState | null }
  | { type: "gameStart"; state: GameState }
  /** `alive` = hráči, kteří mají živou loď (nezávisle na mlze – cizí lodě mimo dohled ve stavu nejsou). */
  | { type: "gameState"; state: GameState; ready: string[]; alive?: string[] }
  | { type: "planningStatus"; ready: string[]; alive?: string[] }
  | { type: "tuning"; tuning: Tuning }
  | { type: "maps"; maps: CustomMapSummary[] }
  | { type: "map"; map: CustomMap | null; /** Po uložení: potvrzení klientovi, který ukládal. */ saved?: boolean }
  | { type: "notice"; message: string }
  | { type: "turnResult"; result: TurnResult }
  /** Výsledek skenu lodi: plná loď včetně výbavy (jen pro skenujícího). */
  | { type: "scanResult"; shooterId: string; ship: Ship }
  /** Předpověď skeneru: naplánované manévry nepřátelských botů v dohledu (jen pro skenujícího hráče, na dané kolo). */
  | { type: "botPlans"; turn: number; plans: { shipId: string; maneuverId: string }[] }
  | { type: "error"; message: string };
