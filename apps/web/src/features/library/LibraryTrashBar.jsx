import { useEffect, useRef } from "react";
import { Trash } from "../../components/ui/icons.jsx";
import Button from "../../components/ui/Button.jsx";
import { tr, useTr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";

/*
 * Корзина в шапке «Библиотеки». Владелец, 15.11.2026: «верни мусорку… чтобы я выделил, что я хочу удалить, и я мог бы удалить выделенное»; 16.11.2026: «корзину оставь
 * с самого нуля, её не убирай… убери у неё вот эти двойные» — корзина не включается кнопкой: отметка стоит на каждой плитке сразу, а шапка всегда показывает, что отмечено и что с этим делать.
 *
 * В шапке только то, что нужно сейчас, и ничего дважды:
 *   - слева — что отмечено («Выделено: N») или подсказка, как отметить; если на плитках есть дубли (два мода на одном месте), вместо подсказки — просьба удалить лишний;
 *   - «Выбрать все» (когда отмечено не всё) и «Снять выбор» (когда что-то отмечено) — по одной, а не парой «Отмена» и «Удалить всё»: «всё» — это «Выбрать все»;
 *   - «Удалить выделенное (N)» — серая, пока ничего не отмечено; ведёт в то же окно подтверждения со списком, что и раньше (`LibraryRemovalDialog`), с точкой возврата.
 * Esc снимает выбор, Ctrl+A отмечает всё, Delete — то же, что «Удалить выделенное» (клавиши живут, пока корзина на странице).
 *
 * @param {object} props
 * @param {{ available: boolean, active: boolean, count: number, total: number, busy: boolean, copy: object, duplicates?: Map<string, object>,
 *   onCancel: () => void, onSelectAll: () => void, onRemoveSelected: () => void }} props.trash
 */
export default function LibraryTrashBar({ trash }) {
  useTr();
  const keys = useRef(trash);
  keys.current = trash;
  useEffect(() => {
    if (!trash.available) return undefined;
    const onKey = (event) => {
      /* Поверх открыто окно или курсор в поле ввода — клавиши их. */
      if (document.querySelector(".ui-dialog-backdrop:not(.is-kept)")) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable]"))
        return;
      const now = keys.current;
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyA") {
        event.preventDefault();
        now.onSelectAll();
      } else if (event.key === "Delete" && now.count && !now.busy) {
        event.preventDefault();
        now.onRemoveSelected();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [trash.available]);

  if (!trash.available) return null;

  const { count, total, busy } = trash;
  const twins = trash.duplicates?.size || 0;
  const hint = count
    ? tr("Выделено: {count}").replace("{count}", String(count))
    : twins
      ? trFill(
          "Дубли на одном месте: {0}. Отметьте лишний мод и удалите его",
          twins,
        )
      : tr("Отметьте галочкой то, что хотите убрать из игры");
  return (
    <div
      className="lib-trash-bar"
      role="group"
      aria-label={tr("Выделите, что удалить из игры")}
    >
      <p className="lib-trash-hint" role="status">
        {hint}
      </p>
      {count > 0 && (
        <Button
          className="lib-trash-cancel"
          variant="ghost"
          onClick={trash.onCancel}
        >
          {tr("Снять выбор")}
        </Button>
      )}
      {count < total && (
        <Button
          className="lib-trash-all"
          variant="secondary"
          disabled={busy}
          onClick={trash.onSelectAll}
        >
          {tr("Выбрать все")}
        </Button>
      )}
      <Button
        className="lib-trash-selected"
        variant="danger"
        icon={<Trash />}
        disabled={!count || busy}
        onClick={trash.onRemoveSelected}
      >
        {count
          ? tr("Удалить выделенное ({count})").replace("{count}", String(count))
          : tr("Удалить выделенное")}
      </Button>
    </div>
  );
}
