import "./library-v2.css";
import "./library-state.css";
import { useMemo, useState } from "react";
import { Check, MagnifyingGlass } from "../../components/ui/icons.jsx";
import { tr, useTr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import LibraryBand from "./LibraryBand.jsx";
import LibraryTrashBar from "./LibraryTrashBar.jsx";
import { useLibraryNumbers } from "./library-numbers.js";

/*
 * Библиотека Б «Состояние игры» (владелец, 15.11.2026; до неё — v2 14.11.2026): только установленное. Сверху — шапка с корзиной, потом сводка из четырёх карточек
 * (`LibraryBand.jsx`), полоса фильтров (Все, Графика, Оружие, Одежда, Оптимизация и поиск по имени) и одна плотная сетка плиток.
 *
 * Удаление — корзиной в шапке (владелец, 15.11.2026): она включает режим выделения на всех плитках, «Удалить выделенное (N)» и «Удалить всё» открывают окно
 * подтверждения (`LibraryTrashBar.jsx`). Круглой корзины на плитке нет. Фильтр и поиск только прячут плитки: отмеченное остаётся отмеченным, «Удалить всё»
 * берёт всё, что стоит в игре, а не то, что видно.
 *
 * Сами плитки — готовые карточки страницы (`WorkshopVisualSlotCard`: кадр, подпись, пара «штатная вещь → мод» у одежды, «Удаляется…», отметка выделения), их рисует
 * `CatalogPages`; здесь — шапка, сводка, фильтры и сетка. Файл едет отдельным куском: стили — `library-state.css` и `library-v2.css`.
 */

/** Вкладки полосы фильтров в порядке полки; три первые видны всегда (даже пустые), «Оптимизация» — когда она стоит. */
const TABS = [
  ["graphics", "Графика", true],
  ["weapons", "Оружие", true],
  ["clothing", "Одежда", true],
  ["optimization", "Оптимизация", false],
];

const fold = (text) => String(text || "").toLocaleLowerCase();

/* Дубль на плитке: подсказка у значка говорит, какое именно место занято дважды. */
function twinNote(twin) {
  return twin.kind === "place"
    ? trFill("Модов на этом месте: {0} — оставьте один", twin.count)
    : twin.with
      ? trFill("Это же место занимает «{0}» — оставьте один мод", twin.with)
      : tr("Два мода на одном месте — оставьте один");
}

/* Отметка плитки — одна и всегда на месте (16.11.2026): корзину не нужно «включать». Пока ничего не отмечено, щелчок по плитке открывает мод, а отметка ставится квадратиком;
   когда что-то отмечено, плитка сама отмечается щелчком (так её ведёт карточка — `selecting`). Своих отметок у карточек внутри плитки нет. */
function Tile({ item, removing, picking, selected, twin, markLabel, onMark }) {
  return (
    <div
      className="lib-tile"
      data-removing={removing || undefined}
      data-picking={picking || undefined}
      data-selected={selected || undefined}
      data-twin={twin ? twin.kind : undefined}
    >
      {item.node}
      <span className="lib-tile-open" aria-hidden="true">
        <b>{tr("Открыть")}</b>
      </span>
      {onMark && !removing && (
        <button
          type="button"
          className="lib-tile-check"
          aria-pressed={selected}
          aria-label={markLabel}
          title={markLabel}
          onClick={() => onMark(item.id)}
        >
          <span className="lib-tile-box" aria-hidden="true">
            {selected && <Check weight="bold" />}
          </span>
        </button>
      )}
      {twin && (
        <span className="lib-tile-twin" title={twinNote(twin)}>
          {tr("Дубль")}
        </span>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {{ id: string, title: string, items: { id: string, name?: string, node: import("react").ReactNode }[], extra?: import("react").ReactNode }[]} props.groups группы с плитками; пустые не рисуются
 * @param {number} props.total сколько всего стоит в игре
 * @param {Set<string>} props.removingIds плитки, что удаляются прямо сейчас
 * @param {Parameters<typeof LibraryTrashBar>[0]["trash"] & { selected?: string[] }=} props.trash корзина шапки и режим выделения; нет — нет и корзины
 * @param {import("react").ReactNode=} props.notices строки сверху: «слетело / проверка сняла моды», «Ждёт новой версии»
 * @param {import("react").ReactNode=} props.empty пустая библиотека
 * @param {{ bundle: object, progress: object }[]=} props.bundles установленные сборки каталога (карточка «Сборка»)
 * @param {string=} props.targetId игра, чьи точки возврата читает сводка
 */
export default function LibraryShelves({
  groups,
  total,
  removingIds,
  trash = null,
  notices = null,
  empty = null,
  bundles = [],
  targetId = "",
}) {
  useTr();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const numbers = useLibraryNumbers(targetId, total);
  const shown = groups.filter((group) => group.items.length > 0 || group.extra);
  const picking = Boolean(trash?.active);
  const picked = useMemo(
    () => new Set(trash?.selected || []),
    [trash?.selected],
  );
  const markWord = trash?.copy?.cardToggle || "{name}";

  /* Сводка считает по группам полки; «Оптимизация» — тоже графика. */
  const counts = {};
  const removing = { total: 0 };
  for (const group of groups) {
    const key = group.id === "optimization" ? "graphics" : group.id;
    counts[key] = (counts[key] || 0) + group.items.length;
    for (const entry of group.items) {
      if (!picking || !picked.has(entry.id)) continue;
      removing[key] = (removing[key] || 0) + 1;
      removing.total += 1;
    }
  }

  /* «Все» и «Сейчас в игре» считают плитки сетки: сборки каталога стоят отдельными строками под сеткой и записаны в карточке «Сборка». */
  const inGame = Object.entries(counts).reduce(
    (sum, [, count]) => sum + count,
    0,
  );
  const tabs = [
    ["all", null, inGame],
    ...TABS.map(([id, name, always]) => [
      id,
      name,
      groups.find((group) => group.id === id)?.items.length || 0,
      always,
    ]),
  ].filter(([id, , count, always]) => id === "all" || always || count > 0);
  const activeTab = tabs.some(([id]) => id === tab) ? tab : "all";
  const needle = fold(query).trim();
  const visible = shown
    .filter((group) => activeTab === "all" || group.id === activeTab)
    .flatMap((group) => group.items)
    .filter((entry) => !needle || fold(entry.name).includes(needle));
  const bundleRows = shown.find((group) => group.id === "graphics")?.extra;
  const showBundles =
    Boolean(bundleRows) &&
    (activeTab === "all" || activeTab === "graphics") &&
    !needle;

  return (
    <div className="lib-page" data-library-v2="" data-library-b="">
      <header className="lib-head">
        <h1>{tr("Библиотека")}</h1>
        {trash && shown.length > 0 && <LibraryTrashBar trash={trash} />}
      </header>
      {notices}
      {shown.length === 0 ? (
        empty
      ) : (
        <>
          <LibraryBand
            total={inGame}
            counts={counts}
            removing={removing}
            bundles={bundles}
            numbers={numbers}
          />
          <div className="lib-tools">
            <div
              className="lib-tabs"
              role="tablist"
              aria-label={tr("Что показать")}
            >
              {tabs.map(([id, name, count]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className="lib-chip"
                  aria-selected={activeTab === id}
                  onClick={() => setTab(id)}
                >
                  {name ? tr(name) : tr("Все")}
                  <em>{count}</em>
                </button>
              ))}
            </div>
            <label className="lib-search">
              <MagnifyingGlass aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder={tr("Найти в библиотеке")}
                aria-label={tr("Найти в библиотеке")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {visible.length > 0 ? (
            <div
              className="lib-grid redux-visual-grid"
              data-workshop-shelf="installed"
            >
              {visible.map((entry) => (
                <Tile
                  key={entry.id}
                  item={entry}
                  removing={removingIds.has(entry.id)}
                  picking={picking}
                  selected={picked.has(entry.id)}
                  twin={trash?.duplicates?.get(entry.id)}
                  markLabel={markWord.replace("{name}", entry.name || "")}
                  onMark={trash?.available ? trash.onToggle : null}
                />
              ))}
            </div>
          ) : (
            <p className="lib-none" role="status">
              {tr("Ничего не нашлось")}
            </p>
          )}
          {showBundles && bundleRows}
        </>
      )}
    </div>
  );
}
