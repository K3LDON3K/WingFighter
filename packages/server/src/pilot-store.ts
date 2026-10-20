import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_PILOTS, pilotList, sanitizePilots, setPilots, type PilotDef } from "@wingfighter/shared";

/** Editovaní piloti: pilots.json v kořeni projektu (vedle tuning.json). */
const here = fileURLToPath(new URL(".", import.meta.url));
export const PILOTS_FILE = resolve(here, "../../../pilots.json");

export function loadPilots(): PilotDef[] {
  try {
    if (existsSync(PILOTS_FILE)) {
      const list = sanitizePilots(JSON.parse(readFileSync(PILOTS_FILE, "utf8")));
      if (list) setPilots(list);
    }
  } catch (e) {
    console.warn("pilots.json se nepodařilo načíst:", e);
  }
  return pilotList();
}

export function savePilots(list: PilotDef[]): void {
  setPilots(list);
  writeFileSync(PILOTS_FILE, JSON.stringify(pilotList(), null, 2) + "\n", "utf8");
}

export function resetPilots(): PilotDef[] {
  setPilots(BUILTIN_PILOTS);
  writeFileSync(PILOTS_FILE, JSON.stringify(pilotList(), null, 2) + "\n", "utf8");
  return pilotList();
}
