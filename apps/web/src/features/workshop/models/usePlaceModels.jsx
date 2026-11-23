/*
 * Инструмент «Модели» в редакторе места — всё, что ему нужно, одним хуком
 * (задача 1 ТЗ 11.10.2026, вечер): список и его правка (`useModelsEditor`),
 * облик для кадра (`usePlaceModelLooks`), панель, плашка ручек и строка
 * подсказок. Редактор места добавляет инструмент (`modelsTool`), отдаёт
 * панель своей колонке, а кадру — `stageProps`.
 */

import { useCallback, useRef, useState } from "react";
import ModelsPanel from "./ModelsPanel.jsx";
import { MODELS_TOOL_ID, ModelsStageBar, modelsGuide } from "./models-tool.jsx";
import { useModelsEditor } from "./useModelsEditor.js";
import { usePlaceModelLooks } from "./usePlaceModelLooks.js";

const readModels = (project) => project.models;
const writeModels = (project, models) => ({ ...project, models });

/**
 * `editor` — от `useRecolorEditor` (`project`, `commit`, `amend`,
 * `cameraMode`); `read`/`write` — где список (по умолчанию `project.models`);
 * `scene` — сцена кадра; `tool`, `onTool` — взятый инструмент редактора;
 * `where` — где место («на заводе»).
 *
 * Ответ: `{ edit, active, stageRef, panel, bar, guide, stageProps, onAim }`.
 * `onAim(hit)` — нажатие колеса по кадру (`ModelStage`, проп `onAim`): если
 * под курсором своя модель (`hit.model`), берёт «Модели», выбирает её и
 * отвечает `true`; иначе — `false` (выбор — за редактором места). Он же
 * лежит в `stageProps` — кадрам, где больше нечего выбирать колесом.
 */
export function usePlaceModels({
  editor,
  read = readModels,
  write = writeModels,
  scene = "",
  tool,
  onTool,
  where = "",
  /* Подпись сцены в списке (`scene` → «Ферма»), переход кадра к сцене модели. */
  sceneLabel = null,
  onSceneChange = null,
  /* Модель выбрана строкой списка (`useModelsEditor`). */
  onListPick = null,
  /* Почему сюда модели не поставить (место ставит сервер) или `""`. */
  blocked = "",
  onNotice = null,
}) {
  const stageRef = useRef(null);
  const [bounds, setBounds] = useState(null);
  const active = tool === MODELS_TOOL_ID;
  const onActivate = useCallback(() => onTool?.(MODELS_TOOL_ID), [onTool]);
  const edit = useModelsEditor({
    project: editor.project,
    commit: editor.commit,
    amend: editor.amend,
    read,
    write,
    scene,
    stage: stageRef,
    active,
    onActivate,
    onSceneChange,
    onListPick,
    blocked,
    onNotice,
  });
  const looks = usePlaceModelLooks(edit.items, scene);
  const onSceneBounds = useCallback((next) => setBounds(next || null), []);
  const onAim = edit.aim;

  return {
    edit,
    active,
    stageRef,
    onAim,
    panel: (
      <ModelsPanel
        edit={edit}
        bounds={bounds}
        where={where}
        sceneLabel={sceneLabel}
      />
    ),
    bar: active ? <ModelsStageBar edit={edit} /> : null,
    guide: modelsGuide(editor.cameraMode, { selected: Boolean(edit.selected) }),
    /* Кадру места: облик моделей, выбранная, мышь, выбор колесом и ссылка на кадр. */
    stageProps: {
      stageRef,
      models: looks,
      modelSelection: edit.selection,
      modelHandlers: edit.stageHandlers,
      onSceneBounds,
      onAim,
    },
  };
}
