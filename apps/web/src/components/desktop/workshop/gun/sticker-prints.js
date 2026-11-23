/*
 * Запечённые наклейки вещей для персонажа (05.11.2026, владелец: «поставил наклейку на футболку, нажал «Применить» — вернуло к персонажу, а на футболке ни наклейки»).
 *
 * Краска и слои вещи на модельке красит `paintOutfit` из черновика (`outfit-paint.js`), а наклейка — не слой: она печатается по геометрии вещи в кадре (`bakeSticker` сцены), и место наклейки лежит в пространстве
 * витрины. У персонажа вещь стоит «как в файле», на кости, и по его геометрии наклейке места не найти. Развёртка у вещи одна, поэтому то, что запечено в витрине, годится и на персонаже: `useGunSurfaces` кладёт сюда запечённое
 * (`rememberStickerPrint`), а `bakeOutfitDraft` берёт его слоями материала (`outfitStickerLayers`) — тем же `{ canvas, blend, opacity }`, что и сама мастерская.
 *
 * Запись живёт, пока жив образ окна: после перезапуска наклейки на персонаже нет, пока вещь не откроют в редакторе (там она запекается снова). Ключ записи — вещь, наклейка и всё, из чего собирается её картинка
 * (`stickerBakeKey`): сдвинули или заменили наклейку — прежнее запечённое не подходит и не показывается.
 */

/*
 * Что в наклейке требует перезапекания: всё, из чего собирается её картинка
 * (`stickerArtwork`) и проекция (`decalUniforms`). Прозрачности и режима
 * наложения здесь нет — их кладёт сборка материала. Порога трафарета и
 * «Краской — светлое» здесь не было, и «Обрисовать» не менялось на стволе.
 */
export const stickerBakeKey = (sticker) =>
  JSON.stringify([
    sticker.source,
    sticker.text,
    sticker.font,
    sticker.fontAsset || "",
    sticker.anchor,
    sticker.normal,
    sticker.size,
    sticker.rotation,
    sticker.flip,
    sticker.wear,
    sticker.tint,
    sticker.outline,
    sticker.outlineColour,
    sticker.stencil,
    sticker.stencilInvert,
  ]);

/* Холстов в записи много (по материалу на наклейку), а вещей у человека обычно несколько: старые уходят первыми. */
const PRINT_LIMIT = 48;
const prints = new Map();

const entryKey = (modelId, stickerId) => `${modelId}\n${stickerId}`;

/** Запомнить запечённое в витрине: `byMaterial` — `Map<имя материала, холст>` из `scene.bakeSticker`. */
export function rememberStickerPrint(modelId, sticker, key, byMaterial) {
  if (!modelId || !sticker?.id || !byMaterial) return;
  const at = entryKey(modelId, sticker.id);
  prints.delete(at);
  prints.set(at, { key, byMaterial });
  while (prints.size > PRINT_LIMIT) prints.delete(prints.keys().next().value);
}

/** Для проверок: забыть всё запечённое. */
export const forgetStickerPrints = () => prints.clear();

/**
 * Слои наклеек вещи `project` на материале `materialName`: `[{ canvas, blend, opacity }]` — только видимые, только запечённые именно в нынешнем виде и только у задетых материалов.
 */
export function outfitStickerLayers(project, materialName) {
  const list = [];
  for (const sticker of project?.stickers || []) {
    if (sticker.visible === false) continue;
    const entry = prints.get(entryKey(project.modelId, sticker.id));
    if (!entry || entry.key !== stickerBakeKey(sticker)) continue;
    const canvas = entry.byMaterial.get(materialName);
    if (canvas) list.push({ canvas, blend: sticker.blend, opacity: sticker.opacity });
  }
  return list;
}
