import { generateProfile } from "./asteroids.ts";
import { MAP, RULES } from "./constants.ts";
import type { Pose } from "./geometry.ts";
import { computeStats, DEFAULT_LOADOUT, moduleCost, refillLoadout, shieldTypeOf, shipNames, pilotList } from "./ships.ts";
import { applyTuning, DEFAULT_TUNING, sanitizeTuning, type Tuning } from "./tuning.ts";
import type { Asteroid, GameSettings, GameState, PlayerInfo, Ship, ShipLoadout, Storm } from "./types.ts";
import { generateMap, START_MARGIN } from "./mapgen.ts";

/** Mapa 1 – statické asteroidy (vx, vy = 0; v budoucnu mohou létat). Tvar se generuje ze seedu. */
const MAP_1: Omit<Asteroid, "profile" | "version">[] = [
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
export const MAP_1_ASTEROIDS: Asteroid[] = MAP_1.map((a) => ({ ...a, profile: generateProfile(a.radius, a.seed), version: 0 }));

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
  tuning?: Tuning;
}

/**
 * Vytvoří počáteční stav bitvy. V DM dostane každý hráč vlastní číslo týmu,
 * takže zbytek pravidel pracuje jednotně s týmy.
 */
export function createGame(opts: CreateGameOptions): GameState {
  const settings = { ...opts.settings };
  const tuning = sanitizeTuning(opts.tuning ?? DEFAULT_TUNING);
  applyTuning(tuning);
  let players = opts.players.map((p) => {
    const loadouts = (p.loadouts?.length ? p.loadouts : [p.loadout ?? opts.loadout ?? DEFAULT_LOADOUT]).map(refillLoadout);
    const loadout = loadouts[0];
    return { ...p, loadout, loadouts, credits: p.credits ?? Math.max(0, tuning.startBudget - loadouts.reduce((s, l) => s + moduleCost(l), 0)) };
  });
  if (settings.mode === "dm") players = players.map((p, i) => ({ ...p, team: i }));

  const teams = [...new Set(players.map((p) => p.team))].sort((a, b) => a - b);
  // mapa: generovaná podle nastavení, jinak klasická mapa 1
  let width = MAP.width;
  let height = MAP.height;
  let asteroids: Asteroid[] = structuredClone(MAP_1_ASTEROIDS);
  let storms: Storm[] = [];
  let startAt: ((p: PlayerInfo) => Pose) | null = null;
  if (settings.map) {
    const gen = generateMap(settings.map);
    width = gen.width;
    height = gen.height;
    asteroids = gen.asteroids;
    storms = gen.storms;
    const taken = new Set(players.map((p) => p.startIndex).filter((i): i is number => typeof i === "number" && i >= 0 && i < gen.starts.length));
    const freeIdx = gen.starts.map((_, i) => i).filter((i) => !taken.has(i));
    const assigned = new Map<string, number>();
    for (const p of players) {
      let i = typeof p.startIndex === "number" && p.startIndex >= 0 && p.startIndex < gen.starts.length && !assigned.has(`i${p.startIndex}`) ? p.startIndex : undefined;
      if (i === undefined || [...assigned.values()].includes(i)) {
        // volný bod co nejdál od už obsazených (hlavně od cizích týmů)
        const used = [...assigned.entries()].map(([pid, idx]) => ({ idx, team: players.find((q) => q.id === pid)?.team }));
        let best = freeIdx[0];
        let bestScore = -1;
        for (const cand of freeIdx) {
          const c = gen.starts[cand];
          let score = Infinity;
          for (const u of used) {
            const o = gen.starts[u.idx];
            const d = Math.hypot(c.x - o.x, c.y - o.y) * (u.team === p.team ? 0.4 : 1);
            score = Math.min(score, d);
          }
          if (used.length === 0) score = 0;
          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }
        i = best ?? Math.floor(Math.random() * gen.starts.length);
        const at = freeIdx.indexOf(i);
        if (at >= 0) freeIdx.splice(at, 1);
      }
      assigned.set(p.id, i);
      p.startIndex = i;
    }
    startAt = (p) => {
      const st = gen.starts[assigned.get(p.id) ?? 0] ?? { x: START_MARGIN, y: height / 2, heading: 0 };
      return { x: st.x, y: st.y, heading: st.heading };
    };
  }
  const zones = spawnZones(teams.length, width, height);

  const ships: Ship[] = [];
  teams.forEach((team, zi) => {
    const zoneT = zones[zi];
    const members = players.filter((p) => p.team === team);
    const total = members.reduce((s, p) => s + (p.loadouts?.length ?? 1), 0);
    const spacing = 60;
    let idx = 0;
    for (const p of members) {
      const zone = startAt ? startAt(p) : zoneT;
      // kolmice ke kurzu zóny
      const px = -Math.sin(zone.heading);
      const py = Math.cos(zone.heading);
      const fleet = p.loadouts!;
      const perPlayer = fleet.length;
      const names = shipNames(p.name, fleet);
      for (let k = 0; k < perPlayer; k++) {
        const offset = startAt ? (k - (perPlayer - 1) / 2) * spacing : (idx - (total - 1) / 2) * spacing;
        const loadout = structuredClone(fleet[k]);
        const stats = computeStats(loadout);
        ships.push({
          id: `ship-${p.id}-${k}`,
          ownerId: p.id,
          team,
          name: perPlayer > 1 ? names[k] : p.name,
          loadout,
          stats,
          x: zone.x + px * offset,
          y: zone.y + py * offset,
          heading: zone.heading,
          hull: stats.hull,
          shields: stats.shields,
          shieldType: shieldTypeOf(loadout),
          shieldEff: 100,
          segments: [RULES.segmentHp * stats.segmentModules, RULES.segmentHp * stats.segmentModules, RULES.segmentHp * stats.segmentModules, RULES.segmentHp * stats.segmentModules],
          stressPoints: stats.stressMax,
          techPoints: stats.techMax,
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
    pilots: pilotList(),
    tuning,
    width,
    height,
    asteroids,
    storms,
    ships,
    torpedoes: [],
    mines: [],
    debris: [],
    comets: [],
    players,
    stats: Object.fromEntries(players.map((p) => [p.id, { damageDealt: 0, damageTaken: 0, kills: 0, deaths: 0, creditsEarned: 0, maneuvers: { green: 0, white: 0, red: 0, danger: 0, koiogran: 0 }, lasersFired: 0, laserHits: 0, mgShots: 0, mgHits: 0, torpedoesFired: 0, minesDropped: 0, scans: 0, cometsShot: 0, cometTails: 0 }])),
    status: "planning",
  };
}
