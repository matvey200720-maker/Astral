import { isCatalogBundle } from "../../catalog-utils.js";
import { tr } from "../../locales/ui.js";
import { extrasLeaving, isGunpackPack, packRemovalIds } from "../library/gunpack-state.js";
import { EFFECTS_LEAD_ORDER, TRACERS_NEED, TRACERS_SLOT, effectsSlotOf } from "./bundles/component-groups.js";

/*
 * Состав установки пакета «Эффектов» или «Трейсеров» из каталога (владелец 12.11.2026: «просто „Эффекты“ и отдельно „Трейсеры“»).
 *
 * В каталоге у редукса видна одна карточка эффектов (`catalog-page-mods.js`: ведущая, остальные пакеты скрыты), и «Установить» на ней обязано поставить ВСЕ пакеты «Эффектов» этого
 * редукса: таблицы и попадания ссылаются на правила частиц из ядра того же автора, и один пакет без соседей даёт пустые эффекты. «Трейсеры» — своя карточка, но привязки следа
 * ссылаются на правила из ядра и словарей частиц (`TRACERS_NEED`), поэтому ставятся вместе с ними. Порядок — порядок сборки (`includedModIds`): требуемые пакеты в нём раньше
 * требующих (сборка так и собирается, `requirementsFirst` разбора). Редукс — сборка каталога, в чьём составе стоит пакет; их несколько (версии «GTA 5 RP» и «Majestic») —
 * берётся та, где у пакета больше соседей.
 *
 * Модуль чистый: установку набора одной пачкой делает `effects-install-run.js`, снятие — оболочка (`removeMod`, `removeIdsOf`), страница мода берёт признак «стоит» (`installSetFacts`).
 * «Установить» и «Удалить» над ОДНИМ пакетом (`{ single: true }`) набор не раскрывают: так зовут строки частей окна «Компоненты», у которого свой ход по пакетам.
 */

const slotsOfSet = (slot) => (slot === TRACERS_SLOT ? TRACERS_NEED : EFFECTS_LEAD_ORDER);

/**
 * Пакеты, которые ставятся вместе с `mod`, в порядке установки. Пакет вне «Эффектов» и «Трейсеров», пакет без сборки-владельца и неизвестная запись — только он сам.
 * @param {object} mod запись каталога
 * @param {object[]} catalog все записи каталога (сборки и пакеты)
 * @returns {object[]} пакеты; `mod` среди них всегда (для эффектов — на своём месте в порядке сборки, для трейсеров — последним)
 */
export function installSetOf(mod, catalog = []) {
  if (!mod) return [];
  const slot = effectsSlotOf(mod);
  if (!slot) return [mod];
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const wanted = slotsOfSet(slot);
  /* Состав каждой сборки-владельца в её порядке: соседи по слотам набора и сам пакет. */
  const sets = catalog
    .filter((owner) => isCatalogBundle(owner) && (owner.includedModIds || []).includes(mod.id))
    .map((owner) => owner.includedModIds.map((id) => byId.get(id)).filter((entry) => entry && (entry.id === mod.id || wanted.includes(effectsSlotOf(entry)))));
  const best = sets.reduce((found, set) => (set.length > found.length ? set : found), []);
  if (!best.length) return [mod];
  /* Трейсеры: ядро и частицы раньше, привязки последними; эффекты: как идут в сборке. */
  return slot === TRACERS_SLOT ? [...best.filter((entry) => entry.id !== mod.id), mod] : best;
}

/**
 * Что из состава стоит в игре: `all` — всё (карточка «Установлено»), `none` — ничего, `some` — часть (доустановить недостающее).
 * @returns {{ state: "all"|"some"|"none", missing: object[] }}
 */
export function installSetState(set, installed = []) {
  const standing = new Set(installed);
  const missing = set.filter((part) => !standing.has(part.id));
  if (!missing.length) return { state: "all", missing };
  return { state: missing.length === set.length ? "none" : "some", missing };
}

/**
 * Что поставить по «Установить» на карточке: недостающие пакеты набора в порядке установки. Больше одного — ставятся одной пачкой (`effects-install-run.js`), один — им самим,
 * ни одного — всё уже стоит. Пакет вне «Эффектов» и «Трейсеров» — он сам, если не стоит.
 */
export function installTodoOf(mod, catalog = [], installed = []) {
  return installSetState(installSetOf(mod, catalog), installed).missing;
}

/**
 * Что снять по «Удалить» на карточке (id стоящих пакетов). «Эффекты» — все стоящие пакеты набора: по отдельности они не работают. «Трейсеры» — только привязки: ядро и частицы
 * принадлежат «Эффектам», и снятие трейсеров их не трогает. Остальные пакеты — они сами.
 */
export function removeIdsOf(mod, catalog = [], installed = [], bundleOf = {}) {
  if (!mod?.id) return [];
  /* Ганпак по стволам: «Удалить ганпак» снимает стволы, которые поставил пак (`gunpack-state.js`). */
  if (isGunpackPack(mod)) return packRemovalIds(mod, installed, bundleOf);
  const standing = new Set(installed);
  const own = effectsSlotOf(mod) === TRACERS_SLOT ? [mod] : installSetOf(mod, catalog);
  return own.filter((part) => standing.has(part.id)).map((part) => part.id);
}

const BUSY = new Set(["install", "remove"]);

/**
 * Признаки карточки эффектов или трейсеров для страницы мода: `ready` («Установлено») — стоит весь набор, а не один пакет из четырёх; `active` — строка очереди карточки (в том числе
 * пачка, в которой стоит хоть один её пакет: у пачки id первого пакета, а не ведущего). Очередь «Эффектов» карточку «Трейсеров» не занимает: трейсеры считаются по своим привязкам и пачкам.
 * @param {{ mod: object, set: object[], installed: string[], queue: object[] }} args `set` — `installSetOf(mod, catalog)`
 * @returns {{ ready: boolean, active: object|undefined }}
 */
export function installSetFacts({ mod, set, installed = [], queue = [] }) {
  const ids = new Set((effectsSlotOf(mod) === TRACERS_SLOT ? [mod] : set).map((part) => part.id));
  return {
    ready: installSetState(set, installed).state === "all",
    active: queue.find((entry) => BUSY.has(entry.operation) && (ids.has(entry.id) || (entry.batch?.ids || []).some((id) => ids.has(id)))),
  };
}

/**
 * «Прочее ганпака» уходит вместе с последним стволом пака (и с «Удалить ганпак»): служебная запись без стволов ни к чему, а своей корзины в библиотеке у неё нет. Строки снятия встают в очередь после строк
 * стволов; решение принимается внутри обновления очереди, чтобы несколько снятий в один такт (отмечено несколько стволов) видели друг друга: у них один и тот же `installed`.
 * @param {string[]} ids стволы, снятие которых только что поставлено в очередь
 * @param {{ mods: object[], installed: string[], bundleOf: object, setQueue: Function }} shell состояние оболочки (`bundleShell`)
 */
export function removePackExtras(ids, shell) {
  const { mods = [], installed = [], bundleOf = {}, setQueue } = shell;
  if (!ids.some((id) => bundleOf[id])) return;
  setQueue((previous) => {
    const leaving = [...new Set([...ids, ...previous.filter((row) => row.operation === "remove" && !row.failed).map((row) => row.id)])];
    const rows = extrasLeaving(leaving, { mods, installed, bundleOf }).flatMap(({ packId, extras }) =>
      extras
        .filter((id) => !previous.some((row) => row.id === id && row.operation === "remove"))
        .map((id, index) => ({
          id,
          /* Стволы этого пака, что снимаются: не снялся любой — строка уходит из очереди (`bundle-failure.js`, `withoutDependents`). */
          after: leaving.filter((one) => bundleOf[one] === packId && !extras.includes(one)),
          name: tr("Ганпак «{name}»: прочее").replace("{name}", mods.find((mod) => mod.id === packId)?.name || ""),
          cover: mods.find((mod) => mod.id === packId)?.cover,
          queueId: `remove-${id}-${Date.now()}-${index}`,
          queuedAt: Date.now(),
          operation: "remove",
          progress: 0,
        })),
    );
    return rows.length ? [...previous, ...rows] : previous;
  });
}
