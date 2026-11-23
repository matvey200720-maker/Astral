import { useMemo } from "react";
import { WorkshopImage } from "../../../WorkshopMedia.jsx";
import { workshopPreviewFor } from "../../../workshop-visuals.js";
import EditorCover from "../covers/EditorCover.jsx";
import { hasEditorCover } from "../covers/editor-covers.js";
import GunWorkCover from "./GunWorkCover.jsx";
import WorkSnapshotCover from "./WorkSnapshotCover.jsx";
import { workCoverKeys } from "./work-cover-keys.js";

/*
 * Обложка работы мастерской — одна на «Мои работы», сборки и окно новой сборки (Т-150): снимок кадра её редактора или обложка из каталога
 * (`work-covers.js`, ключи — `work-cover-keys.js`); пока их нет, запасной вид: лёгкая обложка работы или штатная картинка вида (`EditorCover`), у вида
 * без рисователя — снимок слота. Библиотека ставит те же части (`covers/slot-cover.jsx`).
 *
 * `work` — `{ workKind, slotId, section, state?, projectId?, updatedAt?, key?, coverKey?, coverKeys?, installed? }`: `coverKeys` — ключи уже известны
 * (работа из кода сборки); `index` — номер плитки для отложенной загрузки снимка.
 */
export default function WorkCover({ work, index = 0 }) {
  const coverKeys = useMemo(
    () => work.coverKeys || workCoverKeys(work),
    // Ключи решают снимок работы и её место, а не каждая новая запись с теми же значениями.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [work.coverKeys, work.coverKey, work.key, work.projectId, work.slotId, work.installed, work.state],
  );
  const key = `${work.key || work.slotId}:${work.updatedAt || ""}`;
  if (work.workKind === "weapon" || work.workKind === "clothing")
    return <WorkSnapshotCover key={key} coverKeys={coverKeys} fallback={<GunWorkCover state={work.state} kind={work.workKind} />} />;
  if (hasEditorCover(work.slotId))
    return (
      <WorkSnapshotCover
        key={key}
        coverKeys={coverKeys}
        fallback={<EditorCover slotId={work.slotId} projectId={work.projectId || ""} state={work.state || null} />}
      />
    );
  return (
    <WorkSnapshotCover
      key={key}
      coverKeys={coverKeys}
      fallback={<WorkshopImage className="workshop-work-image" src={workshopPreviewFor(work.section, work.slotId, 0)} alt="" index={index} />}
    />
  );
}
