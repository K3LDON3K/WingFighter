import { COMET, MODULES, MOVE_STEPS, TEAM_COLORS, type GameState, type Pose, type TurnEvent, type TurnResult } from "@wingfighter/shared";
import { cometToView, mineToView, shipToView, torpedoToView, viewFromState, type ViewModel } from "./view.ts";

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
  kind: "ship" | "torpedo" | "comet";
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
              : e.with === "comet"
                ? `☄ ${name(e.shipId)} byl zasažen kometou a odmrštěn.`
                : `${name(e.shipId)} narazil do okraje mapy.`,
        );
        break;
      case "asteroidHit":
        lines.push(e.destroyed ? `Asteroid se rozpadl!` : `Výbuch vykousl kus asteroidu.`);
        break;
      case "stress":
        lines.push(`${name(e.shipId)}: stresové body ${e.delta > 0 ? "+" : ""}${e.delta} → ${e.stressPoints}.`);
        break;
      case "damage": {
        const abs = e.absorbed ?? 0;
        const segName = ["předek", "pravobok", "záď", "levobok"];
        const where = e.segment !== undefined ? ` do ${segName[e.segment]}` : "";
        lines.push(abs >= e.amount ? `  ${name(e.shipId)}: štít${where} pohltil ${e.amount}.` : `  ${name(e.shipId)} −${e.amount - abs} do trupu${where}${abs ? ` (štít ${abs})` : ""} → trup ${e.hullAfter}.`);
        break;
      }
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
      case "evadePass":
        lines.push(`  ${name(e.shipId)} proletěl skrz ${name(e.victimId)}.`);
        break;
      case "mg":
        lines.push(`${name(e.shooterId)} kulomet → ${name(e.targetId)}: ${e.hits}/${e.shots} zásahů${e.damage ? `, −${e.damage}` : ""}${e.destroyed ? " – zničeno" : ""}.`);
        break;
      case "scan":
        lines.push(e.mode === "ship" ? `${name(e.shipId)} skenoval ${e.targetId ? name(e.targetId) : "loď"}.` : e.mode === "deep" ? `${name(e.shipId)} provedl hluboký sken – mapa odkryta do konce kola.` : `${name(e.shipId)} vynutil cooldown skeneru.`);
        break;
      case "jettison":
        lines.push(`${name(e.shipId)} vyhodil modul ${MODULES[e.debris.type]?.name ?? e.debris.type} (sestřelení = +${e.debris.value} kreditů).`);
        break;
      case "debrisShot":
        lines.push(e.destroyed ? `  ${name(e.shooterId)} sestřelil vyhozený modul: +${e.reward} kreditů.` : `  ${name(e.shooterId)} minul vyhozený modul.`);
        break;
      case "credits":
        if (e.reason === "kill") lines.push(`  ${owner(e.playerId)}: +${e.delta} kreditů za sestřel (celkem ${e.total}).`);
        break;
      case "action":
        if (!e.ok) lines.push(`${name(e.shipId)}: akce se nepovedla.`);
        else if (e.action.type === "evade") lines.push(`${name(e.shipId)} provádí úhybný manévr.`);
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
      case "spawnComet":
        lines.push(`☄ Na okraj mapy přilétá kometa.`);
        break;
      case "cometShot":
        lines.push(e.destroyed ? `  ${name(e.shooterId)} sestřelil kometu: +${e.reward} kreditů.` : e.damage > 0 ? `  ${name(e.shooterId)} zasáhl kometu (−${e.damage}, zbývá ${e.hullAfter}).` : `  ${name(e.shooterId)} minul kometu.`);
        break;
      case "cometGone":
        lines.push(
          e.reason === "ship"
            ? `☄ Kometa narazila do ${name(e.shipId!)} (−${e.damage}).`
            : e.reason === "asteroid"
              ? `☄ Kometa se roztříštila o asteroid.`
              : e.reason === "torpedo"
                ? `☄ Kometa se srazila s torpédem.`
                : e.reason === "mine"
                  ? `☄ Kometa spustila minu.`
                  : `☄ Kometa odletěla z mapy.`,
        );
        break;
      case "cometTail":
        lines.push(
          e.effect === "shield"
            ? `  ${name(e.shipId)} proletěl ocasem komety: štít +${e.amount}.`
            : e.effect === "segment"
              ? `  ${name(e.shipId)} proletěl ocasem komety: segment ${["předek", "pravobok", "záď", "levobok"][e.segment ?? 0]} +1.`
              : e.effect === "hull"
                ? `  ${name(e.shipId)} proletěl ocasem komety: trup +${e.amount}.`
                : e.effect === "stress"
                  ? `  ${name(e.shipId)} proletěl ocasem komety: stres obnoven, +${e.amount} kreditů.`
                  : `  ${name(e.shipId)} proletěl ocasem komety: +${e.amount} kreditů.`,
        );
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
  private pendingMines: { at: number; mine: import("@wingfighter/shared").Mine }[] = [];
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
    // lasery se střílí na začátku kola (před pohybem): nejdřív salvy, pak start pohybu
    const preLasers = ev.filter((e, i) => (e.type === "laser" || e.type === "torpedoShot" || e.type === "cometShot" || e.type === "mg" || e.type === "debrisShot") && !ev.slice(0, i).some((x) => x.type === "move")).length;
    const moveStart = preLasers > 0 ? preLasers * LASER_GAP + 350 : 0;
    actionTime = moveStart + MOVE_DURATION;
    const lasersStart = moveStart + MOVE_DURATION + (actionCount > 0 ? ACTION_DURATION + 200 : 200);
    let movePassed = false;
    let preCount = 0;

    for (const e of ev) {
      let time: number;
      switch (e.type) {
        case "move":
          time = moveStart;
          movePassed = true;
          for (const p of e.paths) this.tweens.push({ id: p.id, kind: p.kind, points: p.points, start: moveStart, duration: MOVE_DURATION });
          break;
        case "collision":
        case "mineBlast":
        case "torpedoHit":
        case "asteroidHit":
        case "cometGone":
        case "cometTail":
          time = moveStart + e.t * MOVE_DURATION;
          break;
        case "spawnComet":
          time = 0;
          break;
        case "cometShot":
          if (!movePassed) {
            time = preCount * LASER_GAP;
            preCount++;
          } else {
            time = lasersStart + laserCount * LASER_GAP;
            laserCount++;
            laserTime = time;
          }
          break;
        case "torpedoExpire":
          time = moveStart + MOVE_DURATION;
          break;
        case "stress":
          time = moveStart + MOVE_DURATION;
          break;
        case "evadePass":
          time = moveStart + e.t * MOVE_DURATION;
          break;
        case "jettison":
          time = 0;
          break;
        case "debrisShot":
          if (!movePassed) {
            time = preCount * LASER_GAP;
            preCount++;
          } else {
            time = lasersStart + laserCount * LASER_GAP;
            laserCount++;
            laserTime = time;
          }
          break;
        case "credits":
          time = e.reason === "survive" ? moveStart + MOVE_DURATION + 300 : lastTime + 80;
          break;
        case "scan":
          time = 0;
          break;
        case "action":
          time = movePassed ? actionTime : 0;
          if (e.ok && e.path) {
            this.tweens.push({ id: e.shipId, kind: "ship", points: e.path, start: actionTime, duration: ACTION_DURATION });
          }
          break;
        case "laser":
        case "mg":
        case "torpedoShot":
          if (!movePassed) {
            time = preCount * LASER_GAP;
            preCount++;
          } else {
            time = lasersStart + laserCount * LASER_GAP;
            laserCount++;
            laserTime = time;
          }
          break;
        case "damage":
        case "destroyed":
          time = lastTime + 60;
          break;
        case "spawnTorpedo":
          time = movePassed ? Math.max(lasersStart, laserTime + LASER_GAP) + 150 : moveStart;
          break;
        case "spawnMine":
          time = movePassed ? Math.max(lasersStart, laserTime + LASER_GAP) + 150 : moveStart;
          break;
      }
      lastTime = time;
      this.schedule.push({ time, event: e, fired: false });
    }
    this.total = Math.max(moveStart + MOVE_DURATION + 400, ...this.schedule.map((s) => s.time + 500));
  }

  update(now: number) {
    if (!this.started) {
      this.started = true;
      this.startedAt = now;
    }
    const t = now - this.startedAt;

    for (const s of this.schedule) {
      if (s.fired || s.time > t) continue;
      if (s.event.type !== "spawnTorpedo" && s.event.type !== "spawnComet") continue;
      s.fired = true;
      this.fire(s.event, now);
    }
    for (const tw of this.tweens) {
      const p = Math.min(1, Math.max(0, (t - tw.start) / tw.duration));
      if (p <= 0) continue;
      const pose = interp(tw.points, p);
      const list = tw.kind === "ship" ? this.view.ships : tw.kind === "comet" ? this.view.comets : this.view.torpedoes;
      let ent = list.find((x) => x.id === tw.id);
      if (!ent && tw.kind === "comet") {
        // kometa, kterou jsme neviděli přilétat (vletěla do dohledu během kola)
        const src = this.result.state.comets?.find((c) => c.id === tw.id);
        const nc = src ? cometToView(src) : { id: tw.id, x: pose.x, y: pose.y, heading: pose.heading, radius: COMET.radius, hull: COMET.hull, maxHull: COMET.hull, speed: COMET.speed, tailUsed: [] };
        this.view.comets.push(nc);
        ent = nc;
      }
      if (ent) {
        ent.x = pose.x;
        ent.y = pose.y;
        ent.heading = pose.heading;
        // kývání při úhybném manévru: zatočení ±14° a vlnění do stran, utlumí se ke konci dráhy
        if (tw.kind === "ship") {
          const es = ent as { evading?: boolean; roll?: number };
          if (es.evading && p < 1) {
            // sudový překrut: fáze otáčení kolem podélné osy (renderer podle ní zužuje sprite) + lehké vlnění do stran
            es.roll = (p * 3 * Math.PI * 2) % (Math.PI * 2);
            const w = Math.sin(p * Math.PI * 6);
            ent.x += -Math.sin(pose.heading) * w * 6;
            ent.y += Math.cos(pose.heading) * w * 6;
          } else if (es.evading && p >= 1) {
            es.evading = false;
            es.roll = undefined;
          }
        }
      }
    }

    for (const s of this.schedule) {
      if (s.fired || s.time > t) continue;
      s.fired = true;
      this.fire(s.event, now);
    }

    for (const pm of [...this.pendingMines]) {
      if (now >= pm.at) {
        this.view.mines.push(mineToView(pm.mine));
        this.view.effects.push({ kind: "ring", x: pm.mine.x, y: pm.mine.y, radius: pm.mine.radius, color: TEAM_COLORS[pm.mine.team], start: now, duration: 500 });
        this.pendingMines = this.pendingMines.filter((x) => x !== pm);
      }
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
      case "jettison": {
        const sh = v.ships.find((x) => x.id === e.shipId);
        v.debris.push({ ...e.debris });
        if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: `VYHOZEN ${MODULES[e.debris.type]?.short ?? ""}`, color: "#94a3b8", start: now, duration: 1000 });
        break;
      }
      case "debrisShot": {
        const shooter = v.ships.find((x) => x.id === e.shooterId);
        const color = shooter ? TEAM_COLORS[shooter.team] : "#fff";
        if (shooter) v.effects.push({ kind: "laser", from: { x: shooter.x, y: shooter.y, heading: shooter.heading }, to: { x: e.x, y: e.y, heading: 0 }, color, start: now, duration: 420, hit: e.destroyed });
        if (e.destroyed) {
          v.debris = v.debris.filter((d) => d.id !== e.debrisId);
          v.effects.push({ kind: "explosion", x: e.x, y: e.y, size: 20, start: now + 200, duration: 600, color: "#94a3b8" });
          v.effects.push({ kind: "text", x: e.x, y: e.y, text: `+${e.reward} CR`, color: "#fbbf24", start: now + 250, duration: 1000 });
        }
        break;
      }
      case "credits": {
        if (e.reason === "kill") {
          const sh = v.ships.find((x) => x.alive && this.result.state.ships.find((q) => q.id === x.id)?.ownerId === e.playerId);
          if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: `+${e.delta} CR`, color: "#fbbf24", start: now, duration: 1100 });
        }
        break;
      }
      case "evadePass": {
        const victim = v.ships.find((x) => x.id === e.victimId);
        v.effects.push({ kind: "ripple", x: e.x, y: e.y, color: "#7dd3fc", start: now, duration: 700 });
        if (victim) v.effects.push({ kind: "text", x: victim.x, y: victim.y, text: "PRŮLET −1 STRES", color: "#f472b6", start: now + 100, duration: 1000 });
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
          if (e.action.type === "evade") s.evading = true;
          if (e.action.type === "focus") s.tokens.focus = 1;
          if (e.action.type === "evade") s.tokens.evade = 1;
          if (e.action.type === "lock") s.lockTargetId = e.action.targetId;
          const label =
            e.action.type === "focus" ? "zaměření" : e.action.type === "evade" ? "ÚHYBNÝ MANÉVR" : e.action.type === "lock" ? "zámek" : e.action.type === "boost" ? "přídavný posun" : "úskok";
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
      case "mg": {
        const shooter = v.ships.find((x) => x.id === e.shooterId);
        const n = e.shots;
        for (let i = 0; i < n; i++) {
          v.effects.push({ kind: "tracer", from: e.from, to: e.to, angle: e.spread[i] ?? 0, hit: i < e.hits, start: now + i * 35, duration: 320 });
        }
        if (e.hits > 0) v.effects.push({ kind: "text", x: e.to.x, y: e.to.y, text: `${e.hits}/${e.shots}${e.damage ? ` −${e.damage}` : ""}`, color: "#fde047", start: now + n * 35 + 100, duration: 900 });
        else v.effects.push({ kind: "text", x: e.to.x, y: e.to.y, text: "minul", color: "#cbd5e1", start: now + n * 35 + 100, duration: 700 });
        if (e.destroyed) {
          v.torpedoes = v.torpedoes.filter((x) => x.id !== e.targetId);
          v.debris = v.debris.filter((x) => x.id !== e.targetId);
          v.effects.push({ kind: "explosion", x: e.to.x, y: e.to.y, size: 18, start: now + n * 35 + 150, duration: 500 });
        }
        if (shooter) {
          const mod = this.result.state.ships.find((x) => x.id === shooter.id)?.loadout.modules.find((m) => m.type === "mg");
          void mod;
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
        s.shields = e.shieldsAfter;
        s.hull = e.hullAfter;
        if (e.segmentsAfter) s.segments = [...e.segmentsAfter] as import("@wingfighter/shared").Segments;
        if (e.effAfter !== undefined) s.shieldEff = e.effAfter;
        const absorbed = e.absorbed ?? 0;
        if (absorbed > 0) {
          if (e.segment !== undefined) v.effects.push({ kind: "segmentHit", shipId: s.id, segment: e.segment, start: now, duration: 600 });
          else v.effects.push({ kind: "shield", shipId: s.id, start: now, duration: 500 });
        }
        const hullDmg = e.amount - absorbed;
        const txt = hullDmg > 0 ? `−${hullDmg}` : "ŠTÍT";
        v.effects.push({ kind: "text", x: s.x, y: s.y, text: txt, color: hullDmg > 0 ? "#fca5a5" : "#7dd3fc", start: now, duration: 900 });
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
      case "spawnComet":
        if (!v.comets.some((c) => c.id === e.comet.id)) v.comets.push(cometToView(e.comet));
        v.effects.push({ kind: "text", x: e.comet.x, y: e.comet.y, text: "KOMETA", color: "#a5f3fc", start: now, duration: 1200 });
        break;
      case "cometShot": {
        const shooter = v.ships.find((x) => x.id === e.shooterId);
        const com = v.comets.find((x) => x.id === e.cometId);
        const to = com ?? { x: e.x, y: e.y };
        if (shooter) v.effects.push({ kind: "laser", from: { x: shooter.x, y: shooter.y, heading: shooter.heading }, to: { x: to.x, y: to.y, heading: 0 }, color: TEAM_COLORS[shooter.team], start: now, duration: 420, hit: e.damage > 0 });
        if (com) com.hull = e.hullAfter;
        if (e.destroyed) {
          v.comets = v.comets.filter((x) => x.id !== e.cometId);
          v.effects.push({ kind: "explosion", x: to.x, y: to.y, size: 26, start: now + 150, duration: 600, color: "#a5f3fc" });
          v.effects.push({ kind: "text", x: to.x, y: to.y, text: `+${e.reward} CR`, color: "#fbbf24", start: now + 250, duration: 1000 });
        } else v.effects.push({ kind: "text", x: to.x, y: to.y, text: e.damage > 0 ? `−${e.damage}` : "minul", color: e.damage > 0 ? "#a5f3fc" : "#cbd5e1", start: now + 150, duration: 700 });
        break;
      }
      case "cometGone":
        v.comets = v.comets.filter((x) => x.id !== e.cometId);
        if (e.reason === "edge") break;
        v.effects.push({ kind: "explosion", x: e.x, y: e.y, size: e.reason === "ship" ? 36 : 24, start: now, duration: 600, color: "#a5f3fc" });
        if (e.reason === "ship") v.effects.push({ kind: "ring", x: e.x, y: e.y, radius: 40, color: "#67e8f9", start: now, duration: 500 });
        break;
      case "cometTail": {
        const s = v.ships.find((x) => x.id === e.shipId);
        const com = v.comets.find((x) => x.id === e.cometId);
        if (com && !com.tailUsed.includes(e.shipId)) com.tailUsed.push(e.shipId);
        v.effects.push({ kind: "ripple", x: e.x, y: e.y, color: "#67e8f9", start: now, duration: 700 });
        const segName = ["PŘEDEK", "PRAVOBOK", "ZÁĎ", "LEVOBOK"];
        const txt = e.effect === "shield" ? `+${e.amount} ŠTÍT` : e.effect === "segment" ? `+1 ŠTÍT ${segName[e.segment ?? 0]}` : e.effect === "hull" ? `+${e.amount} TRUP` : e.effect === "stress" ? `STRES OBNOVEN · +${e.amount} CR` : `+${e.amount} CR`;
        v.effects.push({ kind: "text", x: e.x, y: (s?.y ?? e.y) - 4, text: txt, color: e.effect === "credits" || e.effect === "stress" ? "#fbbf24" : "#67e8f9", start: now + 100, duration: 1100 });
        if (s) {
          if (e.effect === "shield") s.shields = Math.min(s.maxShields, s.shields + e.amount);
          if (e.effect === "segment" && e.segment !== undefined) s.segments[e.segment] = s.segments[e.segment] + 1;
          if (e.effect === "hull") s.hull = Math.min(s.maxHull, s.hull + e.amount);
          if (e.effect !== "credits") v.effects.push({ kind: "shield", shipId: s.id, start: now, duration: 600 });
        }
        break;
      }
      case "spawnMine": {
        // odhození: mina letí od lodi na místo, pak se objeví s polem
        const owner = v.ships.find((s) => s.id.startsWith(`ship-${e.mine.ownerId}-`) && s.team === e.mine.team);
        const from = owner ? { x: owner.x, y: owner.y } : { x: e.mine.x, y: e.mine.y };
        const dur = 550;
        v.effects.push({ kind: "drop", from, to: { x: e.mine.x, y: e.mine.y }, color: TEAM_COLORS[e.mine.team], start: now, duration: dur });
        this.pendingMines.push({ at: now + dur, mine: e.mine });
        break;
      }
    }
  }

  /** Pro jistotu: po dokončení se model srovná s výsledným stavem. */
  finalView(): ViewModel {
    this.pendingMines = [];
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
