/*
 * Карточка оптимизации в игру и из игры — очередью мастерской.
 *
 * Кнопки «Применить» у раздела нет (03.10.2026): включил карточку — её
 * состав встаёт в очередь установки и уходит в игру, выключил — снимается.
 * Одно нажатие — одна работа очереди (одна строка на экране «В процессе»)
 * со своими шагами: настройки игры, затем каждый слой. У карточки две
 * половины, и снимаются они по-разному:
 *
 *   переключатели — один общий профиль (`visualsettings.dat`,
 *     `procedural.meta` — одним патчем `update.rpf` с точкой отката, ключи
 *     `settings.xml` — с запомненными прежними значениями). Патч у профиля
 *     один на все карточки: две карточки правят один и тот же файл, и
 *     отдельные патчи на один файл при откате одного из них вернули бы в
 *     игру чужие числа. Поэтому смена профиля сначала снимает стоящий путём
 *     «Библиотеки», а потом ставит новый целиком;
 *   слои из модов — все включённые слои всех карточек одним пакетом
 *     движка (набор, задача 8): переключение карточки — одна пересборка
 *     update.rpf, выключение слоя — тот же набор без него, а не снятие
 *     корзиной (перемотка архива и повтор работ мастерской сверху).
 *
 * Работа берёт цель, сохранённую при нажатии (`saved`): профиль целиком и
 * какие слои должны стоять. Цель считается от того, к чему придёт очередь
 * (последняя живая работа раздела), а не от того, что стоит сейчас: нажатие
 * во время чужой установки не теряет её правок. В момент записи цель
 * сверяется с тем, что стоит: повтор не пишет в игру то, что там уже есть.
 *
 * Отказ (игра запущена, файл занят) приходит словами очереди
 * (`utils/installFailure.js`). Неудачное переключение не снимает того, что
 * стояло: запущенную игру ловит проверка до снятия прежнего профиля, а отказ
 * записи нового возвращает прежний.
 */

import { optimizationLayerTitle } from "@modovik/optimizer/layer-ids.js";
import { createOptimizerProfile } from "@modovik/optimizer";
import {
  applyOptimizerProfile,
  planLibraryRemoval,
  removeFromLibrary,
  rollbackOptimizerProfile,
} from "../../../../api.js";
import { applyLibraryRemovalResult } from "../../../../workshop-library.js";
import {
  enqueueWorkshopInstall,
  workSignature,
} from "../../../../features/workshop/install-queue/index.js";
import { locateLegacyTarget } from "../../../../features/workshop/install-queue/game-root.js";
import {
  installOptimizationSet,
  installedOptimizationLayers,
} from "../../../../features/workshop/install-queue/tasks/optimization-set.js";
import {
  clearAppliedOptimizer,
  readAppliedOptimizer,
  sameSelection,
  writeAppliedOptimizer,
} from "./optimizer-storage.js";
import { tr } from "../../../../locales/ui.js";

/** Ключ работы карточки в очереди. */
export const optimizationCardJobKey = (cardId) =>
  `astral.optimization.card.${cardId}.v1`;

const CARD_JOB_PREFIX = "astral.optimization.card.";

const EMPTY = Object.freeze({ enabled: [] });

const isLive = (job) => job.status === "queued" || job.status === "running";

/* Живые работы раздела в порядке очереди: последняя — то, чем она кончится. */
const sectionJobs = (snapshot) =>
  (snapshot?.jobs || []).filter(
    (job) => isLive(job) && String(job.key).startsWith(CARD_JOB_PREFIX),
  );

/** Профиль, к которому придёт очередь: цель последней работы или то, что стоит. */
export function profileTarget(snapshot, applied) {
  const job = sectionJobs(snapshot)
    .filter((item) => item.saved?.profile)
    .at(-1);
  return job?.saved.profile || applied?.profile || EMPTY;
}

/** Стоит ли слой — или будет стоять, когда очередь дойдёт до его работы. */
export function layerTarget(snapshot, layerId) {
  const job = sectionJobs(snapshot)
    .filter((item) => typeof item.saved?.layers?.[layerId] === "boolean")
    .at(-1);
  if (job) return job.saved.layers[layerId];
  return installedOptimizationLayers().has(layerId);
}

/*
 * Снять стоящий профиль тем же путём, что «Библиотека»: хост сам откатывает
 * только верхнюю точку стопки, а поверх профиля к этому времени часто лежат
 * другие работы — «Библиотека» перематывает архив к точке до профиля и
 * ставит их обратно (записи получают новые имена точек). Ключи настроек
 * возвращаются запомненными значениями.
 *
 * Перемотать удаётся не всегда. Слои карточек ставит движок и пересобирает
 * архив поверх точки профиля, а уборка кэша потом забирает её копию; точки
 * нет и у профиля, который встал «уже стоящим». 04.10.2026 «Улицы» так
 * «выключились»: «Библиотека» забыла точку, правки остались в файлах, а
 * карточка показывала «Выключено». Теперь план «Библиотеки» спрашивается
 * заранее, а снятый профиль всегда уходит в `revert` у
 * `applyOptimizerProfile` — вернуть штатными значениями то, что осталось:
 * всё, если перемотки не было (`required`), и только застрявшее ниже
 * потерянной точки, если она была.
 */
async function takeOffProfile(applied, gameRoot) {
  let rewound = false;
  if (applied.restorePointId) {
    const request = {
      gameRoot,
      natives: [{ restorePointId: applied.restorePointId, patch: "" }],
      mods: [],
    };
    const plan = await planLibraryRemoval(request).catch(() => null);
    const action = plan?.natives?.[0]?.action;
    /* Перемотка сквозь слои движка — пересборка всех модов каталога, по
       десять с лишним минут на каждое переключение карточки. Точка под
       движком уже погребена, её копию всё равно заберёт уборка: дешевле и
       так же верно вернуть правки штатными значениями поверх. «forget» —
       точка уже вне цепочки: «Библиотека» только забудет её. */
    const rewind = action === "remove" && !plan?.engineReplay;
    if (plan?.status === "ready" && (rewind || action === "forget")) {
      const result = await removeFromLibrary(request);
      applyLibraryRemovalResult(globalThis.localStorage, result);
      rewound = result?.natives?.[0]?.action === "remove";
    }
  }
  if (Object.keys(applied.settingsPrevious || {}).length)
    await rollbackOptimizerProfile({
      gameRoot,
      restorePointId: "",
      previous: applied.settingsPrevious,
    });
  return applied.profile?.enabled?.length
    ? { profile: applied.profile, required: !rewound }
    : null;
}

/* «Вернуть россыпь штатной»: человек сам выбрал после отказа «россыпь
   чужая» (бета 15.10) — главный процесс возвращает её штатной. */
const scatterChoice = (forceScatter) => (forceScatter ? { forceScatter: true } : {});

/* Поставить профиль и запомнить, чем его снимать. */
async function installProfile(profile, gameRoot, locale, revert = null, forceScatter = false) {
  const result = await applyOptimizerProfile({
    profile,
    gameRoot,
    locale,
    ...(revert ? { revert: revert.profile, revertRequired: revert.required } : {}),
    ...scatterChoice(forceScatter),
  });
  writeAppliedOptimizer({
    profile,
    appliedAt: new Date().toISOString(),
    /* Имя точки отката: без него выключение вернуло бы только настройки. */
    restorePointId: String(result?.restorePointId || result?.id || ""),
    files: (result?.files || []).map((file) => file.file || file),
    /* Прежние значения ключей `settings.xml` — их вернёт выключение. */
    settingsPrevious: result?.settings?.previous || {},
  });
  return result;
}

/**
 * Профиль в игру: стоящий снимается, цель ставится целиком. Цель, которая
 * уже стоит, ничего не пишет. `forceScatter` — повтор после отказа
 * «россыпь чужая» с выбором человека «Вернуть россыпь штатной».
 */
export async function syncOptimizerProfile(target, { locale = "ru", forceScatter = false } = {}) {
  const next = createOptimizerProfile(target);
  const applied = readAppliedOptimizer();
  if (sameSelection(next, applied?.profile || EMPTY)) return { unchanged: true };
  const game = await locateLegacyTarget();
  /* Игра запущена — отказ до снятия прежнего, а не после. */
  await applyOptimizerProfile({ gameRoot: game.path, checkOnly: true });
  const revert = applied ? await takeOffProfile(applied, game.path) : null;
  if (!next.enabled.length) {
    if (revert)
      try {
        await applyOptimizerProfile({
          gameRoot: game.path,
          profile: EMPTY,
          revert: revert.profile,
          revertRequired: revert.required,
          locale,
          ...scatterChoice(forceScatter),
        });
      } catch (error) {
        /* Без перемотки правки остались в файлах — карточка не врёт
           «Выключено»: запись остаётся, без точки (её уже нет) и без
           настроек (они вернулись). После перемотки профиля в игре нет. */
        if (revert.required)
          writeAppliedOptimizer({ ...applied, restorePointId: "", settingsPrevious: {} });
        else clearAppliedOptimizer();
        throw error;
      }
    clearAppliedOptimizer();
    return { removed: true };
  }
  clearAppliedOptimizer();
  try {
    const result = await installProfile(next, game.path, locale, revert, forceScatter);
    return { installed: true, skipped: result?.skipped?.length || 0 };
  } catch (error) {
    /* Новый не встал — прежний возвращается на место. */
    if (applied?.profile?.enabled?.length)
      await installProfile(applied.profile, game.path, locale).catch(() => {});
    throw error;
  }
}

/**
 * Слои в игру и из игры — набором (задача 8): к тому, что стоит сейчас,
 * применяются изменения работы (`layers` — слой → должен ли стоять), и весь
 * набор ставится одной установкой.
 */
export async function syncOptimizationLayers(layers) {
  const target = installedOptimizationLayers();
  for (const [layerId, on] of Object.entries(layers)) {
    if (on) target.add(layerId);
    else target.delete(layerId);
  }
  return installOptimizationSet({ layers: [...target] });
}

/* Шаги работы карточки — те части, что меняются. */
function cardSteps(saved, locale) {
  return [
    {
      id: "prepare",
      label: tr("Подготовка"),
      hint: tr("Astral проверяет, что игра закрыта, и сверяет то, что уже стоит"),
    },
    ...(Object.keys(saved.layers).length
      ? [
          {
            id: "layers",
            label: Object.keys(saved.layers)
              .map((layerId) => optimizationLayerTitle(layerId, locale))
              .join(", "),
            hint: tr("Все включённые слои — одним набором: одна пересборка update.rpf на переключение, без перемотки работ мастерской"),
          },
        ]
      : []),
    ...(saved.profile
      ? [
          {
            id: "profile",
            label: tr("Настройки игры"),
            hint: tr("visualsettings.dat, procedural.meta и settings.xml: прежняя настройка снимается, новая ставится одним патчем с точкой отката"),
          },
        ]
      : []),
  ];
}

/*
 * Работа карточки: слои — одним набором, затем настройки игры. Набор идёт
 * первым: профиль — патч поверх архива, и пересборка набора после него
 * сначала перебазировала бы архив (минута на каждое переключение).
 */
async function runCardJob(saved, { report, locale }) {
  report({ step: "prepare" });
  if (Object.keys(saved.layers).length) {
    report({ step: "layers" });
    await syncOptimizationLayers(saved.layers);
  }
  if (saved.profile) {
    report({ step: "profile" });
    await syncOptimizerProfile(saved.profile, {
      locale,
      forceScatter: saved.forceScatter === true,
    });
  }
  return {};
}

/**
 * Переключить карточку или часть её состава: одна работа в очередь с целью
 * каждой части, которая меняется. Обещание — итог работы; `null`, если
 * менять нечего.
 *
 * @param {{
 *   card: { id: string, tweaks: string[], layers: string[], optional: string[] },
 *   on: boolean,
 *   parts?: Array<{ kind: "tweak"|"layer", id: string }>,
 *   snapshot: object,
 *   applied: object|null,
 *   title: string,
 *   editor: string,
 *   locale?: string,
 * }} input `parts` — только эти части (переключатель части в составе
 *   карточки); без него — основной состав, а при выключении и отдельные.
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>|null}
 */
export function toggleOptimizationParts({
  card,
  on,
  parts = null,
  snapshot,
  applied,
  title,
  editor,
  locale = "ru",
}) {
  const tweaks = parts
    ? parts.filter((part) => part.kind === "tweak").map((part) => part.id)
    : card.tweaks;
  const layers = parts
    ? parts.filter((part) => part.kind === "layer").map((part) => part.id)
    : on
      ? card.layers
      : [...card.layers, ...card.optional];

  let profile = null;
  if (tweaks.length) {
    const base = createOptimizerProfile(profileTarget(snapshot, applied));
    const enabled = new Set(base.enabled);
    for (const id of tweaks) {
      if (on) enabled.add(id);
      else enabled.delete(id);
    }
    const target = createOptimizerProfile({ enabled: [...enabled] });
    if (!sameSelection(target, base)) profile = target;
  }
  const changing = Object.fromEntries(
    layers
      .filter((layerId) => layerTarget(snapshot, layerId) !== on)
      .map((layerId) => [layerId, on]),
  );
  if (!profile && !Object.keys(changing).length) return null;

  const saved = { on, profile, layers: changing };
  return new Promise((resolve) => {
    enqueueWorkshopInstall({
      key: optimizationCardJobKey(card.id),
      signature: workSignature(saved),
      title,
      editor,
      steps: cardSteps(saved, locale),
      operation: on ? "install" : "remove",
      saved,
      run: ({ report, saved: job }) => runCardJob(job, { report, locale }),
      onDone: () => resolve({ ok: true }),
      onFailed: (message) => resolve({ ok: false, message }),
      /* Ждущую работу убрали из очереди — итога не будет. */
      onCancelled: () => resolve({ ok: false, cancelled: true }),
    });
  });
}
