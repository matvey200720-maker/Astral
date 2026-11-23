import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, DotsThree, EyeSlash, ImageSquare, Plus, Rows as RowsIcon, Star, Trash } from "../../../ui/icons.jsx";
import {
  MAP_FONTS,
  SCHEDULE_ASTRAL_ICON_GRID,
  SCHEDULE_BOARD_ASTRAL_ICONS,
  SCHEDULE_BOARD_FONTS,
  SCHEDULE_BOARD_ICON_IMAGE,
  SCHEDULE_BOARD_ICON_NONE,
  SCHEDULE_BOARD_LIMITS,
  SCHEDULE_BOARD_LOOK,
  SCHEDULE_BOARD_MAX_ROWS,
  SCHEDULE_BOARD_OPACITY,
  SCHEDULE_BOARD_PRESETS,
  SCHEDULE_BOARD_SERVER_ICONS,
  findScheduleAstralIcon,
  scheduleBoardIconKind,
  scheduleBoardLayout,
  scheduleRowLines,
} from "@modovik/vector-map";
import Button from "../../../ui/Button.jsx";
import MenuButton from "../../../ui/MenuButton.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Select from "../../../ui/Select.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { ObjectActions, Section, Swatches, TextRow } from "../world-map-panel-parts.jsx";
import { customFontOptions } from "./label-options.js";
import MapFontSources from "./MapFontSources.jsx";
import { useMapFonts } from "./MapFontsContext.jsx";
import { addBoardRow, duplicateBoardRow, imageIcon, moveBoardRow, patchBoard, patchBoardRow, removeBoardRow } from "./schedule-board-editing.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { mapText } from "./map-copy.js";

/*
 * Редактор табло «Расписание» на большой карте (ТЗ 18.10, задача 1.2).
 *
 * Табло — картинка на карте: двигается мышью, размер — за уголки, поворот — за
 * ручку сверху, как у любой картинки. Здесь — его содержание и вид: строки
 * (значок, название в одну или две строчки, время; добавить, удалить, переставить), колонки (до трёх) и их
 * заголовки, готовые виды, цвета и рамка, шрифт, размер букв, своя картинка-вставка. Содержание и
 * значки — те же, что у 3D-табло мастерской; готовые 16 строк, как на
 * картинке владельца (AIRDROP, ТАЙНИКИ, ДИЛЕРЫ … КАПТЫ), стоят сразу.
 *
 * С 19.10 (задача 36) — панель инструмента «Расписание»: строка, на которую нажали на табло, раскрыта здесь же, а
 * текст правится и прямо на табло (двойной щелчок).
 */

/* Значок строки в маленьком квадрате: рисунок сервера, значок Astral, своя картинка. */
function RowIcon({ row, size = 22 }) {
  const kind = scheduleBoardIconKind(row.icon);
  if (kind === "server") {
    const icon = SCHEDULE_BOARD_SERVER_ICONS.find((item) => item.id === row.icon);
    return icon ? <img src={icon.url} alt="" width={size} height={size} draggable={false} /> : null;
  }
  if (kind === "astral") {
    const icon = findScheduleAstralIcon(row.icon);
    return icon ? (
      <svg viewBox={`0 0 ${SCHEDULE_ASTRAL_ICON_GRID} ${SCHEDULE_ASTRAL_ICON_GRID}`} width={size} height={size} aria-hidden="true">
        <path d={icon.path} fill="currentColor" />
      </svg>
    ) : null;
  }
  if (row.icon === SCHEDULE_BOARD_ICON_IMAGE) return <ImageSquare aria-hidden="true" />;
  return <span className="wmc-schedule-icon-none" aria-hidden="true" />;
}

/*
 * Поле строки, что растёт по тексту (задача 36: «ЗАХВАТ ЦЕХО», «15-21:0(» обрезались): длинное название или время
 * переносится на вторую строчку поля, а не прячется за краем. Невидимый двойник (`::after` по `data-value`) задаёт
 * высоту, поле лежит поверх него. `multiline` — название: Enter там — перенос (вторая строчка табло); у времени Enter
 * только заканчивает ввод. Имена событий сервера — AIRDROP, ТАЙНИКИ — данные человека и сервера, а не слова интерфейса:
 * у `<textarea>` в аудите есть собственный текст (у `<input>` не было), и правило «слово прописными» (`caps`) принимало бы их за крик.
 */
function GrowField({ className, value, multiline = false, lang, onChange, ...rest }) {
  return (
    <span className="wmc-grow" data-value={value}>
      <textarea
        {...rest}
        className={className}
        lang={lang}
        data-audit-ignore="caps"
        value={value}
        rows={1}
        onChange={(event) => onChange(multiline ? event.target.value : event.target.value.replace(/[\r\n]+/g, " "))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !multiline) event.preventDefault();
        }}
      />
    </span>
  );
}

/* Выбор значка: сервер, Astral, своя картинка, без значка. */
function IconPicker({ row, onPick, onImage }) {
  useTr();
  const file = useRef(null);
  return (
    <div className="wmc-schedule-picker" role="group" aria-label={tr("Значок строки")}>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) onImage(picked);
        }}
      />
      {SCHEDULE_BOARD_SERVER_ICONS.map((icon) => (
        <button
          type="button"
          key={icon.id}
          className={row.icon === icon.id ? "is-active" : ""}
          aria-pressed={row.icon === icon.id}
          aria-label={tr(icon.label)}
          title={tr(icon.label)}
          onClick={() => onPick({ icon: icon.id, image: undefined })}
        >
          <img src={icon.url} alt="" width="20" height="20" draggable={false} />
        </button>
      ))}
      {SCHEDULE_BOARD_ASTRAL_ICONS.map((icon) => (
        <button
          type="button"
          key={icon.id}
          className={row.icon === icon.id ? "is-active" : ""}
          aria-pressed={row.icon === icon.id}
          aria-label={tr(icon.label)}
          title={tr(icon.label)}
          onClick={() => onPick({ icon: icon.id, image: undefined })}
        >
          <svg viewBox={`0 0 ${SCHEDULE_ASTRAL_ICON_GRID} ${SCHEDULE_ASTRAL_ICON_GRID}`} width="20" height="20" aria-hidden="true">
            <path d={icon.path} fill="currentColor" />
          </svg>
        </button>
      ))}
      <button type="button" aria-label={tr("Своя картинка")} title={tr("Своя картинка")} onClick={() => file.current?.click()}>
        <ImageSquare aria-hidden="true" />
      </button>
      <button
        type="button"
        className={row.icon === SCHEDULE_BOARD_ICON_NONE ? "is-active" : ""}
        aria-pressed={row.icon === SCHEDULE_BOARD_ICON_NONE}
        aria-label={tr("Без значка")}
        title={tr("Без значка")}
        onClick={() => onPick({ icon: SCHEDULE_BOARD_ICON_NONE, image: undefined })}
      >
        <span className="wmc-schedule-icon-none" aria-hidden="true" />
      </button>
    </div>
  );
}

/* Строки: значок, название, время, меню строки. Выбор значка раскрывается под строкой. */
function Rows({ emblem, onChange, onImage, focus }) {
  useTr();
  const rows = emblem.schedule.rows;
  const [opened, setOpened] = useState(-1);
  const list = useRef(null);
  /* Нажали на строку или на её значок на карте — она подсвечена и видна в списке, у значка открыт выбор. */
  useEffect(() => {
    if (!focus?.stamp) return;
    setOpened(focus.icon ? focus.row : -1);
    list.current?.querySelector(`[data-schedule-row="${focus.row}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [focus?.stamp]); // eslint-disable-line react-hooks/exhaustive-deps -- только новая просьба с карты
  return (
    <>
      <ol ref={list} className="wmc-schedule-rows" aria-label={tr("Строки табло")}>
        {rows.map((row, index) => {
          const title = row.text.replace(/\n/g, " ") || mapText("Строка {number}", { number: index + 1 });
          const lines = scheduleRowLines(row);
          return (
            <li key={index} className={`${row.hidden ? "is-hidden" : ""}${focus?.row === index ? " is-active" : ""}`.trim()} data-schedule-row={index}>
              <div className="wmc-schedule-row">
                <button
                  type="button"
                  className="wmc-schedule-icon"
                  aria-expanded={opened === index}
                  aria-label={mapText("Значок строки «{title}»", { title })}
                  onClick={() => setOpened(opened === index ? -1 : index)}
                >
                  <RowIcon row={row} />
                </button>
                <GrowField
                  className="wmc-schedule-input is-name"
                  multiline
                  lang={/[Ѐ-ӿ]/.test(row.text) ? "ru" : undefined}
                  value={row.text}
                  maxLength={49}
                  spellCheck={false}
                  aria-label={mapText("Название строки {number}", { number: index + 1 })}
                  placeholder={tr("Название")}
                  onChange={(text) => onChange(patchBoardRow(emblem, index, { text }), tr("Название строки"), `schedule.${index}.text`)}
                />
                <GrowField
                  className="wmc-schedule-input is-time"
                  value={row.time}
                  maxLength={32}
                  spellCheck={false}
                  aria-label={mapText("Время строки {number}", { number: index + 1 })}
                  placeholder={tr("Время")}
                  onChange={(time) => onChange(patchBoardRow(emblem, index, { time }), tr("Время строки"), `schedule.${index}.time`)}
                />
                <MenuButton
                  variant="ghost"
                  size="sm"
                  align="end"
                  trailing={null}
                  icon={<DotsThree />}
                  ariaLabel={mapText("Строка «{title}»: ещё", { title })}
                  options={[
                    ...(index > 0 ? [{ value: "up", label: tr("Выше"), icon: <ArrowUp /> }] : []),
                    ...(index < rows.length - 1 ? [{ value: "down", label: tr("Ниже"), icon: <ArrowDown /> }] : []),
                    { value: "lines", label: lines > 1 ? tr("В одну строчку") : tr("В две строчки"), icon: <RowsIcon /> },
                    { value: "accent", label: row.accent ? tr("Без выделения") : tr("Выделить цветом"), icon: <Star /> },
                    { value: "hide", label: row.hidden ? tr("Показать") : tr("Скрыть"), icon: <EyeSlash /> },
                    { value: "copy", label: tr("Дублировать"), icon: <Copy /> },
                    { value: "remove", label: tr("Удалить"), icon: <Trash />, danger: true },
                  ]}
                  onSelect={(value) => {
                    if (value === "up") onChange(moveBoardRow(emblem, index, -1), tr("Строка выше"), "schedule.rows");
                    else if (value === "down") onChange(moveBoardRow(emblem, index, 1), tr("Строка ниже"), "schedule.rows");
                    else if (value === "lines")
                      onChange(
                        patchBoardRow(emblem, index, { text: lines > 1 ? row.text.split("\n").filter(Boolean).join(" ").slice(0, 24) : `${row.text}\n` }),
                        lines > 1 ? tr("Строка в одну строчку") : tr("Строка в две строчки"),
                        `schedule.${index}.text`,
                      );
                    else if (value === "accent") onChange(patchBoardRow(emblem, index, { accent: !row.accent }), tr("Выделена строка"), `schedule.${index}.accent`);
                    else if (value === "hide") onChange(patchBoardRow(emblem, index, { hidden: !row.hidden }), tr("Строка скрыта"), `schedule.${index}.hidden`);
                    else if (value === "copy") onChange(duplicateBoardRow(emblem, index), tr("Строка скопирована"), "schedule.rows");
                    else if (value === "remove") {
                      setOpened(-1);
                      onChange(removeBoardRow(emblem, index), tr("Строка удалена"), "schedule.rows");
                    }
                  }}
                />
              </div>
              {opened === index && (
                <IconPicker
                  row={row}
                  onPick={(values) => {
                    setOpened(-1);
                    onChange(patchBoardRow(emblem, index, values), tr("Значок строки"), `schedule.${index}.icon`);
                  }}
                  onImage={(file) => {
                    setOpened(-1);
                    onImage(file, (asset, aspect) =>
                      patchBoardRow(emblem, index, imageIcon(asset.id, asset.name || file.name, aspect)),
                    );
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        block
        icon={<Plus />}
        disabled={rows.length >= SCHEDULE_BOARD_MAX_ROWS}
        onClick={() => onChange(addBoardRow(emblem), tr("Строка добавлена"), "schedule.rows")}
      >
        {tr("Добавить строку")}
      </Button>
    </>
  );
}

/** Панель выбранного табло. */
export default function MapSchedule({ emblem, focus = null, onObject, onImage, onFocus, onRemove, onDuplicate, onHide }) {
  useTr();
  const { fonts } = useMapFonts();
  const board = emblem.schedule;
  const layout = scheduleBoardLayout(board);
  const pictureFile = useRef(null);
  /* Любая правка табло уходит одним патчем эмблемы: содержание и ширина рамки. */
  const change = (patch, label, property) => onObject(patch, label, property || "schedule");
  const set = (values, label, property) => change(patchBoard(emblem, values), label, property);
  const look = (key, value, label) => set({ look: { ...board.look, [key]: value } }, label, `schedule.look.${key}`);
  const opacity = (key, value, label) => set({ opacity: { ...board.opacity, [key]: value } }, label, `schedule.opacity.${key}`);
  const fontOptions = [
    ...SCHEDULE_BOARD_FONTS.map((id) => [id, MAP_FONTS.find((item) => item.id === id)?.title || id]),
    /* Свои шрифты проекта (ТЗ 23.10.2026, п. F). */
    ...customFontOptions(fonts, board.font),
  ];

  return (
    <>
      <Section
        title={tr("Расписание")}
        hint={tr("Табло на карте: тяните мышью, размер — за уголки, поворот — за ручку сверху. Здесь — строки и вид.")}
        actions={
          onDuplicate ? (
            <ObjectActions onDuplicate={onDuplicate} onRemove={onRemove} />
          ) : (
            <div className="wmc-section-actions">
              <button type="button" onClick={() => onRemove()} title={tr("Удалить табло")} aria-label={tr("Удалить табло")}>
                <Trash />
              </button>
            </div>
          )
        }
      >
        <Rows emblem={emblem} onChange={change} onImage={onImage} focus={focus} />
        <div className="wmc-schedule-actions">
          <Button variant="ghost" size="sm" onClick={onFocus}>
            {tr("Показать на карте")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onHide}>
            {tr("Скрыть табло")}
          </Button>
        </div>
      </Section>

      <Section title={tr("Колонки и заголовки")}>
        <SegmentedControl
          size="sm"
          label={tr("Колонок")}
          value={String(board.columns)}
          options={SCHEDULE_BOARD_LIMITS.columns.map((count) => ({ value: String(count), label: String(count) }))}
          onChange={(value) => set({ columns: Number(value) }, tr("Колонки табло"), "schedule.columns")}
        />
        <TextRow
          label={tr("Общий заголовок")}
          value={board.title}
          maxLength={SCHEDULE_BOARD_LIMITS.title}
          onChange={(title) => set({ title }, tr("Заголовок табло"), "schedule.title")}
        />
        {Array.from({ length: layout.columns }, (_, column) => column).map((column) => (
          <TextRow
            key={column}
            label={layout.columns > 1 ? mapText("Заголовок колонки {number}", { number: column + 1 }) : tr("Заголовок колонки")}
            value={board.headings[column]}
            maxLength={SCHEDULE_BOARD_LIMITS.heading}
            onChange={(heading) =>
              set(
                { headings: board.headings.map((item, at) => (at === column ? heading : item)) },
                tr("Заголовок колонки"),
                `schedule.heading.${column}`,
              )
            }
          />
        ))}
      </Section>

      <Section title={tr("Готовые виды")} hint={tr("Цвета и подложки одним нажатием — строки и шрифт остаются")}>
        <div className="wmc-schedule-presets">
          {SCHEDULE_BOARD_PRESETS.map((preset) => {
            const current =
              JSON.stringify(board.look) === JSON.stringify({ ...SCHEDULE_BOARD_LOOK, ...preset.look }) &&
              JSON.stringify(board.opacity) === JSON.stringify({ ...SCHEDULE_BOARD_OPACITY, ...preset.opacity });
            return (
              <Button
                key={preset.id}
                variant={current ? "primary" : "secondary"}
                size="sm"
                aria-pressed={current}
                onClick={() => set({ look: { ...preset.look }, opacity: { ...preset.opacity } }, tr("Вид табло"), "schedule.preset")}
              >
                {tr(preset.label)}
              </Button>
            );
          })}
        </div>
      </Section>

      <Section title={tr("Вид")}>
        <Select
          className="wmc-select"
          label={tr("Шрифт")}
          value={board.font}
          options={fontOptions}
          onChange={(font) => set({ font }, tr("Шрифт табло"), "schedule.font")}
        />
        <MapFontSources onPick={(font) => set({ font }, tr("Шрифт табло"), "schedule.font")} />
        <Slider
          label={tr("Размер букв")}
          value={board.letters}
          min={SCHEDULE_BOARD_LIMITS.letters[0]}
          max={SCHEDULE_BOARD_LIMITS.letters[1]}
          step={5}
          unit="%"
          onChange={(letters) => set({ letters }, tr("Размер букв табло"), "schedule.letters")}
        />
        <label className="ui-field wmc-switch-line">
          <span>{tr("Прописные буквы")}</span>
          <Switch checked={board.upper} label={tr("Прописные буквы")} onChange={(upper) => set({ upper }, tr("Регистр табло"), "schedule.upper")} />
        </label>
        {[
          ["text", "Название"],
          ["time", "Время"],
          ["icon", "Значки"],
          ["box", "Квадраты значков"],
          ["accent", "Выделенные строки"],
          ["heading", "Заголовки"],
          ["outline", "Рамка"],
        ].map(([key, title]) => (
          <div className="wmc-field-block" key={key}>
            <small className="wmc-field-caption">{tr(title)}</small>
            <Swatches label={tr(title)} value={board.look[key]} onChange={(colour) => look(key, colour, mapText("Цвет: {title}", { title: tr(title) }))} />
            {board.look[key] !== SCHEDULE_BOARD_LOOK[key] && (
              <Button variant="ghost" size="sm" onClick={() => look(key, SCHEDULE_BOARD_LOOK[key], tr("Цвет как был"))}>
                {tr("Как у сервера")}
              </Button>
            )}
          </div>
        ))}
        <Slider
          label={tr("Подложка строк")}
          value={board.opacity.plates}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => opacity("plates", value, tr("Подложка строк"))}
        />
        {board.opacity.plates > 0 && (
          <div className="wmc-field-block">
            <small className="wmc-field-caption">{tr("Цвет подложки строк")}</small>
            <Swatches label={tr("Цвет подложки строк")} value={board.look.plate} onChange={(colour) => look("plate", colour, tr("Цвет подложки строк"))} />
          </div>
        )}
        <Slider
          label={tr("Квадраты значков")}
          value={board.opacity.boxes}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => opacity("boxes", value, tr("Квадраты значков"))}
        />
        <Slider
          label={tr("Фон табло")}
          value={board.opacity.background}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => opacity("background", value, tr("Фон табло"))}
        />
        {board.opacity.background > 0 && (
          <div className="wmc-field-block">
            <small className="wmc-field-caption">{tr("Цвет фона табло")}</small>
            <Swatches label={tr("Цвет фона табло")} value={board.look.background} onChange={(colour) => look("background", colour, tr("Цвет фона табло"))} />
          </div>
        )}
        <Slider
          label={tr("Рамка")}
          value={board.opacity.outline}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => opacity("outline", value, tr("Рамка табло"))}
        />
        <Slider
          label={tr("Прозрачность табло")}
          value={emblem.opacity}
          min={5}
          max={100}
          unit="%"
          onChange={(value) => onObject({ opacity: value }, tr("Прозрачность табло"), "schedule.opacity")}
        />
        {(board.opacity.plates !== SCHEDULE_BOARD_OPACITY.plates ||
          board.opacity.background !== SCHEDULE_BOARD_OPACITY.background ||
          board.opacity.outline !== SCHEDULE_BOARD_OPACITY.outline ||
          board.opacity.boxes !== SCHEDULE_BOARD_OPACITY.boxes) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set({ opacity: SCHEDULE_BOARD_OPACITY }, tr("Подложки как были"), "schedule.opacity")}
          >
            {tr("Подложки как у сервера")}
          </Button>
        )}
      </Section>

      <Section title={tr("Картинка в табло")} hint={tr("Логотип или рисунок полосой над строками или под ними")}>
        <input
          ref={pictureFile}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (!picked) return;
            onImage(picked, (asset, aspect) =>
              patchBoard(emblem, {
                picture: { asset: asset.id, name: asset.name || picked.name, aspect, place: board.picture?.place || "top", height: board.picture?.height || 3 },
              }),
            );
          }}
        />
        <Button variant="secondary" size="sm" block icon={<ImageSquare />} onClick={() => pictureFile.current?.click()}>
          {board.picture ? tr("Заменить картинку") : tr("Вставить картинку")}
        </Button>
        {board.picture && (
          <>
            <small className="wmc-hint" data-audit-ignore="caps">
              {board.picture.name}
            </small>
            <SegmentedControl
              size="sm"
              label={tr("Где картинка")}
              value={board.picture.place}
              options={[
                { value: "top", label: tr("Сверху") },
                { value: "bottom", label: tr("Снизу") },
              ]}
              onChange={(place) => set({ picture: { ...board.picture, place } }, tr("Место картинки"), "schedule.picture.place")}
            />
            <Slider
              label={tr("Высота картинки")}
              value={board.picture.height}
              min={SCHEDULE_BOARD_LIMITS.picture[0]}
              max={SCHEDULE_BOARD_LIMITS.picture[1]}
              step={0.5}
              onChange={(height) => set({ picture: { ...board.picture, height } }, tr("Высота картинки"), "schedule.picture.height")}
            />
            <Button variant="ghost" size="sm" onClick={() => set({ picture: null }, tr("Картинка убрана"), "schedule.picture")}>
              {tr("Убрать картинку")}
            </Button>
          </>
        )}
      </Section>
    </>
  );
}
