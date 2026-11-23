/*
 * Умолчания арены Majestic в альфа-канале (21.11.2026, слово владельца после захода на arena10: «арена полностью вся функционирует»;
 * `docs/ALPHA-DEFAULTS-2011.md`, `docs/ARENA-SCREEN-PLATES.md`).
 *
 * Три выключателя безопасной сборки Majestic, подтверждённые заходом, в альфе ставятся при старте приложения, если слово в окружении пустое:
 *   — `ASTRAL_ARENA_SLABS=1` — замена аирдропов плитами «картинка → объём» (способ Б2);
 *   — `ASTRAL_ARENA_SCREEN_PLATES=1` — плита «картинка → объём» перед экраном-стеной (экран остаётся серверным, смещение из проекта уважается);
 *   — `ASTRAL_ARENA_HALL_ENTITIES=1` — свои модели людей внутри комнат залов дописанной сущностью помещения.
 * Бета, релиз и запуск вне канала: окружение не тронуто, умолчания в коде — выключено. Любое слово человека сильнее канала; аварийно выключить и в
 * альфе — `ASTRAL_ARENA_SLABS=0` (и так для каждого). Видимых человеку строк здесь нет.
 *
 * Имена записаны здесь своими строками, без импорта сборщика арены: файл грузится на старте (`channels/index.js`), а пакет установки при старте
 * грузиться не должен (`tests/main-startup-imports.test.js`). Равенство держит `tests/arena-alpha-channel.test.js`.
 */

/** Канал, где умолчания арены Majestic включены. */
export const ARENA_ALPHA_CHANNEL = "alpha";

/** Выключатели и слово включения; слово — то, что понимают `slabsEnabledFrom`, `screenPlatesEnabledFrom`, `hallEntitiesEnabledFrom`. */
export const ARENA_ALPHA_SWITCHES = Object.freeze([
  Object.freeze({ env: "ASTRAL_ARENA_SLABS", word: "1" }),
  Object.freeze({ env: "ASTRAL_ARENA_SCREEN_PLATES", word: "1" }),
  Object.freeze({ env: "ASTRAL_ARENA_HALL_ENTITIES", word: "1" }),
]);

/** Ставит умолчания канала, если выключатель не задан. Отдаёт имена поставленных выключателей (пусто — ничего не менял). */
export function applyArenaAlphaDefaults({ channel, env = process.env } = {}) {
  if (channel !== ARENA_ALPHA_CHANNEL) return [];
  const set = [];
  for (const { env: name, word } of ARENA_ALPHA_SWITCHES) {
    if (String(env[name] ?? "").trim() !== "") continue;
    env[name] = word;
    set.push(name);
  }
  return set;
}
