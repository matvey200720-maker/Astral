/*
 * Панель редактора «Банкоматы» — настройки взятого инструмента (мастерская
 * «как в Photoshop»): цвет корпуса, рамки, металла и панели, клавиатура и
 * стекло; экран, вывеска и полоса логотипов (картинка или свой текст), лампа и
 * свечение; где банкоматы стоят на карте; шаблоны.
 *
 * Что правится — вкладка сверху: «Все» (облик всех банкоматов сразу) или
 * одна модель (тумба, синий, красный, Fleeca). У модели облик свой, если он
 * заведён; пока не заведён, модель берёт общий, и первая правка на её
 * вкладке заводит свой облик копией общего.
 *
 * Органы — из словаря (`components/ui`): цвета — `ColorField`, облик части
 * — `Select`, панель — общая отделка (`FinishField`) с полем цветовых
 * эффектов, числа — `Slider` с полем для числа, да/нет — `Switch`.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { UploadSimple } from "../../../components/ui/icons.jsx";
import {
  ATM_GLASS_STRENGTH,
  ATM_GLOW,
  ATM_PICTURE_DEFAULTS,
  ATM_TYPES,
  atmPlacementTotal,
  atmsProjectIsStock,
  changedAtmTypes,
  findAtmType,
} from "@modovik/climb-contract/recolor/atms";
import { EMBLEM_TEXT_FONT_LABELS, EMBLEM_TEXT_LIMIT } from "@modovik/climb-contract/recolor/emblems";
import { SLOT_LIMITS, normalizeSlotTransform } from "@modovik/climb-contract/recolor/arena-slots";
import Button from "../../../components/ui/Button.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import ChoiceRows from "../choice-rows.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import FinishField from "../finish/FinishField.jsx";
import { FINISH_IMAGE_ACCEPT, saveFinishImage, useFinishImage } from "../finish/finish-assets.js";
import StudioEntry from "../texture-studio/StudioEntry.jsx";
import FontSources from "../emblem/FontSources.jsx";
import AtmsPresets from "./AtmsPresets.jsx";
import { atmStudioSurface, placeAtmStudio } from "./atms-studio.js";
import {
  ATM_SWATCHES,
  ATMS_SCENE_URL,
  atmsChangeText,
  editedLook,
  partLabel,
  partsOfTarget,
  percentText,
  surfaceModeOptions,
  targetFollowsAll,
  targetGlows,
  targetLabel,
  typesWithoutPart,
} from "./atms-text.js";
import SectionHeading from "../section-help.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Щелчок по части в кадре: раздел части подъезжает и коротко обводится. Контекст — чтобы не тянуть `ref` и `flash` сквозь каждый раздел. */
const PickContext = createContext({ flash: "", refs: null });
const PICK_FRESH_MS = 1500;
const PICK_FLASH_MS = 1200;

function usePickedSection(focus) {
  const refs = useRef({});
  const [flash, setFlash] = useState("");
  useEffect(() => {
    /* Старый выбор (инструмент открыли заново) раздел не трогает. */
    if (!focus?.part || Date.now() - focus.at > PICK_FRESH_MS) return undefined;
    refs.current[focus.part]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setFlash(focus.part);
    const timer = setTimeout(() => setFlash(""), PICK_FLASH_MS);
    return () => clearTimeout(timer);
  }, [focus]);
  return useMemo(() => ({ flash, refs }), [flash]);
}

/* Пояснение раздела — под «?» у заголовка (`help`), не абзацем в колонке (ТЗ 29.10.2026). */
/* `label` — имя раздела для читалки, когда заголовка нет (его имя уже стоит в шапке страницы части, п. 17). */
function Section({ id, title = "", label = "", note = "", help = null, children }) {
  const { flash, refs } = useContext(PickContext);
  return (
    <section
      ref={(node) => {
        if (refs) refs.current[id] = node;
      }}
      className={`ui-panel fx-section recolor-section${flash === id ? " is-picked" : ""}`}
      aria-label={label || title}
      data-atms-section={id}
    >
      {(title || note || help) && <SectionHeading title={title} note={note} help={help} />}
      {children}
    </section>
  );
}

/* Эффекты по развёртке листа — как у остановок: полосе «линия» в метрах на листе нечего мерить. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

/* Шрифты текста на экране: системные шрифты окна (кадр и установка идут на одном компьютере). */
const TEXT_FONTS = Object.freeze(["modern", "block", "wide", "serif", "stencil", "script", "mono"]);
const TEXT_SWATCHES = Object.freeze(["#ffffff", "#f4f5f7", "#ffd400", "#3ae464", "#2f80ed", "#ea3c41", "#0a1c3a", "#000000"]);

const PART_HINTS = Object.freeze({
  body: "У настенных и Fleeca темнее образца. У тумбы — с бликами.",
  frame: "Рамка вокруг настенного банкомата: серые и белые полосы.",
  panel: "Панель с клавиатурой, щелью для карты и выдачей денег.",
  screen: "Экран светится сам днём и ночью. Меню в игре не поменять.",
  sign: "Вывеска. У тумбы — наклейка банков, у остальных светится.",
  strip: "Полоса банков под козырьком; у Fleeca — полоса ATM.",
  metal: "Детали Fleeca: блики и потёртости остаются, цвет ваш.",
  keyboard: "Клавиатура тумбы: цвет, ровный цвет или своя картинка.",
  lamp: "Лампочка у щели для карты. Светится вместе с вывеской.",
  glass: "Стекло непрозрачное: 0 % — как в игре, 100 % — весь оттенок.",
});

/* Один вид без части — короткой фразой; несколько — списком. */
const LACKS_ONE_TYPE = Object.freeze({ kiosk: "Нет у банкомата-тумбы" });

/* Своя часть: каких моделей она не касается — подсказка общей правки. */
function partHint(target, part) {
  const hint = tr(PART_HINTS[part]);
  const without = target === "all" ? typesWithoutPart(part) : [];
  if (without.length === 1 && LACKS_ONE_TYPE[without[0].id]) return `${hint} ${tr(LACKS_ONE_TYPE[without[0].id])}.`;
  return without.length ? `${hint} ${tr("Нет у")}: ${without.map((type) => tr(type.label)).join(", ")}.` : hint;
}

/* Свой облик модели: включён — правки только у неё; выключен — как у всех. */
/*
 * Свой облик модели — без выключателя (разбор критика 30.10.2026): первая правка на вкладке модели сама заводит ей свой облик
 * копией общего, а вернуть модель к общему — строка «Как у всех банкоматов» внизу, только когда облик свой.
 */
const ownAction = (project, target, onOwn) =>
  target !== "all" && !targetFollowsAll(project, target) && { id: "as-all", label: tr("Как у всех банкоматов"), onClick: () => onOwn(target, false) };

/*
 * Облик части строками с галкой (п. 13 и 16 `design-qa.md`): «Как в игре» — первой строкой, а не «Стандарт» в выпадающем списке.
 * Подписи — режимы части, у штатного — «Как в игре».
 */
function ModeRows({ title, value, modes, onChange }) {
  useTr();
  return (
    <ChoiceRows
      label={`${title}: ${tr("облик")}`}
      options={modes.map(([mode, label]) => ({ value: mode, label: mode === "standard" ? tr("Как в игре") : label }))}
      value={value}
      onChange={(mode) => onChange({ mode }, `${title}: облик`)}
    />
  );
}

/* Корпус и рамка: свой цвет — одной строкой «Цвет» (п. 16): кружок справа, палитра на месте, «×» — как в игре. Имя части — в шапке страницы. */
function ColourPart({ id, target, settings, onChange }) {
  useTr();
  const title = partLabel(id);
  return (
    <Section id={id} label={title} help={partHint(target, id)}>
      <ColourRow
        group
        label={`${title}: ${tr("цвет")}`}
        value={settings.mode === "colour" ? settings.colour : null}
        colours={ATM_SWATCHES}
        onChange={(colour) => onChange({ mode: "colour", colour }, `${title}: цвет`)}
        onClear={() => onChange({ mode: "standard" }, `${title}: как в игре`)}
      />
    </Section>
  );
}

/* Своя модель без своего облика: студия заводит его копией общего — как правка в колонке. */
function ownTarget(project, target) {
  const type = project.types[target];
  if (!type || type.own) return project;
  return { ...project, types: { ...project.types, [target]: { ...type, own: true, parts: project.all.parts, glow: project.all.glow } } };
}

/* Панель: общая отделка, свой цвет — полем эффектов; студия — тем же листом панели, что у остановок у их частей. */
function PanelPart({ target, settings, onChange, onNotice }) {
  useTr();
  const title = partLabel("panel");
  return (
    <Section id="panel" label={title}>
      <FinishField
        label={title}
        settings={settings}
        modes={surfaceModeOptions("panel")}
        swatches={ATM_SWATCHES}
        surface="sheet"
        studio={{
          id: `atms:${target}:panel:sheet`,
          title: `${tr("Банкоматы")} · ${title}`,
          /* Основа — лист панели из игры (у вкладки модели — её панель); живой вид — кадр банкоматов с этим листом из студии. */
          scene: ATMS_SCENE_URL,
          match: (info) => info.group === "panel" && (target === "all" || info.type === target),
          path: target === "all" ? ["all", "parts", "panel"] : ["types", target, "parts", "panel"],
          prepare: target === "all" ? null : (project) => ownTarget(project, target),
          hint: { part: "panel" },
        }}
        shadeLabel={tr("Светотень листа")}
        hints={{
          standard: partHint(target, "panel"),
          flat: tr("Рисунок листа убран: панель ровного цвета, без клавиатуры и надписей."),
        }}
        onNotice={onNotice}
        onChange={onChange}
        /* Отделка строками, «Как в игре» — первой строкой с галкой (п. 13 и 16 `design-qa.md`): выпадающего «Отделка [Стандарт ▾]» нет. */
        rows
      >
        {(settings.mode === "colour" || settings.mode === "flat") && (
          <ColourEffectField
            label={tr("Цвет")}
            subject={title}
            value={settings.look}
            swatches={ATM_SWATCHES}
            modes={settings.mode === "flat" ? ["solid"] : SHEET_EFFECTS}
            directionLabels={{ along: tr("Вдоль листа"), across: tr("Поперёк листа"), height: tr("Снизу вверх") }}
            hints={{ shimmer: tr("Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный.") }}
            onChange={(look, label) => onChange({ look }, label)}
          />
        )}
      </FinishField>
    </Section>
  );
}

const FIT_OPTIONS = Object.freeze([
  ["cover", "Заполнить"],
  ["contain", "Вписать"],
  ["stretch", "Растянуть"],
]);
const BACKGROUND_OPTIONS = Object.freeze([
  ["colour", "Цвет"],
  ["keep", "Как было"],
]);
const scaleText = (value) => `${Math.round(value * 100)} %`;

/* Миниатюра картинки части (своей или нарисованной из слов) с именем и размером. */
function ImagePreview({ image, name }) {
  const previewRef = useRef(null);
  const bitmap = useFinishImage(image.asset);
  useEffect(() => {
    const canvas = previewRef.current;
    const context = canvas?.getContext?.("2d");
    if (!canvas || !context || !bitmap) return;
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, (canvas.width - bitmap.width * scale) / 2, (canvas.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  }, [bitmap]);
  return (
    <div className="finish-image">
      <canvas ref={previewRef} width={96} height={64} aria-hidden="true" />
      <span>
        {/* Имя файла или слова человека: прописные в них — его, а не слово интерфейса. */}
        <b data-audit-ignore="caps">{name}</b>
        <small>
          {image.width} × {image.height}
        </small>
      </span>
    </div>
  );
}

/* Своя картинка места: загрузка, как вписать, размер и фон. */
function PictureControls({ title, settings, onChange, onNotice, autoOpen = false, studio = null }) {
  useTr();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const transform = settings.transform;
  /* Выбрали «Загрузить картинку» на быстрой кнопке — выбор файла открывается сразу. */
  useEffect(() => {
    if (autoOpen) input.current?.click();
    // Только при появлении: дальше — по кнопке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const saved = await saveFinishImage(file);
      onChange({ mode: "image", image: { ...settings.image, ...saved } }, `${title}: своя картинка`);
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    } finally {
      setBusy(false);
    }
  }
  const set = (values, label) => onChange({ transform: normalizeSlotTransform({ ...transform, ...values }, ATM_PICTURE_DEFAULTS) }, label);
  return (
    <div className="recolor-subsection">
      <input ref={input} type="file" accept={FINISH_IMAGE_ACCEPT} hidden onChange={pick} aria-label={`${title}: ${tr("своя картинка")}`} />
      {settings.image.asset ? (
        <ImagePreview image={settings.image} name={settings.image.name || tr("Своя картинка")} />
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        icon={<UploadSimple />}
        disabled={busy}
        title={tr("Любая картинка — логотип своего банка, заставка, фото. PNG, JPEG или WebP до 8 МБ. Картинка остаётся на этом компьютере: в код для друга она не едет.")}
        onClick={() => input.current?.click()}
      >
        {busy ? tr("Читаем картинку…") : settings.image.asset ? tr("Заменить картинку") : tr("Загрузить картинку")}
      </Button>
      {studio}
      {settings.image.asset && (
        <>
          <SegmentedControl
            label={`${title}: ${tr("как вписать картинку")}`}
            size="sm"
            options={FIT_OPTIONS.map(([value, label]) => ({ value, label: tr(label) }))}
            value={transform.fit}
            onChange={(fit) => set({ fit }, `${title}: как вписать`)}
          />
          <Slider
            label={tr("Размер картинки")}
            ariaLabel={`${title}: ${tr("размер картинки")}`}
            value={transform.scale}
            min={SLOT_LIMITS.scale[0]}
            max={SLOT_LIMITS.scale[1]}
            step={0.05}
            format={scaleText}
            onChange={(scale) => set({ scale }, `${title}: размер картинки`)}
          />
          <SegmentedControl
            label={`${title}: ${tr("фон вокруг картинки")}`}
            size="sm"
            options={BACKGROUND_OPTIONS.map(([value, label]) => ({ value, label: tr(label) }))}
            value={transform.background === "clear" ? "keep" : transform.background}
            onChange={(background) => set({ background }, `${title}: фон`)}
          />
          {transform.background === "colour" && (
            <ColorField
              label={tr("Цвет фона")}
              value={transform.backgroundColour}
              swatches={ATM_SWATCHES}
              editable
              onChange={(backgroundColour) => set({ backgroundColour }, `${title}: цвет фона`)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* Свой текст места: слова, шрифт, цвет букв и фон плашки; картинку из слов рисует окно (`atms-text-draw.js`). */
function TextControls({ title, settings, onChange, studio = null }) {
  useTr();
  const text = settings.text;
  const set = (patch, label) => onChange({ text: { ...text, ...patch } }, `${title}: ${label}`);
  return (
    <div className="recolor-subsection">
      <TextField
        label={tr("Текст")}
        value={text.value}
        maxLength={EMBLEM_TEXT_LIMIT}
        placeholder={tr("Например, название своего банка")}
        onChange={(value) => set({ value }, "текст")}
      />
      <Select
        label={tr("Шрифт")}
        ariaLabel={`${title}: ${tr("шрифт")}`}
        value={text.font}
        options={[...TEXT_FONTS.map((font) => [font, tr(EMBLEM_TEXT_FONT_LABELS[font])]), ...(text.fontAsset ? [["custom", `${tr("Свой шрифт")}: ${text.fontName || tr("шрифт")}`]] : [])]}
        onChange={(font) => set({ font }, "шрифт")}
      />
      {/* Свой шрифт — файлом или из установленных на ПК (ТЗ 23.10.2026, п. F). */}
      <FontSources onFont={(font) => set({ font: "custom", ...font }, "шрифт")} />
      <ColorField label={tr("Цвет букв")} value={text.colour} swatches={TEXT_SWATCHES} editable onChange={(colour) => set({ colour }, "цвет букв")} />
      <ColorField label={tr("Цвет фона")} value={text.backdrop} swatches={TEXT_SWATCHES} editable onChange={(backdrop) => set({ backdrop }, "цвет фона")} />
      {settings.image.asset ? (
        <ImagePreview image={settings.image} name={text.value.trim() || tr("Свой текст")} />
      ) : text.value.trim() ? (
        <p className="fx-hint">{tr("Рисуем надпись…")}</p>
      ) : null}
      {studio}
    </div>
  );
}

/* Экран, вывеска, полоса, клавиатура: «Стандарт», цвет, ровный цвет, картинка или свой текст. */
function PicturePart({ id, target, settings, project, onChange, onNotice }) {
  useTr();
  const title = partLabel(id);
  const modes = surfaceModeOptions(id);
  /* Пока облик «как в игре», картинка и текст — на виду двумя кнопками, а не только в списке. */
  const plain = settings.mode === "standard" || settings.mode === "colour" || settings.mode === "flat";
  const [opening, setOpening] = useState(false);
  const modeHelp = settings.mode === "colour" ? tr("Тон листа: надписи и светотень остаются, цвет — ваш.") : settings.mode === "flat" ? tr("Ровный цвет вместо рисунка листа.") : partHint(target, id);
  const textHelp = settings.mode === "text" && !settings.image.asset && !settings.text.value.trim() ? tr("Напишите слова — они встанут на экран, а фон закрасит остальное место.") : null;
  /* «Студия»: холст — лицо места, основа — лист игры; итог встаёт своей картинкой места. */
  const studio = (
    <StudioEntry
      key="studio"
      getSurface={() => atmStudioSurface({ target, part: id, settings, project })}
      onPlace={(blob) => placeAtmStudio(blob, { part: id, settings, onChange })}
      onNotice={(text, tone) => onNotice?.(text, tone)}
    />
  );
  return (
    <Section id={id} label={title} help={[modeHelp, textHelp]}>
      {/* «Своя картинка» и «Свой текст» — строки облика; выбор картинки сразу открывает файл. Студия — строкой, пока облик без картинки и текста. */}
      <ModeRows
        title={title}
        value={settings.mode}
        modes={modes}
        onChange={(patch, label) => {
          if (patch.mode === "image") setOpening(true);
          onChange(patch, label);
        }}
      />
      {plain && <ListGroup label={tr("Студия")}>{studio}</ListGroup>}
      {(settings.mode === "colour" || settings.mode === "flat") && (
        <ColorField label={tr("Цвет")} value={settings.colour} swatches={ATM_SWATCHES} editable onChange={(colour) => onChange({ colour }, `${title}: цвет`)} />
      )}
      {settings.mode === "image" && <PictureControls title={title} settings={settings} onChange={onChange} onNotice={onNotice} autoOpen={opening} studio={studio} />}
      {settings.mode === "text" && <TextControls title={title} settings={settings} onChange={onChange} studio={studio} />}
    </Section>
  );
}

/* Металл и лампа: «Стандарт», свой цвет тоном листа или ровный цвет. */
function PaintPart({ id, target, settings, onChange }) {
  useTr();
  const title = partLabel(id);
  return (
    <Section
      id={id}
      label={title}
      help={settings.mode === "colour" ? tr("Тон листа: надписи и светотень остаются, цвет — ваш.") : settings.mode === "flat" ? tr("Ровный цвет вместо рисунка листа.") : partHint(target, id)}
    >
      <ModeRows title={title} value={settings.mode} modes={surfaceModeOptions(id)} onChange={onChange} />
      {settings.mode !== "standard" && (
        <ColorField label={tr("Цвет")} value={settings.colour} swatches={ATM_SWATCHES} editable onChange={(colour) => onChange({ colour }, `${title}: цвет`)} />
      )}
    </Section>
  );
}

/* Стекло: «Стандарт» или оттенок нужной силы. */
function GlassPart({ target, settings, onChange }) {
  useTr();
  const title = partLabel("glass");
  return (
    <Section id="glass" label={title} help={partHint(target, "glass")}>
      {/* Оттенок — одной строкой (п. 16): «×» — стекло как в игре. */}
      <ColourRow
        group
        title={tr("Оттенок")}
        label={`${title}: ${tr("оттенок")}`}
        value={settings.mode === "colour" ? settings.colour : null}
        colours={ATM_SWATCHES}
        onChange={(colour) => onChange({ mode: "colour", colour }, `${title}: оттенок`)}
        onClear={() => onChange({ mode: "standard" }, `${title}: как в игре`)}
      />
      {settings.mode === "colour" && (
        <>
          <Slider
            label={tr("Сила оттенка")}
            ariaLabel={`${title}: ${tr("сила оттенка")}`}
            value={settings.strength}
            min={ATM_GLASS_STRENGTH.min}
            max={ATM_GLASS_STRENGTH.max}
            step={5}
            format={percentText}
            onChange={(strength) => onChange({ strength }, `${title}: сила оттенка`)}
          />
        </>
      )}
    </Section>
  );
}

/* «Стандарт» взятой вкладки: части и свечение — как в игре. */
function TargetStandard({ project, target, onOwn, onTargetStandard }) {
  useTr();
  const look = editedLook(project, target);
  const stock = look.glow === ATM_GLOW.standard && partsOfTarget(target).every((part) => look.parts[part].mode === "standard");
  /* Действие есть, только когда есть что снимать (ТЗ 29.10.2026, вечер). */
  return (
    <ActionRows
      actions={[
        ownAction(project, target, onOwn),
        !stock && !targetFollowsAll(project, target) && { id: "target-standard", label: tr("Как в игре"), onClick: () => onTargetStandard(target) },
      ]}
    />
  );
}

/*
 * Части банкомата — строками «имя · что стоит ›», каждая своей страницей
 * (18.10.2026, владелец: «Банкоматы — пиздец, перегружено», довести до
 * уровня «Большой карты»). Прежде все части стояли подряд одинаковыми
 * разделами «Облик · кнопки · абзац». Щелчок по части в кадре открывает её
 * страницу.
 */
function usePartPage(focus, parts) {
  const [page, setPage] = useState("");
  useEffect(() => {
    if (!focus?.part || Date.now() - focus.at > PICK_FRESH_MS) return;
    if (parts.includes(focus.part)) setPage(focus.part);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return [parts.includes(page) ? page : "", setPage];
}

/* Подпись — только у части не как в игре: шесть строк «Стандарт» подряд ничего не говорили (разбор критика 30.10.2026). */
const partModeText = (id, settings) => (settings?.mode === "standard" ? null : surfaceModeOptions(id).find(([mode]) => mode === settings?.mode)?.[1] || null);

function PartRows({ title, parts, look, onOpen, help = null }) {
  useTr();
  if (!parts.length) return null;
  return (
    <ListGroup title={title} help={help}>
      {parts.map((id) => (
        <NavRow key={id} title={partLabel(id)} caption={partModeText(id, look.parts[id])} data-atms-part={id} onOpen={() => onOpen(id)} />
      ))}
    </ListGroup>
  );
}

function PartPage({ id, target, onBack, children }) {
  useTr();
  return (
    <PanelPage label={partLabel(id)} note={target === "all" ? tr("Все банкоматы") : targetLabel(target)} backLabel={tr("Ко всем частям")} onBack={onBack}>
      {children}
    </PanelPage>
  );
}

const WORLD_HINT = "Банкоматы красятся в своих файлах моделей — других вещей у них нет, поэтому правка видна только на банкоматах: сразу на всех банкоматах модели по всему миру, вблизи и издалека. Один банкомат отдельно файлом не покрасить.";

const PAINT_PARTS = Object.freeze(["body", "frame", "metal", "panel", "keyboard", "glass"]);

function PaintTool({ project, target, focus, onSurface, onOwn, onTargetStandard, onTarget, onNotice }) {
  useTr();
  const look = editedLook(project, target);
  const parts = PAINT_PARTS.filter((id) => partsOfTarget(target).includes(id));
  const [page, setPage] = usePartPage(focus, parts);
  const change = (id) => (patch, label) => onSurface(target, id, patch, label);
  if (page)
    return (
      <PartPage id={page} target={target} onBack={() => setPage("")}>
        {(page === "body" || page === "frame") && <ColourPart id={page} target={target} settings={look.parts[page]} onChange={change(page)} />}
        {page === "metal" && <PaintPart id="metal" target={target} settings={look.parts.metal} onChange={change("metal")} />}
        {page === "panel" && <PanelPart target={target} settings={look.parts.panel} onNotice={onNotice} onChange={change("panel")} />}
        {page === "keyboard" && <PicturePart id="keyboard" target={target} settings={look.parts.keyboard} project={project} onNotice={onNotice} onChange={change("keyboard")} />}
        {page === "glass" && <GlassPart target={target} settings={look.parts.glass} onChange={change("glass")} />}
      </PartPage>
    );
  return (
    <>
      <PartRows title={tr("Части")} parts={parts} look={look} onOpen={setPage} help={tr(WORLD_HINT)} />
      {/* Где стоят банкоматы вкладки — строками мест прямо под частями (правило 12 `design-qa.md`, четвёртый круг критика 31.10.2026),
          а не переходом на свою страницу. */}
      <PlaceRows project={project} target={target} onTarget={onTarget} />
      <TargetStandard project={project} target={target} onOwn={onOwn} onTargetStandard={onTargetStandard} />
    </>
  );
}

const SCREEN_PARTS = Object.freeze(["screen", "sign", "strip", "lamp"]);

/* Экран банкомата — 4 : 3, как дисплей в модели; рамка пустого экрана в этой пропорции. */
const SCREEN_ASPECT = 4 / 3;

/*
 * Экран — первым блоком «Экрана и вывески» (правило 10 `design-qa.md`, слово владельца 30.10.2026): что стоит на экране сейчас,
 * во всю ширину; щелчок открывает выбор файла, файл можно бросить на колонку — картинка встаёт на экран сразу. Как вписать, размер,
 * фон и студия — на странице «Экрана».
 */
function ScreenPicture({ target, settings, onSurface, onNotice }) {
  useTr();
  const image = settings.mode === "image" && settings.image.asset ? settings.image : null;
  const url = useHangarEmblemUrl(image?.asset || "");
  async function take(file) {
    try {
      const saved = await saveFinishImage(file);
      onSurface(target, "screen", { mode: "image", image: { ...settings.image, ...saved } }, `${partLabel("screen")}: своя картинка`);
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    }
  }
  return (
    <SurfacePicture
      label={`${partLabel("screen")}: ${tr("своя картинка")}`}
      src={url}
      aspect={SCREEN_ASPECT}
      fit={settings.transform?.fit === "contain" ? "contain" : "cover"}
      caption={image ? `${image.name || tr("Своя картинка")} · ${image.width} × ${image.height}` : ""}
      hint={tr("Любая картинка — логотип своего банка, заставка, фото. PNG, JPEG или WebP до 8 МБ. Картинка остаётся на этом компьютере: в код для друга она не едет.")}
      accept={FINISH_IMAGE_ACCEPT}
      dropLabel={tr("Отпустите — встанет на экран")}
      onFile={take}
      /* «×» — экран как в игре (своё — всегда с «×», п. 21). */
      onClear={image ? () => onSurface(target, "screen", { mode: "standard" }, `${partLabel("screen")}: как в игре`) : null}
      clearLabel={tr("как в игре")}
    />
  );
}

function ScreenTool({ project, target, focus, onSurface, onGlow, onOwn, onNotice }) {
  useTr();
  const look = editedLook(project, target);
  const parts = SCREEN_PARTS.filter((id) => partsOfTarget(target).includes(id));
  const [page, setPage] = usePartPage(focus, parts);
  if (page)
    return (
      <PartPage id={page} target={target} onBack={() => setPage("")}>
        {page === "lamp" ? (
          <PaintPart id="lamp" target={target} settings={look.parts.lamp} onChange={(patch, label) => onSurface(target, "lamp", patch, label)} />
        ) : (
          <PicturePart id={page} target={target} settings={look.parts[page]} project={project} onNotice={onNotice} onChange={(patch, label) => onSurface(target, page, patch, label)} />
        )}
      </PartPage>
    );
  return (
    <>
      {parts.includes("screen") && <ScreenPicture target={target} settings={look.parts.screen} onSurface={onSurface} onNotice={onNotice} />}
      <PartRows title={tr("Части")} parts={parts} look={look} onOpen={setPage} />
      {/* Ползунка свечения нет (владелец 30.10.2026: «бесполезная функция»); прежнее значение проекта снимается строкой внизу. */}
      <ActionRows
        actions={[
          targetGlows(target) && look.glow !== ATM_GLOW.standard && { id: "glow-stock", label: tr("Вернуть яркость как в игре"), onClick: () => onGlow(target, ATM_GLOW.standard, "Свечение как в игре") },
          ownAction(project, target, onOwn),
        ]}
      />
    </>
  );
}

/*
 * Где стоят банкоматы вкладки (опись мира игры), строками с числом справа. На «Всех» — модели: щелчок берёт модель, как вкладка над
 * кадром, и кадр встаёт к ней; у модели — районы, где она стоит. Сколько всего и сколько в помещениях — строками той же группы.
 */
function PlaceRows({ project, target, onTarget }) {
  useTr();
  const type = findAtmType(target);
  const inside = type ? type.inside || 0 : ATM_TYPES.reduce((sum, item) => sum + (item.inside || 0), 0);
  const changed = changedAtmTypes(project)
    .filter((id) => !type || id === type.id)
    .reduce((sum, id) => sum + (findAtmType(id)?.placements || 0), 0);
  return (
    <ListGroup
      title={tr("Где стоят")}
      label={type ? `${tr("Где стоят")}: ${tr(type.label)}` : tr("Где стоят все банкоматы")}
      help={tr("Числа — по описи мира вашей игры: улицы, магазины, заправки и банк. Копии одного банкомата в картах-вариантах считаются одним. Правка меняет файл модели — изменятся все банкоматы этой модели сразу.")}
    >
      <ListRow title={tr("Всего на карте")} caption={changed ? atmsChangeText(changed) : null} trailing={type ? type.placements || 0 : atmPlacementTotal()} />
      {inside > 0 && <ListRow title={tr("В помещениях")} trailing={inside} />}
      {type
        ? type.districts.map(([name, count]) => <ListRow key={name} title={tr(name)} trailing={count} />)
        : ATM_TYPES.map((item) => <NavRow key={item.id} title={tr(item.label)} trailing={item.placements || 0} onOpen={() => onTarget?.(item.id)} />)}
    </ListGroup>
  );
}

export default function AtmsInspector({ tool, project, target, focus = null, onSurface, onGlow, onOwn, onTargetStandard, onTarget = null, onStandard, onPreset, onNotice }) {
  useTr();
  const pick = usePickedSection(focus);
  return (
    <PickContext.Provider value={pick}>
      <AtmsTool
        tool={tool}
        project={project}
        target={target}
        focus={focus}
        onSurface={onSurface}
        onGlow={onGlow}
        onOwn={onOwn}
        onTargetStandard={onTargetStandard}
        onTarget={onTarget}
        onStandard={onStandard}
        onPreset={onPreset}
        onNotice={onNotice}
      />
    </PickContext.Provider>
  );
}

function AtmsTool({ tool, project, target, focus, onSurface, onGlow, onOwn, onTargetStandard, onTarget, onStandard, onPreset, onNotice }) {
  useTr();
  /* Ключ по вкладке модели: другая модель — список частей с начала. */
  if (tool === "paint") return <PaintTool key={target} project={project} target={target} focus={focus} onSurface={onSurface} onOwn={onOwn} onTargetStandard={onTargetStandard} onTarget={onTarget} onNotice={onNotice} />;
  if (tool === "screen") return <ScreenTool key={target} project={project} target={target} focus={focus} onSurface={onSurface} onGlow={onGlow} onOwn={onOwn} onNotice={onNotice} />;
  return (
    <>
      <AtmsPresets project={project} onApply={onPreset} />
      <ActionRows
        actions={[
          !atmsProjectIsStock(project) && {
            id: "standard",
            label: tr("Как в игре"),
            title: tr("Все банкоматы как в игре одним шагом: цвета, картинки и свечение — штатные, свои облики моделей снимаются."),
            onClick: onStandard,
          },
        ]}
      />
    </>
  );
}
