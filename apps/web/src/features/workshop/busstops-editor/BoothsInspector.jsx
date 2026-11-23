/*
 * Панель «Будок» в редакторе «Остановки» (задача 11 ТЗ 18.10.2026) —
 * настройки взятого инструмента: цвет и текстура частей, шаблоны.
 *
 * Что правится — вкладка сверху: «Обе» (облик обеих будок сразу) или одна
 * будка. У будки облик свой, если он заведён; пока не заведён, она берёт общий,
 * и первая правка на её вкладке заводит свой облик копией общего.
 *
 * Органы — из словаря (`components/ui`): цвета — `ColorField`, облик части —
 * `Select`, крыша и пол — общая отделка (`FinishField`) с полем цветовых
 * эффектов, числа — `Slider` с полем для числа, да/нет — `Switch`.
 */

import { useEffect, useRef, useState } from "react";
import { UploadSimple } from "../../../components/ui/icons.jsx";
import { BOOTH_GLASS_STRENGTH, BOOTH_PICTURE_DEFAULTS, boothsAreStock, findBoothPart } from "@modovik/climb-contract/recolor/busstop-booths";
import { SLOT_LIMITS, normalizeSlotTransform } from "@modovik/climb-contract/recolor/arena-slots";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import ChoiceRows from "../choice-rows.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import FinishField from "../finish/FinishField.jsx";
import { FINISH_IMAGE_ACCEPT, saveFinishImage, useFinishImage } from "../finish/finish-assets.js";
import BoothsPresets from "./BoothsPresets.jsx";
import { PickContext, Section, usePickedSection } from "./BusStopsInspector.jsx";
import {
  BOOTH_SWATCHES,
  boothEditedLook,
  boothFollowsAll,
  boothPartLabel,
  boothPartsOfTarget,
  boothSurfaceModeOptions,
  percentText,
} from "./booths-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Эффекты по развёртке листа — как у остановок: полосе «линия» в метрах на листе нечего мерить. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

const PART_HINTS = Object.freeze({
  body: "Стены будки плиткой: цвет в игре — палитра тинта, рисунок плитки остаётся.",
  canopy: "Цветная полоса вверху и внизу будки — козырёк и цоколь: у игры это один цвет палитры на оба.",
  frame: "Рамы окон и двери, ребристая отделка — как в игре.",
  roof: "Крыша и потолок под козырьком — как в игре.",
  signs: "Крупные «24 HRS.» и «PARKING» на козырьке. Своя картинка встанет на место надписей.",
  notices: "Листки NOTICE и WARNING на стенах и табличка «только для клиентов». Своя картинка встанет на место листков.",
  glass: "Стёкла окон и двери — как в игре. Свой оттенок нужной силы ложится на стекло.",
  floor: "Пол плиткой — как в игре.",
});

/*
 * Свой облик будки — без выключателя (разбор критика 30.10.2026): первая правка на вкладке будки сама заводит ей свой облик,
 * вернуть будку к общему — строка «Как у обеих будок» внизу, только когда облик свой.
 */
const ownAction = (booths, target, onOwn) =>
  target !== "all" && !boothFollowsAll(booths, target) && { id: "as-all", label: tr("Как у обеих будок"), onClick: () => onOwn(target, false) };

/* Облик части строками с галкой (п. 13 и 16 `design-qa.md`): «Как в игре» — первой строкой, а не «Стандарт» в выпадающем списке. */
function ModeRows({ title, value, modes, onChange }) {
  useTr();
  return (
    <ChoiceRows
      label={`${title}: ${tr("облик")}`}
      options={modes.map(([mode, label]) => ({ value: mode, label: mode === "standard" ? tr("Как в игре") : tr(label) }))}
      value={value}
      onChange={(mode) => onChange({ mode }, `${title}: ${tr("облик")}`)}
    />
  );
}

/* Корпус, козырёк и рамы: свой цвет — одной строкой «Цвет» (п. 16): кружок справа, палитра на месте, «×» — как в игре. */
function ColourPart({ id, settings, onChange, extraHelp = null }) {
  useTr();
  const title = boothPartLabel(id);
  return (
    <Section id={id} title={title} help={[extraHelp, tr(PART_HINTS[id])]}>
      <ColourRow
        group
        label={`${title}: ${tr("цвет")}`}
        value={settings.mode === "colour" ? settings.colour : null}
        colours={BOOTH_SWATCHES}
        onChange={(colour) => onChange({ mode: "colour", colour }, `${title}: ${tr("цвет")}`)}
        onClear={() => onChange({ mode: "standard" }, `${title}: ${tr("как в игре")}`)}
      />
    </Section>
  );
}

/* Крыша и пол: общая отделка, свой цвет — полем эффектов. */
function FinishPart({ id, settings, onChange, onNotice, extraHelp = null }) {
  useTr();
  const title = boothPartLabel(id);
  return (
    <Section id={id} title={title} help={extraHelp}>
      <FinishField
        label={title}
        settings={settings}
        modes={boothSurfaceModeOptions(id)}
        swatches={BOOTH_SWATCHES}
        surface="sheet"
        shadeLabel={tr("Светотень листа")}
        hints={{
          standard: tr(PART_HINTS[id]),
          flat: tr("Рисунок листа убран: часть ровного цвета. Рельеф и блик остаются — их несут другие листы модели."),
        }}
        onNotice={onNotice}
        onChange={onChange}
        /* Отделка строками, «Как в игре» — первой строкой с галкой (п. 13 и 16 `design-qa.md`): выпадающего «Отделка [Стандарт ▾]» нет. */
        rows
        /* Часть уже названа заголовком раздела («Крыша», «Пол»): у строк своего имени нет. */
        title=""
      >
        {(settings.mode === "colour" || settings.mode === "flat") && (
          <ColourEffectField
            label={tr("Цвет")}
            subject={title}
            value={settings.look}
            swatches={BOOTH_SWATCHES}
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

/* Миниатюра картинки части с именем и размером. */
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
        {/* Имя файла человека: прописные в нём — его, а не слово интерфейса. */}
        <b data-audit-ignore="caps">{name}</b>
        <small>
          {image.width} × {image.height}
        </small>
      </span>
    </div>
  );
}

/* Своя картинка места: загрузка, как вписать, размер и фон. */
function PictureControls({ title, settings, onChange, onNotice, autoOpen = false }) {
  useTr();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const transform = settings.transform;
  /* Выбрали «Своя картинка» на быстрой кнопке — выбор файла открывается сразу. */
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
      onChange({ mode: "image", image: { ...settings.image, ...saved } }, `${title}: ${tr("своя картинка")}`);
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    } finally {
      setBusy(false);
    }
  }
  const set = (values, label) => onChange({ transform: normalizeSlotTransform({ ...transform, ...values }, BOOTH_PICTURE_DEFAULTS) }, label);
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
        title={tr("Любая картинка — своё название парковки, логотип, фото. PNG, JPEG или WebP до 8 МБ. Картинка остаётся на этом компьютере: в код для друга она не едет.")}
        onClick={() => input.current?.click()}
      >
        {busy ? tr("Читаем картинку…") : settings.image.asset ? tr("Заменить картинку") : tr("Загрузить картинку")}
      </Button>
      {settings.image.asset && (
        <>
          <SegmentedControl
            label={`${title}: ${tr("как вписать картинку")}`}
            size="sm"
            options={FIT_OPTIONS.map(([value, label]) => ({ value, label: tr(label) }))}
            value={transform.fit}
            onChange={(fit) => set({ fit }, `${title}: ${tr("как вписать")}`)}
          />
          <Slider
            label={tr("Размер картинки")}
            ariaLabel={`${title}: ${tr("размер картинки")}`}
            value={transform.scale}
            min={SLOT_LIMITS.scale[0]}
            max={SLOT_LIMITS.scale[1]}
            step={0.05}
            format={scaleText}
            onChange={(scale) => set({ scale }, `${title}: ${tr("размер картинки")}`)}
          />
          <SegmentedControl
            label={`${title}: ${tr("фон вокруг картинки")}`}
            size="sm"
            options={BACKGROUND_OPTIONS.map(([value, label]) => ({ value, label: tr(label) }))}
            value={transform.background === "clear" ? "keep" : transform.background}
            onChange={(background) => set({ background }, `${title}: ${tr("фон")}`)}
          />
          {transform.background === "colour" && (
            <ColorField
              label={tr("Цвет фона")}
              value={transform.backgroundColour}
              swatches={BOOTH_SWATCHES}
              editable
              onChange={(backgroundColour) => set({ backgroundColour }, `${title}: ${tr("цвет фона")}`)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* Надписи и листки: «Стандарт», цвет, ровный цвет или своя картинка. */
function PicturePart({ id, settings, onChange, onNotice, extraHelp = null }) {
  useTr();
  const title = boothPartLabel(id);
  const [opening, setOpening] = useState(false);
  const modeHelp =
    settings.mode === "colour" ? tr("Тон листа: надписи и светотень остаются, цвет — ваш.") : settings.mode === "flat" ? tr("Ровный цвет вместо рисунка листа.") : tr(PART_HINTS[id]);
  return (
    <Section id={id} title={title} help={[extraHelp, modeHelp]}>
      {/* Картинка — строкой облика; выбор сразу открывает файл. */}
      <ModeRows
        title={title}
        value={settings.mode}
        modes={boothSurfaceModeOptions(id)}
        onChange={(patch, label) => {
          if (patch.mode === "image") setOpening(true);
          onChange(patch, label);
        }}
      />
      {(settings.mode === "colour" || settings.mode === "flat") && (
        <ColorField label={tr("Цвет")} value={settings.colour} swatches={BOOTH_SWATCHES} editable onChange={(colour) => onChange({ colour }, `${title}: ${tr("цвет")}`)} />
      )}
      {settings.mode === "image" && <PictureControls title={title} settings={settings} onChange={onChange} onNotice={onNotice} autoOpen={opening} />}
    </Section>
  );
}

/* Стекло: «Стандарт» или оттенок нужной силы. */
function GlassPart({ settings, onChange, extraHelp = null }) {
  useTr();
  const title = boothPartLabel("glass");
  return (
    <Section id="glass" title={title} help={[extraHelp, tr(PART_HINTS.glass)]}>
      {/* Оттенок — одной строкой (п. 16): «×» — стекло как в игре. */}
      <ColourRow
        group
        title={tr("Оттенок")}
        label={`${title}: ${tr("оттенок")}`}
        value={settings.mode === "colour" ? settings.colour : null}
        colours={BOOTH_SWATCHES}
        onChange={(colour) => onChange({ mode: "colour", colour }, `${title}: ${tr("оттенок")}`)}
        onClear={() => onChange({ mode: "standard" }, `${title}: ${tr("как в игре")}`)}
      />
      {settings.mode === "colour" && (
        <>
          <Slider
            label={tr("Сила оттенка")}
            ariaLabel={`${title}: ${tr("сила оттенка")}`}
            value={settings.strength}
            min={BOOTH_GLASS_STRENGTH.min}
            max={BOOTH_GLASS_STRENGTH.max}
            step={5}
            format={percentText}
            onChange={(strength) => onChange({ strength }, `${title}: ${tr("сила оттенка")}`)}
          />
        </>
      )}
    </Section>
  );
}

/* «Стандарт» взятой вкладки: все части — как в игре. */
function TargetStandard({ booths, target, onOwn, onTargetStandard }) {
  useTr();
  const look = boothEditedLook(booths, target);
  const stock = boothPartsOfTarget(target).every((part) => look.parts[part].mode === "standard");
  /* Действие есть, только когда есть что снимать (ТЗ 29.10.2026, вечер). */
  return (
    <ActionRows
      actions={[
        ownAction(booths, target, onOwn),
        !stock && !boothFollowsAll(booths, target) && { id: "target-standard", label: tr("Как в игре"), onClick: () => onTargetStandard(target) },
      ]}
    />
  );
}

const PART_BY_KIND = Object.freeze({ colour: ColourPart, finish: FinishPart, picture: PicturePart, glass: GlassPart });

function PaintTool({ booths, target, onSurface, onOwn, onTargetStandard, onNotice }) {
  useTr();
  const look = boothEditedLook(booths, target);
  return (
    <>
      {/* Общее пояснение — под «?» у первой части, отдельного абзаца в колонке нет. */}
      {boothPartsOfTarget(target).map((part, index) => {
        const Part = PART_BY_KIND[findBoothPart(part).kind];
        return (
          <Part
            key={part}
            id={part}
            settings={look.parts[part]}
            extraHelp={index === 0 ? tr("Будки красятся в своих файлах — других вещей у них нет, поэтому правка видна только на будках, на обеих сразу или на одной, вблизи и издалека.") : null}
            onChange={(patch, label) => onSurface(target, part, patch, label)}
            onNotice={onNotice}
          />
        );
      })}
      <TargetStandard booths={booths} target={target} onOwn={onOwn} onTargetStandard={onTargetStandard} />
    </>
  );
}

export default function BoothsInspector({ tool, project, target, focus = null, onSurface, onOwn, onTargetStandard, onStandard, onPreset, onNotice }) {
  useTr();
  const pick = usePickedSection(focus);
  const booths = project.booths;
  return (
    <PickContext.Provider value={pick}>
      {tool === "paint" ? (
        <PaintTool booths={booths} target={target} onSurface={onSurface} onOwn={onOwn} onTargetStandard={onTargetStandard} onNotice={onNotice} />
      ) : (
        <>
          <BoothsPresets project={project} onApply={onPreset} />
          <ActionRows
            actions={[
              !boothsAreStock(booths) && {
                id: "standard",
                label: tr("Как в игре"),
                title: tr("Обе будки как в игре одним шагом: цвета, текстуры и картинки — штатные, свои облики будок снимаются."),
                onClick: onStandard,
              },
            ]}
          />
        </>
      )}
    </PickContext.Provider>
  );
}
