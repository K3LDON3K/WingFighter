import { SCANNER, TORPEDO } from "./constants.ts";
import type { Vec } from "./geometry.ts";
import type { Asteroid, GameState, MovePath, TurnEvent, TurnResult } from "./types.ts";

/** Základní dohled lodi (3 × zaměřovací dostřel torpéda); mutovatelné kvůli ladění. */
export const VISION_REF = { value: TORPEDO.lockRange * 3 };
export const VISION_RADIUS = VISION_REF.value;

/** Paměť týmu: asteroidy tak, jak je tým naposledy viděl. */
export type AsteroidMemory = Map<string, Asteroid>;

interface Eye extends Vec {
  r: number;
}

/** Pozice, ze kterých tým "vidí": živé lodě týmu (+ volitelně body jejich dráhy v tomto kole). */
export function teamEyes(state: GameState, team: number, paths?: MovePath[]): Eye[] {
  const eyes: Eye[] = [];
  for (const s of state.ships) {
    if (s.team !== team) continue;
    const r = s.stats.vision ?? VISION_REF.value;
    if (s.alive) eyes.push({ x: s.x, y: s.y, r });
    const path = paths?.find((p) => p.id === s.id);
    if (path) for (let i = 0; i < path.points.length; i += 4) eyes.push({ x: path.points[i].x, y: path.points[i].y, r });
  }
  return eyes;
}

export function seenBy(eyes: Eye[], p: Vec, radius = 0): boolean {
  for (const e of eyes) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const r = e.r + radius;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/** Stav tak, jak ho vidí daný tým. Aktualizuje paměť asteroidů. */
export function stateForTeam(state: GameState, team: number, memory: AsteroidMemory): GameState {
  const eyes = teamEyes(state, team);
  // hluboký sken: tým vidí všechno v dosahu skeneru kolem svých lodí
  if (state.revealTeams?.includes(team)) for (const s of state.ships) if (s.team === team && s.alive) eyes.push({ x: s.x, y: s.y, r: SCANNER.deepRange });
  for (const a of state.asteroids) if (seenBy(eyes, a, a.radius)) memory.set(a.id, structuredClone(a));
  const live = new Set(state.asteroids.map((a) => a.id));
  // asteroid, který tým vidí jako zničený, z paměti zmizí (ostatní zničené v ní zůstávají)
  for (const [id, a] of memory) if (!live.has(id) && seenBy(eyes, a, a.radius)) memory.delete(id);
  return {
    ...state,
    ships: state.ships.filter((s) => s.team === team || !s.alive || seenBy(eyes, s, s.stats.radius)),
    torpedoes: state.torpedoes.filter((t) => t.team === team || seenBy(eyes, t, TORPEDO.radius)),
    mines: state.mines.filter((m) => m.team === team || seenBy(eyes, m, m.radius)),
    debris: (state.debris ?? []).filter((d) => seenBy(eyes, d, 12)),
    asteroids: [...memory.values()].map((a) => structuredClone(a)),
  };
}

/**
 * Výsledek kola pro daný tým: události a dráhy jen pro to, co tým během kola viděl
 * (z pozic na začátku, podél dráhy i na konci). Aktualizuje paměť asteroidů.
 */
export function resultForTeam(result: TurnResult, prev: GameState, team: number, memory: AsteroidMemory): TurnResult {
  const move = result.events.find((e) => e.type === "move");
  const paths = move?.type === "move" ? move.paths : [];
  const eyes = [...teamEyes(prev, team), ...teamEyes(result.state, team, paths)];
  if (prev.revealTeams?.includes(team)) for (const s of prev.ships) if (s.team === team && s.alive) eyes.push({ x: s.x, y: s.y, r: SCANNER.deepRange });

  const shipTeam = (id: string) => prev.ships.find((s) => s.id === id)?.team ?? result.state.ships.find((s) => s.id === id)?.team;
  const torpTeam = (id: string) => prev.torpedoes.find((t) => t.id === id)?.team ?? result.state.torpedoes.find((t) => t.id === id)?.team ?? result.events.find((e) => e.type === "spawnTorpedo" && e.torpedo.id === id && e.torpedo.team === team) ? team : undefined;
  const pathVisible = (p: MovePath) => p.points.some((pt, i) => i % 3 === 0 && seenBy(eyes, pt, 20));
  const visibleShip = new Set<string>();
  const visibleTorp = new Set<string>();
  for (const p of paths) {
    const own = p.kind === "ship" ? shipTeam(p.id) === team : torpTeam(p.id) === team;
    if (own || pathVisible(p)) (p.kind === "ship" ? visibleShip : visibleTorp).add(p.id);
  }
  for (const s of result.state.ships) if (s.team === team || seenBy(eyes, s, s.stats.radius)) visibleShip.add(s.id);
  for (const t of result.state.torpedoes) if (t.team === team || seenBy(eyes, t, TORPEDO.radius)) visibleTorp.add(t.id);

  const events: TurnEvent[] = [];
  for (const e of result.events) {
    switch (e.type) {
      case "move":
        events.push({ type: "move", paths: paths.filter((p) => (p.kind === "ship" ? visibleShip.has(p.id) : visibleTorp.has(p.id))) });
        break;
      case "collision":
      case "stress":
      case "damage":
      case "destroyed":
      case "action":
        if (visibleShip.has(e.shipId)) events.push(e);
        break;
      case "mineBlast":
        if (seenBy(eyes, e, 80)) events.push(e);
        break;
      case "torpedoHit":
        if (visibleTorp.has(e.torpedoId) || seenBy(eyes, e, 80)) events.push(e);
        break;
      case "torpedoExpire":
        if (visibleTorp.has(e.torpedoId)) events.push(e);
        break;
      case "torpedoShot":
        if (visibleShip.has(e.shooterId) || visibleTorp.has(e.torpedoId)) events.push(e);
        break;
      case "asteroidHit":
        if (seenBy(eyes, e, 80)) {
          events.push(e);
          const a = memory.get(e.asteroidId) ?? prev.asteroids.find((x) => x.id === e.asteroidId);
          if (a) {
            if (e.destroyed) memory.delete(e.asteroidId);
            else memory.set(e.asteroidId, { ...structuredClone(a), profile: [...e.profile], version: (a.version ?? 0) + 1 });
          }
        }
        break;
      case "laser":
        if (visibleShip.has(e.shooterId) || visibleShip.has(e.targetId)) events.push(e);
        break;
      case "spawnTorpedo":
        if (e.torpedo.team === team || seenBy(eyes, e.torpedo, 20)) {
          events.push(e);
          visibleTorp.add(e.torpedo.id);
        }
        break;
      case "spawnMine":
        if (e.mine.team === team || seenBy(eyes, e.mine, e.mine.radius)) events.push(e);
        break;
      case "evadePass":
        if (visibleShip.has(e.shipId) || visibleShip.has(e.victimId)) events.push(e);
        break;
      case "jettison":
        if (visibleShip.has(e.shipId)) events.push(e);
        break;
      case "debrisShot":
        if (visibleShip.has(e.shooterId) || seenBy(eyes, e, 20)) events.push(e);
        break;
      case "scan":
        if (visibleShip.has(e.shipId)) events.push(e);
        break;
      case "credits":
        // kredity jsou veřejné (tabulka), ale důvod sestřelu vidí všichni stejně
        events.push(e);
        break;
    }
  }
  return {
    turn: result.turn,
    orders: result.orders.filter((o) => visibleShip.has(o.shipId)),
    events,
    state: stateForTeam(result.state, team, memory),
  };
}
