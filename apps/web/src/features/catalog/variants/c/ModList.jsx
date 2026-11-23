import { useEffect, useRef } from "react";
import { Check, Heart, ImageSquare } from "../../../../components/ui/icons.jsx";
import PickTile from "../../../../components/ui/PickTile.jsx";
import VirtualList from "../../../../components/ui/VirtualList.jsx";
import ModName from "../../../../components/desktop/catalog/ModName.jsx";
import { dataLangOf } from "../../../../components/desktop/catalog/data-lang.js";
import { tr } from "../../../../locales/ui.js";

/*
 * Список модов варианта В — левая часть «Просмотра» (ТЗ 29.10.2026-b): строка — маленький кадр, имя, вторая строка, отметки «в избранном» и «стоит». Листается сам,
 * в документе только строки на экране (`VirtualList`: в разделе бывают тысячи модов). В строках одни постеры — ролики играют только на сцене выбранного (`docs/3D.md`, п. 31).
 * Стрелки вверх и вниз выбирают соседнюю строку и ведут фокус, Home и End — первую и последнюю; выбор ведёт и сцену справа.
 */

/** Высота строки списка: кадр 40 px, поля 6 + 6, зазор 2 (`catalog-variant-c.css`). */
export const ROW_HEIGHT = 60;

const cx = (...names) => names.filter(Boolean).join(" ");

function Row({ entry, selected, liked, installed, onPick }) {
  const Icon = entry.icon || ImageSquare;
  return (
    <div className="cvc-cell">
      <button
        type="button"
        className={cx("cvc-row", selected && "is-selected")}
        aria-current={selected ? "true" : undefined}
        data-entry={entry.key}
        onClick={() => onPick(entry.key)}
      >
        <span className="cvc-row-art" aria-hidden="true">
          {entry.cover ? (
            <PickTile look="poster" mode="static" cover={entry.cover} fit="auto" title="" />
          ) : (
            <span className="cvc-row-blank">
              <Icon />
            </span>
          )}
        </span>
        <span className="cvc-row-name">
          <b className="cvc-row-title" lang={dataLangOf(entry.title)}>
            <ModName name={entry.title} />
          </b>
          {entry.sub && <span className="cvc-row-sub">{entry.sub}</span>}
        </span>
        {liked && <Heart className="cvc-row-mark is-liked" weight="fill" aria-label={tr("В избранном")} />}
        {installed && <Check className="cvc-row-mark" weight="bold" aria-label={tr("Установлено")} />}
      </button>
    </div>
  );
}

/**
 * @param {{ entries: object[], describe: Function, selectedKey: string, likedIds: Set<string>, installedIds: string[], onPick: Function, label: string }} props
 */
export default function ModList({ entries, describe, selectedKey, likedIds, installedIds, onPick, label }) {
  const listRef = useRef(null);
  const apiRef = useRef(null);
  const installed = new Set(installedIds);
  /* Вернулись в каталог — выбранный мод стоит на виду, а не где-то за краем длинного списка. */
  useEffect(() => {
    const at = entries.findIndex((entry) => entry.key === selectedKey);
    if (at > 0) requestAnimationFrame(() => apiRef.current?.scrollToIndex(at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (event) => {
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const at = Math.max(0, entries.findIndex((entry) => entry.key === selectedKey));
    const next = Math.max(0, Math.min(entries.length - 1, event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : at + keys[event.key]));
    if (!entries[next]) return;
    onPick(entries[next].key);
    apiRef.current?.scrollToIndex(next);
    /* Строка за краем в документе не стоит: фокус — после того, как список её нарисует. */
    requestAnimationFrame(() => requestAnimationFrame(() => listRef.current?.querySelector(`[data-entry="${CSS.escape(entries[next].key)}"]`)?.focus({ preventScroll: true })));
  };
  return (
    <div className="cvc-list" ref={listRef} onKeyDown={onKeyDown} role="group" aria-label={label}>
      <VirtualList
        className="cvc-rows"
        items={entries}
        rowHeight={ROW_HEIGHT}
        apiRef={apiRef}
        renderRow={(light) => {
          const entry = describe(light);
          return (
            <Row
              key={entry.key}
              entry={entry}
              selected={entry.key === selectedKey}
              liked={Boolean(entry.mod && likedIds.has(entry.mod.id))}
              installed={Boolean(entry.mod && installed.has(entry.mod.id))}
              onPick={onPick}
            />
          );
        }}
      />
    </div>
  );
}
