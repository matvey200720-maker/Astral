import { ArrowCounterClockwise, ImageSquare } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Switch from "../../../ui/Switch.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Общие органы панелей мини-карты: раздел с «Стандартом», строка
 * выключателя, цвет, выбор из нескольких и загрузка своей картинки.
 *
 * Жили в `MinimapCustomizer.jsx`, пока все инструменты были одним файлом в
 * две с половиной тысячи строк; с задачи 15 ТЗ 10.10.2026 (вечер) у каждого
 * инструмента своя панель (`minimap-tools/*`), а органы — общие.
 */

/* Быстрые цвета рамок и задника: белый и чёрный берут чаще всего, остальное —
   акценты, которыми красят HUD на RP-серверах. */
export const FRAME_SWATCHES = Object.freeze([
  "#ffffff",
  "#000000",
  "#ff3b5c",
  "#ffd23f",
  "#3ddc84",
  "#38bdf8",
  "#a78bfa",
]);

export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <label className="ui-field mmc-toggle-row">
      <span>{label}</span>
      <Switch checked={checked} label={label} onChange={onChange} disabled={disabled} />
    </label>
  );
}

export function ColorControl({ label, value, onChange, swatches }) {
  return (
    <ColorField
      className="mmc-color-control"
      label={label}
      value={value}
      swatches={swatches}
      onChange={onChange}
    />
  );
}

/* Выбор из нескольких с подписью над ним: колонка инспектора узкая. */
export function VisibilityChoice({ label, options, value, onChange }) {
  return (
    <div className="mmc-choice-row">
      <span>{label}</span>
      <SegmentedControl
        className="mmc-choice-track"
        label={label}
        size="sm"
        value={value}
        onChange={onChange}
        options={options.map(([id, text]) => ({ value: id, label: text }))}
      />
    </div>
  );
}

export function AssetUpload({ label, loaded, onChange }) {
  useTr();
  return (
    <label className="mmc-asset-upload">
      <span>
        <ImageSquare />
        {label}
      </span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChange(file);
          event.target.value = "";
        }}
      />
      <b>{loaded ? tr("Заменить") : tr("Загрузить")}</b>
    </label>
  );
}

/* Раздел панели. Без заголовка — когда раздел один и его имя уже стоит
   заголовком панели (подпись инструмента). `onStandard` — кнопка
   «Стандарт» в шапке раздела: вернуть его настройки к виду игры. */
export function Section({ title = "", onStandard = null, standard = false, children }) {
  useTr();
  return (
    <section className="ui-panel mmc-panel-section">
      {onStandard ? (
        <div className="mmc-section-head">
          <h3>{title}</h3>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowCounterClockwise />}
            disabled={standard}
            onClick={onStandard}
          >
            {tr("Стандарт")}
          </Button>
        </div>
      ) : (
        title && <h3>{title}</h3>
      )}
      {children}
    </section>
  );
}

export const pickFields = (source, fields) =>
  Object.fromEntries(fields.map((field) => [field, source[field]]));
