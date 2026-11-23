/*
 * Группы слотов компонентов сборки (ТЗ ведущей 10.11.2026, этап 2): какие слоты окно «Компоненты» показывает вместе. Модуль без импортов.
 *
 *  • Интерьеры (`interior-<N>`): каждый — свой компонент со своим выбором, в списке они стоят группой «Интерьеры (N)», которая раскрывается (`isInteriorSlot`).
 *  • Склеенные группы: несколько слотов — ОДИН компонент, одна строка, одна галочка, список пакетов не раскрывается. «Эффекты» автора раскладываются на пакеты со слотами
 *    `blood-routing` (попадания), `particle-effects` (частицы и текстуры), `effects-tables` (таблицы) и `effects-core` (ядро); по отдельности их менять нельзя: таблицы и попадания
 *    ссылаются на правила частиц из ядра того же автора, и смесь двух редуксов даёт пустые эффекты. Отключить, заменить, вернуть — над всеми четырьмя разом, замена — набором
 *    другой сборки целиком, частичной замены нет. Своя работа мастерской (редактор попаданий) встаёт вместо пакета `blood-routing`, остальные остаются (`work`).
 *  • «Трейсеры» (`tracer-bindings`: привязки следа пули к стволам) — отдельный компонент рядом с «Эффектами» (владелец 12.11.2026: «просто „Эффекты“ и отдельно „Трейсеры“»): своя
 *    строка, своя галочка, своя замена. Привязки ссылаются на правила частиц из ядра и словарей того же автора (`TRACERS_NEED`), поэтому ставятся после них.
 *  • «Килл-эффект» (`kill-effects`) и «Звуки оружия» (`sound-…`) — отдельные компоненты, в группу не входят.
 *  • «Основа редукса» (`redux-base`, владелец 13.11.2026: «вообще все файлы должны быть один в один») — служебный пакет с файлами автора, которым нет своего раздела
 *    в каталоге (дорожные узлы, отдельные меты уровня, настройки эффектов вне штатных путей). Карточкой в каталог он не идёт (`catalogUnlisted`), а внутри редукса — строка
 *    «Основа редукса»: её можно выключить и включить, но взять чужую основу или сделать её в мастерской нельзя (`isReduxBase`). Полка его карточки — полка маппинга
 *    (`catalogSlot: "mapping"`, нарочно: прежнее окно прячет такие части), поэтому по полке основу узнавать нельзя — только по `manifest.slots`, `kind`, `domain.anatomy`.
 */

const INTERIOR = /^interior-/;

/** Слот интерьера: такие слоты окно показывает раскрывающейся группой. */
export const isInteriorSlot = (slot) => INTERIOR.test(slot || "");

/** Склеенные группы: ключ группы (он же ключ компонента) → её слоты и слоты, что заменяет своя работа. */
export const MERGED_GROUPS = Object.freeze({
  effects: Object.freeze({
    slots: Object.freeze(["blood-routing", "particle-effects", "effects-tables", "effects-core"]),
    work: Object.freeze(["blood-routing"]),
  }),
});

const GROUP_OF_SLOT = new Map(Object.entries(MERGED_GROUPS).flatMap(([group, spec]) => spec.slots.map((slot) => [slot, group])));

/** Ключ склеенной группы, в которую входит слот, либо сам слот. Ключ группы переводится в себя же. */
export const groupKeyOf = (slot) => GROUP_OF_SLOT.get(slot) || slot;

/** Слоты, которые заменяет своя работа в компоненте `key`: у склеенной группы — часть слотов, у остальных все (`null`). */
export const workSlotsOf = (key) => MERGED_GROUPS[key]?.work || null;

/** Слот привязок следа пули: отдельный компонент «Трейсеры», в группу «Эффекты» не входит. */
export const TRACERS_SLOT = "tracer-bindings";

/** Слоты, чьи правила частиц нужны привязкам трейсеров: ядро и словари частиц автора (`RULE_CARRIERS` разбора, `anatomy-effects.js`). */
export const TRACERS_NEED = Object.freeze(["effects-core", "particle-effects"]);

/**
 * Какой пакет «Эффектов» ведёт группу в каталоге (владелец 12.11.2026): на полке попаданий, в поиске и во «Всех» у редукса видна одна карточка, и это первый существующий по порядку.
 * Остальные пакеты группы видны только внутри своего редукса и ставятся вместе с ведущим.
 */
export const EFFECTS_LEAD_ORDER = Object.freeze(["blood-routing", "effects-core", "particle-effects", "effects-tables"]);

/**
 * Аргументы `onInstall` для «Установить отдельно» у части: пакет «Эффектов» или «Трейсеров» из строки части — один пакет (`single`), остальные части — как есть. Один способ для строки части
 * на странице мода (`ModDetailPage.jsx`) и для части в корзине (`features/cart/`): второго пути установки нет.
 */
export const partInstallArgs = (part) => (effectsSlotOf(part) ? [part, { single: true }] : [part]);

/**
 * Слот пакета «Эффектов» или «Трейсеров» у записи каталога: подписанный манифест (`manifest.slots`), иначе слот полки (`catalogSlot`, `slot`).
 * Слот вне группы «Эффекты» и не `tracer-bindings` — пустая строка. Ключ группы (`effects`, как в старых записях со слотом полки) слотом пакета не считается.
 */
export function effectsSlotOf(mod) {
  if (!mod || typeof mod !== "object") return "";
  const declared = Array.isArray(mod.manifest?.slots) ? mod.manifest.slots : [];
  const isEffectsSlot = (slot) => typeof slot === "string" && (EFFECTS_LEAD_ORDER.includes(slot) || slot === TRACERS_SLOT);
  return [...declared, mod.catalogSlot, mod.slot].find(isEffectsSlot) || "";
}

/** Слот служебного пакета «Основа редукса»: файлы редукса без своего раздела в каталоге. */
export const REDUX_BASE_SLOT = "redux-base";

/**
 * Служебный пакет «Основа редукса»? Узнаётся по подписанному манифесту (`manifest.slots`), а у записи без манифеста (облачная витрина) — по виду заявки (`kind`) и разбору
 * (`domain.anatomy.slot` / `.kind`). Слот полки (`catalogSlot`, `slot`) тоже сходит, но решает не он: у основы полка — маппинг, и по ней основа не отличается от настоящего маппинга.
 */
export function isReduxBase(mod) {
  if (!mod || typeof mod !== "object") return false;
  const declared = Array.isArray(mod.manifest?.slots) ? mod.manifest.slots : [];
  if (declared.includes(REDUX_BASE_SLOT)) return true;
  const anatomy = mod.domain?.anatomy;
  return [mod.kind, anatomy?.slot, anatomy?.kind, mod.catalogSlot, mod.slot].includes(REDUX_BASE_SLOT);
}

/**
 * Пакеты одного компонента в порядке «кто ведёт» (владелец 12.11.2026: у группы картинка — обложка ведущего пакета с кадром): пакеты «Эффектов» — по `EFFECTS_LEAD_ORDER`,
 * остальные остаются там, где стояли (сортировка устойчива). Исходный список не меняется.
 */
export function leadOrder(packages) {
  const rank = (mod) => {
    const at = EFFECTS_LEAD_ORDER.indexOf(effectsSlotOf(mod));
    return at < 0 ? EFFECTS_LEAD_ORDER.length : at;
  };
  return [...(packages || [])].sort((left, right) => rank(left) - rank(right));
}

// Служебная пометка пакета в скобках в конце имени: «<редукс> · Эффекты (ядро)» (ядро, частицы, таблицы; `effectsName` разбора, `anatomy-effects.js`).
const SERVICE_NOTE = /\s*\((?:ядро|частицы|таблицы|core|particles|tables)\)\s*$/i;

/**
 * Имя пакета «Эффектов» без служебной пометки: человеку служебные пакеты не показываются ни под каким видом — «<редукс> Effects (ядро)» для него просто «<редукс> Effects».
 * Имя, что целиком состояло бы из пометки, остаётся как есть.
 */
export function plainEffectsName(name) {
  const text = typeof name === "string" ? name : "";
  const plain = text.replace(SERVICE_NOTE, "");
  return plain.trim() ? plain : text;
}
