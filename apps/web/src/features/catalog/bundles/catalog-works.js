import { modPicture } from "../../library/mod-picture.js";
import { isCatalogWork } from "../../workshop/works/catalog-work.js";
import { installsAsEffects } from "../../workshop/works/work-kinds.js";
import { tr } from "../../../locales/ui.js";
import { humanFailure } from "../../../utils/installFailure.js";

// Часть редукса, которую код мастерской воспроизводит без потерь, публикуется работой: пакета
// у неё нет, а код превращается в шаблон и ставится той же заявкой «Применить», что и в
// редакторе работы. Тяжёлый код мастерской подгружается динамически, при импорте модуля его нет.

const noop = () => {};

// Подгрузчики возвращают само обещание импорта: число тактов ожидания остаётся таким же.
const loadWorkTransfer = () => import("../../workshop/works/work-transfer.js");
const loadInstaller = () => import("../../workshop/work-install/install-build-works.js");

async function loadCodeReader() {
  const { readWorkCode } = await loadWorkTransfer();
  return (code) => readWorkCode(code, {});
}

// Отказ обещания превращается в null; синхронное исключение при самом вызове сюда не доходит.
const settled = (value) => Promise.resolve(value).catch(() => null);
const kindOf = (parsed) => parsed?.templates?.[0]?.kind;

// Картинка идёт последним ключом записи и только настоящая.
const withCover = (entry, cover) => (cover ? Object.assign(entry, { cover }) : entry);

function entryOf(mod, code, workKind) {
  const named = { name: mod.name || "", workKind, code };
  return withCover(named, modPicture(mod));
}

/**
 * Работа, которую каталог ставит сам, не открывая мастерскую: часть редукса и набор эффектов (трейсер, попадание, огонь). Вид — из карточки (контракт каталога
 * сверяет его с кодом работы). Остальное — оптимизация, небо, карта и прочие виды — ведёт в мастерскую.
 */
export const installsFromCatalog = (mod) => isCatalogWork(mod) && (mod.catalogSection === "redux" || installsAsEffects(mod.work.kind));

/**
 * Слова, когда работа не встала в очередь: «Работа не встала в очередь.», причина (если она читается и не повторяет это) и «Её можно открыть в мастерской.».
 */
export function workRefusal(reason = "") {
  const said = humanFailure(new Error(reason)).replace(/[.!…\s]+$/, "");
  const why = said && said !== tr("не встала в очередь") ? `${said}.` : "";
  return [tr("Работа не встала в очередь."), why, tr("Её можно открыть в мастерской.")].filter(Boolean).join(" ");
}

/**
 * Ставит части-работы каталога через очередь мастерской. Ответ установки возвращается как
 * есть; ставить нечего — null. Свой read сюда не передать.
 */
export async function installCatalogWorks(mods = [], { notify = noop } = {}) {
  const entries = await catalogWorkEntries(mods);
  if (entries.length === 0) return null;
  const { installBuildWorks } = await loadInstaller();
  return installBuildWorks(entries, { notify });
}

/**
 * Записи для установки работ: { name, workKind, code } и, если у мода есть настоящая
 * картинка, последним ключом cover. Работы читаются по одной, по порядку. Нечитаемая работа
 * пропускается молча: отказ обещания read ловится, синхронное исключение read уходит наружу.
 */
export async function catalogWorkEntries(mods = [], { read = null } = {}) {
  const found = [];
  // Настоящий разбор подгружается при каждом вызове, до просмотра списка.
  const readCode = read || (await loadCodeReader());
  for (const mod of mods.filter((candidate) => isCatalogWork(candidate))) {
    const code = mod.work.code;
    const workKind = kindOf(await settled(readCode(code)));
    if (workKind) found.push(entryOf(mod, code, workKind));
  }
  return found;
}
