/*
 * Панель «Групповых меток» — настройки взятого инструмента (мастерская «как в Photoshop»): метки с
 * видом выбранной и шаблоны со «Стандартом».
 *
 * Органы — из словаря (`components/ui`): метки — плитки `ChoiceTile`, вид метки — `ChoiceRadioGroup`
 * (одно из), цвет — `ColorField` с образцами и полем для числа, размер и прозрачность — `Slider`, обводка —
 * `SegmentedControl`, готовые виды — `PresetShelf`.
 * Первая строка панели — «Где работает»: честно, что в игре меняется этим листом, а что рисует сервер.
 *
 * Отделка (дополнение владельца 19.10.2026): надпись вместо метки, размер рисунка в листе, прозрачность, обводка
 * или свечение, тонировка картинки. Размер, с которым метку рисует сервер или скрипт игры, файлом не меняется —
 * панель говорит об этом словами.
 *
 * 19.10.2026, вечер (владелец: «в групповых метках облегчи функционал редактирования»): как «Большая карта» —
 * первая страница — метки строками по группам (рисунок, имя, что с ней сделано), строка открывает страницу метки
 * с её видом, а «Размер и обводка» — ещё одна страница внутри. Абзацы «Где работает» ушли в одну строку.
 */

import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CaretDown,
  Circle,
  CrosshairSimple,
  Flag,
  FlagBanner,
  House,
  MapPin,
  MapPinSimple,
  Skull,
  SuitcaseSimple,
  Target,
  UploadSimple,
  Warning,
} from "../../../components/ui/icons.jsx";
import {
  GROUP_MARKER_DEFAULT_COLOUR,
  GROUP_MARKER_DEFAULT_FONT,
  GROUP_MARKER_DEFAULT_TEXT_COLOUR,
  GROUP_MARKER_FINISH_LIMITS,
  GROUP_MARKER_GROUPS,
  GROUP_MARKER_OUTLINE_COLOUR,
  GROUP_MARKER_TEXT_LIMITS,
  cleanGroupMarkerText,
  groupMarkerFinishOf,
  hasGroupMarkerFinish,
} from "@modovik/minimap-contract/group-markers";
import Button from "../../../components/ui/Button.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import SectionHeading from "../section-help.jsx";
import ChoiceRadioGroup from "../../../components/ui/ChoiceRadioGroup.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import PresetShelf, { PresetMarks } from "../../../components/ui/PresetShelf.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import FontSources from "../emblem/FontSources.jsx";
import { ownFontStack } from "../emblem/own-font.js";
import { GROUP_MARKER_FONT_LIST, groupMarkerCssFont } from "./group-markers-fonts.js";
import { EDITOR_GROUP_MARKERS, GROUP_MARKERS_PRESETS, groupMarkersProjectIsStock, matchingGroupMarkersPreset } from "./group-markers-project.js";
import { GROUP_MARKER_PICTURE_TYPES } from "./group-markers-pictures.js";
import { gifPlaysText } from "./group-markers-text.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

const SWATCHES = Object.freeze([GROUP_MARKER_DEFAULT_COLOUR, "#e8202a", "#ff7a00", "#2bd96b", "#22d3ee", "#2f6bff", "#a44cf2", "#ff2bd6", "#f0f0f0"]);
const TEXT_SWATCHES = Object.freeze([GROUP_MARKER_DEFAULT_TEXT_COLOUR, GROUP_MARKER_DEFAULT_COLOUR, "#e8202a", "#ff7a00", "#2bd96b", "#22d3ee", "#2f6bff", "#ff2bd6", "#000000"]);
const OUTLINE_SWATCHES = Object.freeze([GROUP_MARKER_OUTLINE_COLOUR, "#ffffff", GROUP_MARKER_DEFAULT_COLOUR, "#e8202a", "#22d3ee", "#2bd96b", "#ff2bd6"]);
const TEXT_DEBOUNCE_MS = 300;
/* Свечение по умолчанию светлое (на тёмном фоне кадра чёрное не видно), обводка — тёмная, как у меток игры. */
const GLOW_COLOUR = "#ffffff";

/* Цвет при смене вида: свой остаётся, умолчание прежнего вида (чёрное ↔ белое) заменяется умолчанием нового. */
function outlineColourFor(kind, outline) {
  const own = outline?.color;
  const wanted = kind === "glow" ? GLOW_COLOUR : GROUP_MARKER_OUTLINE_COLOUR;
  const other = kind === "glow" ? GROUP_MARKER_OUTLINE_COLOUR : GLOW_COLOUR;
  return !own || (outline.kind !== kind && own === other) ? wanted : own;
}

/* Пояснение раздела — под «?» у заголовка (`help`), не абзацем в колонке (ТЗ 29.10.2026). */
function Section({ id, title, help = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={title} data-group-markers-section={id}>
      <SectionHeading title={title} help={help} />
      {children}
    </section>
  );
}

/* Что с меткой сделано — подпись строки; у штатной подписи нет (design-qa.md, п. 17: «как в игре» ×10 подряд — шум). */
function markState(edit) {
  if (!edit) return "";
  if (edit.mode === "hidden") return tr("убрана");
  if (edit.mode === "image") return tr("своя картинка");
  if (edit.mode === "text") return tr("надпись");
  if (edit.mode === "colour") return tr("свой цвет");
  return tr("с правкой");
}

/*
 * Знак метки на плашке строки, пока листа игры под окном нет (критик 31.10.2026: строки одним текстом, без значка): у каждой метки свой
 * знак того, что на ней нарисовано. Есть лист игры — на плашке его рисунок.
 */
const MARK_GLYPHS = Object.freeze({
  warning: Warning,
  ring: Target,
  "ring-blue": CrosshairSimple,
  chevron: CaretDown,
  arrow: ArrowRight,
  corona: Circle,
  skull: Skull,
  case: SuitcaseSimple,
  "race-target": FlagBanner,
  base: House,
  pin: MapPin,
  flag: Flag,
});

/* Строка метки: знак, имя, что с ней сделано; выбранная (та, что в кадре) — подложкой выбора, как взятая строка списка (п. 3). */
function MarkRow({ mark, preview, edit, selected = false, onOpen }) {
  const Glyph = MARK_GLYPHS[mark.id] || MapPinSimple;
  return (
    <NavRow
      className={`group-markers-row${selected ? " is-selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      icon={preview ? <img className="group-markers-row-art" src={preview} alt="" /> : <Glyph aria-hidden="true" />}
      title={tr(mark.label)}
      caption={markState(edit)}
      data-mark={mark.id}
      onOpen={() => onOpen(mark.id)}
    />
  );
}

/* Образец шрифта — сами слова, как их нарисует метка. */
const FontTile = memo(function FontTile({ font, sample, selected, onSelect }) {
  return (
    <ChoiceTile
      className="group-markers-font"
      selected={selected}
      media={
        <span className="group-markers-font-sample" style={font.family ? { fontFamily: font.family } : groupMarkerCssFont(font.id)} lang="und" data-audit-ignore="caps">
          {sample}
        </span>
      }
      title={font.label}
      onClick={() => onSelect(font.id)}
    />
  );
});

/*
 * Надпись вместо метки: слова, шрифт и цвет. Окно рисует её PNG-ом (`onText`), установщик вписывает в лист как свою
 * картинку. Пока слов нет, метка в работе остаётся прежней: пустая надпись не «убирает» метку, а ничего не меняет.
 * Набранное уходит в окно через паузу, а не с каждой буквой: каждая правка — рисунок и шаг истории.
 */
function TextSection({ mark, edit, pictureError, onText, onClear }) {
  useTr();
  const own = edit?.mode === "text" ? edit : null;
  const [text, setText] = useState(own?.text || "");
  const [font, setFont] = useState(own?.font || GROUP_MARKER_DEFAULT_FONT);
  /* Свой шрифт: ключ файла и имя — вместе с надписью; остаются, когда выбран шрифт набора. */
  const [fontAsset, setFontAsset] = useState(own?.fontAsset || "");
  const [fontName, setFontName] = useState(own?.fontName || "");
  const [fontError, setFontError] = useState("");
  const fontSpec = (patch) => ({ text, font, color, ...(fontAsset ? { fontAsset, fontName } : {}), ...patch });
  const [color, setColor] = useState(own?.color || GROUP_MARKER_DEFAULT_TEXT_COLOUR);
  const pending = useRef(null);
  const timer = useRef(0);
  const push = (spec) => {
    pending.current = null;
    if (!cleanGroupMarkerText(spec.text)) onClear(mark.id);
    else onText(mark.id, spec);
  };
  const schedule = (spec) => {
    pending.current = spec;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => push(spec), TEXT_DEBOUNCE_MS);
  };
  /* Ушли к другой метке, не дождавшись паузы, — то, что набрано, не пропадает. */
  const flush = useRef(null);
  flush.current = () => {
    window.clearTimeout(timer.current);
    if (pending.current) push(pending.current);
  };
  useEffect(() => () => flush.current?.(), []);
  const sample = cleanGroupMarkerText(text).split("\n")[0] || tr("Надпись");
  return (
    <>
      <TextField
        label={tr("Надпись")}
        value={text}
        multiline
        rows={2}
        lang="und"
        maxLength={GROUP_MARKER_TEXT_LIMITS.chars}
        spellCheck={false}
        placeholder={tr("Например, ЦЕЛЬ")}
        onChange={(value) => {
          setText(value);
          schedule(fontSpec({ text: value }));
        }}
      />
      <h4 className="group-markers-subhead">{tr("Шрифт надписи")}</h4>
      <div className="ui-choice-grid group-markers-fonts" role="group" aria-label={tr("Шрифт надписи")}>
        {[...GROUP_MARKER_FONT_LIST, ...(fontAsset ? [{ id: "custom", label: fontName || tr("Свой шрифт"), family: ownFontStack(fontAsset, "Impact, sans-serif") }] : [])].map((item) => (
          <FontTile
            key={item.id}
            font={item}
            sample={sample}
            selected={font === item.id}
            onSelect={(id) => {
              setFont(id);
              window.clearTimeout(timer.current);
              push(fontSpec({ font: id }));
            }}
          />
        ))}
      </div>
      {/* Свой шрифт — файлом или из установленных на ПК (ТЗ 23.10.2026, п. F). */}
      <FontSources
        onFont={(picked) => {
          setFontError("");
          setFontAsset(picked.fontAsset);
          setFontName(picked.fontName);
          setFont("custom");
          window.clearTimeout(timer.current);
          push({ text, font: "custom", color, fontAsset: picked.fontAsset, fontName: picked.fontName });
        }}
        onNotice={(message) => setFontError(message)}
      />
      {fontError && <p className="fx-hint">{fontError}</p>}
      <ColorField
        label={tr("Цвет надписи")}
        value={color}
        swatches={TEXT_SWATCHES}
        editable
        onChange={(value) => {
          setColor(value);
          schedule(fontSpec({ color: value }));
        }}
      />
      {pictureError && <p className="fx-hint">{pictureError}</p>}
    </>
  );
}

/*
 * Размер, обводка или свечение, прозрачность и — у картинки — тонировка. Это отделка листа метки (`finishMark`): то
 * же правило считает предпросмотр и установщик. Размер, с которым метку рисует сервер или скрипт игры, файлом листа
 * не меняется — меняется рисунок внутри листа.
 */
function FinishSection({ mark, edit, mode, onFinish, onResetFinish }) {
  useTr();
  const finish = groupMarkerFinishOf(edit);
  const outline = finish.outline || null;
  const limits = GROUP_MARKER_FINISH_LIMITS;
  return (
    <>
    <Section
      id="finish"
      title={tr("Размер и обводка")}
      help={[
        tr("Размер — это рисунок внутри листа метки: меньше — вокруг прозрачные поля, больше — рисунок уходит к краям листа и обрезается. Размер, с которым метку рисует сервер или скрипт игры, файлом не меняется."),
        outline ? tr("Обводка и свечение помещаются в лист: рисунок для них слегка уменьшается.") : "",
        mode === "image" && finish.tint ? tr("Тонировка умножает картинку на цвет: светлое окрасится, тёмное останется тёмным.") : "",
      ]}
    >
      <Slider
        label={tr("Размер")}
        value={finish.scale ?? limits.scale.fallback}
        min={limits.scale.min}
        max={limits.scale.max}
        step={limits.scale.step}
        unit="%"
        onChange={(value) => onFinish({ scale: value }, "Размер метки")}
      />
      <Slider
        label={tr("Непрозрачность")}
        value={finish.opacity ?? limits.opacity.fallback}
        min={limits.opacity.min}
        max={limits.opacity.max}
        step={limits.opacity.step}
        unit="%"
        onChange={(value) => onFinish({ opacity: value }, "Прозрачность метки")}
      />
      <SegmentedControl
        label={tr("Обводка")}
        value={outline?.kind || "none"}
        options={[
          { value: "none", label: tr("Нет") },
          { value: "outline", label: tr("Обводка") },
          { value: "glow", label: tr("Свечение") },
        ]}
        onChange={(kind) =>
          onFinish(
            { outline: kind === "none" ? null : { kind, color: outlineColourFor(kind, outline), width: outline?.width || limits.outline.fallback } },
            "Обводка метки",
          )
        }
      />
      {outline && (
        <>
          <ColorField
            label={tr("Цвет обводки")}
            value={outline.color}
            swatches={OUTLINE_SWATCHES}
            editable
            onChange={(color) => onFinish({ outline: { ...outline, color } }, "Цвет обводки")}
          />
          <Slider
            label={tr("Ширина обводки")}
            value={outline.width}
            min={limits.outline.min}
            max={limits.outline.max}
            step={limits.outline.step}
            onChange={(width) => onFinish({ outline: { ...outline, width } }, "Ширина обводки")}
          />
        </>
      )}
      {mode === "image" && (
        <>
          <SegmentedControl
            label={tr("Цвет картинки")}
            value={finish.tint ? "tint" : "none"}
            options={[
              { value: "none", label: tr("Как есть") },
              { value: "tint", label: tr("Тонировать") },
            ]}
            onChange={(next) => onFinish({ tint: next === "tint" ? finish.tint || GROUP_MARKER_DEFAULT_COLOUR : null }, "Тонировка картинки")}
          />
          {finish.tint && (
            <>
              <ColorField label={tr("Цвет тонировки")} value={finish.tint} swatches={SWATCHES} editable onChange={(tint) => onFinish({ tint }, "Тонировка картинки")} />
            </>
          )}
        </>
      )}
    </Section>
      {/* Сбросить — внизу и только когда есть что: неактивной кнопки нет. */}
      <ActionRows actions={[hasGroupMarkerFinish(edit) && { id: "reset-finish", label: tr("Сбросить размер и обводку"), onClick: () => onResetFinish(mark.id) }]} />
    </>
  );
}

function MarksTool({ project, markId, previews, picture, pictureBusy, pictureError, animated, gameFound, failure, onSelect, onEdit, onPicture, onText }) {
  useTr();
  const language = useUiLanguage();
  const fileRef = useRef(null);
  const mark = EDITOR_GROUP_MARKERS.find((item) => item.id === markId) || EDITOR_GROUP_MARKERS[0];
  const edit = project.marks[mark.id] || null;
  /* «Текст», выбранный до первых слов: правки ещё нет, а вид уже выбран — панель не прыгает назад. */
  const [wantText, setWantText] = useState(() => new Set());
  const textChosen = wantText.has(mark.id);
  const [page, setPage] = useState("list");
  const mode = edit?.mode === "text" || (textChosen && (!edit || edit.mode === "stock")) ? "text" : edit?.mode || "stock";
  const finish = groupMarkerFinishOf(edit);
  /* Своя картинка метки — только у вида «Картинка»: картинка надписи своей не считается. */
  const imageAsset = edit?.mode === "image" ? edit.asset : "";
  /* Вид — коротко, без строки пояснения под каждым: что делает вид, видно в кадре сразу. */
  const options = [
    { value: "stock", title: tr("Как в игре") },
    { value: "colour", title: tr("Свой цвет") },
    { value: "image", title: tr("Своя картинка") },
    ...(mark.overlay ? [] : [{ value: "text", title: tr("Надпись") }]),
    { value: "hidden", title: tr("Убрать") },
  ];
  const keep = (next) => ({ ...finish, ...next });
  const forget = (id) =>
    setWantText((current) => {
      if (!current.has(id)) return current;
      const copy = new Set(current);
      copy.delete(id);
      return copy;
    });
  const onMode = (next) => {
    if (next === "image" && !imageAsset) {
      forget(mark.id);
      fileRef.current?.click();
      return;
    }
    if (next === "text") {
      /* Слов ещё нет: метка — штатная (с отделкой, если она была), пока их не напишут; вид «Надпись» уже выбран. */
      setWantText((current) => new Set(current).add(mark.id));
      if (edit && edit.mode !== "text") onEdit(mark.id, Object.keys(finish).length ? { mode: "stock", ...finish } : null, "Надпись метки");
      return;
    }
    forget(mark.id);
    if (next === "stock") onEdit(mark.id, Object.keys(finish).length ? { mode: "stock", ...finish } : null, "Как в игре");
    else if (next === "hidden") onEdit(mark.id, { mode: "hidden" }, "Убрать метку");
    else if (next === "colour") onEdit(mark.id, { mode: "colour", color: edit?.color || GROUP_MARKER_DEFAULT_COLOUR, ...keep({}) }, "Цвет метки");
    else onEdit(mark.id, { mode: "image", asset: imageAsset, name: edit.name || "", animated: edit.animated === true, ...keep({}) }, "Картинка метки");
  };
  /* Слова стёрты: метка снова штатная (с отделкой, если она была) — а вид «Надпись» остаётся выбранным. */
  const onClearText = (id) => onEdit(id, Object.keys(finish).length ? { mode: "stock", ...finish } : null, "Надпись метки");
  const onFinish = (patch, label) => onEdit(mark.id, { ...(edit || { mode: "stock" }), ...patch }, label);
  const onResetFinish = (id) => {
    if (!edit) return;
    const { scale: _scale, opacity: _opacity, outline: _outline, tint: _tint, ...rest } = edit;
    onEdit(id, rest.mode === "stock" ? null : rest, "Размер метки");
  };
  const showFinish = !mark.overlay && mode !== "hidden";
  /* Первая страница — список меток; метка — своя страница, «Размер и обводка» — страница в ней. */
  if (page === "list")
    return (
      <>
        {GROUP_MARKER_GROUPS.filter((group) => EDITOR_GROUP_MARKERS.some((item) => item.group === group.id)).map((group, index) => (
          <ListGroup
            key={group.id}
            data-group-markers-section={`group-${group.id}`}
            title={tr(group.label)}
            /* Где работает и откуда рисунки — под «?» первой группы, а не абзацем над списком. */
            help={
              index === 0
                ? [tr("Меняются метки игры. Серверную метку со своей картинкой файлом игры не поменять."), gameFound ? "" : `${tr("Листов меток из вашей игры под окном нет — рисунки ниже нарисованы Astral, а не взяты из вашей GTA V.")}${failure ? ` (${failure})` : ""}`]
                : null
            }
          >
            {EDITOR_GROUP_MARKERS.filter((item) => item.group === group.id).map((item) => (
              <MarkRow
                key={item.id}
                mark={item}
                preview={previews.get(item.id)}
                edit={project.marks[item.id] || null}
                selected={item.id === mark.id}
                onOpen={(id) => {
                  onSelect(id);
                  setPage("mark");
                }}
              />
            ))}
          </ListGroup>
        ))}
      </>
    );
  if (page === "finish" && showFinish)
    return (
      <PanelPage label={tr("Размер и обводка")} backLabel={tr(mark.label)} onBack={() => setPage("mark")}>
        <FinishSection mark={mark} edit={edit} mode={mode} onFinish={onFinish} onResetFinish={onResetFinish} />
      </PanelPage>
    );
  return (
    <PanelPage label={tr(mark.label)} backLabel={tr("Ко всем меткам")} onBack={() => setPage("list")}>
      <Section
        id="look"
        title={tr("Вид метки")}
        help={[
          mark.note ? tr(mark.note) : "",
          mode === "text" ? tr("До 60 знаков, до трёх строк. Длинную надпись разбейте на строки — так она выйдет крупнее.") : "",
          mode === "text" ? tr("Слова рисуются картинкой и вписываются в лист метки по ширине; размер, обводка и прозрачность — ниже.") : "",
          mark.overlay ? tr("Накладка радара лежит в minimap.gfx, общем с «Мини-картой»: обе работы живут в нём вместе, в каком порядке их ни применяй.") : "",
          mark.overlay ? tr("Размер, обводка и надпись есть у листов меток; у накладки радара — только цвет, «убрать» и картинка.") : "",
        ]}
      >
        <ChoiceRadioGroup label={tr("Вид метки")} className="group-markers-modes" value={mode} options={options} onChange={onMode} />
        {mode === "colour" && (
          <ColorField
            label={tr("Цвет метки")}
            value={edit?.color || GROUP_MARKER_DEFAULT_COLOUR}
            swatches={SWATCHES}
            editable
            onChange={(color) => onEdit(mark.id, { mode: "colour", color, ...keep({}) }, "Цвет метки")}
          />
        )}
        {mode === "text" && <TextSection key={mark.id} mark={mark} edit={edit} pictureError={pictureError} onText={onText} onClear={onClearText} />}
        <input
          ref={fileRef}
          className="lamp-picture-input"
          type="file"
          accept={GROUP_MARKER_PICTURE_TYPES.join(",")}
          aria-label={tr("Своя картинка метки")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onPicture?.(mark.id, file);
          }}
        />
        {mode === "image" && (
          <div className="lamp-picture-row">
            <span className="lamp-note">
              {pictureError
                ? pictureError
                : edit?.asset
                  ? picture
                    ? edit.name || tr("Своя картинка выбрана")
                    : tr("Своей картинки нет на этом компьютере — выберите файл заново")
                  : tr("Выберите картинку")}
            </span>
            <Button variant="ghost" size="sm" icon={<UploadSimple />} disabled={pictureBusy} onClick={() => fileRef.current?.click()}>
              {pictureBusy ? tr("Читаем…") : tr("Другая картинка")}
            </Button>
          </div>
        )}
        {mode === "image" && animated && (
          <p className="fx-hint">
            {mark.overlay
              ? edit?.strip
                ? gifPlaysText(language, edit.frames)
                : tr("Кадры гифки здесь не прочитались — в игру уедет первый кадр.")
              : tr("Это гифка: лист метки в игре — одна картинка, анимации у такой метки нет, в игру уедет первый кадр.")}
          </p>
        )}
      </Section>
      {showFinish && (
        <ListGroup label={tr("Размер и обводка")}>
          <NavRow
            className="group-markers-finish-row"
            title={tr("Размер и обводка")}
            caption={hasGroupMarkerFinish(edit) ? tr("с правкой") : ""}
            onOpen={() => setPage("finish")}
          />
        </ListGroup>
      )}
    </PanelPage>
  );
}

function TemplatesTool({ project, onPreset, onStandard }) {
  useTr();
  const matching = matchingGroupMarkersPreset(project);
  return (
    <>
      <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды групповых меток")} collapsible={false}>
        {GROUP_MARKERS_PRESETS.map((preset) => (
          <ChoiceTile
            key={preset.id}
            media={<PresetMarks marks={preset.colours.map((colour, index) => ({ key: `${preset.id}-${index}`, colour, label: tr("Цвет") }))} />}
            title={tr(preset.label)}
            /* Описание — подсказкой: под плиткой оно обрывалось «…» (п. 20). */
            tooltip={tr(preset.note)}
            selected={matching === preset.id}
            onClick={() => onPreset(preset)}
          />
        ))}
      </PresetShelf>
      {/* «Как в игре» — внизу и только когда есть что возвращать: неактивной кнопки нет. */}
      <ActionRows actions={[!groupMarkersProjectIsStock(project) && { id: "standard", label: tr("Как в игре"), title: tr("Все метки — как в игре одним шагом."), onClick: onStandard }]} />
    </>
  );
}

export default function GroupMarkersInspector({ tool, ...props }) {
  if (tool === "templates") return <TemplatesTool project={props.project} onPreset={props.onPreset} onStandard={props.onStandard} />;
  return <MarksTool {...props} />;
}
