import { CARGO, COMET, MODULES, MOVE_STEPS, SCANNER, TEAM_COLORS, type GameState, type Pose, type TurnEvent, type TurnResult } from "@wingfighter/shared";
import { cometToView, mineToView, shipToView, torpedoToView, viewFromState, type ViewModel } from "./view.ts";
import { sfxAt } from "../sound.ts";

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
      case "borderStorm":
        lines.push(`⚡ ${name(e.shipId)} letěl okrajovou bouří (${Math.round(e.fraction * 100)} % kola): trup −${e.damage}.`);
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
        const pierce = e.pierced ? (e.kind === "energy" ? ` – laser pronikl segmenty (${e.pierced})` : ` – průraz štítu (${e.pierced})`) : "";
        lines.push(abs >= e.amount ? `  ${name(e.shipId)}: štít${where} pohltil ${e.amount}.` : `  ${name(e.shipId)} −${e.amount - abs} do trupu${where}${abs ? ` (štít ${abs})` : ""}${pierce} → trup ${e.hullAfter}.`);
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
      case "evadeThrough":
        lines.push(`  ${name(e.shipId)} úhybem proletěl skrz ${e.with === "asteroid" ? "asteroid" : "kometu"}.`);
        break;
      case "mg":
        lines.push(`${name(e.shooterId)} kulomet → ${name(e.targetId)}: ${e.hits}/${e.shots} zásahů${e.damage ? `, −${e.damage}` : ""}${e.destroyed ? " – zničeno" : ""}.`);
        break;
      case "droid":
        lines.push(`${name(e.shipId)}: droid – ${[e.overdrive ? "overdrive" : "", e.autopilot ? "autopilot" : ""].filter(Boolean).join(" + ")} (−${e.cost} technologie).`);
        break;
      case "shieldRecharge": {
        const segName = ["předek", "pravobok", "záď", "levobok"];
        const what = e.amount !== undefined ? `+${e.amount} zásoby → ${e.shieldsAfter}` : `+${(e.segments ?? []).reduce((a, b) => a + b, 0)} bodů (${(e.segments ?? []).map((n, i) => (n ? `${segName[i]} +${n}` : "")).filter(Boolean).join(", ")})`;
        lines.push(`${name(e.shipId)} dobil štít technologií: ${what} (−${e.cost} technologie, zbývá ${e.techPoints}).`);
        break;
      }
      case "repair": {
        const mt = e.moduleType ? MODULES[e.moduleType]?.name ?? e.moduleType : "";
        const what = e.kind === "module" ? `opravil modul ${mt} (+${e.amount})` : e.kind === "ammo" ? `vyrobil náboj do ${mt}` : e.kind === "hull" ? `opravil trup o ${e.amount} → ${e.hullAfter}` : `nasadil ${mt}${e.swappedType ? ` (výměnou za ${MODULES[e.swappedType]?.name ?? e.swappedType})` : ""}`;
        lines.push(`${name(e.shipId)}: opravář ${what} (−${e.cost} technologie, zbývá ${e.techPoints}).`);
        break;
      }
      case "hack": {
        const mt = e.moduleType ? MODULES[e.moduleType]?.name ?? e.moduleType : "";
        const what = e.kind === "mine" ? `hackl minu${e.timer !== undefined ? ` (odpočet ${e.timer === 1 ? "start kola" : `${e.timer - 1} ${e.timer - 1 === 1 ? "kolo" : "kola"}`})` : ""}` : e.kind === "torpedo" ? `hackl torpédo → nový cíl ${e.victimId ? name(e.victimId) : "?"}` : e.kind === "module" ? `hackl ${mt} lodi ${name(e.victimId ?? "")} (na toto kolo nefunguje)` : "zapnul pasivní opravu trupu";
        lines.push(`${name(e.shipId)}: hacker ${what} (−${e.cost} technologie, zbývá ${e.techPoints}).`);
        break;
      }
      case "hacked":
        lines.push(`⚠ ${name(e.shipId)}: systém ${MODULES[e.moduleType]?.name ?? e.moduleType} byl na toto kolo HACKNUT – nefunguje.`);
        break;
      case "autoRepair":
        lines.push(`${name(e.shipId)}: pasivní oprava trupu +${e.amount} → ${e.hullAfter}${e.turnsLeft > 0 ? ` (zbývá ${e.turnsLeft} kol)` : " (konec)"}.`);
        break;
      case "scan":
        lines.push(e.mode === "ship" ? `${name(e.shipId)} skenoval ${e.targetId ? name(e.targetId) : "loď"}.` : e.mode === "deep" ? `${name(e.shipId)} provedl hluboký sken – mapa odkryta do konce kola.` : e.mode === "predict" ? `${name(e.shipId)} skenerem předpovídá manévry botů (${SCANNER.predictTurns} kola).` : `${name(e.shipId)} vynutil cooldown skeneru.`);
        break;
      case "jettison":
        if (e.dropped) lines.push(`Z vraku ${name(e.shipId)} vypadl modul ${MODULES[e.debris.type]?.name ?? e.debris.type}${e.debris.module && (e.debris.module.hp ?? 1) <= 0 ? " (zničený)" : ""} – lze zvednout.`);
        else lines.push(`${name(e.shipId)} vyhodil modul ${MODULES[e.debris.type]?.name ?? e.debris.type} (sestřelení = +${e.debris.value} kreditů).`);
        break;
      case "moduleDamage":
        lines.push(e.broken ? `🔧 ${name(e.shipId)}: modul ${MODULES[e.moduleType]?.name ?? e.moduleType} je zničen – přestal fungovat.` : `${name(e.shipId)}: modul ${MODULES[e.moduleType]?.name ?? e.moduleType} poškozen (−${e.damage}, zbývá ${e.hp}/${e.maxHp}).`);
        break;
      case "stationPickup":
        lines.push(e.ok ? `${name(e.shipId)} nabral ze stanice modul: ${e.module ? MODULES[e.module.type]?.name ?? e.module.type : "modul"} (ve stanici zbývá ${e.stockLeft}).` : `${name(e.shipId)} nenabral modul ze stanice – ${e.reason === "speed" ? `letěl rychleji než ${CARGO.maxSpeed}` : e.reason === "full" ? "nákladový prostor je plný" : e.reason === "empty" ? "zásoba stanice je prázdná" : "nebyl v okruhu sběru"}.`);
        break;
      case "stationOrder":
        lines.push(e.ok ? `${name(e.shipId)} objednal ze stanice ${MODULES[e.moduleType]?.name ?? e.moduleType} za ${e.price} kreditů – stanice ho vypustila jako trosky.` : `${name(e.shipId)}: objednávka ze stanice selhala – ${e.reason === "broken" ? "stanice je rozbitá" : e.reason === "credits" ? "nedostatek kreditů" : e.reason === "busy" ? "linka obsazena (1 objednávka za kolo)" : e.reason === "range" ? "stanice není v dohledu" : "neplatný modul"}.`);
        break;
      case "stationHit":
        lines.push(`${e.shooterId ? name(e.shooterId) + " zasáhl" : "Zásah"} stanici: −${e.damage}${e.absorbed ? ` (štít ${e.absorbed})` : ""}, trup ${e.hullAfter}, štít ${e.shieldsAfter}.`);
        break;
      case "stationDestroyed":
        lines.push(`💥 Stanice zničena${e.byId ? ` (${name(e.byId)}${e.reward ? `, +${e.reward} kreditů` : ""})` : ""} – zůstává rozbitá.`);
        break;
      case "pickup":
        lines.push(
          e.ok
            ? `${name(e.shipId)} zvedl náklad: ${e.module ? MODULES[e.module.type]?.name ?? e.module.type : "modul"}.`
            : e.reason === "lost"
              ? `${name(e.shipId)} se přetahoval o náklad, ale ${name(e.winnerId!)} byl pomalejší/blíž a získal ho.`
              : e.reason === "speed"
                ? `${name(e.shipId)} nezvedl náklad – letěl rychleji než ${CARGO.maxSpeed}.`
                : e.reason === "full"
                  ? `${name(e.shipId)} nezvedl náklad – nákladový prostor je plný.`
                  : e.reason === "gone"
                    ? `${name(e.shipId)} nezvedl náklad – předmět už tam není.`
                    : `${name(e.shipId)} nezvedl náklad – nic v dosahu.`,
        );
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
                  : e.reason === "comet"
                    ? `☄ Dvě komety se srazily a roztříštily.`
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
                  : e.effect === "tech"
                    ? `  ${name(e.shipId)} proletěl ocasem komety: technologie +${e.amount}.`
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
  /** Průběh přehrávání 0..1 (pro plynulé rozjetí a dojetí průběžných animací, např. ocasu komety). */
  progress = 0;

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
        case "borderStorm":
          time = moveStart + MOVE_DURATION;
          break;
        case "stress":
          time = moveStart + MOVE_DURATION;
          break;
        case "evadePass":
        case "evadeThrough":
          time = moveStart + e.t * MOVE_DURATION;
          break;
        case "jettison":
          time = e.dropped ? lastTime + 120 : 0;
          break;
        case "pickup":
        case "stationPickup":
        case "stationOrder":
          if (!movePassed) {
            time = preCount * LASER_GAP;
            preCount++;
          } else time = moveStart;
          break;
        case "stationHit":
        case "stationDestroyed":
          time = e.t ? moveStart + e.t * MOVE_DURATION : lastTime + 60;
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
        case "droid":
        case "repair":
        case "hack":
        case "hacked":
        case "shieldRecharge":
          time = 0;
          break;
        case "autoRepair":
          time = lastTime + 80;
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
        case "moduleDamage":
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
    this.progress = this.total > 0 ? Math.min(1, t / this.total) : 1;

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
      if (!ent && tw.kind === "ship") {
        // cizí loď, která vletěla do dohledu během kola: zobrazíme ji od začátku její dráhy
        const src = this.result.state.ships.find((x) => x.id === tw.id);
        if (src) {
          const ns = shipToView(src);
          this.view.ships.push(ns);
          ent = ns;
        }
      }
      if (!ent && tw.kind === "torpedo") {
        const src = this.result.state.torpedoes.find((x) => x.id === tw.id);
        if (src) {
          const nt = torpedoToView(src);
          this.view.torpedoes.push(nt);
          ent = nt;
        }
      }
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
        // úhybný manévr: loď přesně sleduje nakreslenou dráhu i rychlost, navíc jen sudový překrut (bez vlnění do stran)
        if (tw.kind === "ship") {
          const es = ent as { evading?: boolean; roll?: number };
          if (es.evading && p < 1) {
            // fáze otáčení kolem podélné osy (renderer podle ní zužuje sprite)
            es.roll = (p * 3 * Math.PI * 2) % (Math.PI * 2);
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
    this.sound(e);
    switch (e.type) {
      case "collision": {
        const s = v.ships.find((x) => x.id === e.shipId);
        if (s) v.effects.push({ kind: "ring", x: s.x, y: s.y, radius: 30, color: "#f8fafc", start: now, duration: 500 });
        break;
      }
      case "jettison": {
        const sh = v.ships.find((x) => x.id === e.shipId);
        v.debris.push({ ...e.debris });
        if (sh && e.shieldType) sh.shieldType = e.shieldType; // vyhozený štít: prstenec zmizí hned
        if (e.dropped) {
          // modul vylétá z vraku do místa trosek
          const from = sh ? { x: sh.x, y: sh.y } : { x: e.debris.x, y: e.debris.y };
          v.effects.push({ kind: "drop", from, to: { x: e.debris.x, y: e.debris.y }, color: "#94a3b8", start: now, duration: 500 });
        } else if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: `VYHOZEN ${MODULES[e.debris.type]?.short ?? ""}`, color: "#94a3b8", start: now, duration: 1000 });
        break;
      }
      case "moduleDamage": {
        const sh = v.ships.find((x) => x.id === e.shipId);
        if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y + 14, text: e.broken ? `${MODULES[e.moduleType]?.short ?? "MODUL"} ZNIČEN` : `${MODULES[e.moduleType]?.short ?? "MODUL"} −${e.damage}`, color: e.broken ? "#f87171" : "#fdba74", start: now + 150, duration: e.broken ? 1400 : 900 });
        break;
      }
      case "pickup": {
        const sh = v.ships.find((x) => x.id === e.shipId);
        if (e.ok) {
          v.debris = v.debris.filter((d) => d.id !== e.debrisId);
          if (sh) v.effects.push({ kind: "drop", from: { x: e.x, y: e.y }, to: { x: sh.x, y: sh.y }, color: "#a7f3d0", start: now, duration: 500 });
          if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: "+NÁKLAD", color: "#a7f3d0", start: now + 400, duration: 1000 });
        } else if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: e.reason === "lost" ? "NÁKLAD UCHVÁCEN" : e.reason === "speed" ? "MOC RYCHLE" : "NÁKLAD NEZVEDNUT", color: "#fca5a5", start: now, duration: 1000 });
        break;
      }
      case "stationPickup": {
        const sh = v.ships.find((x) => x.id === e.shipId);
        const st = v.stations?.find((x) => x.id === e.stationId);
        if (sh && e.ok) {
          if (st) v.effects.push({ kind: "drop", from: { x: st.x, y: st.y }, to: { x: sh.x, y: sh.y }, color: "#a7f3d0", start: now, duration: 600 });
          v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: "+MODUL ZE STANICE", color: "#a7f3d0", start: now + 400, duration: 1000 });
          if (st) st.stock = e.stockLeft;
        } else if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: e.reason === "speed" ? "MOC RYCHLE" : e.reason === "empty" ? "STANICE PRÁZDNÁ" : e.reason === "full" ? "NÁKLAD PLNÝ" : "MIMO OKRUH", color: "#fca5a5", start: now, duration: 1000 });
        break;
      }
      case "stationOrder": {
        const sh = v.ships.find((x) => x.id === e.shipId);
        const st = v.stations?.find((x) => x.id === e.stationId);
        if (e.ok && e.debris) {
          v.debris.push({ ...e.debris });
          if (st) v.effects.push({ kind: "drop", from: { x: st.x, y: st.y }, to: { x: e.debris.x, y: e.debris.y }, color: "#fde68a", start: now, duration: 600 });
          if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: `OBJEDNÁNO −${e.price}`, color: "#fde68a", start: now, duration: 1000 });
        } else if (sh) v.effects.push({ kind: "text", x: sh.x, y: sh.y, text: e.reason === "busy" ? "LINKA OBSAZENA" : e.reason === "credits" ? "MÁLO KREDITŮ" : "OBJEDNÁVKA SELHALA", color: "#fca5a5", start: now, duration: 1000 });
        break;
      }
      case "stationHit": {
        const st = v.stations?.find((x) => x.id === e.stationId);
        if (st) {
          st.hull = e.hullAfter;
          st.shields = e.shieldsAfter;
          v.effects.push({ kind: "text", x: st.x, y: st.y - 30, text: `−${e.damage}`, color: e.absorbed ? "#67e8f9" : "#fdba74", start: now, duration: 800 });
        }
        break;
      }
      case "stationDestroyed": {
        const st = v.stations?.find((x) => x.id === e.stationId);
        if (st) {
          st.broken = true;
          st.shields = 0;
          st.hull = 0;
          v.effects.push({ kind: "explosion", x: st.x, y: st.y, size: 150, start: now, duration: 900, color: "#fb923c" });
          v.effects.push({ kind: "text", x: st.x, y: st.y - 40, text: "STANICE ZNIČENA", color: "#f87171", start: now + 200, duration: 1600 });
        }
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
      case "evadeThrough":
        v.effects.push({ kind: "ripple", x: e.x, y: e.y, color: e.with === "comet" ? "#67e8f9" : "#d6d3d1", start: now, duration: 700 });
        break;
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
        if (e.ok && e.action.type === "shield") {
          // přerozdělení segmentů platí od začátku kola – ve view hned, aby se štít během animace nevracel na starý stav
          s.segments = [...e.action.segments] as import("@wingfighter/shared").Segments;
          break;
        }
        if (e.ok && (e.action.type === "jettison" || e.action.type === "pickup")) break; // mají vlastní události
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
      case "borderStorm": {
        const s = v.ships.find((x) => x.id === e.shipId);
        if (s) {
          v.effects.push({ kind: "ring", x: s.x, y: s.y, radius: 26, color: "#c084fc", start: now, duration: 500 });
          v.effects.push({ kind: "text", x: s.x, y: s.y - 6, text: `⚡ BOUŘE −${e.damage}`, color: "#e879f9", start: now + 80, duration: 1100 });
        }
        break;
      }
      case "cometTail": {
        const s = v.ships.find((x) => x.id === e.shipId);
        const com = v.comets.find((x) => x.id === e.cometId);
        if (com && !com.tailUsed.includes(e.shipId)) com.tailUsed.push(e.shipId);
        v.effects.push({ kind: "ripple", x: e.x, y: e.y, color: "#67e8f9", start: now, duration: 700 });
        const segName = ["PŘEDEK", "PRAVOBOK", "ZÁĎ", "LEVOBOK"];
        const txt = e.effect === "shield" ? `+${e.amount} ŠTÍT` : e.effect === "segment" ? `+1 ŠTÍT ${segName[e.segment ?? 0]}` : e.effect === "hull" ? `+${e.amount} TRUP` : e.effect === "stress" ? `STRES OBNOVEN · +${e.amount} CR` : e.effect === "tech" ? `+${e.amount} TECHNOLOGIE` : `+${e.amount} CR`;
        v.effects.push({ kind: "text", x: e.x, y: (s?.y ?? e.y) - (e.effect === "tech" ? 18 : 4), text: txt, color: e.effect === "credits" || e.effect === "stress" || e.effect === "tech" ? "#fbbf24" : "#67e8f9", start: now + (e.effect === "tech" ? 400 : 100), duration: 1100 });
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

  /** Zvuk k události (prostorově ztišený podle vzdálenosti od vlastních lodí). */
  private sound(e: TurnEvent) {
    const v = this.view;
    const at = (id: string) => v.ships.find((x) => x.id === id);
    switch (e.type) {
      case "collision": {
        const s = at(e.shipId);
        if (s) sfxAt("collision", s.x, s.y);
        break;
      }
      case "laser":
        sfxAt("laser", e.from.x, e.from.y);
        setTimeout(() => sfxAt(e.damage > 0 ? "laserHit" : "laserMiss", e.to.x, e.to.y), 120);
        break;
      case "mg":
        sfxAt("mg", e.from.x, e.from.y);
        break;
      case "torpedoShot":
      case "debrisShot":
      case "cometShot": {
        const sh = at(e.shooterId);
        if (sh) sfxAt("laser", sh.x, sh.y);
        if (e.destroyed) setTimeout(() => sfxAt("explosion", e.x, e.y), 150);
        break;
      }
      case "spawnTorpedo":
        sfxAt("torpedoLaunch", e.torpedo.x, e.torpedo.y);
        break;
      case "spawnMine":
        sfxAt("mine", e.mine.x, e.mine.y);
        break;
      case "torpedoHit":
      case "mineBlast":
        sfxAt("explosion", e.x, e.y);
        break;
      case "cometGone":
        if (e.reason !== "edge") sfxAt("explosion", e.x, e.y);
        break;
      case "spawnComet":
        sfxAt("comet", e.comet.x, e.comet.y);
        break;
      case "cometTail":
        sfxAt("cometTail", e.x, e.y);
        break;
      case "destroyed":
        sfxAt("bigExplosion", e.x, e.y);
        break;
      case "moduleDamage": {
        const s = at(e.shipId);
        if (s && e.broken) sfxAt("moduleBreak", s.x, s.y);
        break;
      }
      case "damage": {
        const s = at(e.shipId);
        if (!s) break;
        const absorbed = e.absorbed ?? 0;
        sfxAt(absorbed >= e.amount ? "shieldHit" : "hullHit", s.x, s.y);
        break;
      }
      case "evadePass":
      case "evadeThrough":
        sfxAt("evade", e.x, e.y);
        break;
      case "pickup":
        if (e.ok) sfxAt("pickup", e.x, e.y);
        break;
      case "action":
        if (e.ok && e.action.type === "evade") {
          const s = at(e.shipId);
          if (s) sfxAt("evade", s.x, s.y);
        }
        break;
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
