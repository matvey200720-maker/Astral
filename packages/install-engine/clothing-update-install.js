import { CLOTHING_HOST_TARGET, clothingHeroHostEntries, clothingHostEntries, translateClothingFiles } from "./clothing-update-route.js";

/*
 * Одежда через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026, `docs/RP-CLOTHING-CONTAINER.md`): перевод пакетов `direct-clothing-dlc-v1` в записи `update.rpf`.
 *
 * Зовётся из `installPackageBatch` ПОСЛЕ проверки подписи и формы манифеста (`checkPackage`) и после оружия: подпись смотрит на манифест как он есть,
 * переводится только разобранный `parsed`. Переведённое ложится в `update.rpf` обычной записью `rpf-entry` в контейнер `x64/astral/astral_rp_clothing.rpf`
 * (слой, откат, «Починить» и дозапись — общие); не переведённое остаётся в пакете одежды `astral_clothing`, как сегодня, со строкой в журнале.
 * Пакет, у которого переведено всё, больше не несёт `direct-clothing-dlc-v1`; контейнер регистрируется в `content.xml` движком по `astral-content-rpf-v1`.
 *
 * Без `clothingUpdateRoute` (по умолчанию) ничего не меняется. Дозаписи (`appendInstall`) режим не требует (решение 20.11.2026): контейнера Astral в основе
 * нет, дозапись его не берёт (`chooseComposeWriter` → помощник), так что условие «только вместе с дозаписью» ничего не давало; пакет уходит обычной
 * записью `rpf-entry`, и `update.rpf` собирается так же, как для любого мода каталога без дозаписи.
 */

const CLOTHING_CAPABILITY = "direct-clothing-dlc-v1";
const UPDATE_ENTRIES_CAPABILITY = "direct-update-entries-v1";
const CONTENT_CAPABILITY = "astral-content-rpf-v1";

function reasonsOf(kept) {
  const counts = new Map();
  for (const { reason } of kept) counts.set(reason, (counts.get(reason) || 0) + 1);
  return [...counts].map(([reason, count]) => `${reason} ×${count}`).join(", ");
}

/**
 * `checked` — пакеты после `checkPackage` (и после оружия); `route` — `{ note?(строка) }` от приложения (`null` — режим выключен); `already` — набор уже
 * переведённых целиком (оружием): пересозданный здесь пакет остаётся в нём. Ответ: `{ checked, fullyTranslated }` — те же пакеты, у переведённых другой
 * `parsed`; `fullyTranslated` — переведённые целиком (в том числе пришедшие из `already`, под новым объектом).
 */
export function translateCheckedClothing({ checked, route = null, already = null }) {
  const fullyTranslated = new Set(already || []);
  if (!route) return { checked, fullyTranslated };
  const note = (line) => route.note?.(line);
  const out = [];
  for (const item of checked) {
    const { parsed } = item;
    if (!parsed.capabilities.includes(CLOTHING_CAPABILITY) || !clothingHostEntries(parsed.files).length) {
      out.push(item);
      continue;
    }
    const result = translateClothingFiles({ files: parsed.files });
    if (result.moved === 0) {
      note(`Одежда через update.rpf: пакет ${parsed.id} остаётся в пакете одежды (${reasonsOf(result.kept) || "нет готовых файлов"}).`);
      out.push(item);
      continue;
    }
    const capabilities = parsed.capabilities.filter((capability) => !(result.all && capability === CLOTHING_CAPABILITY));
    for (const capability of [UPDATE_ENTRIES_CAPABILITY, CONTENT_CAPABILITY]) if (!capabilities.includes(capability)) capabilities.push(capability);
    const next = { ...item, parsed: { ...parsed, files: result.files, capabilities } };
    note(
      `Одежда через update.rpf: пакет ${parsed.id} — ${result.moved} файлов в контейнер astral_rp_clothing` +
        (result.kept.length ? `, ${result.kept.length} остаются в пакете одежды (${reasonsOf(result.kept)})` : "") +
        ".",
    );
    /* Объект пересоздан: принадлежность к набору (переведён оружием) переносится на новый. Переведённый и оружием, и одеждой — переведён целиком, только если одежда не оставила своих файлов в хосте. */
    if (already?.has(item)) {
      fullyTranslated.delete(item);
      if (result.all) fullyTranslated.add(next);
    } else if (result.all) fullyTranslated.add(next);
    out.push(next);
  }
  return { checked: out, fullyTranslated };
}

/**
 * Пакет с папкой сюжетного героя ставится только маршрутом через update.rpf: хост `astral_clothing` — для freemode, герои в него не ложатся. Зовётся после `translateCheckedClothing`:
 * с выключателем герои уже переведены в контейнер и в хосте не остались; без него (или если перевод записи оставил в хосте) — отказ словами до любой записи.
 */
export function refuseHeroWithoutContainer(checked) {
  for (const { parsed } of checked) {
    const left = clothingHeroHostEntries(parsed?.files || []);
    if (left.length) {
      throw new Error(
        `Пакет ${parsed.id}: папка сюжетного героя (${left.slice(0, 3).join(", ")}${left.length > 3 ? ", …" : ""}) ставится только маршрутом через update.rpf — включите ASTRAL_CLOTHING_VIA_UPDATE=container; в пакет одежды astral_clothing герои не ложатся.`,
      );
    }
  }
}

/** Остаётся ли у пакета что-то в хосте одежды (нужен ли `astral_clothing`): для вызывающего, который решает, готовить ли пакет одежды. */
export const clothingHostStillNeeded = (parsed) => (parsed?.files || []).some((file) => file?.target?.toLowerCase() === CLOTHING_HOST_TARGET);
