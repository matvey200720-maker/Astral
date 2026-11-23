import MediaCard from "../../ui/MediaCard.jsx";
import { Plus } from "../../ui/icons.jsx";
import "./builds-poster.css";

/*
 * Плитка «Создать сборку» стоит первой в сетке (владелец 16.11.2026): та же карточка-витрина, что у сборок (`MediaCard` с `is-store`; класса `builds-card` у неё нет — карточки сборок считаются по нему), —
 * кадр 16 : 10 сверху с пунктирной рамкой и «плюсом», подпись и строка под ним, — поэтому размер у неё один с остальными. «Вставить код» с афиши убрана:
 * код читается на странице «Новая сборка» (вкладка «По коду») и из «билета» открытой сборки.
 */
export default function BuildsTiles({ copy, onNew }) {
  const frame = (
    <span className="builds-new-frame" aria-hidden="true">
      <span className="builds-new-icon">
        <Plus />
      </span>
    </span>
  );
  return (
    <div className="builds-card-wrap builds-new-wrap">
      <MediaCard
        className="is-store builds-new"
        media={frame}
        title={copy.tileNew}
        description={copy.tileNewHint}
        onClick={onNew}
      />
    </div>
  );
}
