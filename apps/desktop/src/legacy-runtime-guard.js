/*
 * Предохранитель живой игры: всё, что должно совпасть, прежде чем редактор
 * мастерской напишет что-нибудь в `update.rpf` настоящей установки.
 *
 * Жил внутри `registerIpc` в `main.js` замыканием. Вынесен потому, что это
 * не часть регистрации каналов, а самостоятельное правило с восемью
 * вызывающими и длинным объяснением, зачем оно такое.
 */
import path from "node:path";
import fs from "node:fs/promises";
import {
  inspectModsShadow,
  MODS_SHADOW_ARCHIVE,
} from "@modovik/install-engine";
import { discoverGames } from "@modovik/game-discovery";
import { describeProcess, runningProcesses } from "./game-processes.js";
import { clearModsShadow } from "./game-loaders.js";

export async function findGame(targetId) {
  const games = await discoverGames();
  const game = games.find((item) => item.id === String(targetId || ""));
  if (!game)
    throw new Error(
      "Установка GTA V больше не найдена. Выполните повторное сканирование.",
    );
  return game;
}

/** Какие процессы игры запущены: `[{ name, pid }]`; не смогли спросить — пусто. */
export async function runningGameProcesses(game) {
  try {
    return await runningProcesses([game.executable, "GTA5.exe", "GTA5_Enhanced.exe"]);
  } catch {
    return [];
  }
}

export async function gameProcessRunning(game) {
  return (await runningGameProcesses(game)).length > 0;
}

/*
 * Один предохранитель на все редакторы, которые пишут в `update.rpf`.
 * Проверка одна и та же — подтверждённая Astral папка, издание Legacy и
 * закрытая игра, — и три её копии расходились бы ровно тогда, когда в неё
 * добавили бы четвёртое условие.
 */
/*
 * Тень папки mods проверяется и здесь.
 *
 * Редакторы мастерской пишут в `update/update.rpf` мимо `installPackage`:
 * план уходит нативному хосту командой `install-rpf-patch`, а он адресует
 * архив от корня игры и про слой `mods` не знает вовсе. С копией
 * `mods/update/update.rpf` рядом с загрузчиком такая установка отчитается
 * успехом, запишет точку отката — и в игре не появится. Ровно этим
 * начинаются все жалобы «установилось, а в игре ничего нет».
 *
 * Установщик пакетов эту проверку делает давно
 * (`packages/install-engine/index.js`, ветка `direct-update-entries-v1`);
 * до 2026-09-09 семь из десяти плиток редакторов проходили мимо неё.
 */
const assertNoModsShadow = async (gameRoot, genitive) => {
  /* OpenIV поставили, пока Astral открыт: копию архива убирает сам Astral, а не человек. */
  await clearModsShadow(gameRoot);
  const shadow = await inspectModsShadow(gameRoot, async (file) => {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  });
  if (!shadow.shadowed) return;
  /* Файл называется целиком: «папка mods» человеку — это поиск по диску, а
     путь он открывает в проводнике. Окно показывает его в «Подробностях». */
  const archive = path.join(gameRoot, ...MODS_SHADOW_ARCHIVE.split("/"));
  throw new Error(
    `Игра читает ${MODS_SHADOW_ARCHIVE}, а не свой update.rpf: рядом стоит ` +
      `загрузчик (${[...shadow.hooks, ...shadow.plugins].join(", ")}). ` +
      `Уберите копию архива из папки mods или отключите загрузчик — иначе ` +
      `результат ${genitive} в игре не появится. Файл: ${archive}`,
  );
};

export const legacyRuntimeGuard = (genitive, subject) => ({
  assertRuntimeSafety: async (gameRoot) => {
    const games = await discoverGames();
    const game = games.find(
      (item) =>
        path.resolve(item.path).toLowerCase() === gameRoot.toLowerCase(),
    );
    if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
    if (String(game.edition || "Legacy").toLowerCase() !== "legacy")
      throw new Error(
        `${subject} Majestic / GTA5RP поддерживает только GTA V Legacy.`,
      );
    const running = await runningGameProcesses(game);
    if (running.length)
      throw new Error(
        `Закройте GTA V и лаунчер проекта перед применением ${genitive}. ` +
          `Найден процесс: ${running.map(describeProcess).join(", ")}.`,
      );
    await assertNoModsShadow(gameRoot, genitive);
  },
});
