// Общий разбор ганпака для студии и конвейера публикации: опись, проверки, отпечатки стволов.
import { inflateSync } from "fflate";
import { readDrawable } from "@modovik/rage-drawable";
import { gunpackInventory } from "./inventory.js";
import { inspectWeapon, quickChecks } from "./checks.js";

const HOLLOW_TRIANGLES = 4;
const STOPPED_TEXT = "Разбор остановлен.";

export function inflateRawPortable(bytes) {
  return inflateSync(bytes);
}

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function trianglesOf(drawable) {
  let count = 0;
  for (const mesh of drawable?.meshes ?? []) count += (mesh.indices?.length ?? 0) / 3;
  return count;
}

const mainFileOf = ({ files }) =>
  files.find(({ role }) => role === "model") ??
  files.find(({ role }) => role === "model-hi") ??
  files[0];

// Состояние одного разбора: индекс записей дерева, опции и накопленные итоги.
class PackScan {
  #entries;
  #inflateRaw;
  #signal;
  #onProgress;

  constructor(entries, { inflateRaw, signal, onProgress }) {
    // Путь записи читается здесь один раз и раньше описи; при повторах выигрывает последняя запись.
    this.#entries = new Map(entries.map((entry) => [entry.path, entry]));
    this.#inflateRaw = inflateRaw;
    this.#signal = signal;
    this.#onProgress = onProgress;
    this.inspections = {};
    this.fingerprints = {};
  }

  #stopIfAborted() {
    const signal = this.#signal;
    if (signal?.aborted) throw signal.reason || new Error(STOPPED_TEXT);
  }

  #read = async (path) => {
    const entry = this.#entries.get(path);
    if (!entry) throw new Error(`В паке нет файла ${path}.`);
    return entry.read();
  };

  async passWeapons(inventory, deep) {
    const total = inventory.total;
    const onProgress = this.#onProgress;
    let done = 0;
    for (const variant of inventory.variants) {
      for (const weapon of variant.weapons) {
        this.#stopIfAborted();
        weapon.checks = quickChecks(weapon);
        if (!deep) continue;
        onProgress?.({ phase: "weapon", model: weapon.model, done, total });
        await this.#inspect(`${variant.key}|${weapon.model}`, weapon);
        done += 1;
      }
    }
  }

  async #inspect(key, weapon) {
    this.inspections[key] = await inspectWeapon(weapon, {
      read: this.#read,
      inflateRaw: this.#inflateRaw,
    });
    this.fingerprints[key] = await sha256Hex(await this.#read(mainFileOf(weapon).path));
  }

  async passAttachments(inventory) {
    for (const variant of inventory.variants) {
      for (const attachment of variant.attachments ?? []) {
        if (!attachment.hidden) await this.#hideIfHollow(attachment);
      }
    }
  }

  async #hideIfHollow(attachment) {
    this.#stopIfAborted();
    const models = attachment.files.filter(({ role }) => role === "model");
    if (models.length === 0) return;
    for (const { path } of models) {
      if (!this.#isHollow(await this.#read(path))) return;
    }
    attachment.hidden = true;
  }

  // Модель, которую не удалось разобрать, считается непустой.
  #isHollow(bytes) {
    try {
      const parsed = readDrawable(new Uint8Array(bytes), { inflateRaw: this.#inflateRaw });
      return trianglesOf(parsed.drawables[0]) <= HOLLOW_TRIANGLES;
    } catch {
      return false;
    }
  }
}

export async function scanGunpack(
  tree,
  { name = tree?.name || "", inflateRaw = inflateRawPortable, deep = true, signal, onProgress } = {},
) {
  const entries = tree?.files || [];
  const scan = new PackScan(entries, { inflateRaw, signal, onProgress });
  const inventory = gunpackInventory(entries, { name });
  await scan.passWeapons(inventory, deep);
  if (deep) await scan.passAttachments(inventory);
  return { inventory, inspections: scan.inspections, fingerprints: scan.fingerprints };
}

export async function variantDraftInputs(variant, scan) {
  const inspections = {};
  const weapons = {};
  for (const weapon of variant.weapons) {
    const key = `${weapon.variantKey ?? variant.key}|${weapon.model}`;
    const inspection = scan.inspections[key];
    if (inspection) inspections[weapon.model] = inspection;
    const fingerprint = scan.fingerprints[key];
    if (fingerprint) weapons[weapon.model] = fingerprint;
  }
  const parts = Object.values(weapons).sort();
  const pack = parts.length > 0 ? await sha256Hex(new TextEncoder().encode(parts.join("\n"))) : null;
  return { inspections, fingerprints: { pack, weapons } };
}
