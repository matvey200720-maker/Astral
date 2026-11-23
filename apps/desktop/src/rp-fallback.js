/*
 * Режим RP включился сам, а контейнерный маршрут отказал: работа ставится прежним пакетом `astral_*` (21.11.2026, пробел приёмки; решение первого лида).
 * Клиент RAGE MP такой пакет не подключает: «установлено», но на GTA 5 RP мода не видно. Установку это не отказывает (сюжет и Majestic целы), но человеку об этом
 * говорят: результат несёт структурный признак `summary.rpFallback = { kind, code, reason, container: false }`, окно (`features/workshop/install-queue/tasks/rp-update-notes.js`)
 * переводит причину в слова на шести языках. Главный процесс отдаёт КОДЫ, не слова (как `clothing-install-visibility.js`).
 *
 * Чистый модуль без импортов: стартовый граф главного процесса его не утяжеляет.
 */

/** Причины для окна: семейства кодов отказа дорог, растительности и мест. `other` — код, которого окно не знает (слова общие). */
export const RP_FALLBACK_REASONS = Object.freeze({
  budget: Object.freeze(["over-budget", "nothing-fits", "container-too-big", "carrier-over-budget", "carrier-container-full"]),
  global: Object.freeze(["global-markings", "global-trees"]),
  part: Object.freeze(["parts-unavailable", "part-unavailable"]),
  "packs-standing": Object.freeze(["packs-standing"]),
  places: Object.freeze(["overrides", "map-set"]),
  /* Билборды: ни один щит работы на RP не виден (21.11.2026). */
  "no-visible": Object.freeze(["no-visible"]),
  other: Object.freeze([]),
});

/** Код отказа → причина окна. */
export function rpFallbackReason(code) {
  const word = String(code ?? "");
  return Object.entries(RP_FALLBACK_REASONS).find(([, codes]) => codes.includes(word))?.[0] ?? "other";
}

/** Признак отката на старый пакет: что за вид работы, какой код отказа, какая причина; в контейнер ничего не легло. */
export const rpFallbackInfo = (kind, code) => ({ kind, code: String(code ?? ""), reason: rpFallbackReason(code), container: false });

/** Результат сборки с признаком; исходный объект не меняется. */
export const annotateRpFallback = (built, info) => ({ ...built, summary: { ...(built?.summary || {}), rpFallback: info } });
