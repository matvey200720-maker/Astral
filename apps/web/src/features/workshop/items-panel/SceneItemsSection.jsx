/*
 * «Предметы» редакторов с кадром-сценой без правки по вещам — маппинг, Мегамолл, Ашан / Икея (ТЗ владельца 26.10.2026, п. A).
 *
 * Панель — общая (`ItemsPanel.jsx`): категории с кадром модели, комната, страница вещи. Здесь то, что у этих редакторов
 * общее: правка в них ложится на место и его части целиком (цвет, отделка, баннеры), а не на одну вещь, поэтому
 *
 *   — охвата панели нет (`adapter.scopes === false`): вещь можно найти, обвести и перелистать, а «Все такие» здесь своё — род
 *     разметки или, с обликом вещей, та же модель по всей сцене;
 *   — в слоте органов правки — строка-переход туда, где всё же правится то, что на вещи (`links`: инструмент редактора);
 *   — «Удалить» в «⋯» только там, где вещь убирается: убрать вещь из места мод умеет не везде, и тогда пункта нет;
 *   — с обликом вещей (вариант A разбора 31.10.2026) — «Из чего»: элементы вещи (листы модели, `elementsOf`) или части (`partsOf`) строками, страница
 *     элемента и части (`renderLook` получает `element` и `part`); Esc — уровнем вверх (`onUp`), камера стоит;
 *   — несколько вещей (п. 7 разбора): Shift+щелчок по строке (`onToggle` кадра), страница «3 вещи» — органы от редактора (`renderMulti`: своя
 *     картинка каждой на её «Корпус», «Цвет»), «Удалить» тем, что убираются.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { itemElementOf } from "@modovik/climb-contract/recolor/item-elements";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import ItemsPanel, { ScopeSwitch } from "./ItemsPanel.jsx";
import { isTextEntry } from "../../../utils/hotkeys.js";
import { entityBounds } from "./items-frame.js";

/* Что стоит на элементе — подписью строки «Из чего»: своя картинка (имя файла) или свой цвет; как в игре — без подписи. */
const elementNote = (element) => (element?.picture ? element.picture.name || tr("Своя картинка") : element?.colour ? element.colour.toUpperCase() : null);

/* Слова про место у редактора (`adapter.words`), как у самой панели. */
const say = (adapter, text) => adapter.words?.[text] || text;

export default function SceneItemsSection({
  adapter,
  objects,
  asset,
  shots,
  selection,
  onSelect,
  onScope,
  onFind,
  onNotice = null,
  onTool = null,
  /* Наведение на строку списка: `onHover(номера вещей | null)` — кадр подсвечивает их места. */
  onHover = null,
  /* Откуда смотрит кадр (`viewHome`): плитки снимаются с той же стороны. */
  home = null,
  /* Строка слота правки и кнопки к инструментам редактора: `[{ tool, label }]`. */
  note,
  links = [],
  /* Почему вещь не убрать (у «Удалить» эта строка). */
  removalReason,
  /* Вещи убираются по одной (завод: `project.removed`): номера убранных, что можно убрать (`removable(номер)`), как убрать и вернуть
     (`onRemove(номера, подпись)`, `onRestore`), слова подписей (`removeLabels.removed`, `.restored`). Без них «Удалить» стоит, но
     не нажимается и говорит, почему. */
  removed = null,
  removable = null,
  onRemove = null,
  onRestore = null,
  removeLabels = null,
  /* Облик вещей (ТЗ 27.10.2026): `renderLook({ item, model, scope, element, part })` — «Заменить» над строкой слота правки; нет — как прежде. */
  renderLook = null,
  /* «Из чего» (с обликом вещей): части — `partsOf(номер)`, `onPiece(номер, часть | null)`; элементы — `elementsOf(номер)`, `onElement(номер, лист | null)`;
     что стоит на них — по группам облика `looks` (`elementNote` строки); Esc — `onUp()`. */
  partsOf = null,
  onPiece = null,
  elementsOf = null,
  onElement = null,
  looks = null,
  /* Номер вещи панели → номер в группах облика (у маппинга облик — в ключах работы места). */
  lookKeyOf = (key) => key,
  onUp = null,
  /* Несколько вещей: `onToggle(номер)` — вещь в набор или из набора (`useSceneItems`), панель зовёт его Shift+щелчком по строке; `renderMulti({ keys })` —
     органы страницы «3 вещи» (`MultiLook` с адаптером облика редактора). */
  onToggle = null,
  renderMulti = null,
}) {
  useTr();
  /* Esc — уровнем вверх, пока открыты «Предметы»: не в поле ввода, не при окне. */
  const up = useRef(onUp);
  up.current = onUp;
  useEffect(() => {
    if (!onUp) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || isTextEntry(event.target)) return;
      if (document.querySelector("[role='dialog']:not([data-ui-tour])")) return;
      up.current?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [Boolean(onUp)]); // eslint-disable-line react-hooks/exhaustive-deps
  const removedSet = useMemo(() => new Set(removed || []), [removed]);
  const removal = useCallback(
    ({ item }) => {
      if (!onRemove || !removable?.(item.key))
        return { canRemove: false, canRestore: false, reason: removalReason };
      const gone = removedSet.has(item.key);
      return {
        gone,
        canRemove: !gone,
        canRestore: gone,
        remove: () =>
          onRemove([item.key], tr(removeLabels?.removed || "Предмет убран")),
        restore: () =>
          onRestore?.(
            [item.key],
            tr(removeLabels?.restored || "Предмет возвращён"),
          ),
      };
    },
    [onRemove, onRestore, removable, removalReason, removedSet, removeLabels],
  );
  const find = useCallback(
    (key) => {
      if (!onFind?.(key)) onNotice?.(tr("Этого предмета нет в кадре."), "info");
    },
    [onFind, onNotice],
  );
  /*
   * «Все такие» — одной строкой с выключателем, как у арены (ТЗ 29.10.2026, вечер), и только когда таких больше одной. Без облика вещей (ТЗ 26.10.2026,
   * раздел D) «такие» — вещи того же рода разметки; щелчок в кадре — всегда одна. С обликом (ТЗ 27.10.2026) охват один — и для подсветки, и для
   * облика: облик ложится на копию модели, поэтому «такие» — вещи той же модели по всей сцене (`arena`), а не род разметки.
   */
  const renderEditor = ({ item, model, scope, element = null, part = null }) => {
    const same = model.selectionKind
      ? objects.byKind.get(model.selectionKind)?.length || 0
      : 0;
    const alike = renderLook ? (model.keys || []).filter((key) => !removedSet.has(key)).length : 0;
    const wide = scope === "arena" ? "all" : "one";
    return (
      <div className="items-editor" data-items-editor="scene">
        {renderLook && alike > 1 && (
          <ScopeSwitch checked={wide === "all"} count={alike} where={say(adapter, "{0} шт. в зале")} onChange={(on) => onScope(on ? "arena" : "one")} />
        )}
        {!renderLook && same > 1 && (
          <ScopeSwitch checked={scope === "kind"} count={same} where="{0} шт." onChange={(on) => onScope(on ? "kind" : "one")} />
        )}
        {renderLook ? renderLook({ item, model, scope: wide, element, part }) : null}
        {/* Где правится то, что на вещи, — строкой-переходом; пояснение — подписью строки, а не абзацем. На странице элемента и части — нет: она про них. */}
        {onTool && links.length > 0 && !element && !part && (
          <ListGroup label={tr("Где ещё править")}>
            {links.map((link) => (
              <NavRow key={link.tool} title={tr(link.label)} caption={links.length === 1 && note ? tr(note) : null} aria-label={tr(link.label)} onOpen={() => onTool(link.tool)} />
            ))}
          </ListGroup>
        )}
      </div>
    );
  };
  /* Вернуть всё убранное — строкой внизу входа (`ActionRows`), и только когда есть что возвращать. */
  const extras = useMemo(
    () => (
      <ActionRows
        actions={[
          onRestore && removedSet.size > 0 && { id: "restore-all", label: trFill("Вернуть убранное ({0})", removedSet.size), onClick: () => onRestore([...removedSet], tr("Все предметы возвращены")) },
        ]}
      />
    ),
    [onRestore, removedSet],
  );
  /* Облик вещи — группа облика, где она есть (у мест облик на часть не пишется по элементам: группа одна). */
  const groupOf = (key) => (looks || []).find((group) => group.keys.includes(lookKeyOf(key)) && !group.part) || null;
  /* Кружок строки «Из чего» — цвет листа, а со своим цветом элемента — он. */
  const elementsOfWithLooks = (key) =>
    (elementsOf?.(key) || []).map((entry) => {
      const colour = itemElementOf(groupOf(key), entry.texture)?.colour;
      return colour ? { ...entry, colour } : entry;
    });
  /* «Удалить» на странице «3 вещи»: те, что место даёт убрать и что ещё стоят. */
  const removeMany =
    onRemove && removable
      ? (keys) => {
          const alive = keys.filter((key) => removable(key) && !removedSet.has(key));
          const label = tr(removeLabels?.removed || "Предмет убран");
          return alive.length ? { count: alive.length, remove: () => onRemove(alive, alive.length > 1 ? `${label} (${alive.length})` : label) } : null;
        }
      : null;
  if (!objects) return null;
  return (
    <ItemsPanel
      adapter={adapter}
      objects={objects}
      shots={shots}
      asset={asset}
      entityBounds={entityBounds}
      home={home}
      removed={removed}
      selection={selection}
      onSelect={onSelect}
      onScope={onScope}
      onFind={find}
      onHover={onHover}
      removal={removal}
      renderEditor={renderEditor}
      entryExtras={extras}
      partsOf={renderLook ? partsOf : null}
      onPiece={renderLook ? onPiece : null}
      elementsOf={renderLook ? elementsOfWithLooks : null}
      onElement={renderLook ? onElement : null}
      elementNote={(key, texture) => elementNote(itemElementOf(groupOf(key), texture))}
      flyOnPick
      hint={adapter.hint}
      onToggle={onToggle}
      renderMulti={renderMulti}
      removeMany={removeMany}
    />
  );
}
