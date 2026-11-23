import { overlayHostEntries, translateOverlayFiles } from "./overlays-update-route.js";

/*
 * Наложения тела через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026, `docs/RP-OVERLAYS-CONTAINER.md`): перевод пакетов тату и бород в записи `update.rpf`.
 * Зовётся из `installPackageBatch` ПОСЛЕ проверки подписи и формы манифеста (`checkPackage`), после оружия и одежды; переводится только разобранный `parsed`.
 * Не переведённое остаётся в пакете одежды `astral_clothing`, как сегодня. Без `overlaysUpdateRoute` (по умолчанию) ничего не меняется.
 * Права пакета — те же, что у одежды: `direct-clothing-dlc-v1` снимается, если переведено всё, добавляются `direct-update-entries-v1` и `astral-content-rpf-v1`.
 */

const CLOTHING_CAPABILITY = "direct-clothing-dlc-v1";
const UPDATE_ENTRIES_CAPABILITY = "direct-update-entries-v1";
const CONTENT_CAPABILITY = "astral-content-rpf-v1";

function reasonsOf(kept) {
  const counts = new Map();
  for (const { reason } of kept) counts.set(reason, (counts.get(reason) || 0) + 1);
  return [...counts].map(([reason, count]) => `${reason} ×${count}`).join(", ");
}

/** `checked` — пакеты после `checkPackage`; `route` — `{ note?(строка) }` (`null` — режим выключен); `already` — переведённые целиком раньше. Ответ: `{ checked, fullyTranslated }`. */
export function translateCheckedOverlays({ checked, route = null, already = null }) {
  const fullyTranslated = new Set(already || []);
  if (!route) return { checked, fullyTranslated };
  const note = (line) => route.note?.(line);
  const out = [];
  for (const item of checked) {
    const { parsed } = item;
    if (!parsed.capabilities.includes(CLOTHING_CAPABILITY) || !overlayHostEntries(parsed.files).length) {
      out.push(item);
      continue;
    }
    const result = translateOverlayFiles({ files: parsed.files });
    if (result.moved === 0) {
      note(`Наложения через update.rpf: пакет ${parsed.id} остаётся в пакете одежды (${reasonsOf(result.kept) || "нет готовых файлов"}).`);
      out.push(item);
      continue;
    }
    const capabilities = parsed.capabilities.filter((capability) => !(result.all && capability === CLOTHING_CAPABILITY));
    for (const capability of [UPDATE_ENTRIES_CAPABILITY, CONTENT_CAPABILITY]) if (!capabilities.includes(capability)) capabilities.push(capability);
    const next = { ...item, parsed: { ...parsed, files: result.files, capabilities } };
    note(
      `Наложения через update.rpf: пакет ${parsed.id} — ${result.moved} файлов в контейнер astral_rp_overlays` +
        (result.kept.length ? `, ${result.kept.length} остаются в пакете одежды (${reasonsOf(result.kept)})` : "") +
        ".",
    );
    if (already?.has(item)) {
      fullyTranslated.delete(item);
      if (result.all) fullyTranslated.add(next);
    } else if (result.all) fullyTranslated.add(next);
    out.push(next);
  }
  return { checked: out, fullyTranslated };
}
