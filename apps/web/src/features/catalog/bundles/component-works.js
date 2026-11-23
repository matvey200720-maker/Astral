import { WORK_KINDS } from "../../workshop/works/work-kinds.js";
import { tr } from "../../../locales/ui.js";
import { componentSlotOf } from "./component-choices.js";
import { editorOf, hasNoEditor } from "./component-editors.js";

/*
 * Своя работа из мастерской на месте компонента сборки (ТЗ владельца 10.11.2026: «взять из другой сборки либо сделать из мастерской и
 * поставить, и у него бы все это применялось»).
 *
 * Работа подходит компоненту, если сделана в редакторе того же слота (`catalogSlot` части = `slotId` вида работы: мини-карта — работа мини-карты,
 * таймцикл — работа таймцикла). Ставится работа очередью мастерской (`installBuildWorks`, как «Свои карты» и части-работы сборки), а не пакетом:
 * у неё нет файла в каталоге, только код.
 *
 * Тяжёлое (код работ, очередь мастерской) подгружается, когда работу ставят или снимают; список подходящих работ — лёгкое чтение хранилища.
 */

// Вид работы мастерской с таким слотом (вид «на ствол» и «на вещь» — по слоту — не в счёт).
const workKindOf = (slotId) => Object.values(WORK_KINDS).find((spec) => spec.slotId === slotId && !spec.perSlot) || null;

/**
 * Редактор мастерской, в котором можно сделать работу «с нуля» для компонента, и слоты сборки, на которые встаёт одна такая работа (`covers`: три слота зон).
 * Слот установки — по таблице (`component-editors.js`); слот вне таблицы, у которого редактор не исключён, — по слоту каталога, как раньше (старые записи).
 * @returns {{ slotId: string, section: string, covers: string[] } | null}
 */
export function workshopSlotOf(part) {
  const slot = componentSlotOf(part);
  if (!slot) return null;
  const found = editorOf(slot) || (hasNoEditor(slot) ? null : { slotId: slot, covers: [slot] });
  const kind = found ? workKindOf(found.slotId) : null;
  return found && kind ? { slotId: found.slotId, section: kind.section || "redux", covers: found.covers } : null;
}

/** Сохранённые работы мастерской, что подходят компоненту. `works` — `listWorkshopWorks()`. */
export function ownWorkCandidates(part, works = []) {
  const place = workshopSlotOf(part);
  if (!place) return [];
  return works.filter((work) => work?.slotId === place.slotId && WORK_KINDS[work.workKind] && work.name);
}

/** Все сохранённые работы мастерской. Читаются по нужде: модуль мастерской тяжёлый и в стартовый кусок не входит. */
export async function readOwnWorks() {
  const { listWorkshopWorks } = await import("../../workshop/works/workshop-works.js");
  return listWorkshopWorks();
}

/** Работа по ключу выбора (`project:…` или `work:…`); не нашлась (человек её удалил) — null. */
export const ownWorkByKey = (works = [], key = "") => (key ? works.find((work) => work.key === key) || null : null);

// Код работы для очереди мастерской: проект студии берётся из хранилища проектов, снимок отдельного редактора лежит в самой работе.
async function entryOf(work) {
  const [{ savedWorkCode }, projects] = await Promise.all([
    import("../../workshop/works/work-transfer.js"),
    work.kind === "project" ? import("../../../components/desktop/workshop/workshop-project.js") : null,
  ]);
  const project = projects ? projects.readWorkshopProjects().find((item) => item.id === work.projectId) : null;
  if (work.kind === "project" && !project) throw new Error(`${tr("Работы больше нет")}: «${work.name}»`);
  const { code } = await savedWorkCode(work, project);
  return { name: work.name, workKind: work.workKind, code };
}

// Исход очереди мастерской: всё, что не встало или не поддержано, — отказ с причиной по-человечески.
function failuresOf(ledger) {
  return [...(ledger?.failed || []), ...(ledger?.unsupported || [])].map((item) => (typeof item === "string" ? item : item?.reason || item?.name || ""));
}

/**
 * Поставить свои работы на место компонентов.
 * @returns {Promise<{ ok: boolean, failures: string[], ledger: object }>}
 */
export async function installComponentWorks(works = [], { notify = () => {} } = {}) {
  if (!works.length) return { ok: true, failures: [], ledger: {} };
  const [{ installBuildWorks }, entries] = await Promise.all([import("../../workshop/work-install/install-build-works.js"), Promise.all(works.map(entryOf))]);
  const ledger = await installBuildWorks(entries, { notify });
  const failures = failuresOf(ledger);
  return { ok: failures.length === 0, failures, ledger };
}

/**
 * Снять свои работы с места компонентов (компонент отключили или вернули родную часть).
 * @returns {Promise<{ ok: boolean, failures: string[], ledger: object }>}
 */
export async function removeComponentWorks(works = []) {
  if (!works.length) return { ok: true, failures: [], ledger: {} };
  const [{ removeBuildWorks }, entries] = await Promise.all([import("../../workshop/work-install/install-build-works.js"), Promise.all(works.map(entryOf))]);
  const ledger = await removeBuildWorks(entries);
  const failures = [...(ledger.failed || []), ...(ledger.unsupported || []), ...(ledger.stuck || [])].map((item) => (typeof item === "string" ? item : item?.reason || item?.name || ""));
  return { ok: failures.length === 0, failures, ledger };
}

/** Выбор компонентов без работ, которых больше нет (человек удалил их): такой компонент снова родная часть. `works` — `null`, пока список не прочитан. */
export function withKnownWorks(components, works) {
  if (works === null || !Object.keys(components.work).length) return components;
  const known = new Set(works.map((work) => work.key));
  const kept = Object.fromEntries(Object.entries(components.work).filter(([, key]) => known.has(key)));
  return Object.keys(kept).length === Object.keys(components.work).length ? components : { ...components, work: Object.freeze(kept) };
}
