import { MOVE_STEPS, TEAM_COLORS, type GameState, type Pose, type TurnEvent, type TurnResult } from "@spacegame/shared";
import { mineToView, shipToView, torpedoToView, viewFromState, type ViewModel } from "./view.ts";

const MOVE_DURATION = 2200;
const ACTION_DURATION = 450;
const LASER_GAP = 320;

interface Scheduled {
  time: number;
  event: TurnEvent;
  fired: boolean;
}

interface Tween {
  id: string;
  kind: "ship" | "torpedo";
  points: Pose[];
  start: number;
  duration: number;
}

/** Textový popis událostí kola pro log. */
export function describeEvents(result: TurnResult, prev: GameState): string[] {
  const name = (id: string) => {
    const known = prev.ships.find((s) => s.id === id)?.name ?? result.state.ships.find((s) => s.id === id)?.name;
    if (known) return known;
    // loď mimo dohled: jméno odvodíme z id "ship-<hráč>-<n>"
    const m = /^ship-(.+)-(\d+)$/.exec(id);
    const owner = m ? result.state.players.find((p) => p.id === m[1]) : undefined;
    return owner ? `${owner.name} (mimo dohled)` : "neznámá loď";
  };
  const owner = (id: string) => result.state.players.find((p) => p.id === id)?.name ?? "?";
  const die = (f: string) =>
    f === "hit" ? "●" : f === "crit" ? "✸" : f === "focus" ? "◉" : f === "evade" ? "◇" : "○";
  const lines: string[] = [];
  for (const e of result.events) {
    switch (e.type) {
      case "collision":
        lines.push(
          e.with === "ship"
            ? `${name(e.shipId)} se srazil s ${name(e.otherId!)} a byl odmrštěn.`
            : e.with === "asteroid"
              ? `${name(e.shipId)} narazil do asteroidu a byl odmrštěn.`
              : `${name(e.shipId)} narazil do okraje mapy.`,
        );
        break;
      case "asteroidHit":
        lines.push(e.destroyed ? `Asteroid se rozpadl!` : `Výbuch vykousl kus asteroidu.`);
        break;
      case "stress":
        lines.push(`${name(e.shipId)}: stresové body ${e.delta > 0 ? "+" : ""}${e.delta} → ${e.stressPoints}.`);
        break;
      case "damage":
        lines.push(`  ${name(e.shipId)} −${e.amount} (štíty ${e.shieldsAfter}, trup ${e.hullAfter}).`);
        break;
      case "torpedoShot":
        lines.push(`${name(e.shooterId)} pálí na torpédo: ${e.attackDice.map(die).join(" ")} vs ${e.defenseDice.map(die).join(" ")} → ${e.destroyed ? "sestřeleno!" : "minul"}.`);
        break;
      case "mineBlast":
        lines.push(`Výbuch miny: ${e.hits.map((h) => `${name(h.shipId)} −${h.damage}`).join(", ")}.`);
        break;
      case "torpedoHit":
        lines.push(e.shipId ? `Torpédo zasáhlo ${name(e.shipId)}.` : e.blast ? `Torpédo vybuchlo.` : `Torpédo se roztříštilo.`);
        break;
      case "torpedoExpire":
        lines.push(`Torpédu došlo palivo.`);
        break;
      case "laser":
        lines.push(
          `${name(e.shooterId)} → ${name(e.targetId)} (pásmo ${e.rangeBand}): ${e.attackDice.map(die).join(" ")} vs ${e.defenseDice.map(die).join(" ")} → ${e.damage > 0 ? `−${e.damage}` : "minul"}.`,
        );
        break;
      case "action":
        if (!e.ok) lines.push(`${name(e.shipId)}: akce se nepovedla.`);
        break;
      case "destroyed":
        lines.push(`💥 ${name(e.shipId)} byl zničen!`);
        break;
      case "spawnTorpedo":
        lines.push(`${owner(e.torpedo.ownerId)} vypustil torpédo.`);
        break;
      case "spawnMine":
        lines.push(`${owner(e.mine.ownerId)} položil minu.`);
        break;
    }
  }
  return lines;
}

/** Přehrává události kola nad modelem `view`. */
export class TurnAnimation {
  readonly view: ViewModel;
  private schedule: Scheduled[] = [];
  private tweens: Tween[] = [];
  private total = 0;
  private startedAt = 0;
  private started = false;
  finished = false;

  constructor(
    prev: GameState,
    private result: TurnResult,
  ) {
    this.view = viewFromState(prev);
    this.build();
  }

  private build() {
    const ev = this.result.events;
    let lastTime = 0;
    let actionTime = MOVE_DURATION;
    let laserTime = 0;
    let laserCount = 0;
    const actionCount = ev.filter((e) => e.type === "action" && e.ok && e.path).length;
    const lasersStart = MOVE_DURATION + (actionCount > 0 ? ACTION_DURATION + 200 : 200);
    let movePassed = false;

    for (const e of ev) {
      let time: number;
      switch (e.type) {
        case "move":
          time = 0;
          movePassed = true;
          for (const p of e.paths) this.tweens.push({ id: p.id, kind: p.kind, points: p.points, start: 0, duration: MOVE_DURATION });
          break;
        case "collision":
        case "mineBlast":
        case "torpedoHit":
        case "asteroidHit":
          time = e.t * MOVE_DURATION;
          break;
        case "torpedoExpire":
          time = MOVE_DURATION;
          break;
        case "stress":
          time = MOVE_DURATION;
          break;
        case "action":
          time = actionTime;
          if (e.ok && e.path) {
            this.tweens.push({ id: e.shipId, kind: "ship", points: e.path, start: actionTime, duration: ACTION_DURATION });
          }
          break;
        case "laser":
        case "torpedoShot":
          time = lasersStart + laserCount * LASER_GAP;
          laserCount++;
          laserTime = time;
          break;
        case "damage":
        case "destroyed":
          time = lastTime + 60;
          break;
        case "spawnTorpedo":
          time = movePassed ? Math.max(lasersStart, laserTime + LASER_GAP) + 150 : 0;
          break;
        case "spawnMine":
          time = Math.max(lasersStart, laserTime + LASER_GAP) + 150;
          break;
      }
      lastTime = time;
      this.schedule.push({ time, event: e, fired: false });
    }
    this.total = Math.max(MOVE_DURATION + 400, ...this.schedule.map((s) => s.time + 500));
  }

  update(now: number) {
    if (!this.started) {
      this.started = true;
      this.startedAt = now;
    }
    const t = now - this.startedAt;

    for (const s of this.schedule) {
      if (s.fired || s.time > t) continue;
      if (s.event.type !== "spawnTorpedo" || s.time !== 0) continue;
      s.fired = true;
      this.fire(s.event, now);
    }
    for (const tw of this.tweens) {
      const p = Math.min(1, Math.max(0, (t - tw.start) / tw.duration));
      if (p <= 0) continue;
      const pose = interp(tw.points, p);
      const list = tw.kind === "ship" ? this.view.ships : this.view.torpedoes;
      const ent = list.find((x) => x.id === tw.id);
      if (ent) {
        ent.x = pose.x;
        ent.y = pose.y;
        ent.heading = pose.heading;
      }
    }

    for (const s of this.schedule) {
      if (s.fired || s.time > t) continue;
      s.fired = true;
      this.fire(s.event, now);
    }

    this.view.effects = this.view.effects.filter((e) => now - e.start < e.duration);
    if (t >= this.total) this.finished = true;
  }

  private fire(e: TurnEvent, now: number) {
    const v = this.view;
    switch (e.type) {
      case "collision": {
        const s = v.ships.find((x) => x.id === e.shipId);
        if (s) v.effects.push({ kind: "ring", x: s.x, y: s.y, radius: 30, color: "#f8fafc", start: now, duration: 500 });
        break;
      }
      case "mineBlast":
        v.mines = v.mines.filter((m) => m.id !== e.mineId);
        v.effects.push({ kind: "explosion", x: e.x, y: e.y, size: 70, start: now, duration: 700, color: "#f97316" });
        v.effects.push({ kind: "ring", x: e.x, y: e.y, radius: 80, color: "#fb923c", start: now, duration: 600 });
        break;
      case "torpedoHit":
        v.torpedoes = v.torpedoes.filter((t) => t.id !== e.torpedoId);
        v.effects.push({ kind: "explosion", x: e.x, y: e.y, size: e.blast ? 70 : e.shipId ? 40 : 18, start: now, duration: e.blast ? 800 : 600, color: e.blast ? "#f97316" : undefined });
        if (e.blast) v.effects.push({ kind: "ring", x: e.x, y: e.y, radius: 80, color: "#fb923c", start: now, duration: 600 });
        break;
      case "asteroidHit": {
        const a = v.asteroids.find((x) => x.id === e.asteroidId);
        if (a) {
          a.profile = [...e.profile];
          a.version++;
          if (e.destroyed) v.asteroids = v.asteroids.filter((x) => x.id !== e.asteroidId);
        }
        v.effects.push({ kind: "explosion", x: e.x, y: e.y, size: 30, start: now, duration: 700, color: "#a8a29e" });
        break;
      }
      case "torpedoExpire":
        v.torpedoes = v.torpedoes.filter((t) => t.id !== e.torpedoId);
        v.effects.push({ kind: "explosion", x: e.x, y: e.y, size: 10, start: now, duration: 400, color: "#94a3b8" });
        break;
      case "action": {
        const s = v.ships.find((x) => x.id === e.shipId);
        if (!s) break;
        if (e.ok) {
          if (e.action.type === "focus") s.tokens.focus = 1;
          if (e.action.type === "evade") s.tokens.evade = 1;
          if (e.action.type === "lock") s.lockTargetId = e.action.targetId;
          const label =
            e.action.type === "focus" ? "zaměření" : e.action.type === "evade" ? "úhyb" : e.action.type === "lock" ? "zámek" : e.action.type === "boost" ? "přídavný posun" : "úskok";
          v.effects.push({ kind: "text", x: s.x, y: s.y, text: label, color: "#a7f3d0", start: now, duration: 900 });
        } else {
          v.effects.push({ kind: "text", x: s.x, y: s.y, text: "akce zrušena", color: "#fca5a5", start: now, duration: 900 });
        }
        break;
      }
      case "stress": {
        const s = v.ships.find((x) => x.id === e.shipId);
        if (s) {
          s.stressPoints = e.stressPoints;
          v.effects.push({ kind: "text", x: s.x, y: s.y + 20, text: `stres ${e.delta > 0 ? "+" : ""}${e.delta}`, color: "#f472b6", start: now, duration: 900 });
        }
        break;
      }
      case "laser": {
        const shooter = v.ships.find((x) => x.id === e.shooterId);
        const color = TEAM_COLORS[shooter?.team ?? 0];
        v.effects.push({ kind: "laser", from: e.from, to: e.to, color, start: now, duration: 420, hit: e.damage > 0 });
        if (e.damage > 0) v.effects.push({ kind: "explosion", x: e.to.x, y: e.to.y, size: 16, start: now + 120, duration: 400, color: "#fde68a" });
        else v.effects.push({ kind: "text", x: e.to.x, y: e.to.y, text: "minul", color: "#cbd5e1", start: now + 100, duration: 700 });
        if (shooter) {
          shooter.tokens.focus = 0;
          if (shooter.lockTargetId === e.targetId) shooter.lockTargetId = undefined;
        }
        break;
      }
      case "torpedoShot": {
        const shooter = v.ships.find((x) => x.id === e.shooterId);
        const torp = v.torpedoes.find((x) => x.id === e.torpedoId);
        const color = TEAM_COLORS[shooter?.team ?? 0];
        if (shooter) {
          const to = torp ?? { x: e.x, y: e.y, heading: 0 };
          v.effects.push({ kind: "laser", from: { x: shooter.x, y: shooter.y, heading: shooter.heading }, to: { x: to.x, y: to.y, heading: 0 }, color, start: now, duration: 420, hit: e.destroyed });
          if (e.destroyed) {
            v.torpedoes = v.torpedoes.filter((x) => x.id !== e.torpedoId);
            v.effects.push({ kind: "explosion", x: to.x, y: to.y, size: 22, start: now + 100, duration: 500 });
          } else v.effects.push({ kind: "text", x: to.x, y: to.y, text: "minul", color: "#cbd5e1", start: now + 100, duration: 700 });
        }
        break;
      }
      case "damage": {
        const s = v.ships.find((x) => x.id === e.shipId);
        if (!s) break;
        const shieldLoss = s.shields - e.shieldsAfter;
        s.shields = e.shieldsAfter;
        s.hull = e.hullAfter;
        if (shieldLoss > 0) v.effects.push({ kind: "shield", shipId: s.id, start: now, duration: 500 });
        v.effects.push({ kind: "text", x: s.x, y: s.y, text: `−${e.amount}`, color: "#fca5a5", start: now, duration: 900 });
        break;
      }
      case "destroyed": {
        const s = v.ships.find((x) => x.id === e.shipId);
        const x = s?.x ?? e.x;
        const y = s?.y ?? e.y;
        v.ships = v.ships.filter((x) => x.id !== e.shipId);
        v.effects.push({ kind: "explosion", x, y, size: 60, start: now, duration: 900, color: "#f97316" });
        v.effects.push({ kind: "ring", x, y, radius: 60, color: "#fde68a", start: now, duration: 800 });
        break;
      }
      case "spawnTorpedo":
        v.torpedoes.push(torpedoToView(e.torpedo));
        v.effects.push({ kind: "launch", x: e.torpedo.x, y: e.torpedo.y, heading: e.torpedo.heading, color: TEAM_COLORS[e.torpedo.team], start: now, duration: 700 });
        break;
      case "spawnMine":
        v.mines.push(mineToView(e.mine));
        break;
    }
  }

  /** Pro jistotu: po dokončení se model srovná s výsledným stavem. */
  finalView(): ViewModel {
    const final = viewFromState(this.result.state);
    final.effects = this.view.effects;
    return final;
  }
}

function interp(points: Pose[], p: number): Pose {
  if (points.length === 1) return points[0];
  const segs = points.length - 1;
  const f = p * segs;
  const i = Math.min(segs - 1, Math.floor(f));
  const t = f - i;
  const a = points[i];
  const b = points[i + 1];
  // kurz: nejkratší cestou
  let dh = b.heading - a.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  // u otočky (koiogran) je skok 180° až v posledním vzorku – necháme otočit rychle
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: a.heading + dh * t };
}

export { MOVE_STEPS, shipToView };
