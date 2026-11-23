/*
 * Дозапись мода каталога в `update.rpf` по каналам (20.11.2026, слово владельца «да» на включение в альфе; `docs/ALPHA-DEFAULTS-2011.md`).
 *
 * Выключатель `ASTRAL_ENGINE_CATALOG_APPEND=catalog` (`packages/install-engine/append-item.js`) понимает только слово `catalog` в списке через запятую.
 * В альфе приложение ставило его при старте, если выключатель в окружении пуст; с 21.11 умолчание выключено (`CATALOG_APPEND_ALPHA_DEFAULT`, находка П7); бета, релиз и запуск вне канала не трогаются.
 * Аварийно выключить и в альфе — любое другое непустое слово до старта: `ASTRAL_ENGINE_CATALOG_APPEND=0` (или `off`): умолчание не ставится, дозапись не включается.
 * Видимых человеку строк здесь нет.
 */

/*
 * Имя и слово записаны здесь своими строками, без импорта из `@modovik/install-engine/append-item.js`: этот файл грузится на старте
 * (`channels/index.js`), а пакет установки при старте грузиться не должен (`tests/main-startup-imports.test.js`). Равенство держит
 * `tests/catalog-append-channel.test.js`.
 */
export const CATALOG_APPEND_ENV = "ASTRAL_ENGINE_CATALOG_APPEND";
const CATALOG_APPEND_MODULE = "catalog";

/** Канал, где дозапись каталога включена по умолчанию. */
export const CATALOG_APPEND_CHANNEL = "alpha";

/*
 * Включено ли умолчание альфы (21.11.2026, решение ведущей по находке П7 ночных сценариев, `docs/handoff/NIGHT-2111-SCENARIOS.md`).
 * С дозаписью по умолчанию работа мастерской («небо»), оказавшаяся под каталожным модом, после снятия этого мода числится
 * «погребённой» (`blocked / buried`): из библиотеки её снять нельзя, 21 запись остаётся в игре; «Проверить файлы игры» после
 * «мод → небо поверх» показывает ложное `update.rpf modified`. Без дозаписи оба случая работают (песочница, `w17b`, `w17c`).
 * Установка каталожного мода без дозаписи дольше: 27–31 с против 1,7–1,9 с (таймцикл 27 записей, мини-карта 3 записи; песочница, NVMe).
 * Вернуть умолчание — поставить `true` (или явно `ASTRAL_ENGINE_CATALOG_APPEND=catalog` до старта: явное слово работает всегда).
 */
export const CATALOG_APPEND_ALPHA_DEFAULT = false;

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applyCatalogAppendDefault({ channel, env = process.env } = {}) {
  if (channel !== CATALOG_APPEND_CHANNEL) return null;
  if (!CATALOG_APPEND_ALPHA_DEFAULT) return null;
  if (String(env[CATALOG_APPEND_ENV] ?? "").trim() !== "") return null;
  env[CATALOG_APPEND_ENV] = CATALOG_APPEND_MODULE;
  return CATALOG_APPEND_MODULE;
}
