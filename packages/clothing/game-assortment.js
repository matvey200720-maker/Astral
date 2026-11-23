/*
 * Вещи самой игры для «На что поставить?» — из оглавления одежды игрока
 * (`apps/desktop/src/game-clothing-index.js`).
 *
 * Сервер называет вещь по-своему, а игра — по-своему: «Детская улыбка» из
 * ограбления казино, «Бордовая маска с прорезями» из байкеров. Это та же вещь,
 * что стоит у человека в гардеробе, и ставить замену можно на любую из них:
 * на RP-сервере чужая вещь, на любом — вещь игры.
 *
 * «Магазин» вещи — дополнение (коллекция), в котором она вышла. Разбивки по
 * Binco, Suburban и Ponsonbys в файлах игры нет: у всех вещей `CLO_SHOP_LOW`,
 * а какая вещь в каком магазине, решает скрипт игры. Поэтому полка в выборе —
 * «Ограбление казино», «Байкеры», «Обновление 02.2023».
 *
 * Строки ответа плоские и короткие: оглавление — тысячи вещей, а окну нужны
 * пол, вид, папка, номер, число цветов, имя и полка.
 */

import { assortmentItem } from "./assortment.js";
import { stubColourIndices } from "./colour-files.js";
import { markGloveBlocks } from "./glove-forms.js";
import { withLooks } from "./game-looks.js";
import { majesticLoadsPack, majesticOverlayFolder } from "./majestic-dlc.js";
import { laterCopies } from "./later-copies.js";

const lastSegment = (dir) =>
  String(dir || "").slice(String(dir || "").lastIndexOf("/") + 1);

/* Папка пропсов дополнения: `mp_m_freemode_01_p_<дополнение>`. */
const propsFolder = (folder) =>
  folder.replace(/^(mp_[mf]_freemode_01)_/i, "$1_p_");

/** Название полки вещей базовой игры (`x64v.rpf`, без дополнений): так она стоит в оглавлении и в строках окна. */
export const BASE_SHOP = "GTA V";

/* Вложенный архив моделей пака — как его принимает движок (`install-engine/pack-overlay.js`). */
const MAJESTIC_INNER = /^x64\/models\/cdimages\/(?:peds\/)?[a-z0-9_]{1,64}\.rpf$/;

/**
 * Что мешает заменить вещь на Majestic файлами игры: `"base"` — вещь базовой игры, `"pack"` — пака нет в белом списке клиента, `"files"` —
 * у вещи нет модели или расцветок в архиве моделей пака; `null` — ставится. `place` — место вещи в оглавлении (`placeInIndex` в
 * `apps/desktop/src/clothing-pack-place.js`: `{ pack, base, inner, model, textures }`). Одно правило для установки (отказ словами) и для
 * окна (`majesticLocalSet`: вещь без маршрута в выборе не стоит).
 */
export function majesticPlaceProblem(place) {
  if (place.base) return "base";
  if (!majesticLoadsPack(place.pack)) return "pack";
  /* Вещь из штатного подпакета (`dlc1.rpf`, `dlc2.rpf`: у `mpheist4`, `mpsecurity`, `mpbattle` и мужских `mptuner`, 22.11.2026): замена пишется в `dlc.rpf` пака (`clothingPackTarget`), а её вложенного архива там нет —
     запись ушла бы не в тот архив, и игра её не увидела бы. Пока запись в подпакет не умеем, вещь без маршрута, как в 1.0.1 (до оглавления с подпакетами у неё не было модели): причина та же, `"files"`. Снять вместе с `subpack` в `indexPlace`,
     когда установка станет писать в `place.archive` вещи, а покраска — читать оттуда (`clothing-paint.js`). */
  if (place.subpack || !place.model || !place.textures?.length || !MAJESTIC_INNER.test(place.inner || "")) return "files";
  /* Файл вещи перекрыт копией в патч-паке, который клиент не грузит (`patch2025_*`, `*_g9ec`…): запись в пак вещи игра не увидит, а в сам патч писать нельзя (`later-copies.js`). */
  if (place.laterCopies?.some((copy) => !majesticLoadsPack(copy.pack))) return "later";
  /* Копия есть, а порядок паков не прочитался (`dlclist.xml`): кто позже, неизвестно — писать «на месте» вслепую нельзя (ревью 15.11, №4). */
  if (place.laterCopies?.orderMissing) return "order";
  /* Замок манифеста принимает вложенный архив копии только такой же формы, как у пака вещи: иначе маршрут пустил бы вещь, а замок отказал бы уже после запекания (ревью 15.11, №10). */
  if (place.laterCopies?.some((copy) => !MAJESTIC_INNER.test(copy.inner || ""))) return "later";
  return null;
}

/** Место вещи оглавления для `majesticPlaceProblem` — как его отдаёт `placeInIndex`. */
export const indexPlace = (collection, item) => ({
  pack: collection.pack,
  base: Boolean(collection.base),
  inner: item.dir ? item.dir.slice(0, item.dir.lastIndexOf("/")) : null,
  /* Вещь лежит в штатном подпакете пака (`item.archive` ставит оглавление версии 8), а не в его `dlc.rpf`: `majesticPlaceProblem` даёт ей `"files"`, пока запись в подпакет не умеем. */
  subpack: Boolean(item.archive),
  model: item.model || null,
  textures: (item.textureFiles || []).map((file) => file.name),
  /* Доп. модели вещи (`hair_003_u_1.ydd`…): заменёнка пишет и их (`model-variants.js`). */
  alternates: Array.isArray(item.alternates) ? item.alternates.map(String) : [],
});

/**
 * Папка вещи в оглавлении: у вещи из вложенного архива — последний сегмент её каталога, у пропса — папка пропсов дополнения, иначе папка
 * секции. Так названа вещь в строках окна (`folder`) и так её находит снимок (`apps/desktop/src/game-item-shot.js`).
 */
export const itemFolder = (section, item) =>
  item.dir ? lastSegment(item.dir) : item.prop ? propsFolder(section.folder) : section.folder;

/**
 * Пустышка игры — модель в полкилобайта (один четырёхугольник в стороне от тела: у Legacy у вещи нового обновления мужского файла нет),
 * вещь — сотни килобайт. Такой вещи нет ни на персонаже, ни на снимке, и в выборе «На что поставить» ей не место.
 */
export const BLANK_MODEL_BYTES = 2048;

/**
 * Оглавление игры → плоские строки для окна. `looks` — таблица одинаковых вещей (`looksIndex`): у строки группы — `look`, `lookRep`, `lookForms`. Пустышка помечена `blank: true`, если ни в одной записи вещи нет настоящей модели: заплатка
 * Rockstar кладёт модель отдельной записью, и вещь с заплаткой пустышкой не считается.
 */
export function gameAssortmentRows(index, looks = null) {
  const rows = [];
  const keyOf = (gender, section, item) =>
    `${gender}|${item.component}|${String(itemFolder(section, item) || "").toLowerCase()}|${item.drawable}`;
  const real = new Set();
  for (const collection of index?.collections || [])
    for (const gender of ["male", "female"]) {
      const section = collection[gender];
      for (const item of section?.items || [])
        if (item.modelSize >= BLANK_MODEL_BYTES) real.add(keyOf(gender, section, item));
    }
  /* Можно ли заменить вещь на Majestic — по первой записи вещи в оглавлении: установка берёт её же (`placeInIndex`, первое совпадение). */
  const majestic = new Map();
  const overlaid = new Map();
  for (const collection of index?.collections || []) {
    for (const gender of ["male", "female"]) {
      const section = collection[gender];
      if (!section) continue;
      for (const item of section.items || []) {
        const folder = itemFolder(section, item);
        if (!folder) continue;
        const key = keyOf(gender, section, item);
        /* Копии файлов вещи в патч-паках (`later-copies.js`): по ним вещь «перекрыта», а перекрытая не белым паком — не ставится на месте. */
        const later = laterCopies(index, { ...indexPlace(collection, item), folder });
        if (!majestic.has(key)) majestic.set(key, !majesticPlaceProblem({ ...indexPlace(collection, item), laterCopies: later }));
        if (!overlaid.has(key)) overlaid.set(key, later.length > 0 || later.orderMissing === true);
        const blank = item.modelSize > 0 && item.modelSize < BLANK_MODEL_BYTES && !real.has(key);
        rows.push({
          ...(blank ? { blank: true } : {}),
          gender,
          component: item.component,
          folder: folder.toLowerCase(),
          drawable: item.drawable,
          textures: item.textures,
          /* Расцветки-заглушки игры по размеру файла (`colour-files.js`): окно их не рисует и не считает (владелец, 22.11.2026: «Прятать»). Поля нет, когда заглушек нет. */
          ...(stubColourIndices(item.textureFiles).length ? { colourStubs: stubColourIndices(item.textureFiles) } : {}),
          name: item.name || "",
          /* Что вещь называется на каждом языке игры (ru, en, de, fr, pl): окно показывает название на языке интерфейса (`game-names.js`); `name` — русское, по нему окно группирует вещи. */
          ...(item.names ? { names: { ...item.names } } : {}),
          shop: collection.title,
          modelSuffix: item.model?.match(/_([ur])\.ydd$/)?.[1] || null,
          /* Пак игры и есть ли у вещи файлы в его архиве моделей: от них
             зависит, можно ли заменить вещь на Majestic (`majestic-dlc.js`). */
          pack: collection.pack || "",
          placed: Boolean(item.dir && item.model),
          /* Вещь базовой игры (`x64v.rpf`): на Majestic её файлами игры не заменить (`majesticLocalSet`). */
          ...(collection.base ? { base: true } : {}),
        });
      }
    }
  }
  /* Приговор Majestic — у каждой строки вещи, по её первой записи: окно не гадает, какая из записей решит установку. */
  for (const row of rows) {
    row.majestic = majestic.get(majesticLocalKey(row)) === true;
    /* Файл вещи перекрыт копией в патч-паке: цель по умолчанию её не берёт (`default-targets-data.js`), запись идёт и в копии. */
    if (overlaid.get(majesticLocalKey(row)) === true) row.overlaid = true;
  }
  /* Руки `uppr` с именем игры — блоки перчаток: модели под кроя торса — одна перчатка (`glove-forms.js`); одинаковые вещи игры (`looks`, `game-looks.js`) помечены до блоков — блок берёт их группу. */
  return markGloveBlocks(withLooks(rows, looks));
}

/** Строка ответа → вещь ассортимента с источником «game»; негодная — `null`. */
export const gameAssortmentItem = (row) =>
  assortmentItem({ ...row, server: null }, "game");

/** Ключ вещи для `majesticLocalSet`: пол, вид, папка, номер. */
export const majesticLocalKey = (item) =>
  `${item.gender}|${item.component}|${String(item.folder || "").toLowerCase()}|${item.drawable}`;

/*
 * Вещи, которые на Majestic можно заменить файлами игры: лежат в белом паке
 * (`majestic-dlc.js`) и файлы у них в архиве пака есть. Вещей серверных паков
 * (`…_clothes_pack0..3`) в строках игры нет: у них свой маршрут, см.
 * `majesticReplaceable`. `null` — игра не прочитана, судить не по чему.
 *
 * Решает первая запись вещи в оглавлении — та же, что берёт установка
 * (`placeInIndex`), по тому же правилу (`majesticPlaceProblem`): строка несёт
 * приговор `majestic`. Прежде хватало любой записи в белом паке, а установка
 * брала первую: журнал владельца 02.11.2026 (beta.90, Majestic) — «Головной
 * убор · GTA V» стоял в выборе и отказал уже после «Применить» («из базовой
 * игры»): заплатки Rockstar из белых паков (`mppatchesng`, `patchday8ng`,
 * `patch2023_01`…) несут файлы с той же папкой и номером, что у вещи базовой
 * игры, а базовая коллекция в оглавлении первая. В игре этого ПК так в выборе
 * стояли 249 из 452 базовых вещей и ещё 149 вещей, у первой записи которых нет
 * модели или расцветок.
 *
 * Строки старого Desktop без `majestic` — прежнее правило, без вещей базовой
 * игры (полка «GTA V» без пака).
 */
const baseRow = (row) => Boolean(row?.base) || (!row?.pack && row?.shop === BASE_SHOP);

export function majesticLocalSet(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const keys = new Set();
  if (rows.some((row) => typeof row?.majestic === "boolean")) {
    for (const row of rows) if (row?.majestic === true) keys.add(majesticLocalKey(row));
    return keys;
  }
  const base = new Set();
  for (const row of rows) {
    if (baseRow(row)) base.add(majesticLocalKey(row));
    else if (row?.placed && majesticLoadsPack(row.pack))
      keys.add(majesticLocalKey(row));
  }
  for (const key of base) keys.delete(key);
  return keys;
}

/**
 * Есть ли у вещи маршрут замены на Majestic: файл в белом паке (`local`,
 * `majesticLocalSet`) или overlay-RPF для серверного пака (`majestic-dlc.js`).
 * Остальное — паки новее списка, базовая игра, пропы серверных паков.
 */
export const majesticReplaceable = (item, local) =>
  majesticOverlayFolder(item?.folder) || Boolean(local?.has(majesticLocalKey(item)));
