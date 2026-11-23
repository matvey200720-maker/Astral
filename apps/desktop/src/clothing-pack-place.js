/*
 * Где вещь лежит в паке игры — для замены на Majestic (25.10.2026).
 *
 * Majestic не грузит Astral Clothing DLC (`@modovik/clothing/majestic-dlc`),
 * поэтому замена идёт в сам пак игры, где вещь лежит. Адрес берётся из
 * оглавления одежды игры игрока (`game-clothing-index.js`): пак, вложенный
 * архив моделей и точные имена файлов вещи — модель и все её расцветки. Под
 * этими именами и пишется замена: ни лишней расцветки, ни чужого суффикса.
 *
 * Вещи серверных паков Majestic (`…_mp_[mf]_clothes_pack0..3`) в оглавлении нет:
 * у них свой маршрут, сюда они не доходят (`majesticOverlayPlace` в
 * `clothing-replace.js`). Прочая вещь без места в игре — отказ словами, а не
 * установка «в пустоту», как было с Astral Clothing DLC.
 */

import { indexPlace, majesticPlaceProblem } from "@modovik/clothing/game-assortment";
import { laterCopies } from "@modovik/clothing/later-copies";
import { majesticLoadsPack } from "@modovik/clothing/majestic-dlc";
import { readGameClothingIndex } from "./game-clothing-index.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/**
 * `content.xml` основы штатного пака — движку, чтобы вписать в него свой
 * overlay-RPF (`install-engine/pack-overlay.js`). `output` — куда положить файл.
 * `entry` — другая запись верхнего уровня пака (`setup2.xml`: число подпакетов, `pack-subpack-setup.js`); по умолчанию `content.xml`.
 */
export async function readPackContentXml({ baseArchive, archiveTarget, gameRoot, edition, output, entry = "content.xml", signal = null }) {
  if (!baseArchive || !output)
    throw refusal("CLOTHING_PACK_CONTENT", `Не указан архив пака или куда положить его ${entry}.`);
  const { extractRpfEntry } = await import("./rpf-composer.js");
  return extractRpfEntry({ archivePath: baseArchive, entry, output, archiveTarget, gameRoot, edition, signal });
}

/* Папка пропсов дополнения — как в `game-assortment.js`. */
const propsFolder = (folder) =>
  folder.replace(/^(mp_[mf]_freemode_01)_/i, "$1_p_");
const lastSegment = (dir) =>
  String(dir || "").slice(String(dir || "").lastIndexOf("/") + 1);

/**
 * Место вещи в оглавлении игры:
 * `{ pack, archive, inner, folder, model, textures: [имена], base }` или `null`. `base` — вещь базовой игры (`x64v.rpf`), не дополнения.
 */
export function placeInIndex(index, target) {
  const folder = String(target?.folder || "").toLowerCase();
  for (const collection of index?.collections || []) {
    const section = collection[target.gender];
    if (!section) continue;
    for (const item of section.items || []) {
      if (item.component !== target.component) continue;
      if (item.drawable !== target.drawable) continue;
      const own = item.dir
        ? lastSegment(item.dir)
        : item.prop
          ? propsFolder(section.folder || "")
          : section.folder || "";
      if (own.toLowerCase() !== folder) continue;
      const place = { ...indexPlace(collection, item), archive: collection.archive, folder };
      /* Копии файлов вещи в паках, что грузятся позже (патч-паки): запись только в пак вещи в игре не видна (`@modovik/clothing/later-copies`). */
      return { ...place, laterCopies: laterCopies(index, place) };
    }
  }
  return null;
}

/**
 * Что можно писать на Majestic для этой вещи — или отказ словами.
 * `index` — оглавление игры; `target` — вещь из окна (`normalizeReplaceTarget`).
 */
export function majesticPackPlace(index, target) {
  const place = placeInIndex(index, target);
  if (!place)
    throw refusal(
      "CLOTHING_REPLACE_MAJESTIC_PACK",
      `Вещи «${target.name || target.folder}» нет среди файлов вашей GTA V, и маршрута замены на Majestic для неё у Astral нет. Выберите другую вещь в «На что поставить?».`,
    );
  /* Правило то же, что у окна (`majesticPlaceProblem` в `majesticLocalSet`): вещь, которой здесь откажут, в выборе на Majestic не стоит. */
  const problem = majesticPlaceProblem(place);
  /* Вещь базовой игры лежит в `x64v.rpf`, а не в пакете дополнения: замену в пак Majestic там писать некуда. */
  if (problem === "base")
    throw refusal(
      "CLOTHING_REPLACE_MAJESTIC_PACK",
      `Вещь «${target.name || target.folder}» — из базовой игры, а не из пакета: на Majestic файлами игры её заменить нельзя.`,
    );
  if (problem === "pack")
    throw refusal(
      "CLOTHING_REPLACE_MAJESTIC_PACK",
      `Majestic не грузит пак «${place.pack}» (его нет в белом списке клиента), поэтому замена на «${target.name || target.folder}» не появилась бы в игре. Выберите вещь из другого пака.`,
    );
  if (problem === "files")
    throw refusal(
      "CLOTHING_REPLACE_MAJESTIC_PACK",
      `Файлов вещи «${target.name || target.folder}» нет в архиве моделей пака «${place.pack}» — заменять нечего.`,
    );
  if (problem === "order")
    throw refusal(
      "CLOTHING_REPLACE_MAJESTIC_PACK",
      `Не все файлы вашей игры удалось прочитать (не открылись: dlclist.xml): порядок паков неизвестен, а файлы вещи «${target.name || target.folder}» лежат в нескольких архивах. Astral не станет писать вслепую. Закройте игру и лаунчеры и нажмите «Установить» ещё раз.`,
    );
  if (problem === "later")
    throw refusal(
      "CLOTHING_REPLACE_MAJESTIC_PACK",
      `Файлы вещи «${target.name || target.folder}» перекрыты копиями в паках игры, которые Majestic не грузит (${place.laterCopies.filter((copy) => !majesticLoadsPack(copy.pack)).map((copy) => copy.pack).join(", ")}): замена в пак «${place.pack}» в игре не появилась бы. Выберите другую вещь.`,
    );
  return place;
}

/**
 * Оглавление и место вещи в нём. Вещи нет, а оглавление неполное (`index.incomplete`: замок, нет ключей, битый архив) — это ещё не «вещи нет в игре»: оглавление собирают заново
 * (сбой мог пройти), а если не сошлось — отказ `CLOTHING_REPLACE_INDEX_INCOMPLETE` с названием того, что не прочиталось, вместо тихого запасного маршрута (находка 3 ревью 14.11.2026).
 */
async function placeInReadIndex({ gameRoot, stateDir, keysDirectory, target, readIndex }) {
  const input = { gameRoot, stateDir, keysDirectory };
  let index = await readIndex(input);
  let place = placeInIndex(index, target);
  if (!place && index?.incomplete?.length) {
    index = await readIndex(input, { refresh: true });
    place = placeInIndex(index, target);
    if (!place && index?.incomplete?.length)
      throw refusal(
        "CLOTHING_REPLACE_INDEX_INCOMPLETE",
        `Не все файлы вашей игры удалось прочитать (не открылись: ${index.incomplete.slice(0, 6).join(", ")}), и вещи «${target?.name || target?.folder || "?"}» среди прочитанных нет. Заменёнка не установлена — закройте игру и повторите.`,
      );
  }
  return { index, place };
}

/** Читает оглавление и ищет в нём вещь (подменяется в тестах). */
export async function findPackPlace({
  gameRoot,
  stateDir,
  keysDirectory,
  target,
  readIndex = readGameClothingIndex,
}) {
  const { index } = await placeInReadIndex({ gameRoot, stateDir, keysDirectory, target, readIndex });
  return majesticPackPlace(index, target);
}

/**
 * Вещь в файлах игры игрока без требования белого списка: у замены на GTA5RP число расцветок берётся по игре, а не по посту автора
 * («Спортивная водолазка» — 11 цветов в посте, 12 у вещи в игре: двенадцатая оставалась штатной). `null` — вещи в игре нет.
 */
export async function findGamePlace({
  gameRoot,
  stateDir,
  keysDirectory,
  target,
  readIndex = readGameClothingIndex,
}) {
  return (await placeInReadIndex({ gameRoot, stateDir, keysDirectory, target, readIndex })).place;
}
