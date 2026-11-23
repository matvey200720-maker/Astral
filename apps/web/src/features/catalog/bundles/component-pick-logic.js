import { isCatalogBundle } from "../../../catalog-utils.js";
import { fitsProject, swapCandidates } from "./component-candidates.js";
import { slotsOf } from "./component-choices.js";
import { finishComponentPick } from "./component-pick.js";
import { isWholeOnly } from "./component-places.js";

/*
 * Что подставить, когда в каталоге щёлкнули по карточке (режим выбора, `component-pick.js`). Модуль грузится по нужде, когда появился запрос выбора.
 *
 * Карточка годится, если это часть нужного слота и не часть самой сборки. Что она подставит — тот же кандидат, что давало окно «Заменить компонент» (`swapCandidates`):
 *  • у части есть сборка-владелец (сборка каталога, у которой она в `includedModIds`) — источник эта сборка, и встают все её пакеты слота (таймцикл = маршруты + облака);
 *  • владельца нет (отдельная вещь каталога этого слота) — источник сама вещь; в хранилище выбора (`swap[слот]`) лежит её id, а состав и список (`sourceParts`) отдают её саму.
 *    Склеенная группа («Эффекты») отдельной вещью не заменяется: смесь двух редуксов даёт пустые эффекты (`component-groups.js`).
 * Часть, у которой владельцы есть, но все они — сама карточка или версии той же части, не годится: версии части — меню «Версии», а не замена.
 */

const unique = (list) => [...new Set(list.filter(Boolean))];

/*
 * Справочник запроса по каталогу: сборка и родной пакет, строки кандидатов по id их частей, части, у которых есть владелец. Строится один раз на каталог и запрос —
 * карточки сетки спрашивают его по одной.
 */
const indexes = new WeakMap();

function buildIndex(request, catalog) {
  const byId = new Map(catalog.map((mod) => [mod.id, mod]));
  const bundle = byId.get(request.bundleId) ?? null;
  const part = byId.get(request.nativeId) ?? null;
  const owned = new Set();
  for (const mod of catalog) if (isCatalogBundle(mod)) for (const id of mod.includedModIds || []) owned.add(id);
  const rows = new Map();
  if (bundle && part) {
    for (const row of swapCandidates({ key: request.slot, part, bundle, catalog })) {
      for (const one of row.parts) if (!rows.has(one.id)) rows.set(one.id, row);
    }
  }
  return { byId, bundle, part, owned, rows, exclude: new Set(request.exclude || []), wanted: new Set([request.slot, ...(request.slots || [])]) };
}

function indexOf(request, catalog) {
  const kept = indexes.get(catalog);
  if (kept && kept.id === request.id) return kept.index;
  const index = buildIndex(request, catalog);
  indexes.set(catalog, { id: request.id, index });
  return index;
}

// Общий архив нескольких слотов (зоны) предупреждал в окне замены и в обе стороны: слоты родного архива входят в то, что закрывает замена.
const withOwnSlots = (row, request) => (request.slots?.length > 1 ? { ...row, slots: unique([...row.slots, ...request.slots]) } : row);

function standalone(mod, index, request) {
  return {
    source: mod,
    parts: [mod],
    mod,
    slots: unique([...slotsOf(mod), ...(request.slots?.length > 1 ? request.slots : [])]),
    fitsProject: fitsProject([mod], index.bundle),
    standalone: true,
  };
}

/**
 * Кандидат на замену из этой карточки либо `null`, если выбрать её нельзя.
 * @param {object} request запрос выбора (или исход: у него те же поля) — `slot`, `slots`, `bundleId`, `nativeId`, `exclude`
 * @param {object} mod карточка каталога
 * @param {object[]} catalog полный каталог (сборки и части)
 * @returns {{ source: object, parts: object[], mod: object, slots: string[], fitsProject: boolean, standalone?: boolean } | null}
 */
export function candidateOf(request, mod, catalog) {
  if (!request || !mod?.id || !Array.isArray(catalog)) return null;
  const index = indexOf(request, catalog);
  const raw = index.byId.get(mod.id) ?? mod;
  if (!index.bundle || !index.part || isCatalogBundle(raw) || index.exclude.has(raw.id)) return null;
  if (!slotsOf(raw).some((slot) => index.wanted.has(slot))) return null;
  const row = index.rows.get(raw.id);
  if (row) return row.parts.some((one) => index.exclude.has(one.id)) ? null : withOwnSlots(row, request);
  if (index.owned.has(raw.id) || isWholeOnly(request.slot)) return null;
  return standalone(raw, index, request);
}

/** Щёлкнули по карточке: годится — исход записан (страница мода применит его при возврате), иначе ничего не меняется. */
export function choosePicked(request, mod, catalog) {
  if (!candidateOf(request, mod, catalog)) return false;
  return finishComponentPick(mod.id, request.id) !== null;
}

/** Кандидат по исходу выбора: тот же, что видел каталог, но по каталогу страницы мода. */
export function candidateOfOutcome(outcome, catalog) {
  if (!outcome?.partId || !Array.isArray(catalog)) return null;
  const mod = catalog.find((one) => one.id === outcome.partId);
  return mod ? candidateOf(outcome, mod, catalog) : null;
}
