import { tr } from "../../../locales/ui.js";
import { requestWorkOpen } from "./work-open-request.js";
import { humanFailure } from "../../../utils/installFailure.js";

// Тяжёлые соседи грузятся по требованию, каждый, когда до него дошло дело.
const lazy = {
  works: () => import("./workshop-works.js"),
  transfer: () => import("./work-transfer.js"),
  code: () => import("./work-code.js"),
  focus: () => import("../optimizer-focus.js"),
  queue: () => import("../../catalog/bundles/catalog-works.js"),
  copy: () => import("../../catalog/bundles/bundle-copy.js"),
};

// Память «мод → ключ созданной работы» читается один раз; любой объект годится, остальное — пустая.
function openedMemory() {
  const storageKey = "astral.catalog.works.v1";
  let snapshot = {};
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(storageKey));
    snapshot = typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // испорченная или недоступная память равна пустой
  }
  return {
    keyOf: (modId) => snapshot[modId],
    remember(modId, workKey) {
      try {
        globalThis.localStorage.setItem(storageKey, JSON.stringify({ ...snapshot, [modId]: workKey }));
      } catch {
        // памяти нет или она полна: в следующий раз работа заведётся заново
      }
    },
  };
}

// Просьбу открыть работу кладём и возвращаем ключ как есть.
const requestOpen = (workKey) => {
  requestWorkOpen(workKey);
  return workKey;
};

export const isCatalogWork = (mod) => mod?.publicationMode === "work" && typeof mod.work?.code === "string";

// Шаблоны мода: готовые, если они списком, иначе из кода работы.
async function templatesOf({ work }) {
  if (Array.isArray(work.templates)) {
    return work.templates;
  }
  const { readWorkCode } = await lazy.transfer();
  return (await readWorkCode(work.code)).templates;
}

const workKeyOf = ({ projectId, workId }) => (projectId ? `project:${projectId}` : `work:${workId}`);

export async function openCatalogWork(mod) {
  if (!isCatalogWork(mod)) {
    throw new Error("У мода нет работы мастерской.");
  }
  const memory = openedMemory();
  const { listWorkshopWorks } = await lazy.works();
  const shelf = listWorkshopWorks().map((work) => work.key);
  const known = memory.keyOf(mod.id);
  if (known && shelf.includes(known)) {
    return requestOpen(known);
  }

  const templates = await templatesOf(mod);
  const { addWorkTemplates } = await lazy.transfer();
  const [first] = await addWorkTemplates(
    Array.from(templates, (template) => Object.assign({}, template, { name: mod.name || template.name })),
  );
  if (!first) {
    throw new Error("Работа из кода не открылась.");
  }
  const workKey = workKeyOf(first);
  memory.remember(mod.id, workKey);
  return requestOpen(workKey);
}

// Единая оболочка: любой отказ шага превращается в сообщение с тоном «error».
async function reporting(showNotice, fallbackText, task) {
  try {
    await task();
  } catch (error) {
    showNotice(humanFailure(error) || fallbackText(), "error");
  }
}

// «Оптимизация» редактора не имеет: слои уходят в её раздел.
const isOptimization = async (mod) =>
  isCatalogWork(mod) && (await lazy.code()).findWorkCode(mod.work.code)?.kind === "optimization";

async function sendToOptimizer(mod) {
  const [{ readWorkCode }, { requestOptimizerFocus }] = await Promise.all([lazy.transfer(), lazy.focus()]);
  const [template] = (await readWorkCode(mod.work.code)).templates;
  const facts = (mod.domain?.optimization?.facts ?? []).filter(Boolean);
  requestOptimizerFocus({ layers: template?.state?.layers ?? [], source: mod.name || "", facts });
}

// Способы открыть мод по порядку; первый, что сработал, и есть ответ.
const OPEN_WAYS = [
  async (mod, navigate) => {
    if (!(await isOptimization(mod))) {
      return false;
    }
    await sendToOptimizer(mod);
    navigate("workshop", "optimization");
    return true;
  },
  async (mod, navigate) => {
    await openCatalogWork(mod);
    navigate("workshop");
    return true;
  },
];

export async function openFromShell(mod, { navigate, showNotice }) {
  await reporting(showNotice, () => tr("Работа не открылась."), async () => {
    for (const way of OPEN_WAYS) {
      if (await way(mod, navigate)) {
        return;
      }
    }
  });
}

// Что делать с ответом очереди: первое подошедшее правило. Нет ответа — открыть в мастерской; не встала — слова отказа с причиной и подсказкой про мастерскую.
const refused = (outcome) => [...(outcome.failed ?? []), ...(outcome.unsupported ?? [])][0];
const QUEUE_REACTIONS = [
  [(outcome) => !outcome, (mod, ctx) => openFromShell(mod, ctx.shell)],
  [(outcome) => outcome.queued?.length, (mod, { phrases, showNotice }) => showNotice(phrases.workQueued(mod.name))],
  [(outcome) => outcome.already?.length, (mod, { phrases, showNotice }) => showNotice(phrases.workInGame(mod.name))],
  [refused, (mod, { queue, showNotice, outcome }) => showNotice(queue.workRefusal(refused(outcome).reason), "error")],
];

export async function installFromShell(mod, { navigate, showNotice, language = "ru" }) {
  const shell = { navigate, showNotice };
  return reporting(showNotice, () => tr("Работа не встала в очередь."), async () => {
    const [queue, { bundleCopy }] = await Promise.all([lazy.queue(), lazy.copy()]);
    // Что каталог ставит сам, решает очередь (`installsFromCatalog`); остальное — в мастерскую.
    if (!queue.installsFromCatalog(mod)) return openFromShell(mod, shell);
    const outcome = await queue.installCatalogWorks([mod], { notify: (text) => showNotice(text, "error") });
    const phrases = bundleCopy(language);
    const [, react] = QUEUE_REACTIONS.find(([applies]) => applies(outcome)) ?? [];
    await react?.(mod, { shell, showNotice, phrases, outcome, queue });
  });
}
