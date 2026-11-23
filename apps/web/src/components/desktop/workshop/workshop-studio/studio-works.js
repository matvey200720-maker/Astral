/*
 * «Мои работы» и коды в студии: мини-карта, прицел, большая карта, залазы.
 *
 * Работа студии — сам проект: «Сохранить в мои работы» сохраняет его и
 * отмечает в «Моих работах», «Сохранить как новую» заводит копию со своими
 * файлами и дальше правит её. Код несёт модули проекта без картинок
 * (`work-transfer.js`).
 *
 * Чужой код открывается НОВЫМ проектом, а не правкой текущего: проект
 * студии — документ, и «Применить» пишет в него же. Код друга, вставленный
 * поверх сохранённой работы, после «Применить» переписал бы её. Большая
 * карта — исключение по решению владельца (22.09.2026): чужая карта ложится
 * в текущую шагом истории и сразу ставится в игру; это делает её редактор.
 */

import {
  copyWorkshopAssets,
  deleteUnreferencedWorkshopAssets,
} from "../workshop-assets.js";
import {
  migrateWorkshopProject,
  readWorkshopProjects,
  upsertWorkshopProject,
} from "../workshop-project.js";
import {
  addStudioWork,
  isStudioWork,
} from "../../../../features/workshop/works/workshop-works.js";
import { rememberStudioProject } from "../../../../features/workshop/works/studio-current.js";
import { studioKindOfModules } from "../../../../features/workshop/works/work-kinds.js";
import { studioCode } from "../../../../features/workshop/works/work-transfer.js";
import { fingerprint } from "./shared.jsx";

/**
 * Обработчики «Моих работ» для редактора студии — пропом `works` в
 * мини-карту, прицел, большую карту и залазы, где их берёт
 * `useWorkActions`.
 */
export function studioWorkHandlers({
  projectRef,
  save,
  dispatch,
  onSaved,
  savedFingerprint,
  notify,
}) {
  const current = () => projectRef.current;
  const kind = studioKindOfModules(
    current().enabledModules || Object.keys(current().modules || {}),
  );

  /* Проект становится тем, что правит редактор, и тем, что откроет плитка. */
  const adopt = (saved) => {
    savedFingerprint.current = fingerprint(saved);
    dispatch({ type: "replace", project: saved });
    onSaved(saved);
    rememberStudioProject(saved.sourceModId, saved.id);
  };

  return {
    kind,
    /* Отклик окна — тостом студии: у редакторов студии своего нет. */
    notify,
    linkedName: () =>
      isStudioWork(current().id) ? String(current().name || "") : "",
    async save({ name, asNew }) {
      const project = current();
      if (!asNew) {
        const wasSaved = isStudioWork(project.id);
        /* `save` сам говорит об отказе тостом и возвращает `null`. */
        const saved = await save({ name });
        if (!saved) return false;
        addStudioWork(saved.id, { origin: "editor" });
        rememberStudioProject(saved.sourceModId, saved.id);
        return { name: saved.name, created: !wasSaved };
      }
      /* Копия со своими файлами: картинки исходной работы остаются ей, и
         удаление одной не выбьет картинки из другой. */
      const copy = migrateWorkshopProject({
        ...project,
        id: undefined,
        name,
        createdAt: undefined,
        updatedAt: undefined,
        lastOpenedAt: undefined,
        assets: [],
        appliedSnapshots: [],
        installations: [],
      });
      let assets = [];
      try {
        assets = await copyWorkshopAssets(project.assets || [], copy.id);
        const saved = upsertWorkshopProject({ ...copy, assets });
        addStudioWork(saved.id, { origin: "editor" });
        adopt(saved);
        return { name: saved.name, created: true };
      } catch (error) {
        await deleteUnreferencedWorkshopAssets(
          assets,
          readWorkshopProjects(),
        ).catch(() => {});
        throw error;
      }
    },
    copy: () => studioCode(current(), kind),
    /* Чужой код — новым проектом того же источника: плитка, на которой
       открыт редактор, продолжит его находить. */
    open(result) {
      const template = result.templates[0];
      const saved = upsertWorkshopProject({
        ...template.project,
        sourceModId: current().sourceModId || template.project.sourceModId,
        sourceModName:
          current().sourceModName || template.project.sourceModName,
      });
      adopt(saved);
      return saved;
    },
  };
}
