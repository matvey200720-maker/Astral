import { Wrench } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Первая плитка каталога «через карандаш» (`ComponentPickBar.jsx`, чистовой набор 2, 15.11.2026): «Создать свой в мастерской» — чёрная, с гаечным ключом на белом круге. Нажатие открывает редактор
 * этого вида от стандартной основы (`openStandardEditor`), как «Сделать в мастерской» в окне «Компоненты». В обычном каталоге такой плитки нет.
 */
export default function PencilCreateTile({ onCreate }) {
  useTr();
  return (
    <div className="pencil-tile">
      <button type="button" className="pencil-tile-box" onClick={onCreate}>
        <span className="pencil-tile-wrench" aria-hidden="true">
          <Wrench weight="bold" />
        </span>
        <b>{tr("Создать свой в мастерской")}</b>
      </button>
      <small>{tr("Откроется редактор этой части")}</small>
    </div>
  );
}
