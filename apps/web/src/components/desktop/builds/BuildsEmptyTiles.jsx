import { ClipboardText, Plus } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import "./builds-poster.css";

/*
 * Пустая страница «Сборок» (владелец, 16.11.2026): посередине экрана надпись, под ней две крупные плитки одного размера —
 * «Создать свою сборку» и «Ввести код друга». Пунктирная рамка, чёрный фон, значок в квадрате (плюс — у «создать», свой значок — у кода).
 * Каждая открывает страницу «Новая сборка»: первая — «Из установленного», вторая — сразу «По коду». Прежняя форма внутри карточки ушла:
 * она дублировала ту же страницу и оставляла пустые поля вокруг.
 */
export default function BuildsEmptyTiles({ copy, onCreate, onPaste }) {
  useTr();
  return (
    <section className="builds-empty" aria-label={copy.title}>
      <h1>{tr("Пока ни одной сборки")}</h1>
      <p>
        {tr("Сохраните то, что стоит в игре, или возьмите сборку у друга.")}
      </p>
      <div className="builds-empty-tiles">
        <button
          type="button"
          className="builds-empty-tile is-new"
          onClick={onCreate}
        >
          <span className="builds-empty-icon" aria-hidden="true">
            <Plus />
          </span>
          <b>{tr("Создать свою сборку")}</b>
          <small>{copy.tileNewHint}</small>
        </button>
        <button
          type="button"
          className="builds-empty-tile is-code"
          onClick={onPaste}
        >
          <span className="builds-empty-icon" aria-hidden="true">
            <ClipboardText />
          </span>
          <b>{tr("Ввести код друга")}</b>
          <small>{tr("сборка от друга")}</small>
        </button>
      </div>
    </section>
  );
}
