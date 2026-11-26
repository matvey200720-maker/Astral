import {
  translateWeaponFiles,
  translateWeaponFilesToContainer,
  WEAPON_CONTAINER_CAPABILITIES,
  WEAPON_CONTAINER_ENTRY_PREFIX,
  WEAPON_HOST_PREFIX,
  WEAPON_HOST_TARGET,
} from "./weapon-update-route.js";

/*
 * Оружие через `update.rpf` (GTA 5 RP, 20.11.2026, `docs/RP-WEAPONS-UPDATE.md`): перевод пакетов `direct-weapon-dlc-v1` в записи `update.rpf`.
 *
 * Зовётся из `installPackageBatch` ПОСЛЕ проверки подписи и формы манифеста (`checkPackage`): подпись смотрит на манифест как он есть, а переводится
 * только разобранный `parsed`. Что переведено, ложится в `update.rpf` как обычная запись `rpf-entry` (слой, откат, «Починить», дозапись — всё общее);
 * что не переведено, остаётся в пакете-хосте `astral_weapons`, как сегодня. Пакет, у которого переведено всё, больше не несёт `direct-weapon-dlc-v1`:
 * хост ему не нужен, и регистрация `astral_weapons` в `dlclist.xml` не пишется.
 *
 * Без `weaponUpdateRoute` (по умолчанию) ничего не меняется. Без дозаписи (`appendInstall`) режим отказывается строкой: каждый ствол пересобирал бы `update.rpf`
 * целиком. Сбой маршрута (перепись не открылась) — тоже строка и прежний путь, установка не падает.
 */

const WEAPON_CAPABILITY = "direct-weapon-dlc-v1";
const UPDATE_ENTRIES_CAPABILITY = "direct-update-entries-v1";

const hostLeaves = (parsed) =>
  parsed.files.filter((file) => file.target === WEAPON_HOST_TARGET && String(file.entry || "").startsWith(WEAPON_HOST_PREFIX)).map((file) => String(file.entry).slice(WEAPON_HOST_PREFIX.length));

function reasonsOf(kept) {
  const counts = new Map();
  for (const { reason } of kept) counts.set(reason, (counts.get(reason) || 0) + 1);
  return [...counts].map(([reason, count]) => `${reason} ×${count}`).join(", ");
}

/**
 * `checked` — пакеты после `checkPackage`; `route` — `{ routesFor({ names }) → { routes }, note?(строка) }` от приложения (`null` — режим выключен);
 * `appendInstall` — дозапись (без неё режим не берёт пакеты). Ответ: `{ checked, fullyTranslated }` — те же пакеты, у переведённых другой `parsed`;
 * `fullyTranslated` — переведённые целиком (план-проверку по хосту им делать не нужно).
 */
/** Режим `container`: файлы хоста — в контейнер слоя Astral в `update.rpf` по имени; победитель и перепись не нужны, дозапись тоже (новый контейнер — полная сборка). */
function translateToContainer(item, note) {
  const { parsed } = item;
  const result = translateWeaponFilesToContainer({ files: parsed.files });
  if (result.moved === 0) {
    note(`Оружие через контейнер: пакет ${parsed.id} остаётся в пакете оружия (${reasonsOf(result.kept) || "нет файлов оружия"}).`);
    return { item, all: false };
  }
  const hasDelete = result.files.some((file) => file.action === "delete");
  const capabilities = parsed.capabilities.filter(
    (capability) => !(result.all && capability === WEAPON_CAPABILITY) && !(!hasDelete && capability === "rpf-delete-v1"),
  );
  for (const capability of WEAPON_CONTAINER_CAPABILITIES) if (!capabilities.includes(capability)) capabilities.push(capability);
  note(
    `Оружие через контейнер: пакет ${parsed.id} — ${result.moved} файлов в ${WEAPON_CONTAINER_ENTRY_PREFIX.slice(0, -1)} (update.rpf)` +
      (result.dropped ? `, масок снято ${result.dropped}` : "") +
      (result.kept.length ? `, ${result.kept.length} остаются в пакете оружия (${reasonsOf(result.kept)})` : "") +
      ".",
  );
  return { item: { ...item, parsed: { ...parsed, files: result.files, capabilities } }, all: result.all };
}

export async function translateCheckedWeapons({ checked, route = null, appendInstall = null }) {
  const fullyTranslated = new Set();
  const containerItems = new Set();
  const containerMode = route?.mode === "container";
  if (!route || (!containerMode && typeof route.routesFor !== "function")) return { checked, fullyTranslated, containerItems };
  const note = (line) => route.note?.(line);
  const out = [];
  for (const item of checked) {
    const { parsed } = item;
    if (!parsed.capabilities.includes(WEAPON_CAPABILITY)) {
      out.push(item);
      continue;
    }
    const names = hostLeaves(parsed);
    if (!names.length) {
      out.push(item);
      continue;
    }
    if (containerMode) {
      const translated = translateToContainer(item, note);
      if (translated.all) fullyTranslated.add(translated.item);
      if (translated.item !== item) containerItems.add(translated.item);
      out.push(translated.item);
      continue;
    }
    if (!appendInstall) {
      note("Оружие через update.rpf не берёт пакет: нужна дозапись в update.rpf (ASTRAL_ENGINE_CATALOG_APPEND=catalog); пакет ставится в пакет оружия.");
      out.push(item);
      continue;
    }
    let answer;
    try {
      answer = await route.routesFor({ names });
    } catch (error) {
      note(`Оружие через update.rpf: маршрут не получен (${error?.message || error}); пакет ${parsed.id} ставится в пакет оружия.`);
      out.push(item);
      continue;
    }
    /* Перепись без единого оружия — игра прочитана не так, как надо (раньше так было при зарегистрированном хосте): честная строка, пакет идёт в хост. */
    if (answer?.empty === true) {
      note(`Оружие через update.rpf: перепись оружия пуста, пакет ${parsed.id} ставится в пакет оружия.`);
      out.push(item);
      continue;
    }
    const result = translateWeaponFiles({ files: parsed.files, routes: answer?.routes || [] });
    if (result.moved === 0) {
      note(`Оружие через update.rpf: пакет ${parsed.id} остаётся в пакете оружия (${reasonsOf(result.kept) || "нет готовых файлов"}).`);
      out.push(item);
      continue;
    }
    const capabilities = parsed.capabilities.filter((capability) => !(result.all && capability === WEAPON_CAPABILITY));
    if (!capabilities.includes(UPDATE_ENTRIES_CAPABILITY)) capabilities.push(UPDATE_ENTRIES_CAPABILITY);
    const next = { ...item, parsed: { ...parsed, files: result.files, capabilities } };
    note(
      `Оружие через update.rpf: пакет ${parsed.id} — ${result.moved} файлов в update.rpf` +
        (result.kept.length ? `, ${result.kept.length} остаются в пакете оружия (${reasonsOf(result.kept)})` : "") +
        ".",
    );
    if (result.all) fullyTranslated.add(next);
    out.push(next);
  }
  return { checked: out, fullyTranslated, containerItems };
}

const SKIN_ID = /^local-(?:(?:weapon|clothing)-skin|gunpack)-/;
/* Только скины: новый скин заменяет лишь их, ганпак остаётся под ним слоем. */
const SKIN_ONLY = /^local-(?:weapon|clothing)-skin-/;

/** Лёг ли пакет в контейнер оружия: по id пакета, а не по ссылке на объект (одежда после оружия может пересоздать объект пакета). */
export const inContainerItems = (containerItems, item) => [...(containerItems || [])].some((own) => own === item || (own?.parsed?.id && own.parsed.id === item?.parsed?.id));

/**
 * Скин мастерской, лёгший в контейнер, заменяет прежний скин той же модели, как в хосте (там замену называет план по записям хоста, а записи контейнера
 * план не видит): id установленных скинов с общим слотом `weapon-<модель>`. СКИН НИКОГДА НЕ СНИМАЕТ ГАНПАК (решение лида 1, 23.11.2026; в 1.0.2 в хосте так и было, скин ложился слоем, ганпак возвращался при снятии скина:
 * скин делают НА модели ганпака, без неё остаются штатная модель с текстурами скина): новый скин (`local-weapon-skin-*`, `local-clothing-skin-*`) заменяет только прежние СКИНЫ, ганпаки остаются под ним. Новый ганпак
 * мастерской (`local-gunpack-*`) заменяет прежние скины и ганпаки, чьи слоты все покрыты; чужие моды и пакеты каталога не затрагиваются.
 * Копия мода каталога с другим размером модели (`local-gunpack-*` с `origin.catalogModId`, приложение: `catalog-model-scale.js`) — мод каталога, а не работа мастерской: сама она никого не снимает,
 * замену называет приложение — ту же, что при установке этого мода в 100 % (26.11.2026).
 */
export function previousSkinsOf(parsed, target, origin = null) {
  if (!SKIN_ID.test(String(parsed?.id || ""))) return [];
  if (!SKIN_ONLY.test(String(parsed.id)) && origin?.catalogModId) return [];
  const replaces = SKIN_ONLY.test(String(parsed.id)) ? SKIN_ONLY : SKIN_ID;
  return (target?.installed || [])
    .filter((installed) => installed.modId !== parsed.id && replaces.test(String(installed.modId || "")) && replacedWhole(installed.slots, parsed.slots))
    .map((installed) => installed.modId);
}

/**
 * Граница замены — по СТВОЛАМ, не по записям (решение лида 1, 22.11.2026; стенд на настоящих файлах: свой ганпак на один ствол снимал ганпак из трёх стволов целиком): прежняя работа заменяется целиком,
 * только если ВСЕ её слоты `weapon-<модель>` есть среди слотов новой (скин с магазином под ганпаком на тот же ствол — по-прежнему заменяется, «Применить ещё раз» не ломается). Есть слот, которого у новой нет, — прежняя
 * остаётся: новая ложится слоем поверх общих записей, остальные стволы на месте, снятие новой возвращает прежний ствол.
 */
export const replacedWhole = (oldSlots, newSlots) => {
  const old = (oldSlots || []).filter(Boolean);
  return old.length > 0 && old.some((slot) => (newSlots || []).includes(slot)) && old.every((slot) => (newSlots || []).includes(slot));
};
