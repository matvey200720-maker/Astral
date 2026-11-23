/*
 * Оптимизация редукса — одной карточкой (13.11.2026, владелец: «не надо делать их две, то есть три редукс-оптимизации, там достаточно одной,
 * чтобы было понятно, что это редукс-оптимизация»).
 *
 * Разбор делит оптимизацию автора на компонент мира (архив `opt.rpf` и подобные, вид `redux-optimization`) и переключатели настроек игры
 * («Без травы», «Без частиц», «Без дождя»… — вид `optimization`, компонент `optimization-toggles`): каждый переключатель выходил своей
 * карточкой с той же картинкой, и в редуксе стояли три «оптимизации» подряд.
 *
 * Сложить всё в один пакет нельзя: архив мира ставится слоем Astral (`astral-content-rpf-v1` принимает только файлы внутри своих
 * контейнеров), а переключатели — записи по штатным путям игры; такой смешанный пакет не проходит ни проверку манифеста, ни движок (первая
 * попытка 13.11: «Некорректная политика слоёв ресурса Astral RPF» на сухом прогоне выкладки). Поэтому:
 *   — есть оптимизация мира: карточка «Оптимизация» — она; файлы переключателей уходят в служебный пакет «Остальные файлы» (`anatomy-rest.js`,
 *     ставится вместе с редуксом) теми же записями по тем же путям — ни один файл автора не теряется;
 *   — мира нет: переключатели складываются в один пакет «Оптимизация» (все записи одного рода, пакет обычный).
 * «Быстрый вход» (`fast-entry`) — отдельная часть, как и был.
 */

const WORLD_KIND = "redux-optimization";
const TOGGLE_KIND = "optimization";
const TOGGLES_SLOT = "optimization-toggles";
const NAME = "Оптимизация";

const unique = (list) => [...new Set(list)];
const isToggle = (draft) =>
  draft?.kind === TOGGLE_KIND && draft.domain?.anatomy?.slot === TOGGLES_SLOT;

/** Что за переключатель — хвост имени карточки («… · Без травы» → «Без травы»). */
export const toggleTitleOf = (draft) =>
  String(draft?.card?.name || "")
    .split(" · ")
    .at(-1) || String(draft?.id || "");

/** Свободное имя файла заявки: то же, а при совпадении — с приставкой `t<N>-`. */
function freeName(name, taken) {
  if (!taken.has(name)) return name;
  for (let at = 2; ; at += 1) {
    const next = `t${at}-${name}`;
    if (!taken.has(next)) return next;
  }
}

/** Переключатели без мира — один пакет: записи остальных вливаются в первый, он зовётся «Оптимизация». */
function mergeToggles(drafts, toggles) {
  const [base, ...extras] = toggles;
  const anatomy = base.domain.anatomy;
  const taken = new Set((base.files || []).map((file) => file.path));
  const titles = [toggleTitleOf(base)];
  for (const extra of extras) {
    const renamed = new Map();
    for (const file of extra.files || []) {
      const path = freeName(file.path, taken);
      taken.add(path);
      renamed.set(file.path, path);
      base.files.push({ ...file, path });
    }
    for (const record of extra.spec?.files || [])
      base.spec.files.push({
        ...record,
        source: renamed.get(record.source) ?? record.source,
      });
    base.spec.capabilities = unique([
      ...(base.spec.capabilities || []),
      ...(extra.spec?.capabilities || []),
    ]);
    base.spec.slots = unique([
      ...(base.spec.slots || []),
      ...(extra.spec?.slots || []),
    ]);
    const other = extra.domain.anatomy;
    anatomy.slots = unique([...(anatomy.slots || []), ...(other.slots || [])]);
    const known = new Set((anatomy.units || []).map((unit) => unit.id));
    anatomy.units = [
      ...(anatomy.units || []),
      ...(other.units || []).filter((unit) => !known.has(unit.id)),
    ];
    anatomy.sources = { ...(anatomy.sources || {}), ...(other.sources || {}) };
    if (other.omitted?.length)
      anatomy.omitted = [...(anatomy.omitted || []), ...other.omitted];
    base.problems = [
      ...(base.problems || []),
      ...(extra.problems || []).filter(
        (problem) => problem?.code !== "needs-media",
      ),
    ];
    titles.push(toggleTitleOf(extra));
    drafts.splice(drafts.indexOf(extra), 1);
  }
  anatomy.toggles = titles;
  anatomy.label = NAME;
  const redux = String(anatomy.redux || "").trim();
  base.card.name = redux ? `${redux} · ${NAME}` : NAME;
  base.card.description =
    `${String(base.card.description || "").trim()} В составе настройки игры: ${titles.map((title) => title.toLowerCase()).join(", ")}.`.trim();
  return { into: base.id, titles };
}

/**
 * Решение по оптимизации одной версии редукса. Массив `drafts` изменяется на месте.
 *   `absorb` — заявки-переключатели, вынутые из списка: их записи забирает служебный пакет (`restComponentDraft`, ключ `absorb`);
 *              не забрал (пакет не собрался) — вернуть их в список (`drafts.push(...absorb)`);
 *   `merged` — переключатели без мира сложены в один пакет: `{ into, titles }`.
 * @param {object[]} drafts заявки одной версии редукса (`packAnatomy`)
 * @returns {{ absorb: object[], merged: { into: string, titles: string[] } | null }}
 */
export function planOptimization(drafts) {
  const toggles = drafts.filter(isToggle);
  if (!toggles.length) return { absorb: [], merged: null };
  const world = drafts.find(
    (draft) => draft?.kind === WORLD_KIND && draft.domain?.anatomy,
  );
  if (world) {
    for (const toggle of toggles) drafts.splice(drafts.indexOf(toggle), 1);
    return { absorb: toggles, merged: null };
  }
  return {
    absorb: [],
    merged: toggles.length > 1 ? mergeToggles(drafts, toggles) : null,
  };
}
