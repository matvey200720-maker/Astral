/*
 * Фонари в игру.
 *
 * У фонарей две части: модели — пакетом слоя Astral (движок), файлы
 * update.rpf — нативным патчем со своей точкой отката (`lamp-studio.js` в
 * главном процессе). Порядок записи держит главный процесс: пакет первым,
 * патч поверх, — а здесь решается одно: снять ли прежнюю точку фонарей ДО
 * смены пакета.
 *
 * Движок, меняя пакет, перебазируется на живой архив, и всё, что в нём
 * лежит от нативных патчей, становится его основой. Прежняя точка фонарей,
 * оставленная под новой сборкой, запекла бы свои огни вдали в основу движка:
 * новая версия их перекроет, но «Откатить» вернёт уже не игру, а прежние
 * фонари. Поэтому, если пакет меняется, прежняя точка снимается первой —
 * той же дорогой, что корзина библиотеки (перемотка и возврат того, что
 * лежало сверху). Не снимается (её уже накрыл другой мод движка) — новая
 * версия встаёт поверх, как у остальных редакторов.
 */

import {
  applyLampPreset,
  createLampProject,
  lampProjectIsVanilla,
} from "@modovik/street-light-contract/lamps";
import { applyLampStudio, planLampStudio } from "../../../../api.js";
import {
  rollBackInstall,
  rollBackPlan,
} from "../../../library/retire-previous.js";
import {
  forgetInstallRecord,
  readInstallRecord,
  rememberInstallRecord,
} from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const LAMP_INSTALL_KEY = "astral.lamp-studio.install.v1";

/** Фонари Rockstar: вид «Как в игре» — его установка возвращает игре её фонари. */
export const STOCK_LAMPS = applyLampPreset(createLampProject(), "vanilla");

/*
 * Откат перемоткой невозможен, когда копии архива под точкой фонарей уже
 * нет (поверх легли другие работы, и уборка кэша её убрала —
 * `backup-missing`) или архив пересобирали мимо цепочки точек (`buried`,
 * `unknown`: движок снял пакет моделей, другой мод, проверка файлов).
 * Тогда фонари игры возвращает установка штатного вида — так и советует
 * библиотека: «верните штатный вид в её редакторе и примените». Прежде
 * «Применить» со штатным видом была погашена, и фонари из игры было не
 * снять ничем (снято 29.09.2026). Место на диске, Vanilla Guard и прочие
 * отказы штатным видом не лечатся — о них говорит сам откат.
 */
const STOCK_CURES = new Set(["backup-missing", "replay-unavailable"]);

export async function lampRollbackNeedsStockLook(record) {
  if (!record?.restorePointId) return false;
  const plan = await rollBackPlan({
    install: record,
    ...(typeof record.gameRoot === "string" && record.gameRoot
      ? { gameRoot: record.gameRoot }
      : {}),
  }).catch(() => null);
  if (!plan) return false;
  const other = plan.problems.filter((code) => !STOCK_CURES.has(code));
  return (
    !other.length &&
    (plan.stuck.length > 0 ||
      plan.problems.some((code) => STOCK_CURES.has(code)))
  );
}

/**
 * `customTexture` — своя картинка частиц (PNG base64 листа 128×128) или `null`.
 * `rollBackPrevious: false` — прежнюю точку перемоткой не снимать: окно уже
 * знает, что её так не снять.
 *
 * @param {{ project: object, state: string, customTexture?: string|null, report?: Function, rollBackPrevious?: boolean }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installLamps({
  project,
  state,
  customTexture = null,
  report = null,
  rollBackPrevious = true,
}) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const plan = await planLampStudio({
    gameRoot: game.path,
    project,
    customTexture,
  });

  const previous = readInstallRecord(LAMP_INSTALL_KEY);
  let previousRemoved = false;
  if (rollBackPrevious && plan?.engine?.changes && previous?.restorePointId) {
    try {
      await rollBackInstall({
        gameRoot: game.path,
        install: {
          restorePointId: previous.restorePointId,
          patch: previous.patch || "",
        },
      });
      previousRemoved = true;
    } catch {
      /* Точку накрыл другой мод движка — снять её отдельно нельзя. Новая
         версия встанет поверх и перекроет те же файлы. */
    }
  }

  const result = await applyLampStudio({
    gameRoot: game.path,
    planId: plan.planId,
    project,
    customTexture,
    previousRemoved,
  });
  /* Штатный вид встал — в игре от фонарей Astral ничего не осталось, и
     откатывать нечего: запись уходит, а не заменяется точкой возврата,
     откат которой вернул бы прежний вид. */
  if (lampProjectIsVanilla(project)) {
    if (result?.nativeError)
      throw new Error(
        `Модели фонарей сняты, а огни вдали и частицы вернуть не удалось: ${result.nativeError}`,
      );
    forgetInstallRecord(LAMP_INSTALL_KEY);
    /* Своих словарей дорог больше нет — ступень текстур берёт штатные. */
    const textures = await refreshTexturesFor(previous?.layerModId ? ["lamps.ytd"] : [], report);
    return { result: textures ? { ...result, textures } : result, record: null };
  }
  const record = await rememberInstallRecord(
    LAMP_INSTALL_KEY,
    { id: result?.id, patch: result?.patch, layerModId: result?.layerModId },
    {
      editor: "lamps",
      gameRoot: game.path,
      installedState: state,
      files: result?.files?.length || 0,
      models: result?.models?.length || 0,
    },
    { report },
  );
  /* Новая версия вернула игре её фонари (всё «как в игре» и ничего нашего
     не осталось) — прежней записи больше нечего снимать. */
  if (!record) forgetInstallRecord(LAMP_INSTALL_KEY);
  if (result?.nativeError)
    throw new Error(
      `Модели фонарей встали в игру, а огни вдали и частицы — нет: ${result.nativeError}`,
    );
  /* Словари дорог с фонарями везут и «Дороги» (задача 6 ТЗ 07.10.2026):
     стоящие дороги собираются заново поверх новых — и сами пересобирают
     ступень. Иначе — словари в ступени «Ухудшения текстур» (задача 1):
     она собирается заново поверх новых. */
  const { refreshRoadsAfterWork } = await import("./recolor.js");
  const roads = await refreshRoadsAfterWork(result?.models, report);
  const textures = roads?.textures ? null : await refreshTexturesFor(result?.models, report);
  return { result: { ...result, ...(roads ? { roads } : {}), ...(textures ? { textures } : {}) }, record };
}

/* Пересборка ступени текстур после фонарей — словами очереди, без падения
   установки: фонари уже в игре. */
async function refreshTexturesFor(names, report) {
  /* Словари и модели: ступень везёт и модели карты со своими текстурами —
     прежний столб из неё перекрыл бы новый. */
  if (!(names || []).some((name) => /\.(?:ytd|ydr|ydd|yft)$/i.test(String(name)))) return null;
  const { refreshTexturesAfterWork } = await import("./textures.js");
  try {
    return await refreshTexturesAfterWork(names, report);
  } catch (error) {
    throw new Error(
      `Фонари встали, но «Ухудшение текстур» не собралось заново поверх них: ${String(error?.message || error)} Нажмите там «Установить» ещё раз.`,
    );
  }
}
