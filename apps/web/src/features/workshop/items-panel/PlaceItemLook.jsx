/*
 * «Облик предмета» у мест (ТЗ 27.10.2026): плашки арены (`arena-editor/arena-item-look.jsx`) с охватом места — «Только этот» или «Все такие» вещи той же
 * модели. У вещи, чью копию честно не поставить (модели нет в описи мест), — строка почему, без плашек.
 *
 * Вариант A разбора 31.10.2026, как у арены: на странице элемента вещи (`element` — лист модели) — своя картинка заливкой, «Цвет» и студия
 * (`ElementLook`); у всей вещи с элементами (`elements`) «Своя картинка» ложится заливкой на главный лист, а стенд — строкой «Картинка вместо предмета»;
 * у части (`part`) — облик на часть.
 */

import { tr, useTr } from "../../../locales/ui.js";
import ItemLook, { ElementLook } from "../arena-editor/arena-item-look.jsx";

/* Охват (`one` | `all`) задаёт панель «Предметов» одним переключателем и для подсветки, и для облика (`SceneItemsSection`). */
export default function PlaceItemLook({ adapter, item, scope = "one", looks, removed, name, onLook, onNotice, element = null, part = null, elements = null }) {
  useTr();
  /* Причина у места (его ставит сервер) — своя; иначе общая: у модели нет места в описи. */
  const reason = adapter.reason?.(item);
  if (reason) return <p className="fx-hint">{tr(reason)}</p>;
  if (!adapter.keys(item, "one").length) return <p className="fx-hint">{tr("У этой вещи облик не ставится: у её модели нет файла в описи Astral или в ней больше общих листов, чем вмещает копия.")}</p>;
  const many = adapter.keys(item, "all").length > 1;
  if (element)
    return (
      <div className="items-editor" data-place-item-look={item.key}>
        <ElementLook key={`${item.key}:${element.texture}`} adapter={adapter} item={item} scope={many ? scope : "one"} looks={looks} removed={removed} name={name} element={element} onLook={onLook} onNotice={onNotice} />
      </div>
    );
  return (
    <div className="items-editor" data-place-item-look={item.key}>
      <ItemLook key={item.key} adapter={adapter} item={item} scope={many ? scope : "one"} looks={looks} removed={removed} name={name} onLook={onLook} onNotice={onNotice} part={part} elements={elements} />
    </div>
  );
}
