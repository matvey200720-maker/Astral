import { parkForeignPlugins, parkModsShadowArchive } from "@modovik/install-engine";

/*
 * Загрузчики неготовой игры. Отказа «завершите настройку стороннего loader»
 * больше нет (бета 02.11.2026: у новичков лежит OpenIV.asi без dinput8.dll, и
 * установка упиралась в текст, с которым им нечего делать): Astral ставит свои
 * и откладывает чужой плагин (`foreign-loaders.js`).
 */
export const LOADERS_VANISHED_MESSAGE =
  "Файлы загрузчиков исчезли из папки игры сразу после установки: обычно их убирает антивирус. Добавьте папку GTA V в исключения антивируса";

/*
 * Копия update.rpf в `mods` откладывается всегда, а не только при загрузчике:
 * загрузчик ставит сам Astral, и с ним она стала бы тенью. Не вышло (файл занят)
 * — движок откажет словами «Игра читает mods/update/update.rpf».
 */
export async function clearModsShadow(gameRoot, park = parkModsShadowArchive) {
  try {
    const parked = await park(gameRoot);
    if (parked.length) console.info(`[astral] Отложена копия архива: ${parked.join(", ")}`);
    return parked;
  } catch (error) {
    console.warn(`[astral] Копия архива из mods не отложена: ${error?.message || error}`);
    return [];
  }
}

/**
 * `provision` ставит загрузчики, `reread` отдаёт игру после них и бросает, если
 * писать в неё уже нельзя (игра запущена, лаунчер обновляет файлы).
 */
export async function settleGameLoaders({ game, provision, reread, park = parkForeignPlugins }) {
  if (game.installReadiness === "ready") return game;
  await provision();
  /* Не отложилось (файл занят) — не повод останавливаться: RageOpenV.asi уже стоит. */
  const parked = await park(game.path).catch((error) => {
    console.warn(`[astral] Чужой плагин не отложен: ${error?.message || error}`);
    return [];
  });
  if (parked.length) console.info(`[astral] Отложены чужие плагины: ${parked.join(", ")}`);
  const settled = await reread();
  if (settled.installReadiness !== "ready") throw new Error(LOADERS_VANISHED_MESSAGE);
  return settled;
}
