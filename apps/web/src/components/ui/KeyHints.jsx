import { Fragment } from "react";
import Kbd from "./Kbd.jsx";
import { tr, useTr } from "../../locales/ui.js";
import "./key-hints.css";

/*
 * Подсказки клавиш под рукой (ТЗ 29.10.2026-d, п. 3): строка в нижнем левом углу кадра редактора — «ПКМ вращение · Колесо
 * приближение · F весь рост» и справа «F1 все клавиши». Образец — строка внизу окна конкурента; поверх подписей редакторов она не
 * ложится (причина, по которой прежнюю подсказку кадра убрали, — `EditorTour.jsx`): строка короткая, у самого угла, мышь её не
 * ловит, кроме кнопки «все клавиши».
 *
 *   <KeyHints items={[{ keys: "ПКМ", text: "вращение" }, …]} all={{ keys: "F1", text: "все клавиши", onClick }} />
 *
 * `keys` — строка или список («Shift», «ЛКМ»): клавиши плашками через «+». Слова приходят уже на языке окна.
 */
function Keys({ keys }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return list.map((key, index) => (
    <Fragment key={`${key}-${index}`}>
      {index > 0 && <span aria-hidden="true">+</span>}
      <Kbd>{key}</Kbd>
    </Fragment>
  ));
}

export default function KeyHints({ items = [], all = null }) {
  useTr();
  if (!items.length && !all) return null;
  /* Чем правее подсказка, тем она важнее: ряд раскладывается справа налево (`key-hints.css`), и тесное окно не показывает
     самые левые целиком, а не режет правый край. `order` — от последней к первой, разметка остаётся в порядке чтения. */
  const total = items.length + (all ? 1 : 0);
  return (
    <div className="ui-key-hints" role="group" aria-label={tr("Подсказки клавиш")}>
      {items.map((item, index) => (
        <span key={`${item.text}-${[].concat(item.keys).join("+")}`} className="ui-key-hint" style={{ order: total - index }}>
          <Keys keys={item.keys} />
          <span>{item.text}</span>
        </span>
      ))}
      {all && (
        <button type="button" className="ui-key-hint ui-key-hints-all" style={{ order: 1 }} title={tr("Горячие клавиши")} onClick={all.onClick}>
          <Keys keys={all.keys} />
          <span>{all.text}</span>
        </button>
      )}
    </div>
  );
}
