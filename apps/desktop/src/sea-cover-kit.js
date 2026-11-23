/*
 * Чтение игры для кадра моря (ТЗ 27.10.2026): карточка воды в каталоге — настоящий кадр моря у Венис-Бич, а не плита на сетке.
 *
 * Кадр снимает окно-съёмщик частей (`part-shooter.js`) кодом редактора «Вода»: ему нужны берег и дно из установленной GTA V
 * (секция `venice-sea`, `mega-mall-section-model.js`), небо игрока на час (таймцикл), облачные шапки и их листы. У окна-съёмщика
 * моста к приложению нет, поэтому хозяин (печь обложек `catalog:render-covers`, песочница) отдаёт эти пять чтений сам — теми же
 * модулями, что у приложения, и только из той игры, с которой его запустили: папку, которую просит окно, он не берёт.
 * Только чтение игры; свои кэши — в `stateDir`.
 *
 *   const kit = createSeaCoverKit({ gameRoot, keys, stateDir, context });
 *   await kit.call("loadMegaMallSection", { sectionId: "venice-sea" });
 */

import path from "node:path";
import { createMegaMallSectionHost, toBase64 } from "./mega-mall-section-host.js";
import { readSkyBases } from "./timecycle-customizer.js";
import { readCloudHatTexture, readCloudHats } from "./cloud-hats.js";

/* Чтения, которые отдаёт хозяин: то, чем кадр моря собирается, и ничего больше. */
export const SEA_KIT_METHODS = Object.freeze([
  "readSkyBases",
  "readCloudHats",
  "readCloudHatTexture",
  "loadMegaMallSection",
  "loadMegaMallSectionBundle",
]);

/**
 * @param {object} options
 * @param {string} options.gameRoot — папка GTA V (Legacy), с которой запущен хозяин
 * @param {string} options.keys — каталог ключей ArchiveFix
 * @param {string} options.stateDir — свои кэши (кадр моря, секции карты, чистая основа неба)
 * @param {object} options.context — контекст нативного движка (`packaged`, `resourcesPath`, `projectRoot`, `onProgress`)
 */
export function createSeaCoverKit({ gameRoot, keys, stateDir, context, tools = {} }) {
  if (!gameRoot || !path.isAbsolute(gameRoot)) throw new TypeError("Кадру моря нужна папка игры.");
  const root = path.resolve(gameRoot);
  const host = createMegaMallSectionHost({ gameRoot: root, keys, cacheRoot: path.join(stateDir, "mega-mall"), context, ...tools });
  /* `strictSources`: печь обложек читает игру строго — нет архива неба в папке игры, это отказ с его именем, а не небо из оставшегося (`game-source-missing.js`). */
  const ask = (input) => ({ gameRoot: root, keys, strictSources: true, ...(input?.refresh ? { refresh: true } : {}), ...(input?.name ? { name: input.name } : {}) });
  return Object.freeze({
    gameRoot: root,
    async call(method, input) {
      if (method === "readSkyBases") return readSkyBases(ask(input), context, stateDir);
      if (method === "readCloudHats") return readCloudHats(ask(input), context, stateDir);
      if (method === "readCloudHatTexture") {
        const bytes = await readCloudHatTexture(ask(input), context, stateDir);
        return { png: toBase64(new Uint8Array(bytes)) };
      }
      if (method === "loadMegaMallSection") return host.section(input);
      if (method === "loadMegaMallSectionBundle") return host.bundle(input);
      throw new TypeError(`Кадр моря не читает «${String(method).slice(0, 40)}».`);
    },
  });
}
