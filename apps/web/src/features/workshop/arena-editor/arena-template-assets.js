/*
 * Картинки шаблона арены — в хранилище окна (ТЗ 12.10.2026).
 *
 * PNG шаблона лежат рядом с приложением (`arenaTemplatePicture`). Чтобы
 * шаблон правился как своя работа, каждая картинка кладётся в хранилище
 * окна тем же путём, что и картинка, выбранная человеком: картинки мест и
 * моделей — `saveHangarEmblem` (`hangar-emblem:<sha256>`), плитка пола —
 * картинкой отделки (`saveFinishImage`, `finish-image:<sha256>`). Дальше её
 * можно заменить, а «Применить» читает её как любую свою картинку.
 */

import { ARENA_TEMPLATE_KINDS, arenaTemplatePicture } from "@modovik/climb-contract/recolor/arena-templates";
import { saveFinishImage } from "../finish/finish-assets.js";
import { saveHangarEmblem } from "../hangar-editor/hangar-emblem.js";

/** Картинки шаблона в хранилище окна: `{ <вид>: { asset, name, width, height } }`. */
export async function saveArenaTemplatePictures(id, { fetchImpl = globalThis.fetch } = {}) {
  const out = {};
  for (const kind of ARENA_TEMPLATE_KINDS) {
    const { url, name } = arenaTemplatePicture(id, kind);
    const response = await fetchImpl(url).catch(() => null);
    if (!response?.ok) throw new Error(`Картинки шаблона ${name} нет рядом с приложением — обновите Astral.`);
    const blob = await response.blob();
    const file = new File([blob], name, { type: "image/png" });
    /* Плитка пола — картинка отделки (`finish-image:`), остальное — картинки мест и моделей. */
    const saved = kind === "floor" ? await saveFinishImage(file) : await saveHangarEmblem(file);
    out[kind] = { asset: saved.asset, name, width: saved.width, height: saved.height };
  }
  return out;
}
