/**
 * Série bitev: hra může mít jednu bitvu, nebo 2–5 bitev za sebou. Každá bitva má vlastní mapu, limit kol
 * a způsob umístění; mód, kredity, lodní body a moduly jsou společné. Vítěz série podle bodů
 * (výhra 3, remíza 1, prohra 0), při rovnosti sestřely, pak zraněné body.
 */
import type { GameMode, GameSettings, GameState, MapSettings, Placement } from "./types.ts";
import { DEFAULT_MAP, sanitizeMapSettings } from "./mapgen.ts";

export const SERIES_MIN = 2;
export const SERIES_MAX = 5;

export const SERIES_POINTS = { win: 3, draw: 1, loss: 0 };

export interface BattleSettings {
  map: MapSettings;
  /** 0 = bez limitu. */
  turnLimit: number;
  placement?: Placement;
}

/** Výsledek jedné odehrané bitvy série. Klíč = číslo týmu (TDM) nebo id hráče (DM). */
export interface SeriesBattleResult {
  index: number;
  winner: string | null;
  /** Účastníci bitvy (klíče) – kdo nevyhrál, prohrál (remíza = winner null → všichni 1 bod). */
  sides: string[];
  kills: Record<string, number>;
  damage: Record<string, number>;
  reason: "elimination" | "turnLimit";
}

export interface SeriesState {
  total: number;
  /** Počet odehraných bitev (= index příští bitvy). */
  played: number;
  results: SeriesBattleResult[];
  finished: boolean;
}

export interface SeriesStanding {
  key: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  kills: number;
  damage: number;
}

export function newBattle(base?: Partial<BattleSettings>): BattleSettings {
  return { map: { ...(base?.map ?? DEFAULT_MAP), seed: Math.floor(Math.random() * 100000) }, turnLimit: base?.turnLimit ?? 0, placement: base?.placement };
}

/** Očistí seznam bitev z klienta: 2–5 položek, jinak null (= jedna bitva). */
export function sanitizeBattles(raw: unknown, prev: BattleSettings[] | undefined, fallback: BattleSettings): BattleSettings[] | null {
  if (!Array.isArray(raw) || raw.length < SERIES_MIN) return null;
  const out: BattleSettings[] = [];
  raw.slice(0, SERIES_MAX).forEach((r, i) => {
    const base = prev?.[i] ?? fallback;
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const map = sanitizeMapSettings(o.map, base.map);
    const turnLimit = typeof o.turnLimit === "number" && Number.isFinite(o.turnLimit) ? Math.max(0, Math.min(99, Math.round(o.turnLimit))) : base.turnLimit;
    const placement = o.placement === "random" || o.placement === "teamRandom" || o.placement === "manual" || o.placement === "teamManual" ? o.placement : base.placement;
    out.push({ map, turnLimit, placement });
  });
  return out;
}

/** Bitva, která se bude hrát (série: podle počtu odehraných; jedna bitva: z nastavení). */
export function currentBattle(settings: GameSettings, played: number): BattleSettings {
  const list = settings.battles;
  if (list && list.length >= SERIES_MIN) return list[Math.min(played, list.length - 1)];
  return { map: settings.map ?? DEFAULT_MAP, turnLimit: settings.turnLimit, placement: settings.placement };
}

export function isSeries(settings: GameSettings): boolean {
  return !!settings.battles && settings.battles.length >= SERIES_MIN;
}

/** Klíč strany: v TDM číslo týmu, v DM id hráče. */
export function sideKey(mode: GameMode, team: number, playerId: string): string {
  return mode === "dm" ? playerId : String(team);
}

/** Výsledek dohrané bitvy pro sérii (z koncového stavu hry). */
export function battleResult(state: GameState, index: number): SeriesBattleResult {
  const mode = state.settings.mode;
  const sides = [...new Set(state.players.map((p) => sideKey(mode, p.team, p.id)))];
  const kills: Record<string, number> = {};
  const damage: Record<string, number> = {};
  for (const s of sides) {
    kills[s] = 0;
    damage[s] = 0;
  }
  for (const p of state.players) {
    const k = sideKey(mode, p.team, p.id);
    const st = state.stats?.[p.id];
    if (!st) continue;
    kills[k] += st.kills;
    damage[k] += st.damageDealt;
  }
  const r = state.result;
  const winner = !r || r.winnerTeam === null ? null : mode === "dm" ? (r.winnerPlayerId ?? null) : String(r.winnerTeam);
  return { index, winner, sides, kills, damage, reason: r?.reason ?? "elimination" };
}

/** Pořadí v sérii: body, pak sestřely, pak zranění. */
export function seriesStandings(results: SeriesBattleResult[], sides?: string[]): SeriesStanding[] {
  const map = new Map<string, SeriesStanding>();
  const get = (k: string) => {
    let s = map.get(k);
    if (!s) map.set(k, (s = { key: k, points: 0, wins: 0, draws: 0, losses: 0, kills: 0, damage: 0 }));
    return s;
  };
  for (const k of sides ?? []) get(k);
  for (const r of results) {
    for (const k of r.sides) {
      const s = get(k);
      s.kills += r.kills[k] ?? 0;
      s.damage += r.damage[k] ?? 0;
      if (r.winner === null) {
        s.points += SERIES_POINTS.draw;
        s.draws++;
      } else if (r.winner === k) {
        s.points += SERIES_POINTS.win;
        s.wins++;
      } else {
        s.points += SERIES_POINTS.loss;
        s.losses++;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.kills - a.kills || b.damage - a.damage);
}

/** Vítěz série (null = remíza i po rozhodujících kritériích). */
export function seriesWinner(results: SeriesBattleResult[]): string | null {
  const st = seriesStandings(results);
  if (st.length < 2) return st[0]?.key ?? null;
  const [a, b] = st;
  return a.points === b.points && a.kills === b.kills && a.damage === b.damage ? null : a.key;
}
