/*
 * Значки карты игры в игру (05.11.2026, «Иконки» большой карты).
 *
 * Работа уезжает одним нативным патчем со своей точкой отката (`blip-icons-customizer.js` в главном процессе): новый
 * `minimap.ytd` с переписанными клетками листов значков. Значки идут вместе с «Применить» большой карты (`installWorldMap`),
 * но патч у них свой: карта кладёт плитки пакетом движка, а значки — клетки одного словаря. Запись установки хранит точку
 * отката и работу, что стоит в игре сейчас: «Как в игре» и правка возвращают игре клетки только прежней работы (`previous`).
 *
 * Работа без правок при стоящей в игре прежней — «вернуть значки игре»: клетки ставятся штатными из сборки до Astral, а запись
 * после этого забывается — от Astral в игре ничего не осталось.
 */

import { blipIconAssets, blipIconsSignature, blipIconsWorkIsStock, describeBlipIcons, normalizeBlipIcons } from "@modovik/vector-map/blip-icons";
import { applyBlipIcons, blipIconsSupported } from "../../../../api.js";
import { forgetInstallRecord, readInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";
import { tr } from "../../../../locales/ui.js";

export const BLIP_ICONS_INSTALL_KEY = "astral.blip-icons.install.v1";

/** Отпечаток работы для кнопки «Применить»: то, что уходит в игру. */
export const blipIconsInstallSignature = (work) => blipIconsSignature(work);

/** Работа, что стоит в игре сейчас (из записи установки), или `null`. */
export function installedBlipIconsWork() {
  const record = readInstallRecord(BLIP_ICONS_INSTALL_KEY);
  return record?.work ? normalizeBlipIcons(record.work) : null;
}

/** Есть ли что делать: свои правки или прежняя работа, которую надо вернуть игре. */
export const blipIconsNeedWork = (work) => !blipIconsWorkIsStock(work) || Boolean(installedBlipIconsWork() && !blipIconsWorkIsStock(installedBlipIconsWork()));

/**
 * @param {{
 *   work: object,
 *   pictures?: () => Promise<Record<string, string>>|Record<string, string>,
 *   report?: Function,
 * }} input `pictures` — свои картинки значков: ключ → PNG base64 (читаются в момент установки)
 * @returns {Promise<{ applied: boolean, unchanged: boolean, restored: boolean, notes: object[], summary: string, record: object|null }>}
 */
export async function installBlipIcons({ work, pictures = null, report = null }) {
  const normalized = normalizeBlipIcons(work);
  const previous = installedBlipIconsWork();
  const stock = blipIconsWorkIsStock(normalized);
  if (stock && (!previous || blipIconsWorkIsStock(previous))) return { applied: false, unchanged: true, restored: false, notes: [], summary: "", counts: describeBlipIcons(normalized), record: null };
  if (!blipIconsSupported()) throw new Error("Значки карты ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.");
  const game = await locateLegacyTarget();
  report?.({ step: "prepare", note: tr("Ставим значки карты") });
  const wanted = blipIconAssets(normalized);
  const loaded = wanted.length ? (typeof pictures === "function" ? await pictures() : pictures) || {} : {};
  const result = await applyBlipIcons({
    gameRoot: game.path,
    work: normalized,
    ...(previous ? { previous } : {}),
    ...(wanted.length ? { pictures: Object.fromEntries(wanted.filter((id) => loaded[id]).map((id) => [id, loaded[id]])) } : {}),
  });
  const base = { notes: result?.notes || [], summary: result?.summary || "", counts: describeBlipIcons(normalized) };
  if (stock) {
    forgetInstallRecord(BLIP_ICONS_INSTALL_KEY);
    return { applied: !result?.unchanged, unchanged: Boolean(result?.unchanged), restored: true, ...base, record: null };
  }
  /* Значки у игры уже такие — патча нет; запись обновляется работой, чтобы «Как в игре» знало, что возвращать. */
  if (result?.unchanged) {
    const record = readInstallRecord(BLIP_ICONS_INSTALL_KEY);
    if (!record) return { applied: false, unchanged: true, restored: false, ...base, record: null };
    const next = await rememberInstallRecord(BLIP_ICONS_INSTALL_KEY, { id: record.restorePointId, patch: record.patch }, { editor: "blip-icons", gameRoot: game.path, work: normalized, summary: base.summary }, { report });
    return { applied: false, unchanged: true, restored: false, ...base, record: next };
  }
  const record = await rememberInstallRecord(
    BLIP_ICONS_INSTALL_KEY,
    result,
    { editor: "blip-icons", gameRoot: game.path, work: normalized, summary: base.summary },
    { report },
  );
  return { applied: true, unchanged: false, restored: false, ...base, record };
}
