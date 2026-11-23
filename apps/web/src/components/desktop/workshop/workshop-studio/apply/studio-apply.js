/*
 * «Применить» в студии: одно нажатие на весь путь работы в игру.
 *
 * Здесь собрано то, что раньше лежало тремя окнами установки — мини-карты,
 * прицела и большой карты, — каждое со своей сводкой, своими шагами, своей
 * полосой и своей кнопкой «Повторить установку» после успеха. Окон больше
 * нет: работа сохраняется, встаёт в общую очередь применения и ставится сама,
 * а что с ней происходит, видно на экране «В процессе».
 *
 * Редактору отсюда нужны две вещи: чем занять кнопку, пока работа в очереди,
 * и что делать по нажатию.
 */

import { useMemo } from "react";
import { useSettled } from "../dirty-state.js";

import { tr, useUiLanguage } from "../../../../../locales/ui.js";
import { mapSavedStockNote, mapTilesDoneNote } from "../studio-lang.js";
import { withIslandNote, withPauseBlurNote, withRadarNote } from "../../world-map-radar-note.js";
import { withBlipIconsNote } from "../../world-map-icons-note.js";
import {
  REPLACING_INSTALL_STEPS,
  applyWorkshopWork,
  useWorkshopApplyButton,
  workSignature,
} from "../../../../../features/workshop/install-queue/index.js";
import {
  MINIMAP_INSTALL_KIND,
  installMinimap,
  minimapGpsNote,
  minimapWarnings,
  minimapZoomNote,
} from "../../../../../features/workshop/install-queue/tasks/minimap.js";
import {
  RETICLE_INSTALL_KIND,
  installReticle,
} from "../../../../../features/workshop/install-queue/tasks/reticle.js";
import {
  WORLD_MAP_INSTALL_KIND,
  WORLD_MAP_INSTALL_STEPS,
  WORLD_MAP_STOCK_STEPS,
  installWorldMap,
} from "../../../../../features/workshop/install-queue/tasks/world-map.js";
import {
  CLIMBS_INSTALL_KIND,
  installClimbs,
} from "../../../../../features/workshop/install-queue/tasks/climbs.js";
import { WORKSHOP_RETICLE_MODULE_IDS } from "../../workshop-project.js";

/*
 * Ключ очереди — по тому, что ставится, а не по открытой вкладке: обычный
 * прицел и снайперский уезжают в игру одним файлом, и очередь обязана
 * считать их одной работой.
 */
export function studioInstallKind(moduleId) {
  if (WORKSHOP_RETICLE_MODULE_IDS.includes(moduleId))
    return RETICLE_INSTALL_KIND;
  if (moduleId === "minimap") return MINIMAP_INSTALL_KIND;
  if (moduleId === "world-map") return WORLD_MAP_INSTALL_KIND;
  if (moduleId === "climbs") return CLIMBS_INSTALL_KIND;
  return moduleId;
}

/*
 * Версия работы — только то, что уезжает в игру этим «Применить».
 *
 * Не весь проект: в нём ещё список установок, который очередь сама же и
 * пишет по окончании, и соседние модули. С ними подпись менялась бы от
 * того, что работа встала в игру, и кнопка звала бы поставить ту же
 * мини-карту второй раз. Файлы проекта входят в подпись описью (имя и хеш),
 * а не байтами: байты лежат в хранилище отдельно.
 *
 * `variant` — другой путь той же работы: карта «как в игре» пишет штатные
 * файлы Rockstar, а не свои, и с обычной картой это разные версии.
 */
export function studioWorkSignature(project, moduleId, variant = "") {
  const ids = WORKSHOP_RETICLE_MODULE_IDS.includes(moduleId)
    ? WORKSHOP_RETICLE_MODULE_IDS
    : [moduleId];
  return workSignature({
    modules: ids.map((id) => project.modules?.[id] ?? null),
    assets: project.assets || [],
    variant,
  });
}

/**
 * @param {{
 *   project: object,
 *   moduleId: string,
 *   save: () => Promise<object|null>,
 *   notify: (text: string, tone?: string) => void,
 *   translate: (text: string) => string,
 * }} context
 */
export function useStudioApply({
  project,
  moduleId,
  save,
  notify,
  translate: t,
}) {
  const language = useUiLanguage();
  const key = `${studioInstallKind(moduleId)}:${project.id}`;
  /* Подпись работы — для кнопки «Применить», не для шага жеста: считаем по отложенному проекту (`useDeferredValue`),
     а при нажатии — по текущему (`applyWork`), чтобы в установку ушло то, что видно. */
  const deferredProject = useSettled(project);
  const signature = useMemo(
    () => studioWorkSignature(deferredProject, moduleId),
    [deferredProject, moduleId],
  );
  const button = useWorkshopApplyButton(key, signature, t);

  const applyWork = ({ variant = "", ...spec }) =>
    applyWorkshopWork({
      key,
      signature: studioWorkSignature(project, moduleId, variant),
      title: project.name,
      coverProjectId: project.id,
      save: async () => {
        const saved = await save();
        if (!saved) throw new Error(tr("Не удалось сохранить работу"));
        return saved;
      },
      notify,
      ...spec,
    });

  return {
    applyBusy: button.busy,
    applyMeter: button.meter,
    applyHint: button.hint,
    applyMinimap: () =>
      applyWork({
        editor: tr("Мини-карта"),
        coverSlotId: "minimap",
        steps: REPLACING_INSTALL_STEPS,
        run: ({ saved, report }) =>
          installMinimap({
            project: saved,
            configuration: saved.modules.minimap || {},
            report,
          }),
        doneText: ({ installed }) => {
          const notes = minimapWarnings(installed);
          /* Дальность радара и метка с маршрутом GPS (задача 10 ТЗ
             10.10.2026, вечер) — тем же патчем, одной строкой. */
          const extras = [minimapZoomNote(installed), minimapGpsNote(installed)].filter(Boolean);
          const head = extras.length
            ? `${tr("Мини-карта в игре")}, ${extras.join("; ")}`
            : tr("Мини-карта в игре");
          return notes.length
            ? `${head}. ${notes.join("; ")}`
            : `${head} — ${tr("перезапустите GTA V")}`;
        },
      }),
    applyReticle: () =>
      applyWork({
        editor: tr("Прицел"),
        coverSlotId: "crosshair",
        steps: REPLACING_INSTALL_STEPS,
        run: ({ saved, report }) => installReticle({ project: saved, report }),
        doneText: () => tr("Прицел в игре — перезапустите GTA V"),
      }),
    /* Карта отдаёт вместе с нажатием то, чем её рисовать: сцена, обработчик
       растра и кодек DDS живут в редакторе, и уезжают они такими, какими
       были в момент нажатия. */
    applyWorldMap: (payload) =>
      applyWork({
        editor: tr("Большая карта"),
        coverSlotId: "large-map",
        variant: payload?.stock ? "stock" : "",
        /* Карта «как в игре» снимает поставленное или возвращает штатные
           файлы Rockstar — шаги обоих путей. */
        steps: payload?.stock ? WORLD_MAP_STOCK_STEPS : WORLD_MAP_INSTALL_STEPS,
        ...(payload?.stock
          ? {
              savedText: mapSavedStockNote(language, project.name),
            }
          : {}),
        run: ({ saved, report }) =>
          installWorldMap({ ...payload, project: saved, report }),
        doneText: ({ tiles, stock, removed, restored, missing, already, radar, pauseBlur, island, icons }) => {
          /* Про мини-карту в углу экрана — вслух, а не молчанием: штатная она
             осталась или перекрашена (жалоба 13.10). Так же — про размытие
             за картой, если его просили убрать (15.10). Значки карты игры — отдельным патчем, их слово — в конце. */
          if (!stock)
            return withBlipIconsNote(withIslandNote(withPauseBlurNote(withRadarNote(mapTilesDoneNote(language, tiles), radar), pauseBlur), island), icons);
          if (restored)
            return withBlipIconsNote(`${tr("В игре штатная карта Rockstar")} — ${tr("перезапустите GTA V")}`, icons);
          if (missing)
            return withBlipIconsNote(
              tr(
                "Карта снята, но штатных файлов Rockstar в копиях Astral не нашлось: в игре карта из копии до Astral. Проверьте файлы игры в Steam.",
              ),
              icons,
            );
          if (already) return withBlipIconsNote(tr("В игре и так штатная карта"), icons);
          return withBlipIconsNote(
            removed
              ? `${tr("В игре штатная карта")} — ${tr("перезапустите GTA V")}`
              : tr("В игре и так штатная карта — ставить нечего"),
            icons,
          );
        },
      }),
    /* Залазы отдают вместе с нажатием макет и нарисованные текстуры меток:
       рисует их сам редактор, и уезжают они такими, какими были в момент
       нажатия, а не какими станут, пока работа ждёт очереди. */
    applyClimbs: ({ design, textures }) =>
      applyWork({
        editor: tr("Залазы"),
        coverSlotId: "climbing",
        run: ({ saved, report }) =>
          installClimbs({ project: saved, design, textures, report }),
        doneText: () => tr("Залазы в игре — перезапустите GTA V"),
      }),
  };
}
