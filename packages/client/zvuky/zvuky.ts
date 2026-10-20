import { h } from "../src/dom.ts";
import { label } from "../src/icons.ts";
import { getVolume, isMuted, setMuted, setVolume, sfx, SFX_NAMES, unlockAudio, type SfxName } from "../src/sound.ts";

const DESC: Record<SfxName, [string, string]> = {
  click: ["Klik", "obyčejné tlačítko v UI"],
  toggle: ["Zapnutí akce", "výběr akce (lasery, úhyb…)"],
  cancel: ["Zrušení", "křížek / vypnutí akce"],
  error: ["Chyba", "nelze: žádná volná akce, mimo dosah…"],
  launch: ["Spustit kolo", "Enter / tlačítko SPUSTIT KOLO"],
  turnStart: ["Nové kolo", "začátek plánování po vyhodnocení"],
  laser: ["Laser – výstřel", "salva laserů"],
  laserHit: ["Laser – zásah", "paprsek dopadl"],
  laserMiss: ["Laser – minul", "slabé cvaknutí"],
  mg: ["Kulomet", "dávka projektilů"],
  torpedoLaunch: ["Torpédo – start", "vypuštění torpéda"],
  explosion: ["Výbuch", "torpédo, mina, kometa"],
  bigExplosion: ["Zničení lodi", "velký výbuch"],
  collision: ["Náraz", "loď, asteroid, okraj mapy"],
  shieldHit: ["Zásah štítu", "štít pohltil zranění"],
  hullHit: ["Zásah trupu", "zranění do trupu"],
  evade: ["Úhyb", "průlet skrz loď / asteroid"],
  scan: ["Sken lodi", "ping skeneru"],
  deepScan: ["Hluboký sken", "odkrytí mapy"],
  pickup: ["Zvednutí nákladu", "trosky do nákladu"],
  comet: ["Kometa", "přílet komety"],
  cometTail: ["Ocas komety", "průlet ocasem – doplnění štítu"],
  storm: ["Bouře", "praskání v elektromagnetické bouři"],
  mine: ["Mina", "položení / aktivace miny"],
  join: ["Hráč se připojil", "lobby"],
  win: ["Výhra", "konec bitvy – vítězství"],
  lose: ["Prohra", "konec bitvy – porážka"],
};

const app = document.getElementById("app")!;
const vol = h("input", { type: "range", min: "0", max: "100", value: String(Math.round(getVolume() * 100)), oninput: (e) => setVolume(Number((e.target as HTMLInputElement).value) / 100) });
const mute = h("input", { type: "checkbox", checked: isMuted(), onchange: (e) => setMuted((e.target as HTMLInputElement).checked) });
app.append(
  h("div", { class: "card" }, h("h3", {}, label("Ukázka zvuků")), h("div", { class: "txt muted" }, "Klikni na zvuk. Všechny jsou syntetizované v prohlížeči (Web Audio), žádné soubory. Napiš, které upravit – výšku, délku, charakter."), h("div", { class: "vol" }, h("span", {}, label("Hlasitost")), vol, h("label", {}, mute, " ", label("ztlumit")))),
  h("div", { class: "card" }, h("h3", {}, label("Rozhraní")), h("div", { class: "grid" }, ...(["click", "toggle", "cancel", "error", "launch", "turnStart", "join"] as SfxName[]).map(btn))),
  h("div", { class: "card" }, h("h3", {}, label("Boj")), h("div", { class: "grid" }, ...(["laser", "laserHit", "laserMiss", "mg", "torpedoLaunch", "mine", "explosion", "bigExplosion", "collision", "shieldHit", "hullHit", "evade"] as SfxName[]).map(btn))),
  h("div", { class: "card" }, h("h3", {}, label("Speciální a konec")), h("div", { class: "grid" }, ...(["scan", "deepScan", "pickup", "comet", "cometTail", "storm", "win", "lose"] as SfxName[]).map(btn))),
);
function btn(n: SfxName) {
  const [t, d] = DESC[n];
  return h("button", { class: "px", onclick: () => (unlockAudio(), sfx(n)) }, h("b", {}, label(t)), h("span", {}, d));
}
void SFX_NAMES;
