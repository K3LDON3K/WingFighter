import { COMET, SCANNER, TORPEDO } from "./constants.ts";
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

/** Kometa je vidět, když je v dohledu jádro nebo kus ocasu (ocas táhne za jádrem). */
export function cometSeen(eyes: Eye[], c: { x: number; y: number; heading: number; radius: number }): boolean {
  if (seenBy(eyes, c, c.radius)) return true;
  const bx = -Math.cos(c.heading);
  const by = -Math.sin(c.heading);
  for (let d = c.radius; d <= c.radius + COMET.tailLength; d += 30) if (seenBy(eyes, { x: c.x + bx * d, y: c.y + by * d }, COMET.tailWidth / 2)) return true;
  return false;
}

/** Stav tak, jak ho vidí daný tým. Aktualizuje paměť asteroidů. */
/** Tým bez živé lodi je pozorovatel – vidí celou mapu. */
export function isSpectator(state: GameState, team: number): boolean {
  return state.ships.some((s) => s.team === team) && !state.ships.some((s) => s.team === team && s.alive);
}

export function stateForTeam(state: GameState, team: number, memory: AsteroidMemory): GameState {
  if (isSpectator(state, team)) return state;
  const eyes = teamEyes(state, team);
  // hluboký sken: tým vidí všechno v dosahu skeneru kolem svých lodí
  if (state.revealTeams?.includes(team)) for (const s of state.ships) if (s.team === team && s.alive) eyes.push({ x: s.x, y: s.y, r: SCANNER.deepRange });
  for (const a of state.asteroids) if (seenBy(eyes, a, a.radius)) memory.set(a.id, structuredClone(a));
  const live = new Set(state.asteroids.map((a) => a.id));
  // asteroid, který tým vidí jako zničený, z paměti zmizí (ostatní zničené v ní zůstávají)
  for (const [id, a] of memory) if (!live.has(id) && seenBy(eyes, a, a.radius)) memory.delete(id);
  return {
    ...state,
    // cizí lodě přesně podle hranice dohledu (vraky se posílají vždy kvůli panelu hráčů; klient je mimo dohled nekreslí)
    ships: state.ships.filter((s) => s.team === team || !s.alive || seenBy(eyes, s, s.stats.radius)).map((s) => (s.team === team && s.loadout.modules.some((m) => m.hacked) ? { ...s, loadout: { ...s.loadout, modules: s.loadout.modules.map((m) => (m.hacked ? { ...m, hacked: undefined } : m)) } } : s)),
    torpedoes: state.torpedoes.filter((t) => t.team === team || seenBy(eyes, t, TORPEDO.radius)),
    mines: state.mines.filter((m) => m.team === team || seenBy(eyes, m, m.radius)),
    debris: (state.debris ?? []).filter((d) => seenBy(eyes, d, 12)),
    comets: (state.comets ?? []).filter((c) => cometSeen(eyes, c)),
    storms: (state.storms ?? []).filter((st) => st.blobs.some((b) => seenBy(eyes, b, b.r))),
    asteroids: [...memory.values()].map((a) => structuredClone(a)),
  };
}

/**
 * Výsledek kola pro daný tým: události a dráhy jen pro to, co tým během kola viděl
 * (z pozic na začátku, podél dráhy i na konci). Aktualizuje paměť asteroidů.
 */
export function resultForTeam(result: TurnResult, prev: GameState, team: number, memory: AsteroidMemory): TurnResult {
  if (isSpectator(result.state, team)) return result;
  const move = result.events.find((e) => e.type === "move");
  const paths = move?.type === "move" ? move.paths : [];
  const eyes = [...teamEyes(prev, team), ...teamEyes(result.state, team, paths)];
  if (prev.revealTeams?.includes(team)) for (const s of prev.ships) if (s.team === team && s.alive) eyes.push({ x: s.x, y: s.y, r: SCANNER.deepRange });

  const shipTeam = (id: string) => prev.ships.find((s) => s.id === id)?.team ?? result.state.ships.find((s) => s.id === id)?.team;
  const torpTeam = (id: string) => prev.torpedoes.find((t) => t.id === id)?.team ?? result.state.torpedoes.find((t) => t.id === id)?.team ?? result.events.find((e) => e.type === "spawnTorpedo" && e.torpedo.id === id && e.torpedo.team === team) ? team : undefined;
  const pathVisible = (p: MovePath) => p.points.some((pt, i) => i % 3 === 0 && seenBy(eyes, pt, 20));
  const visibleShip = new Set<string>();
  const visibleTorp = new Set<string>();
  const visibleComet = new Set<string>();
  for (const p of paths) {
    if (p.kind === "comet") {
      if (pathVisible(p)) visibleComet.add(p.id);
      continue;
    }
    const own = p.kind === "ship" ? shipTeam(p.id) === team : torpTeam(p.id) === team;
    if (own || pathVisible(p)) (p.kind === "ship" ? visibleShip : visibleTorp).add(p.id);
  }
  for (const c of result.state.comets ?? []) if (cometSeen(eyes, c)) visibleComet.add(c.id);
  for (const s of result.state.ships) if (s.team === team || seenBy(eyes, s, s.stats.radius)) visibleShip.add(s.id);
  for (const t of result.state.torpedoes) if (t.team === team || seenBy(eyes, t, TORPEDO.radius)) visibleTorp.add(t.id);

  const events: TurnEvent[] = [];
  for (const e of result.events) {
    switch (e.type) {
      case "move":
        events.push({ type: "move", paths: paths.filter((p) => (p.kind === "ship" ? visibleShip.has(p.id) : p.kind === "comet" ? visibleComet.has(p.id) : visibleTorp.has(p.id))) });
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
      case "mg":
        if (visibleShip.has(e.shooterId) || visibleShip.has(e.targetId) || visibleTorp.has(e.targetId) || visibleComet.has(e.targetId)) events.push(e);
        break;
      case "spawnComet":
        if (seenBy(eyes, e.comet, e.comet.radius)) {
          events.push(e);
          visibleComet.add(e.comet.id);
        }
        break;
      case "cometShot":
        if (visibleShip.has(e.shooterId) || visibleComet.has(e.cometId)) events.push(e);
        break;
      case "cometGone":
        if (visibleComet.has(e.cometId) || seenBy(eyes, e, 40)) events.push(e);
        break;
      case "cometTail":
        if (visibleShip.has(e.shipId)) events.push(e);
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
      case "evadeThrough":
        if (visibleShip.has(e.shipId)) events.push(e);
        break;
      case "jettison":
        if (visibleShip.has(e.shipId)) events.push(e);
        break;
      case "pickup":
        if (visibleShip.has(e.shipId) || seenBy(eyes, e, 20)) events.push(e);
        break;
      case "debrisShot":
        if (visibleShip.has(e.shooterId) || seenBy(eyes, e, 20)) events.push(e);
        break;
      case "scan":
      case "droid":
      case "shieldRecharge":
      case "repair":
      case "autoRepair":
        if (visibleShip.has(e.shipId)) events.push(e);
        break;
      case "hack":
      case "hacked":
        // hack vidí jen tým hackera, zprávu o hacknutém modulu jen tým oběti
        if (shipTeam(e.shipId) === team) events.push(e);
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
