import { readWorkshopProjects } from "../../components/desktop/workshop/workshop-project.js";
import { workshopCopyFor } from "../../workshop-copy.js";
import { installBuildWorks } from "../workshop/work-install/install-build-works.js";
import { savedWorkCode } from "../workshop/works/work-transfer.js";
import {
  listWorkshopWorks,
  openEditorWork,
} from "../workshop/works/workshop-works.js";
import { requestWorkApply } from "../workshop/works/work-apply-request.js";
import { RETURN_CART } from "./cart-return.js";

/*
 * Работы мастерской в корзине (владелец, 16.11.2026: «в мастерской, если я что-то сделал, нажать на троеточие и добавить это в корзину; на корзине установить могу; а если тыкну по названию,
 * меня перекинет в редактор на этот момент, чтобы я продолжил его редактировать»). Тяжёлая сторона — хранилище «Моих работ», коды работ и очередь установки мастерской — живёт здесь, одним куском,
 * и грузится динамически: корзина в стартовый кусок окна её не тянет.
 */

/** Работы по ключам корзины: ключ → запись «Моих работ» или `null`, если работу удалили. */
export function readCartWorks(keys) {
  const found = new Map(listWorkshopWorks().map((work) => [work.key, work]));
  return new Map(keys.map((key) => [key, found.get(key) ?? null]));
}

/** Свежая запись работы вида `kind`, что только что сохранили (список идёт от новых к старым). */
export const newestWorkOfKind = (kind) =>
  listWorkshopWorks().find((work) => work.workKind === kind) ?? null;

/** Название вида работы на языке окна («Трейсер», «Небо»…). */
export const workKindLabel = (work, language) =>
  workshopCopyFor(language).works.kinds[work?.workKind] ?? "";

// Запрос реестру редакторов: куда открыть работу. Тот же, что у `part-workshop.js` для «Моих работ»: проект студии — по его id, снимок редактора — после `openEditorWork`, что кладёт правку в черновик.
const studioQuery = ({ slotId, section, sourceModId, projectId, name }) => {
  const id = sourceModId || projectId;
  return {
    slotId,
    section,
    variant: { id, sourceModId: id, projectId, name, isUserWork: true },
  };
};

async function editorQueryFor(work) {
  if (work.kind === "project") return studioQuery(work);
  const opened = await openEditorWork(work.workId);
  return opened && { slotId: opened.slotId, section: opened.section };
}

/**
 * Открыть редактор на этой работе, на том месте, где её оставили. «Назад» из редактора ведёт в корзину (`returnPage: "cart"`, `goBackToCart`). `true` — редактор открылся.
 */
export async function openCartWork(
  work,
  {
    navigate,
    locale = "ru",
    apply = false,
    registry = () => import("../workshop/useWorkshopEditors.jsx"),
  } = {},
) {
  const query = await editorQueryFor(work);
  if (!query) return false;
  /* `apply` — «Установить» у работы одежды: окно выбора цели встаёт в редакторе само (`work-apply-request.js`), редактор не пустой. */
  if (apply && query.slotId) requestWorkApply(query.slotId);
  const { presetWorkshopEditor } = await registry();
  const shown = await presetWorkshopEditor(query, {
    locale,
    returnPage: RETURN_CART,
  });
  if (!shown) return false;
  navigate("workshop");
  return true;
}

/**
 * Поставить последнюю сохранённую версию работы тем же путём, что работы сборок (`installBuildWorks`): код работы → заявка «Применить» очереди мастерской.
 * Ответ — разбор по корзинам `{ queued, already, unsupported, failed }`.
 */
export async function installCartWork(work, { notify = () => {} } = {}) {
  const project =
    work.kind === "project"
      ? readWorkshopProjects().find((item) => item.id === work.projectId)
      : null;
  const { code } = await savedWorkCode(work, project);
  return installBuildWorks(
    [{ name: work.name, workKind: work.workKind, code }],
    { notify },
  );
}
