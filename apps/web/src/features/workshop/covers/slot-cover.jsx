import { useMemo } from "react";
import EditorCover from "./EditorCover.jsx";
import { editorCoverKind, hasEditorCover } from "./editor-covers.js";
import { installedEditorState } from "../works/workshop-works.js";
import { workCoverKeys } from "../works/work-cover-keys.js";
import WorkSnapshotCover from "../works/WorkSnapshotCover.jsx";

export { installedCoverKey } from "../works/work-cover-keys.js";

/*
 * Обложка плитки слота: на полке мастерской — штатная картинка, в библиотеке — работа человека.
 *
 * Плитка редактора на полке мастерской не меняется, что бы человек ни делал (владелец, 25.10.2026): это готовая
 * картинка с настоящего предпросмотра (`renderStockCover`). Работа, что стоит в игре, показывается в библиотеке
 * (`renderSlotCover`) — снимком кадра редактора, снятым при «Сохранить» и «Применить» (`works/work-covers.js`), тем же, что в сборках
 * (`work-cover-keys.js`); пока снимка нет, на месте запасной вид (`EditorCover`): лёгкая обложка-холст или штатная картинка.
 * Ничего не перерисовывается в фоне.
 *
 * Работа узнаётся по установкам (`readWorkshopInstallUnits`): у проектов студии — по id проекта, у отдельных
 * редакторов — по снимку работы, которая числится в игре. Черновик на обложку не попадает: библиотека отвечает на
 * вопрос «что стоит в игре», а не «что я вчера крутил».
 */

/** Что показывает обложка слота: `{ kind, projectId, state, unit }` или `null`. */
export function slotCoverSpec(slotId, installUnits = []) {
  if (!hasEditorCover(slotId)) return null;
  const unit = installUnits.find((item) => item.slots?.includes(slotId));
  const projectId =
    unit?.origin?.type === "project" ? unit.origin.projectId || "" : "";
  const state =
    unit?.origin?.type === "key" ? installedEditorState(slotId) : null;
  return { kind: editorCoverKind(slotId), projectId, state, unit };
}

/** Плитка слота на полке мастерской: всегда штатная картинка вида. */
export function renderStockCover(slotId) {
  if (!hasEditorCover(slotId)) return null;
  return <EditorCover key={`${slotId}:stock`} slotId={slotId} />;
}

function InstalledCover({ slotId, projectId, state, installed }) {
  const coverKeys = useMemo(
    () => workCoverKeys({ slotId, projectId, installed }),
    // Снимок работы в игре меняется вместе с `state`: ключи перечитываются, когда она сменилась.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotId, projectId, state, installed],
  );
  return (
    <WorkSnapshotCover
      coverKeys={coverKeys}
      fallback={<EditorCover slotId={slotId} projectId={projectId} state={state} />}
    />
  );
}

/** Обложка слота в библиотеке: снимок работы, что стоит в игре, а без снимка — запасной вид. */
export function renderSlotCover(slotId, installUnits = []) {
  const spec = slotCoverSpec(slotId, installUnits);
  if (!spec) return null;
  const { projectId, state, unit } = spec;
  return (
    <InstalledCover
      key={`${slotId}:${unit?.key || "stock"}:${unit?.installedAt || ""}`}
      slotId={slotId}
      projectId={projectId}
      state={state}
      installed={Boolean(unit)}
    />
  );
}
