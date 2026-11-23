/*
 * Арена мода в файлах (Хелпер 7, 25.10.2026): правки листов мода (`project.mod`, `arena-mod.js`) ложатся на файлы поставленного мода.
 *
 * Мод арены каталога лежит в игре своим контейнером `x64/astral/<имя>.rpf` в `update.rpf` (`modFilesUnder`: имя файла → адрес и
 * владелец). Правка листа — `bakeFile` по имени листа: тон по светотени (у плашки — заливка) или прозрачный лист, как у остальных
 * правок арены; файл с изменённым листом уходит в пакет Astral под тем же именем и закрывает файл мода (пакет мест грузится после
 * `update.rpf`), мод и его остальные файлы остаются на месте. Снимут правку — останется мод.
 *
 * Своя картинка листа (28.10.2026, «замена листа») — `pictures["mod:<лист>"]` (`{ rgba, width, height }`, как у остальных картинок арены): лист мода целиком
 * заменяется ею, растянутой по развёртке; у плашки (до 8 пикселей) картинка не ложится.
 *
 * Мод не поставлен — отказ словами: правка листов лежит поверх его файлов, без них класть нечего.
 */

import { hexBytes } from "@modovik/climb-contract/recolor";
import { ARENA_MOD_PLATE_SIDE, arenaModImageKey, arenaModIsStock, arenaModOp } from "@modovik/climb-contract/recolor/arena-mod";

import { bakeFile } from "./recolor-sheets.js";

/* Файлы мода, где бывают листы: словари и модели со встроенными листами. */
const SHEET_FILE = /\.(ytd|ydr|yft|ydd)$/i;

/**
 * Файлы поставленного мода с правками листов. `mod` — `project.mod`, `over` — `modFilesUnder` (имя строчными → `{ at, owner }`), `game` —
 * чтение игры (`read(адрес)`), `built` — файлы, уже собранные для работы (`[{ name, bytes }]`): лист в таком файле правится поверх.
 * `bake` — подмена `bakeFile` для проверок. Ответ — `{ files, patches, report }`; нет правок — пусто, мод не поставлен — исключение.
 */
export async function buildArenaModSheets({ mod, over, game, built = [], pictures = {}, bake = bakeFile }) {
  const report = { mod: mod?.id || "", files: 0, textures: 0, missing: [] };
  /* Режим «картинка» без картинки у главного процесса — отказ словами, а не молча «как у мода». */
  const lacking = Object.entries(mod?.sheets || {}).filter(([name, look]) => look.mode === "image" && !pictures[arenaModImageKey(name)]).map(([name]) => name);
  if (lacking.length) throw new Error(`Картинка листа мода не пришла (${lacking.slice(0, 3).join(", ")}): выберите её ещё раз и нажмите «Применить».`);
  if (arenaModIsStock(mod)) return { files: [], patches: [], report };
  const own = [...(over || [])].filter(([, item]) => item?.owner === mod.id && SHEET_FILE.test(item.at));
  if (!own.length)
    throw new Error("Мод арены не поставлен: правка его листов ложится поверх его файлов. Поставьте мод арены и нажмите «Применить» ещё раз.");
  const sheets = mod.sheets;
  const ready = new Map(built.map((file) => [String(file.name).toLowerCase(), file]));
  const files = [];
  const patches = [];
  for (const [name, item] of own) {
    const placed = ready.get(name);
    const base = placed ? placed.bytes : await game?.read(item.at).catch(() => null);
    if (!base) {
      report.missing.push(name);
      continue;
    }
    const baked = await bake(base, name, (texture, ref) => {
      const look = sheets[texture];
      if (!look) return null;
      const plate = Math.max(ref?.width || 0, ref?.height || 0) <= ARENA_MOD_PLATE_SIDE;
      return arenaModOp(look, { plate, rgb: look.mode === "colour" ? hexBytes(look.colour) : null, picture: look.mode === "image" ? pictures[arenaModImageKey(texture)] || null : null, aspect: (ref?.width || 1) / Math.max(1, ref?.height || 1) });
    });
    if (!baked.textures.length) continue;
    report.files += 1;
    report.textures += baked.textures.length;
    patches.push({ file: name, mod: mod.id, textures: baked.textures });
    files.push({ name, bytes: baked.bytes });
  }
  return { files, patches, report };
}
