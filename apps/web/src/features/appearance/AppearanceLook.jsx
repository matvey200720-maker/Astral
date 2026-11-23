import { tr, useTr } from "../../locales/ui.js";
import * as look from "./look.js";
import HomePreview from "./HomePreview.jsx";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import AppIconPicker from "./AppIconPicker.jsx";

// Русские ключи словаря tr(): переводятся в месте отрисовки, а не при загрузке модуля.
// Названия акцентов идут в порядке LOOK_ACCENTS.
const ACCENT_NAMES = ["Белый", "Песочный", "Персиковый", "Розовый", "Лавандовый", "Небесный", "Зелёный"];

export default function AppearanceLook({ mods = [], onSaved = null, language = "ru", resetLabel = "", aside = null }) {
  const view = look.useLook();
  useTr();

  // Правка применяется сразу; родителю уходит только функция отмены (тост «Сохранено · Отменить»)
  function change(patch, undo) {
    look.setLook(patch);
    if (onSaved) onSaved(() => look.setLook(undo));
  }
  const choose = (field, value) => view[field] !== value && change({ [field]: value }, { [field]: view[field] });

  // Строка настроек: слева подпись с пояснением, справа орган управления
  const line = (name, note, control) => (
    <div className="settings-row">
      <span className="settings-row-copy">
        <b>{tr(name)}</b>
        <small>{tr(note)}</small>
      </span>
      {control}
    </div>
  );
  const segmented = (field, name, note, pairs) =>
    line(
      name,
      note,
      <span className="settings-row-control">
        <SegmentedControl
          onChange={(value) => choose(field, value)}
          options={pairs.map(([value, text]) => ({ label: tr(text), value }))}
          value={view[field]}
          label={tr(name)}
        />
      </span>,
    );

  const swatches = look.LOOK_ACCENTS.map(({ hex, id }, position) => {
    const accentName = tr(ACCENT_NAMES[position]);
    return (
      <button
        key={id}
        aria-checked={view.accent === id}
        aria-label={accentName}
        className="look-swatch"
        onClick={() => choose("accent", id)}
        role="radio"
        style={{ "--swatch": hex }}
        title={accentName}
        type="button"
      />
    );
  });
  const resetVisible = Boolean(resetLabel) && !look.isDefaultLook(view);
  const resetButton = resetVisible ? (
    <button
      className="settings-item-reset"
      onClick={() => change(look.DEFAULT_LOOK, view)}
      type="button"
    >
      {resetLabel}
    </button>
  ) : null;
  const backdropPairs = Object.entries({ none: "Выкл.", light: "Свет", waves: "Волны", lines: "Линии" });
  const radiusPairs = Object.entries({ sharp: "Острые", soft: "Обычные", round: "Круглые" });

  return (
    <section
      className="look-settings"
      data-setting="look"
    >
      {/* Слева колонкой — миниатюра и (из настроек) карточка анимаций, справа — цвет, фон и значок: пустого места под миниатюрой нет. */}
      <div className="look-aside">
        <HomePreview
          backdrop={view.backdrop}
          language={language}
          mods={mods}
        />
        {aside}
      </div>
      <div className="look-main">
        <span className="settings-group-title" data-audit-ignore="caps">
          {tr("Цвет и фон")}
          {resetButton}
        </span>
        <div className="settings-card look-card">
          {line(
            "Акцент",
            "Главная кнопка, выбранное и знак",
            <span
              aria-label={tr("Акцент")}
              className="settings-row-control look-swatches"
              role="radiogroup"
            >
              {swatches}
            </span>,
          )}
          {segmented("backdrop", "Фон", "Что видно за окнами", backdropPairs)}
          {segmented("radius", "Скругления", "Углы окон, карточек, кнопок и полей", radiusPairs)}
        </div>
        <AppIconPicker
          onSaved={onSaved}
          resetLabel={resetLabel}
        />
      </div>
    </section>
  );
}
