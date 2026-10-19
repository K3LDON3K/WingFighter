import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TUNING, sanitizeTuning, type Tuning } from "@spacegame/shared";

/** Uložené ladicí parametry: soubor tuning.json v kořeni projektu. */
const here = fileURLToPath(new URL(".", import.meta.url));
export const TUNING_FILE = resolve(here, "../../../tuning.json");

let saved: Tuning | null = null;

export function loadSavedTuning(): Tuning | null {
  try {
    if (!existsSync(TUNING_FILE)) return (saved = null);
    saved = sanitizeTuning(JSON.parse(readFileSync(TUNING_FILE, "utf8")), DEFAULT_TUNING);
    return saved;
  } catch (e) {
    console.warn("tuning.json se nepodařilo načíst:", e);
    return (saved = null);
  }
}

export function getSavedTuning(): Tuning | null {
  return saved;
}

export function saveTuning(t: Tuning): void {
  writeFileSync(TUNING_FILE, JSON.stringify(t, null, 2) + "\n", "utf8");
  saved = { ...t };
}

/** Výchozí hodnoty pro novou místnost: uložené, jinak tovární. */
export function initialTuning(): Tuning {
  return { ...(saved ?? DEFAULT_TUNING) };
}
