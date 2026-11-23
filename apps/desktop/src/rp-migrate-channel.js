/*
 * Умолчание канала для переноса стоящих модов в контейнеры RP (`ASTRAL_RP_MIGRATE`, 20.11.2026, `docs/RP-MIGRATE-OFFER.md`). Модуль без импортов: при старте пакет установки грузить нельзя
 * (`tests/main-startup-imports.test.js`), имя выключателя здесь записано словом, равенство с `rp-container-migrate.js` держит `tests/rp-migrate-offer.test.js`.
 *
 * Пока перенос не проверен на настоящих архивах и состоянии (решение ведущей), он не включается ни в одном канале: `RP_MIGRATE_ALPHA_DEFAULT = false`. Включит ведущая одной правкой
 * этой константы; тогда в альфе (и только в ней) выключатель ставится сам, а в окне появляется предложение «Пересобрать» (`RpMigrateRow.jsx`). Явное значение в окружении сильнее умолчания.
 */

export const RP_MIGRATE_ENV_NAME = "ASTRAL_RP_MIGRATE";
export const RP_MIGRATE_CHANNEL = "alpha";
export const RP_MIGRATE_ALPHA_DEFAULT = false;

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applyRpMigrateDefault({
  channel,
  env = process.env,
  enabledByDefault = RP_MIGRATE_ALPHA_DEFAULT,
} = {}) {
  if (!enabledByDefault || channel !== RP_MIGRATE_CHANNEL) return null;
  if (String(env[RP_MIGRATE_ENV_NAME] ?? "").trim() !== "") return null;
  env[RP_MIGRATE_ENV_NAME] = "1";
  return "1";
}
