/*
 * Ложится ли файл пакета слоем поверх того, что уже стоит на записи, или
 * сменяет владельца записи (`planPackage`, `installPackage`).
 *
 * Слоями складываются правки по смыслу (таймцикл по модификаторам, звук,
 * ядро эффектов, ресурсы контейнеров Astral) — пока все слои записи одной
 * стратегии. Иначе запись одна, и её владелец — верхний слой: это конфликт,
 * о котором окно спрашивает человека.
 *
 * Исключение у ресурсов контейнера — `_manifest.ymf` (задача 3 ТЗ
 * 10.10.2026): манифест в контейнере один, слои не складываются — в игре
 * остаётся верхний, и карты нижнего мода теряют свои типы. Второй мод с
 * манифестом в том же контейнере — конфликт, а не тихая стопка.
 */

const LAYERED = new Set([
  "rpf-resource-layer-v1",
  "timecycle-modifier-v1",
  "decoration-overlay-v1",
  "astral-tracer-v1",
  "ypt-texture-layer-v1",
  "ypt-rule-patch-v1",
  "ypt-own-rules-v1",
  "ptx-clip-rows-v1",
  "awc-stream-layer-v1",
  "blood-routing-v1",
  "weapons-meta-tracer-patch-v1",
  "audio-rel-patch-v1",
  "astral-audio-chunk-v1",
]);
const CORE_LAYERS = ["ptfx-core-base-v1", "ypt-texture-layer-v1", "ypt-rule-patch-v1", "ypt-own-rules-v1", "astral-tracer-v1"];
const MANIFEST = /(^|\/)_manifest\.ymf$/i;

/** Манифест контейнера, на котором уже стоит чужой слой. */
export const sharedManifestOwner = (file, entryState, modId) =>
  file?.merge?.strategy === "rpf-resource-layer-v1" &&
  MANIFEST.test(String(file.entry || "")) &&
  (entryState?.layers || []).some((layer) => layer?.modId && layer.modId !== modId && !String(layer.modId).startsWith("@"));

/**
 * `true` — файл ляжет слоем, владельца у записи нет; `false` — запись
 * сменит владельца (верхний слой), если он есть.
 */
export function isMergeCompatible(parsed, file, entryState) {
  if (parsed.adapter !== "rpf-entry" || !LAYERED.has(file.merge?.strategy)) return false;
  if (entryState?.layers?.at(-1)?.action === "delete") return false;
  if (sharedManifestOwner(file, entryState, parsed.id)) return false;
  return (entryState?.layers || []).every((layer) => {
    if (file.merge.strategy === "rpf-resource-layer-v1") return layer.merge?.strategy === "rpf-resource-layer-v1";
    /* Модификаторы таймцикла ложатся и поверх файла целиком: сборщик берёт
       верхний такой файл основой и кладёт модификаторы на него (задача 3 ТЗ
       10.10.2026). Иначе килл-эффект каталога после таймцикла-файла
       «сменял» таймцикл — и тот уходил из игры. */
    if (file.merge.strategy === "timecycle-modifier-v1")
      return layer.merge?.strategy === "timecycle-modifier-v1" || (!layer.merge && layer.action !== "delete");
    if (["ypt-texture-layer-v1", "ypt-rule-patch-v1", "ypt-own-rules-v1"].includes(file.merge.strategy))
      return CORE_LAYERS.includes(layer.merge?.strategy);
    if (file.merge.strategy === "astral-tracer-v1" && file.merge.role === "core")
      return (
        CORE_LAYERS.includes(layer.merge?.strategy) &&
        (layer.merge?.strategy !== "astral-tracer-v1" || layer.merge?.role === "core")
      );
    return layer.merge?.strategy === file.merge.strategy;
  });
}

/**
 * На записи уже лежит ровно такой же файл: тот же sha256, что у верхнего слоя
 * (общий обвес двух стволовых карточек одного ганпака, `w_at_ar_supp.ydr` в
 * пакетах обоих). Это не смена владельца — слои складываются, снятие одного
 * пакета оставляет файл второму, снятие обоих возвращает штатный. Другой
 * sha256 — прежний конфликт: окно спрашивает, чей файл остаётся.
 */
export function sharesIdenticalEntry(parsed, file, entryState) {
  if (parsed.adapter !== "rpf-entry" || file.action === "delete" || !file.sha256) return false;
  const top = (entryState?.layers || []).at(-1);
  return Boolean(top) && top.modId !== parsed.id && top.action !== "delete" && String(top.sha256 || "").toLowerCase() === file.sha256;
}

const TIMECYCLE = "timecycle-modifier-v1";
/* Сколько слоёв модификаторов таймцикла лежит на записи сверху. */
function mergeTop(layers) {
  let count = 0;
  for (let index = layers.length - 1; index >= 0 && layers[index]?.merge?.strategy === TIMECYCLE; index -= 1) count += 1;
  return count;
}

/**
 * Таймцикл целиком на запись, где сверху уже лежат модификаторы по именам
 * (килл-эффект, вода, оптимизация), — ложится ПОД них: модификаторы — правки
 * поверх любого файла, и сборщик кладёт их на него (задача 3 ТЗ 10.10.2026).
 * Так ставятся оба в любом порядке. Сменяет он только прежний файл целиком
 * под ними (`owner`). `null` — правило не про этот файл.
 */
export function slidesUnderMerges(parsed, file, entryState) {
  if (parsed.adapter !== "rpf-entry" || file.merge || !["replace", "upsert"].includes(file.action)) return null;
  const layers = (entryState?.layers || []).filter((layer) => layer?.modId !== parsed.id);
  const top = mergeTop(layers);
  if (!top) return null;
  const below = layers.slice(0, layers.length - top).at(-1);
  return { owner: below && below.action !== "delete" ? below.modId : null };
}

/** Куда лечь новому слою: наверх или под модификаторы таймцикла. */
export function placeLayer(layers, layer, slide) {
  if (!slide) return [...layers, layer];
  const top = mergeTop(layers);
  return [...layers.slice(0, layers.length - top), layer, ...layers.slice(layers.length - top)];
}
