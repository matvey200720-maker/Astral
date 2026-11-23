/*
 * Правки мастерской, которые пересборка каталога обязана оставить в игре.
 *
 * Килл-эффект мастерской — один модификатор `hud_def_desat_cold_kill` в
 * `timecycle_mods_4.xml`, и ставит его нативный патч прямо в живой
 * update.rpf. Движок каталога, пересобирая архив, складывает этот же файл
 * из слоёв своих пакетов (`timecycle-modifier-v1`): у редукса или таймцикла
 * из каталога в файле свой килл-модификатор, почти всегда пустой. Без этой
 * записи любая следующая установка через каталог — ганпак, звук, карта —
 * молча стирала бы килл-эффект: «поставил таймцикл, потом эффект — и эффект
 * пропал».
 *
 * Здесь мастерская записывает, какие модификаторы в каком файле она
 * поставила, и с каким приоритетом: у килл-эффекта он тот же, что у слота
 * `kill-effects` в реестре целей (200 — выше таймцикла, 100). Сборщик
 * таймцикла (`timecycle-composer.js`) кладёт такой модификатор поверх слоёв
 * каталога — но только если в основе архива лежит ровно он. Запись себя
 * проверяет: откатили килл-эффект, вернули файлы проверкой Steam, поставили
 * поверх чужой мод — модификатор в основе уже другой, и запись молчит, а не
 * возвращает в игру то, что человек убрал.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const VERSION = 1;
const MAX_MODIFIERS = 16;
const MAX_XML_BYTES = 64 * 1024;

const gameKey = (gameRoot) =>
  createHash("sha256")
    .update(path.resolve(String(gameRoot || "")).toLowerCase())
    .digest("hex")
    .slice(0, 16);

const storeFile = (stateDir, gameRoot) =>
  path.join(stateDir, "workshop-overlays", `${gameKey(gameRoot)}.json`);

const normalizeEntry = (entry) =>
  String(entry || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

async function readStore(stateDir, gameRoot) {
  try {
    const store = JSON.parse(await fs.readFile(storeFile(stateDir, gameRoot), "utf8"));
    if (store?.version !== VERSION || typeof store.entries !== "object")
      throw new Error("old");
    return store;
  } catch {
    return { version: VERSION, entries: {} };
  }
}

async function writeStore(stateDir, gameRoot, store) {
  const target = storeFile(stateDir, gameRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const stage = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(stage, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(stage, target);
}

/**
 * Запоминает модификаторы работы в файле таймцикла. `modifiers` — имя →
 * текст элемента `<modifier …>` таким, каким он лёг в игру. Пустой набор
 * снимает запись работы.
 */
export async function rememberTimecycleOverlay(
  stateDir,
  { gameRoot, entry, owner, priority, modifiers },
) {
  if (!stateDir || !gameRoot) return;
  const key = normalizeEntry(entry);
  const names = Object.keys(modifiers || {}).slice(0, MAX_MODIFIERS);
  const store = await readStore(stateDir, gameRoot);
  const owners = { ...(store.entries[key] || {}) };
  if (!names.length) delete owners[owner];
  else
    owners[owner] = {
      priority: Math.max(0, Math.min(1000, Math.round(Number(priority) || 0))),
      modifiers: Object.fromEntries(
        names.map((name) => {
          const xml = String(modifiers[name] || "");
          if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
            throw new RangeError(`Модификатор ${name} слишком велик для записи.`);
          return [name.toLowerCase(), xml];
        }),
      ),
      updatedAt: new Date().toISOString(),
    };
  if (Object.keys(owners).length) store.entries[key] = owners;
  else delete store.entries[key];
  await writeStore(stateDir, gameRoot, store);
}

/**
 * Правки мастерской для файла таймцикла: `[{ owner, priority, modifiers }]`,
 * где `modifiers` — имя → текст элемента. Проверку на основу делает сборщик:
 * он один знает, что в основе лежит сейчас.
 */
export async function readTimecycleOverlays(stateDir, gameRoot, entry) {
  if (!stateDir || !gameRoot) return [];
  const store = await readStore(stateDir, gameRoot);
  const owners = store.entries[normalizeEntry(entry)] || {};
  return Object.entries(owners).map(([owner, value]) => ({
    owner,
    priority: Number(value?.priority) || 0,
    modifiers: value?.modifiers && typeof value.modifiers === "object"
      ? value.modifiers
      : {},
  }));
}
