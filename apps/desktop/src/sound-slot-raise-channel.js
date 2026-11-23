/*
 * Подъём слота памяти звуков оружия по каналам (20.11.2026, решение ведущей после контрольной серии К1–К3; `launcher_app/docs/SOUND-STUDIO.md`, «Что проверено в игре»).
 *
 * Паки звуков, которым не хватило мёртвых дорожек банка, при включённом подъёме получают слот STATIC_WEAPONS больше штатного (`audio-composer.js`, `audio-slots.js`).
 * В игре это проверено в сюжетном режиме шестью запусками (одно зависание на подъёме +2,06 МБ без дампа, серия К1–К3 чистая, потолок теперь 1 МиБ); на серверах (Majestic,
 * GTA 5 RP) никто не смотрел. Поэтому в альфе подъём включён по умолчанию, а в бете и релизе остаётся выключенным (`SLOT_RAISE_DEFAULT`) — до отзывов альфы.
 *
 * Слово в окружении (`ASTRAL_SOUND_SLOT_RAISE`: `on`, `off`, `1`, `0`…) сильнее умолчания канала. Видимых человеку строк здесь нет.
 */

/*
 * Имя выключателя записано здесь своей строкой, без импорта из `@modovik/sound-studio/slot-fit`: этот файл грузится на старте
 * (`channels/index.js`), а пакет звука при старте грузиться не должен (`tests/main-startup-imports.test.js`). Равенство двух имён
 * держит `tests/sound-slot-raise-channel.test.js`.
 */
export const SLOT_RAISE_CHANNEL_ENV = "ASTRAL_SOUND_SLOT_RAISE";
const SLOT_RAISE_ENV = SLOT_RAISE_CHANNEL_ENV;

/** Канал, где подъём слота включён по умолчанию. */
export const SLOT_RAISE_CHANNEL = "alpha";

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applySoundSlotRaiseDefault({
  channel,
  env = process.env,
} = {}) {
  if (channel !== SLOT_RAISE_CHANNEL) return null;
  if (String(env[SLOT_RAISE_ENV] ?? "").trim() !== "") return null;
  env[SLOT_RAISE_ENV] = "1";
  return "1";
}
