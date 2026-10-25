/** Strukturované vysvětlivky tlačítek akcí (varianta B): název + cena, štítky efektů, poznámka. */
import { CARGO, DROID, LASER, MG, MINE, RULES, SCANNER, STRESS, TORPEDO, cargoCapacity, laserRange, mgRange, torpedoLockRange, torpedoPointRange, effEvadeCost, effStressCost, loadoutWeight, type Maneuver, type Ship, type ShipOrders } from "@wingfighter/shared";
import type { TipSpec } from "../tooltip.ts";

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/** Vysvětlivka akce z lišty. `man` = aktuálně nakreslený manévr (pro cenu stresu). */
export function actionTip(id: string, ship: Ship, o: ShipOrders, man: Maneuver | null | undefined, warn?: string | null): TipSpec {
  const over = !!o.droid?.overdrive;
  const w = warn ? { warn: `Nelze: ${warn}.` } : {};
  switch (id) {
    case "move": {
      const st = man ? effStressCost(man, o) : 0;
      return {
        icon: "pen",
        iconColor: "#e2e8f0",
        title: "Manévr",
        cost: { actions: 1, stress: st },
        fx: [
          { icon: "ship", text: "tažení z lodi = směr a rychlost" },
          { icon: "speed", text: "kolečko / 1–5 = rychlost" },
          { icon: "tick", text: "klik / mezerník = potvrdit", tone: "good" },
          { icon: "stress", text: `oranžový −${STRESS.costRed} · nebezpečný (červený) −${STRESS.costDanger} stres` + (over ? " (overdrive: 0)" : "") },
        ],
        note: "rovně stejnou rychlostí zdarma",
        ...w,
      };
    }
    case "koiogran":
      return {
        icon: "turn",
        iconColor: "#e2e8f0",
        title: "Otočka 180°",
        cost: { actions: over ? 1 : 2, stress: man?.koiogran ? effStressCost(man, o) : effStressCost("red", o) },
        fx: [
          { icon: "ship", text: "na konci křivky se otočí o 180°" },
          { icon: "speed", text: `rychlost −${RULES.koiogranSpeedDrop} po otočce`, tone: "bad" },
          { icon: "stress", text: over ? "overdrive: bez stresu" : `stres: zelená/bílá ${STRESS.costRed} · oranžová ${STRESS.costRed + 1} · nebezpečná ${STRESS.costDanger + 1}`, tone: over ? "good" : undefined },
        ],
        note: "od rychlosti 2 · zapni před kreslením i po něm",
        ...w,
      };
    case "evade":
      return {
        icon: "evade",
        iconColor: "#e2e8f0",
        title: "Úhyb",
        cost: { actions: 1, stress: effEvadeCost(o) },
        fx: [
          { icon: "ship", text: "proletí skrz lodě, asteroidy, komety" },
          { icon: "stress", text: `nepřítel při průletu −${RULES.evadePassStress} stres` },
          { icon: "shield", text: `zranění minou / torpédem −${RULES.evadeDamageReduction} %`, tone: "good" },
          { icon: "hull", text: "konec v asteroidu / kometě = 2× zranění", tone: "bad" },
        ],
        ...w,
      };
    case "laser":
      return {
        icon: "laser",
        iconColor: "#f87171",
        title: "Lasery",
        cost: { actions: 1 },
        fx: [
          { icon: "clock", text: "na začátku kola, před pohybem" },
          { icon: "target", text: `výseč ±${deg(LASER.halfArc)}° · dostřel ${laserRange(ship)}` },
          { icon: "eye", text: "cíl: označený, jinak nejbližší" },
          { icon: "hull", text: `${RULES.damagePerHit} za zásah`, tone: "bad" },
        ],
        note: "v bouři nefungují · jeden laser za akci",
        ...w,
      };
    case "mg":
      return {
        icon: "mg",
        iconColor: "#fde047",
        title: "Kulomet",
        cost: { actions: 1 },
        fx: [
          { icon: "clock", text: "na začátku kola, před pohybem" },
          { icon: "target", text: `výseč ±${deg(MG.halfArc)}° · dosah ${mgRange(ship)}` },
          { icon: "mg", text: `dávka ${MG.burst} × ${MG.damage}`, tone: "bad" },
          { icon: "eye", text: "i torpéda, trosky, komety" },
        ],
        note: "funguje i v bouři · šance klesá s dálkou",
        ...w,
      };
    case "torpedo":
      return {
        icon: "torpedo",
        iconColor: "#fb923c",
        title: "Torpédo",
        cost: { actions: 1 },
        fx: [
          { icon: "target", text: `zaměření lodi do ${torpedoLockRange(ship)}` },
          { icon: "target", text: `nebo bod do ${torpedoPointRange(ship)}` },
          { icon: "clock", text: `letí ${TORPEDO.lifeTurns} kol` },
          { icon: "hull", text: `${TORPEDO.damage} přímo · výbuch ${TORPEDO.blastDamage}`, tone: "bad" },
        ],
        note: "každé torpédo loď odlehčí",
        ...w,
      };
    case "mine":
      return {
        icon: "mine",
        iconColor: "#fbbf24",
        title: "Mina",
        cost: { actions: 1 },
        fx: [
          { icon: "ship", text: "odhodí za loď / do strany" },
          { icon: "hull", text: `zranění ${MINE.damage} · dosah ${MINE.radius}`, tone: "bad" },
          { icon: "clock", text: "časovač 1–3 kola nebo kontaktní" },
        ],
        note: "spouští lodě, torpéda i komety",
        ...w,
      };
    case "shield":
      return {
        icon: "segments",
        iconColor: "#60a5fa",
        title: "Štít",
        cost: { actions: 1 },
        fx: [
          { icon: "segments", text: "přerozdělí body segmentů" },
          { icon: "clock", text: "platí od začátku kola", tone: "good" },
        ],
        note: `stejný součet · max ${RULES.segmentMax} na segment · beze změny zdarma`,
        ...w,
      };
    case "jettison":
      return {
        icon: "debris",
        iconColor: "#94a3b8",
        title: "Vyhodit modul",
        cost: { actions: 1 },
        fx: [
          { icon: "weight", text: `váha teď ${loadoutWeight(ship.loadout)} · lehčí loď = rychlejší`, tone: "good" },
          { icon: "clock", text: "na začátku kola" },
          { icon: "credits", text: "trosky za lodí – sestřel = kredity" },
        ],
        ...w,
      };
    case "pickup":
      return {
        icon: "cargo",
        iconColor: "#94a3b8",
        title: "Zvednout náklad",
        cost: { actions: 1 },
        fx: [
          { icon: "target", text: `trosky do ${CARGO.range} od lodi` },
          { icon: "speed", text: `rychlost manévru ≤ ${CARGO.maxSpeed}` },
          { icon: "cargo", text: `náklad ${(ship.loadout.cargo ?? []).length}/${cargoCapacity(ship.loadout)}` },
          { icon: "weight", text: "náklad jen váží", tone: "bad" },
        ],
        note: "po střelbě, před pohybem · pomalejší loď vyhrává",
        ...w,
      };
    case "scanner":
      return {
        icon: "scan",
        iconColor: "#a78bfa",
        title: "Skener",
        cost: { tech: SCANNER.shipCost },
        fx: [
          { icon: "ship", text: `sken lodi ${SCANNER.shipCost} tech · do ${SCANNER.range}` },
          { icon: "deep", text: `vesmír ${SCANNER.deepCost} tech · do ${SCANNER.deepRange}` },
          { icon: "clock", text: "proběhne hned", tone: "good" },
        ],
        note: "nebere akci · v bouři nefunguje",
        ...w,
      };
    case "scan-ship":
      return {
        icon: "ship",
        iconColor: "#a78bfa",
        title: "Sken lodi",
        cost: { tech: SCANNER.shipCost },
        fx: [
          { icon: "eye", text: "ukáže výbavu, natočení, munici, pilota" },
          { icon: "target", text: `cizí loď v dohledu do ${SCANNER.range}` },
          { icon: "clock", text: "proběhne hned", tone: "good" },
        ],
        note: "nebere akci",
        ...w,
      };
    case "scan-deep":
      return {
        icon: "deep",
        iconColor: "#a78bfa",
        title: "Vesmír",
        cost: { tech: SCANNER.deepCost },
        fx: [
          { icon: "eye", text: `odkryje mapu do ${SCANNER.deepRange}` },
          { icon: "people", text: "celému týmu do konce kola" },
          { icon: "clock", text: "proběhne hned", tone: "good" },
        ],
        note: "nebere akci",
        ...w,
      };
    case "recharge":
      return {
        icon: "shield",
        iconColor: "#60a5fa",
        title: "Dobít štít",
        cost: { tech: RULES.rechargeTechCost },
        fx: [
          ship.shieldType === "whole" ? { icon: "shield", text: `energetický +${RULES.rechargeWhole} zásoby`, tone: "good" } : { icon: "shield", text: `segmentový +${RULES.rechargeSegments} body (kam zvolíš)`, tone: "good" },
          { icon: "clock", text: "proběhne hned", tone: "good" },
        ],
        note: `technologie ${ship.techPoints}/${ship.stats.techMax} · nebere akci · 1× za kolo · v bouři nefunguje`,
        ...w,
      };
    case "droid":
      return {
        icon: "bot",
        iconColor: "#c084fc",
        title: "Droid – pilot",
        cost: {},
        fx: [
          { icon: "speed", text: `overdrive ${DROID.overdriveCost} tech` },
          { icon: "turn", text: `autopilot ${DROID.autopilotCost} tech` },
          { icon: "clock", text: "platí se při SPUSTIT KOLO", tone: "good" },
        ],
        note: `technologie ${ship.techPoints}/${ship.stats.techMax} · nebere akci · v bouři nefunguje`,
        ...w,
      };
    case "overdrive":
      return {
        icon: "speed",
        iconColor: "#c084fc",
        title: "Overdrive",
        cost: { tech: DROID.overdriveCost },
        fx: [
          { icon: "stress", text: "stres za manévry: 0" },
          { icon: "turn", text: "otočka: 1 akce" },
          { icon: "evade", text: "úhyb bez stresu" },
          { icon: "hull", text: "nebezpečný bez ztráty trupu", tone: "good" },
          { icon: "weight", text: "rychlost ignoruje váhu", tone: "good" },
        ],
        note: "nebere akci · platí se při SPUSTIT KOLO · zrušení zdarma",
        ...w,
      };
    case "autopilot":
      return {
        icon: "turn",
        iconColor: "#c084fc",
        title: "Autopilot",
        cost: { tech: DROID.autopilotCost },
        fx: [{ icon: "stress", text: `zelený manévr vrátí +${DROID.autopilotRegen} stres (místo +${STRESS.regenGreen})`, tone: "good" }],
        note: "nebere akci · platí se při SPUSTIT KOLO · zrušení zdarma",
        ...w,
      };
    default:
      return { icon: "target", title: id, fx: [], ...w };
  }
}
