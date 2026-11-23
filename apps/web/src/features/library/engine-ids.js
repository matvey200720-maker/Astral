import { useMemo } from "react";

// У мода два имени: движок пишет его под идентификатором манифеста (слаг облачного мода,
// local-… у работ мастерской), окно ведёт по идентификатору каталога. Карты переводят туда и
// обратно: идентификатор движка -> каталога, каталога -> движка (последний подошедший), а
// подсказки — идентификатор движка -> origin.catalogModId из записи установки. Это общее
// состояние окна, каждый расчёт заменяет карты целиком.
let [toCatalog, toEngine, hints] = [new Map(), new Map(), new Map()];

const through = (map, id) => map.get(id) ?? id;

export const catalogModId = (id) => through(toCatalog, id);

export const engineModId = (id) => through(toEngine, id);

export const engineModIds = (ids) => {
  if (!Array.isArray(ids)) return ids;
  return ids.map((id) => through(toEngine, id));
};

// Отметку окно записало само при установке: она сильнее слага, но слабее идентификатора каталога.
export const rememberInstallRecords = (records = []) => {
  hints = new Map(
    [...records]
      .filter((rec) => rec?.origin?.catalogModId && rec.modId)
      .map((rec) => [rec.modId, String(rec.origin.catalogModId)]),
  );
};

export const catalogInstalledIds = (engineIds = [], mods = []) => {
  const catalog = [...mods].filter((mod) => mod?.id);
  const known = new Set(catalog.map((mod) => mod.id));
  const bySlug = new Map(catalog.filter((mod) => mod.slug).map((mod) => [mod.slug, mod.id]));
  const moves = [];
  const targets = [...engineIds].map((id) => {
    // порядок предпочтения: сам идентификатор, отметка, слаг (сравнения строгие)
    const to = [id, hints.get(id), bySlug.get(id)].find((cand) => known.has(cand)) ?? id;
    if (to !== id) moves.push([id, to]);
    return to;
  });
  toCatalog = new Map(moves);
  toEngine = new Map(moves.map((move) => [move[1], move[0]]));
  return [...new Set(targets)];
};

// Карты заполняются прямо в отрисовке, поэтому bundleOf читает их после пересчёта installed.
export const useCatalogInstalled = (engineIds, mods, engineBundleOf = {}) => {
  const base = useMemo(() => catalogInstalledIds(engineIds, mods), [mods, engineIds]);
  const bundleOf = useMemo(
    () => Object.assign({}, ...Object.keys(engineBundleOf).map((key) => ({ [catalogModId(key)]: engineBundleOf[key] }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- карты перевода меняются вместе с installed
    [base, engineBundleOf],
  );
  /* Ганпак по стволам «стоит», пока стоит хоть одна запись, что он поставил (`gunpack-state.js`): его id — к установленным. */
  const installed = useMemo(() => {
    const packs = new Set(Object.values(bundleOf));
    const standing = mods.filter((mod) => packs.has(mod.id) && mod.domain?.weapon?.pack).map((mod) => mod.id);
    return standing.length ? [...new Set([...base, ...standing])] : base;
  }, [base, bundleOf, mods]);
  return { installed, bundleOf };
};
