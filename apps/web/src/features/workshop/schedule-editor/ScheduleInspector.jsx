/*
 * Панель «Расписания» — настройки взятого инструмента (мастерская «как в
 * Photoshop»).
 *
 * «Строки» (задача 4 ТЗ 11.10.2026, утро: «полная редакция этого
 * расписания… прямо можно было менять текст») — строки табло списком по
 * колонкам, как на щите. «Добавить строку» — своя строка (тайник, событие,
 * что угодно) в конец; у каждой строки — «Выше», «Ниже», «Удалить». Нажатая
 * строка раскрывается прямо в списке: название, время (часы и промежутки
 * полями или своим текстом), значок (значки сервера, значки Astral, своя
 * картинка, без значка), «Выделить», «Скрыть», «Копия строки», «Как на
 * сервере». Ниже — «Раскладка»: колонки и честная высота букв в игре.
 *
 * «Заголовок и шрифт» — слова заголовка, шрифт (шрифты окна и свой файл),
 * ширина букв и заглавные. «Цвета» — заголовок, названия, время, плашки,
 * выделенные строки, квадраты и значки, фон, рамка и свечение.
 * «Прозрачность» — непрозрачность всего табло и его частей. «Шаблоны» —
 * готовые виды. «Где стоят» — двадцать табло сервера.
 *
 * Органы — из словаря (`components/ui`); разделы — `ui-panel fx-section`,
 * как у остальных мест; своих стилей у редактора нет.
 */

import ActionRows from "../../../components/ui/ActionRows.jsx";
import SectionHeading from "../section-help.jsx";
import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, Prohibit, UploadSimple } from "../../../components/ui/icons.jsx";
import {
  SCHEDULE_ASTRAL_ICONS,
  SCHEDULE_COLUMN_CHOICES,
  SCHEDULE_ICONS,
  SCHEDULE_ICON_IMAGE,
  SCHEDULE_ICON_NONE,
  SCHEDULE_LIMITS,
  SCHEDULE_MAX_ROWS,
  SCHEDULE_PLACES,
  SCHEDULE_SERVER_COLOURS,
  SCHEDULE_SERVER_OPACITY,
  scheduleColumnCount,
  scheduleIconKind,
  createScheduleProject,
  scheduleStockRow,
} from "@modovik/climb-contract/recolor/schedule";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { FontControls } from "../emblem/EmblemSection.jsx";
import { HANGAR_EMBLEM_ACCEPT, convertedImageText, saveHangarEmblem, useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import { useStudioLive } from "../texture-studio/StudioLive.jsx";
import { scheduleIconSurface } from "./schedule-studio.js";
import SchedulePresets from "./SchedulePresets.jsx";
import {
  COLOUR_FIELDS,
  OPACITY_FIELDS,
  SCHEDULE_SWATCHES,
  columnLabel,
  iconLabel,
  layoutText,
  opacityHint,
  percentText,
  readabilityHint,
  rowTitle,
  rowsText,
} from "./schedule-text.js";
import { useIconThumb } from "./schedule-thumbs.js";
import ScheduleTimeField from "./ScheduleTimeField.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Как у сервера: строки и свечение табло (что возвращают строки внизу «Строк» и «Цветов»). */
const SERVER = createScheduleProject();
const SERVER_GLOW = SERVER.glow;
const rowsAreServer = (project) => JSON.stringify(project.rows) === JSON.stringify(SERVER.rows) && project.columns === SERVER.columns;

/* Раздел: пояснения — за «?» у заголовка, а не абзацами (слово владельца 29.10.2026, `design-qa.md`). */
function Section({ title, label, note = "", help = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      {/* Раздел без имени, подписи и «?» — без шапки: пустая шапка стояла пустой строкой над полем. */}
      {(title || note || help) && <SectionHeading title={title} note={note} help={help} />}
      {children}
    </section>
  );
}

/* Картинка строки для списка: значок сервера или Astral, своя картинка или пусто. */
function RowThumb({ row }) {
  const kind = scheduleIconKind(row.icon);
  const icon = useIconThumb(kind === "server" || kind === "astral" ? row.icon : "");
  const own = useHangarEmblemUrl(kind === "image" ? row.image?.asset : "");
  const url = kind === "image" ? own : icon;
  return url ? <img className="schedule-row-thumb" src={url} alt="" /> : <i className="schedule-row-thumb" aria-hidden="true" />;
}

/* Значок кнопкой выбора: белый квадрат с рисунком — как на табло. */
function IconChoice({ id, label, active, onPick }) {
  const url = useIconThumb(id);
  return (
    <button type="button" className={`finish-pattern${active ? " is-active" : ""}`} aria-pressed={active} aria-label={label} title={label} onClick={onPick}>
      {url ? <img src={url} alt="" width="40" height="34" /> : null}
    </button>
  );
}

const ICON_SOURCES = Object.freeze([
  { value: "server", label: "Сервера", title: "Значки табло сервера Majestic" },
  { value: "astral", label: "Astral", title: "Свои рисунки Astral — векторные, красятся цветом значков" },
  { value: "own", label: "Свой", title: "Своя картинка или без значка" },
]);
const sourceOf = (icon) => {
  const kind = scheduleIconKind(icon);
  return kind === "server" || kind === "astral" ? kind : "own";
};

export function IconPicker({ row, index, onRow, onNotice, groupRef = null }) {
  useTr();
  const live = useStudioLive();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState(() => sourceOf(row.icon));
  const own = useHangarEmblemUrl(row.icon === SCHEDULE_ICON_IMAGE ? row.image?.asset : "");
  /* Другая строка — набор её значка. */
  useEffect(() => setSource(sourceOf(row.icon)), [index, row.icon]);
  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const { converted, ...image } = await saveHangarEmblem(file);
      onRow(index, { icon: SCHEDULE_ICON_IMAGE, image }, `Строка ${index + 1}: своя картинка`);
      if (converted) onNotice?.(convertedImageText(converted), "info");
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    } finally {
      setBusy(false);
    }
  }
  const choose = (id) => onRow(index, { icon: id }, `Строка ${index + 1}: значок`);
  let choices;
  if (source === "server") choices = SCHEDULE_ICONS.map((icon) => <IconChoice key={icon.id} id={icon.id} label={icon.label} active={row.icon === icon.id} onPick={() => choose(icon.id)} />);
  else if (source === "astral") choices = SCHEDULE_ASTRAL_ICONS.map((icon) => <IconChoice key={icon.id} id={icon.id} label={icon.label} active={row.icon === icon.id} onPick={() => choose(icon.id)} />);
  else
    choices = (
      <>
        <button
          type="button"
          className={`finish-pattern${row.icon === SCHEDULE_ICON_IMAGE ? " is-active" : ""}`}
          aria-pressed={row.icon === SCHEDULE_ICON_IMAGE}
          aria-label={row.icon === SCHEDULE_ICON_IMAGE ? tr("Другая своя картинка") : tr("Своя картинка")}
          title={tr("Своя картинка — PNG с прозрачным фоном встанет в квадрат")}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {own ? <img src={own} alt="" width="40" height="34" /> : <UploadSimple />}
        </button>
        <button
          type="button"
          className={`finish-pattern${row.icon === SCHEDULE_ICON_NONE ? " is-active" : ""}`}
          aria-pressed={row.icon === SCHEDULE_ICON_NONE}
          aria-label={tr("Без значка")}
          title={tr("Без значка: квадрата нет, название — от края плашки")}
          onClick={() => choose(SCHEDULE_ICON_NONE)}
        >
          <Prohibit />
        </button>
      </>
    );
  return (
    <div className="finish-field" ref={groupRef}>
      <p className="recolor-subhead">Значок — {iconLabel(row)}</p>
      <SegmentedControl label={tr("Чьи значки")} size="sm" options={ICON_SOURCES} value={source} onChange={setSource} />
      <input ref={input} type="file" accept={HANGAR_EMBLEM_ACCEPT} hidden onChange={pick} aria-label={tr("Своя картинка строки")} />
      <div className="finish-patterns" role="group" aria-label={tr("Значок строки")}>
        {choices}
      </div>
      {/* «Студия»: холст — квадрат значка; окно студии показывает табло на месте с этим значком. */}
      {source === "own" && (
        <div className="recolor-actions">
          <StudioPictureButton
            getSurface={() => scheduleIconSurface({ index, live })}
            image={row.icon === SCHEDULE_ICON_IMAGE ? row.image : null}
            onImage={(image) => onRow(index, { icon: SCHEDULE_ICON_IMAGE, image }, `Строка ${index + 1}: своя картинка`)}
            onNotice={onNotice}
            slug={`schedule-row-${index + 1}`}
          />
        </div>
      )}
      {/* Что стоит — одной строкой; пояснения о рисунках и коде для друга — не абзацами (слово владельца 29.10.2026). */}
      {row.icon === SCHEDULE_ICON_IMAGE && (
        <p className="fx-hint">
          {row.image?.name} · {row.image?.width} × {row.image?.height}
        </p>
      )}
    </div>
  );
}

/* Правка нажатой строки — прямо под ней в списке. */
function RowEditor({ row, index, onRow, onNotice, focus }) {
  useTr();
  const nameRef = useRef(null);
  const iconRef = useRef(null);
  /* Просьба окна: «пишите название» (новая строка) или «выберите значок» (из кадра). */
  useEffect(() => {
    if (!focus || focus.index !== index) return;
    if (focus.target === "icon") iconRef.current?.scrollIntoView?.({ block: "nearest" });
    else {
      nameRef.current?.focus();
      nameRef.current?.select?.();
    }
  }, [focus, index]);
  return (
    <div className="arena-element-editor finish-field" role="group" aria-label={`Правка строки ${index + 1}`}>
      <TextField
        label={tr("Название")}
        inputRef={nameRef}
        value={row.text}
        maxLength={SCHEDULE_LIMITS.text}
        placeholder={tr("Например, ТАЙНИКИ")}
        onChange={(text) => onRow(index, { text }, `Строка ${index + 1}: название`)}
      />
      <ScheduleTimeField value={row.time} onChange={(time) => onRow(index, { time }, `Строка ${index + 1}: время`)} />
      <IconPicker row={row} index={index} onRow={onRow} onNotice={onNotice} groupRef={iconRef} />
      <SwitchLine checked={row.accent} label={tr("Выделить строку")} onChange={(accent) => onRow(index, { accent }, accent ? `Строка ${index + 1} выделена` : `Строка ${index + 1} без выделения`)} />
      <SwitchLine checked={row.hidden} label={tr("Скрыть строку")} onChange={(hidden) => onRow(index, { hidden }, hidden ? `Строка ${index + 1} скрыта` : `Строка ${index + 1} снова видна`)} />
    </div>
  );
}

/*
 * Действия взятой строки — строками нижней карточки, только доступные (правила 2 и 4 `design-qa.md`): выше, ниже, копия,
 * как на сервере, удалить. Погашенных стрелок у края списка и «Копии» при полном табло нет.
 */
function rowActions({ project, index, onMove, onDuplicate, onRowReset, onRemove }) {
  const row = project.rows[index];
  if (!row) return [];
  const title = rowTitle(row);
  const stock = scheduleStockRow(index);
  const same = stock && JSON.stringify(row) === JSON.stringify({ ...stock, hidden: false, accent: false });
  return [
    index > 0 && { id: "up", label: trFill("Выше: {0}", title), onClick: () => onMove(index, -1) },
    index < project.rows.length - 1 && { id: "down", label: trFill("Ниже: {0}", title), onClick: () => onMove(index, 1) },
    project.rows.length < SCHEDULE_MAX_ROWS && { id: "copy", label: tr("Копия строки"), onClick: () => onDuplicate(index) },
    stock && !same && { id: "row-server", label: tr("Эта строка — как на сервере"), title: `У сервера на этом месте: ${stock.text} · ${stock.time}`, onClick: () => onRowReset(index) },
    { id: "remove", label: trFill("Удалить строку: {0}", title), danger: true, onClick: () => onRemove(index) },
  ];
}

/* Строка списка — строка группы: значок, название, место и пометки; щелчок берёт её в правку под ней. */
function RowItem({ row, index, selected, onSelect }) {
  useTr();
  const title = rowTitle(row);
  /* Подпись — только у строки, что отличается (скрыта, выделена): номер строки в колонке видно по порядку списка (п. 17). */
  const marks = [row.hidden ? tr("скрыта") : "", row.accent ? tr("выделена") : ""].filter(Boolean).join(", ");
  return (
    <NavRow
      className={selected ? "is-selected" : ""}
      aria-pressed={selected}
      aria-label={`${index + 1}. ${title}`}
      icon={<RowThumb row={row} />}
      title={<span data-audit-ignore="caps">{title}</span>}
      caption={marks || null}
      trailing={null}
      onOpen={() => onSelect(index)}
    />
  );
}

const COLUMN_OPTIONS = SCHEDULE_COLUMN_CHOICES.map((value) => ({
  value,
  label: value === "auto" ? "Авто" : String(value),
  title: value === "auto" ? "Две колонки, как у сервера; с 29-й строки — три" : `${value} ${value === 1 ? "колонка" : "колонки"}`,
}));

/*
 * «Строки» — список строк табло группами по колонкам, под ним — места табло (правило 12 `design-qa.md`, 30.10.2026: выбор
 * там же, где правка; прежде — отдельный инструмент «Где стоят»). Правка строки — своей страницей (`PanelPage`): в списке
 * только имя и время, форма на двенадцать органов в колонке не стоит. Строку берут щелчком в списке или на табло.
 */
function RowsSection({ project, selected, focus, placeId, onPlace, onSelect, onRow, onAdd, onRemove, onDuplicate, onMove, onRowReset, onRowsReset, onColumns, onNotice }) {
  useTr();
  const count = project.rows.length;
  const index = count ? Math.min(count - 1, Math.max(0, selected)) : -1;
  const columns = scheduleColumnCount(project);
  const lines = Math.max(1, Math.ceil(count / columns));
  const full = count >= SCHEDULE_MAX_ROWS;
  const hint = readabilityHint(project);
  const listRef = useRef(null);
  const [editing, setEditing] = useState(false);
  /* Строку взяли на табло (щелчком, написать или выбрать значок) — её страница открывается сама; при входе — список. */
  const seen = useRef(index);
  useEffect(() => {
    if (seen.current !== index && index >= 0) setEditing(true);
    seen.current = index;
  }, [index]);
  useEffect(() => {
    if (focus && Number.isInteger(focus.index) && focus.index >= 0) setEditing(true);
  }, [focus]);
  /* Строку выбрали в кадре — список доезжает до неё. */
  useEffect(() => {
    listRef.current?.querySelector?.('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [index]);
  const row = index >= 0 ? project.rows[index] : null;
  if (editing && row)
    return (
      <PanelPage label={`${index + 1}. ${rowTitle(row)}`} backLabel={tr("Ко всем строкам")} onBack={() => setEditing(false)}>
        <RowEditor row={row} index={index} onRow={onRow} onNotice={onNotice} focus={focus} />
        <ActionRows
          actions={rowActions({
            project,
            index,
            onMove,
            onDuplicate,
            onRowReset,
            onRemove: (at) => {
              setEditing(false);
              onRemove(at);
            },
          })}
        />
      </PanelPage>
    );
  const groups = [];
  for (let column = 0; column * lines < count; column += 1) groups.push(column);
  return (
    <>
      {/* Заголовка «Строки» нет — это имя панели; «?» и раскладка — у группы первой колонки. */}
      <div ref={listRef}>
        {groups.map((column) => {
          const label = columnLabel(column, columns);
          const start = column * lines;
          const members = project.rows.slice(start, start + lines);
          return (
            <ListGroup
              key={column}
              title={label || ""}
              label={label || tr("Строки табло")}
              help={
                column === 0
                  ? [
                      tr("Дважды по строке на табло — и пишите прямо на ней; потяните строку — переставить. Свои строки — «Добавить строку»."),
                      tr("Скрытая строка держит своё место пустым — за ней видно то, что за табло. Чтобы строки сомкнулись, удалите её. Длинное название сжимается, чтобы не наехать на время."),
                      full ? `Больше ${rowsText(SCHEDULE_MAX_ROWS)} табло не вместит` : "",
                    ]
                  : null
              }
            >
              {members.map((item, offset) => {
                const at = start + offset;
                return (
                  <RowItem
                    key={`row-${at}`}
                    row={item}
                    index={at}
                    selected={at === index}
                    onSelect={(next) => {
                      onSelect(next);
                      setEditing(true);
                    }}
                  />
                );
              })}
            </ListGroup>
          );
        })}
        {!full && (
          <ListGroup label={tr("Добавить строку")}>
            <NavRow icon={<Plus />} title={tr("Добавить строку")} trailing={null} onOpen={() => onAdd()} />
          </ListGroup>
        )}
      </div>
      {/* Сколько строк и колонок и какой высоты буквы — подписью «Раскладки», одной строкой состояния. */}
      <Section title={tr("Раскладка")} label={tr("Раскладка табло")} note={layoutText(project)} help={hint.warning ? null : hint.text}>
        <SegmentedControl label={tr("Колонки")} size="sm" options={COLUMN_OPTIONS} value={project.columns} onChange={onColumns} />
        {hint.warning && <p className="fx-hint is-warning">{hint.text}</p>}
      </Section>
      <PlacesSection placeId={placeId} onPlace={onPlace} />
      <ActionRows
        actions={[
          !rowsAreServer(project) && { id: "rows-server", label: tr("Строки как на сервере"), title: tr("Шестнадцать строк сервера на своих местах; цвета, шрифт и заголовок остаются"), onClick: onRowsReset },
        ]}
      />
    </>
  );
}

function TitleSection({ project, onPatch, onNotice, focus }) {
  useTr();
  const titleRef = useRef(null);
  useEffect(() => {
    if (focus?.target !== "title") return;
    titleRef.current?.focus();
    titleRef.current?.select?.();
  }, [focus]);
  const text = { font: project.font, ...(project.font === "custom" ? { fontAsset: project.fontAsset, fontName: project.fontName } : {}) };
  const edit = {
    patchText: (values, label) => {
      const font = values.font ?? project.font;
      onPatch({ font, ...(font === "custom" ? { fontAsset: values.fontAsset ?? project.fontAsset, fontName: values.fontName ?? project.fontName } : {}) }, label);
    },
  };
  return (
    <>
      {/* Подпись одна — у поля «Заголовок»; раздел без своего заголовка: «Заголовок табло» над полем «Заголовок» читался
          повтором (п. 17, четвёртый круг критика 31.10.2026), а имя панели — «Заголовок и шрифт». */}
      <Section label={tr("Заголовок табло")}>
        <TextField
          label={tr("Заголовок")}
          inputRef={titleRef}
          value={project.title}
          maxLength={SCHEDULE_LIMITS.title}
          placeholder={tr("Пусто — без заголовка")}
          onChange={(title) => onPatch({ title }, "Заголовок")}
        />
      </Section>
      <Section
        title={tr("Шрифт табло")}
        label={tr("Шрифт табло")}
        help={[tr("Буквы табло сервера — сетки его модели, а не шрифт: своё табло пишет выбранным шрифтом. Шрифт как у сервера — свой файл шрифта (TTF, OTF, WOFF)."), tr("Растяжка по горизонтали: у сервера буквы широкие")]}
      >
        <FontControls text={text} edit={edit} onNotice={onNotice} sourceRows />
        <Slider
          label={tr("Ширина букв")}
          value={project.letters}
          min={SCHEDULE_LIMITS.letters[0]}
          max={SCHEDULE_LIMITS.letters[1]}
          step={1}
          format={percentText}
          onChange={(letters) => onPatch({ letters }, "Ширина букв")}
        />
        <SwitchLine checked={project.upper} label={tr("Заглавными буквами")} onChange={(upper) => onPatch({ upper }, upper ? tr("Заглавными буквами") : tr("Как написано"))} />
      </Section>
    </>
  );
}

/*
 * Цвета табло — тремя короткими разделами, как цвета слоёв «Большой карты»
 * (18.10.2026, владелец: «в цветах там пиздец, перегружено»): буквы, строки,
 * само табло (фон и рамка). Прежде девять полей стояли одним столбцом с кодом в рамке у каждого.
 */
const COLOUR_GROUPS = Object.freeze([
  ["Буквы", ["title", "text", "time"]],
  ["Строки", ["plate", "accent", "box", "icon"]],
  ["Табло", ["background", "outline"]],
]);

function ColoursSection({ project, onColour, onPatch }) {
  useTr();
  return (
    <>
      {COLOUR_GROUPS.map(([title, keys], index) => (
        <Section
          key={title}
          title={tr(title)}
          label={index === 0 ? tr("Цвета табло") : `${tr("Цвета табло")}: ${tr(title).toLowerCase()}`}
          help={COLOUR_FIELDS.filter((field) => keys.includes(field.key) && field.hint).map((field) => `${tr(field.label)}: ${tr(field.hint)}`)}
        >
          {COLOUR_FIELDS.filter((field) => keys.includes(field.key)).map((field) => (
            <ColorField
              key={field.key}
              /* Подписи — константы модуля: переводом здесь, иначе имя поля
                 (`aria-label` у `input`) оставалось русским (дизайн 12.10). */
              label={tr(field.label)}
              value={project.colours[field.key]}
              swatches={SCHEDULE_SWATCHES}
              editable
              onChange={(colour) => onColour(field.key, colour)}
            />
          ))}
        </Section>
      ))}
      {/* Ползунка свечения табло нет (владелец 30.10.2026: «бесполезная функция»): свечение шаблона снимает строка внизу. */}
      <ActionRows
        actions={[
          JSON.stringify(project.colours) !== JSON.stringify(SCHEDULE_SERVER_COLOURS) && { id: "colours-server", label: tr("Цвета как на сервере"), onClick: () => onPatch({ colours: SCHEDULE_SERVER_COLOURS }, "Цвета как на сервере") },
          project.glow !== SERVER_GLOW && { id: "glow-server", label: tr("Вернуть яркость как в игре"), onClick: () => onPatch({ glow: SERVER_GLOW }, "Свечение") },
        ]}
      />
    </>
  );
}

function OpacitySection({ project, onOpacity, onPatch }) {
  useTr();
  const hint = opacityHint(project);
  return (
    <>
    <Section
      title=""
      label={tr("Прозрачность табло")}
      help={[hint.warning ? "" : hint.text, ...OPACITY_FIELDS.filter((field) => field.hint).map((field) => `${tr(field.label)}: ${tr(field.hint)}`)]}
    >
      {OPACITY_FIELDS.map((field) => (
        <Slider
          key={field.key}
          label={tr(field.label)}
          value={project.opacity[field.key]}
          min={SCHEDULE_LIMITS.opacity[0]}
          max={SCHEDULE_LIMITS.opacity[1]}
          step={1}
          format={percentText}
          onChange={(value) => onOpacity(field.key, value)}
        />
      ))}
      {/* На виду — только предупреждение; что значат проценты — за «?». Вернуть нечего — кнопки нет (слово владельца 29.10.2026). */}
      {hint.warning && <p className="fx-hint is-warning">{hint.text}</p>}
    </Section>
      <ActionRows
        actions={[
          JSON.stringify(project.opacity) !== JSON.stringify(SCHEDULE_SERVER_OPACITY) && {
            id: "server",
            label: tr("Как на сервере"),
            onClick: () => onPatch({ opacity: SCHEDULE_SERVER_OPACITY }, "Прозрачность как на сервере"),
          },
        ]}
      />
    </>
  );
}

function PlacesSection({ placeId, onPlace }) {
  useTr();
  return (
    <ListGroup title={tr("Где стоят")} label={tr("Места табло")} help={tr("Нажмите место — кадр покажет табло его размера")}>
      {SCHEDULE_PLACES.map((place) => (
        <NavRow
          key={place.id}
          className={place.id === placeId ? "is-selected" : ""}
          aria-pressed={place.id === placeId}
          icon={<MapPin />}
          title={place.district}
          trailing={null}
          onOpen={() => onPlace(place.id)}
        />
      ))}
    </ListGroup>
  );
}

export default function ScheduleInspector({
  tool = "rows",
  project,
  presetProject = project,
  row = 0,
  focus = null,
  onRowSelect,
  onRow,
  onAdd,
  onRemove,
  onDuplicate,
  onMove,
  onRowReset,
  onRowsReset,
  onColumns,
  onPatch,
  onColour,
  onOpacity,
  onPreset,
  onReset,
  isStock = false,
  placeId,
  onPlace,
  onNotice,
}) {
  useTr();
  let body;
  if (tool === "rows")
    body = (
      <RowsSection
        project={project}
        selected={row}
        focus={focus}
        onSelect={onRowSelect}
        onRow={onRow}
        onAdd={onAdd}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        onMove={onMove}
        onRowReset={onRowReset}
        onRowsReset={onRowsReset}
        onColumns={onColumns}
        onNotice={onNotice}
        placeId={placeId}
        onPlace={onPlace}
      />
    );
  else if (tool === "title") body = <TitleSection project={project} onPatch={onPatch} onNotice={onNotice} focus={focus} />;
  else if (tool === "colours") body = <ColoursSection project={project} onColour={onColour} onPatch={onPatch} />;
  else if (tool === "opacity") body = <OpacitySection project={project} onOpacity={onOpacity} onPatch={onPatch} />;
  else body = <SchedulePresets project={presetProject} onApply={onPreset} />;
  return (
    <div className="fx-inspector recolor-inspector">
      {body}
      {/* «Всё как на сервере» — строкой внизу и только когда есть что вернуть (правило 4 `design-qa.md`). */}
      <ActionRows
        actions={[tool !== "templates" && !isStock && { id: "all-server", label: tr("Всё как на сервере"), title: tr("Строки, заголовок и облик сервера — «Применить» снимет своё табло"), onClick: onReset }]}
      />
    </div>
  );
}
