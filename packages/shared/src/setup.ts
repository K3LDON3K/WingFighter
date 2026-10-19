import { MAP } from "./constants.ts";
import type { Pose } from "./geometry.ts";
import { computeStats, DEFAULT_LOADOUT } from "./ships.ts";
import type { Asteroid, GameSettings, GameState, PlayerInfo, Ship, ShipLoadout } from "./types.ts";

/** Mapa 1 – statické asteroidy (vx, vy = 0; v budoucnu mohou létat). */
export const MAP_1_ASTEROIDS: Asteroid[] = [
  { id: "a1", x: 1200, y: 800, radius: 80, vx: 0, vy: 0, seed: 11 },
  { id: "a2", x: 850, y: 450, radius: 48, vx: 0, vy: 0, seed: 23 },
  { id: "a3", x: 1550, y: 1150, radius: 52, vx: 0, vy: 0, seed: 37 },
  { id: "a4", x: 1600, y: 420, radius: 38, vx: 0, vy: 0, seed: 41 },
  { id: "a5", x: 800, y: 1180, radius: 42, vx: 0, vy: 0, seed: 53 },
  { id: "a6", x: 950, y: 200, radius: 30, vx: 0, vy: 0, seed: 67 },
  { id: "a7", x: 1550, y: 1400, radius: 32, vx: 0, vy: 0, seed: 71 },
  { id: "a8", x: 560, y: 800, radius: 30, vx: 0, vy: 0, seed: 83 },
  { id: "a9", x: 1840, y: 800, radius: 30, vx: 0, vy: 0, seed: 97 },
  { id: "a10", x: 1250, y: 1300, radius: 36, vx: 0, vy: 0, seed: 101 },
  { id: "a11", x: 1150, y: 330, radius: 26, vx: 0, vy: 0, seed: 113 },
  { id: "a12", x: 2050, y: 300, radius: 34, vx: 0, vy: 0, seed: 127 },
  { id: "a13", x: 350, y: 1250, radius: 34, vx: 0, vy: 0, seed: 131 },
  { id: "a14", x: 1950, y: 1250, radius: 44, vx: 0, vy: 0, seed: 137 },
  { id: "a15", x: 450, y: 350, radius: 40, vx: 0, vy: 0, seed: 139 },
  { id: "a16", x: 1400, y: 600, radius: 24, vx: 0, vy: 0, seed: 149 },
];

/** Startovní zóny: střed zóny a kurz směrem do mapy. */
function spawnZones(teamCount: number, w: number, h: number): Pose[] {
  const cx = w / 2;
  const cy = h / 2;
  if (teamCount <= 2) {
    return [
      { x: 150, y: cy, heading: 0 },
      { x: w - 150, y: cy, heading: Math.PI },
    ];
  }
  if (teamCount === 3) {
    return [
      { x: 150, y: cy - 200, heading: 0 },
      { x: w - 150, y: cy - 200, heading: Math.PI },
      { x: cx, y: h - 120, heading: -Math.PI / 2 },
    ];
  }
  const zones: Pose[] = [];
  for (let i = 0; i < teamCount; i++) {
    const a = (i / teamCount) * Math.PI * 2 - Math.PI;
    const x = cx + Math.cos(a) * (w / 2 - 150);
    const y = cy + Math.sin(a) * (h / 2 - 120);
    zones.push({ x, y, heading: Math.atan2(cy - y, cx - x) });
  }
  return zones;
}

export interface CreateGameOptions {
  players: PlayerInfo[];
  settings: GameSettings;
  loadout?: ShipLoadout;
}

/**
 * Vytvoří počáteční stav bitvy. V DM dostane každý hráč vlastní číslo týmu,
 * takže zbytek pravidel pracuje jednotně s týmy.
 */
export function createGame(opts: CreateGameOptions): GameState {
  const settings = { ...opts.settings };
  const loadout = opts.loadout ?? DEFAULT_LOADOUT;
  let players = opts.players.map((p) => ({ ...p }));
  if (settings.mode === "dm") players = players.map((p, i) => ({ ...p, team: i }));

  const teams = [...new Set(players.map((p) => p.team))].sort((a, b) => a - b);
  const zones = spawnZones(teams.length, MAP.width, MAP.height);

  const ships: Ship[] = [];
  teams.forEach((team, zi) => {
    const zone = zones[zi];
    const members = players.filter((p) => p.team === team);
    const total = members.length * Math.max(1, settings.shipsPerPlayer);
    const spacing = 60;
    // kolmice ke kurzu zóny
    const px = -Math.sin(zone.heading);
    const py = Math.cos(zone.heading);
    let idx = 0;
    for (const p of members) {
      for (let k = 0; k < Math.max(1, settings.shipsPerPlayer); k++) {
        const offset = (idx - (total - 1) / 2) * spacing;
        const stats = computeStats(loadout);
        ships.push({
          id: `ship-${p.id}-${k}`,
          ownerId: p.id,
          team,
          name: settings.shipsPerPlayer > 1 ? `${p.name} ${k + 1}` : p.name,
          loadout: structuredClone(loadout),
          stats,
          x: zone.x + px * offset,
          y: zone.y + py * offset,
          heading: zone.heading,
          hull: stats.hull,
          shields: stats.shields,
          stress: 0,
          speed: 2,
          tokens: { focus: 0, evade: 0 },
          ammo: { torpedoes: stats.torpedoes, mines: stats.mines },
          alive: true,
        });
        idx++;
      }
    }
  });

  return {
    turn: 1,
    settings,
    width: MAP.width,
    height: MAP.height,
    asteroids: structuredClone(MAP_1_ASTEROIDS),
    ships,
    torpedoes: [],
    mines: [],
    players,
    status: "planning",
  };
}
