import { readPartFiles } from "../part-workshop.js";
import { importPart } from "../part-covers/part-import.js";

/*
 * Данные «Предпросмотра» части редукса (Каталог 2.0, часть 2): проект части из её файлов — для сцен мастерской (миникарта, небо, прицел), которые рисуют его в размер окна каталога.
 *
 * Путь без мастерской и без записи в игру: `readPartFiles` (файлы пакета части; облачному моду нужен грант на скачивание) → `importPart` (чистый разбор в проект редактора).
 * `openPartInWorkshop` и `partWork` не зовутся — они пишут работу в библиотеку человека. Читается только по нажатию «Предпросмотр»; разобранное запоминается в окне на сессию.
 */

/** Какие виды частей показывает предпросмотр. */
export const PREVIEW_VIEW_KINDS = Object.freeze([
  "minimap",
  "timecycle",
  "crosshair",
]);

// Проект, который кладёт в снимок обложка части: строка JSON или уже объект.
const projectOf = (state) => {
  if (!state) return null;
  try {
    return typeof state === "string" ? JSON.parse(state) : state;
  } catch {
    return null;
  }
};

/**
 * Что нужно сцене вида из разбора части; `null` — разбор ничего для неё не дал (файл без нужного: прицел нарисован не линиями, небо не из `w_*.xml`).
 *   minimap   → { config, look }   проект мини-карты и вид полос из `minimap.gfx` автора;
 *   timecycle → { project }        проект неба;
 *   crosshair → { config }         настройки обычного прицела.
 */
export function viewDataOf(kind, imported) {
  if (!imported) return null;
  if (kind === "minimap") {
    const project = projectOf(imported.cover?.state);
    const config = project?.modules?.minimap;
    if (!config) return null;
    return {
      config,
      look: project.minimapLook?.version === 1 ? project.minimapLook : null,
    };
  }
  if (kind === "timecycle") {
    const work = imported.work;
    return work?.kind === "sky" && work.project
      ? { project: work.project }
      : null;
  }
  if (kind === "crosshair") {
    const config =
      imported.work?.kind === "reticle"
        ? imported.work.project?.modules?.crosshair
        : null;
    return config ? { config } : null;
  }
  return null;
}

const cache = new Map();

/** Читает и разбирает часть; одинаковые запросы в одном окне делят один ответ. Отказ в кэше не живёт. */
export function loadPartPreview(part, kind, deps = {}) {
  const key = `${part.id}:${kind}`;
  if (!cache.has(key)) {
    const read = deps.readPartFiles || readPartFiles;
    const parse = deps.importPart || importPart;
    const job = (async () => {
      const files = await read(part, kind);
      const data = viewDataOf(
        kind,
        await parse(kind, files, { name: part.name || "" }),
      );
      if (!data) throw new Error("PREVIEW_EMPTY");
      return data;
    })();
    job.catch(() => cache.delete(key));
    cache.set(key, job);
  }
  return cache.get(key);
}

/** Только для тестов. */
export const forgetPreviews = () => cache.clear();
