/*
 * Панель редактора «Остановки» — настройки взятого инструмента (мастерская
 * «как в Photoshop»): цвет, текстура и прозрачность частей, шаблоны.
 *
 * Что правится — вкладка сверху: «Все» (облик всех остановок сразу) или
 * один вид. У вида облик свой, если он заведён; пока не заведён, вид берёт
 * общий, и первая правка на его вкладке заводит свой облик копией общего.
 *
 * Органы — из словаря (`components/ui`): поверхности — общая отделка
 * (`FinishField`: стандарт, свой цвет, «Без текстуры», узор, картинка,
 * градиент) с общим полем цветовых эффектов (`ColourEffectField`), числа —
 * `Slider` с полем для числа, да/нет — `Switch`.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BUSSTOP_OPACITY, busStopsProjectIsStock } from "@modovik/climb-contract/recolor/busstops";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import FinishField from "../finish/FinishField.jsx";
import SectionHeading from "../section-help.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import { gifSurfaceCell } from "@modovik/climb-contract/recolor/gif-surface";
import { FINISH_IMAGE_ACCEPT, saveFinishImage } from "../finish/finish-assets.js";
import { saveGifSurfacePicture } from "../models/model-assets.js";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import BusStopsPresets from "./BusStopsPresets.jsx";
import {
  BUSSTOPS_SCENE_URL,
  BUSSTOP_SWATCHES,
  SURFACE_MODE_OPTIONS,
  busStopGifNote,
  editedLook,
  partLabel,
  partsOfTarget,
  percentText,
  targetFollowsAll,
  targetLabel,
  typesWithPart,
} from "./busstops-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Щелчок по части в кадре: раздел части подъезжает и коротко обводится. Контекст — чтобы не тянуть `ref` и `flash` сквозь каждый раздел. */
export const PickContext = createContext({ flash: "", refs: null });
const PICK_FRESH_MS = 1500;
const PICK_FLASH_MS = 1200;

export function usePickedSection(focus) {
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
export function Section({ id, title = "", label = "", help = null, children }) {
  const { flash, refs } = useContext(PickContext);
  return (
    <section
      ref={(node) => {
        if (refs) refs.current[id] = node;
      }}
      className={`ui-panel fx-section recolor-section${flash === id ? " is-picked" : ""}`}
      aria-label={label || title}
      data-busstops-section={id}
    >
      {(title || help) && <SectionHeading title={title} help={help} />}
      {children}
    </section>
  );
}

/* Эффекты по развёртке листа — как у зданий из игры: полосе «линия» в метрах на листе нечего мерить. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

const PART_HINTS = Object.freeze({
  frame: "Каркас, крыша, скамья и стойки — как в игре.",
  poster: "Рекламный щит — как в игре: светится ночью.",
  glass: "Стёкла навеса — как в игре: прозрачные, с бликом.",
  light: "Светильник под крышей — как в игре.",
});

/*
 * Свой облик вида — без выключателя (разбор критика 30.10.2026): первая правка на вкладке вида сама заводит ему свой облик копией
 * общего, вернуть вид к общему — строка «Как у всех остановок» внизу, только когда облик свой.
 */
const ownAction = (project, target, onOwn) =>
  target !== "all" && !targetFollowsAll(project, target) && { id: "as-all", label: tr("Как у всех остановок"), onClick: () => onOwn(target, false) };

/* Вид, что шёл «как все», по первой правке заводит свой облик — копией общего (как `ownLook` страницы). */
function ownTarget(project, target) {
  const type = project.types[target];
  if (!type || type.own) return project;
  return { ...project, types: { ...project.types, [target]: { ...type, own: true, parts: project.all.parts, opacity: project.all.opacity } } };
}

function SurfaceSection({ id, target = "all", title, settings, onChange, onNotice, hint, gifNote = "" }) {
  useTr();
  return (
    <Section id={id} label={title}>
      <FinishField
        label={title}
        settings={settings}
        modes={SURFACE_MODE_OPTIONS}
        swatches={BUSSTOP_SWATCHES}
        surface="sheet"
        studio={{
          id: `busstops:${target}:${id}:sheet`,
          title: `${tr("Остановки")} · ${title}`,
          /* Основа — лист игры у части (у вида — его часть); живой вид — кадр остановок с этим листом из студии. */
          scene: BUSSTOPS_SCENE_URL,
          match: (info) => info.group === id && (target === "all" || info.type === target),
          path: target === "all" ? ["all", "parts", id] : ["types", target, "parts", id],
          prepare: target === "all" ? null : (project) => ownTarget(project, target),
          hint: { part: id },
        }}
        shadeLabel={tr("Светотень листа")}
        hints={{
          standard: hint,
          flat: tr("Рисунок листа убран: часть ровного цвета. Рельеф и блик остаются — их несут другие листы модели."),
        }}
        onNotice={onNotice}
        onChange={onChange}
        /* Постер может быть гифкой: её играет плашка перед постером. */
        gif={id === "poster" ? "busstops" : null}
        /* Отделка строками, «Как в игре» — первой строкой с галкой (п. 13 и 16 `design-qa.md`): выпадающего «Отделка [Стандарт ▾]» нет. */
        rows
      >
        {id === "poster" && settings.mode === "image" && settings.image.animation && gifNote && (
          <p className="fx-hint" role="note" data-busstops-gif>
            {gifNote}
          </p>
        )}
        {settings.mode === "colour" && (
          <ColourEffectField
            label={tr("Цвет")}
            subject={title}
            value={settings.look}
            swatches={BUSSTOP_SWATCHES}
            modes={SHEET_EFFECTS}
            directionLabels={{ along: tr("Вдоль листа"), across: tr("Поперёк листа"), height: tr("Снизу вверх") }}
            hints={{ shimmer: tr("Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный.") }}
            onChange={(look, label) => onChange({ look }, label)}
          />
        )}
        {settings.mode === "flat" && (
          <ColourEffectField
            label={tr("Цвет")}
            subject={title}
            value={settings.look}
            swatches={BUSSTOP_SWATCHES}
            modes={["solid"]}
            onChange={(look, label) => onChange({ look }, label)}
          />
        )}
      </FinishField>
    </Section>
  );
}

/* «Как в игре» взятой вкладки: части и прозрачность — как в игре. */
function TargetStandard({ project, target, onOwn, onTargetStandard }) {
  useTr();
  const look = editedLook(project, target);
  const stock = look.opacity >= BUSSTOP_OPACITY.max && partsOfTarget(target).every((part) => look.parts[part].mode === "standard");
  /* Действие есть, только когда есть что снимать (ТЗ 29.10.2026, вечер): погашенной кнопки нет. */
  return (
    <ActionRows
      actions={[
        ownAction(project, target, onOwn),
        !stock && !targetFollowsAll(project, target) && { id: "target-standard", label: tr("Как в игре"), onClick: () => onTargetStandard(target) },
      ]}
    />
  );
}

/* Рекламный щит остановки — формат «ситилайт», выше, чем шире (≈ 1,2 × 1,75 м): рамка пустой рекламы в этой пропорции. */
const POSTER_ASPECT = 0.68;
const GIF_ACCEPT = `${FINISH_IMAGE_ACCEPT},image/gif,image/apng,.gif,.apng`;

/*
 * Реклама — первым блоком колонки (правило 10 `design-qa.md`, слово владельца 30.10.2026: «будут в основном только картинки свои
 * закидывать»): что стоит на щите сейчас, во всю ширину; щелчок открывает выбор файла, файл можно бросить на колонку. Картинка
 * встаёт сразу — тем же путём, что «Своя картинка» отделки (`FinishField`): гифка — листом кадров и «Растянуть». В рамке у гифки —
 * её первый кадр.
 */
function PosterPicture({ settings, onChange, onNotice }) {
  useTr();
  /* Заголовок «Реклама» — на какую часть ляжет картинка (критик 31.10.2026: рамка без заголовка, над строками всех частей). */
  const image = settings.mode === "image" ? settings.image : null;
  const url = useHangarEmblemUrl(image?.asset || "");
  async function take(file) {
    try {
      const { notice, ...saved } = await saveGifSurfacePicture(file, "busstops", { save: saveFinishImage });
      const { animation: _previous, ...rest } = settings.image || {};
      onChange({ mode: "image", image: { ...rest, ...saved, ...(saved.animation ? { fit: "stretch" } : {}) } }, "Своя картинка");
      if (notice) onNotice?.(notice);
    } catch (error) {
      onNotice?.(String(error?.message || error));
    }
  }
  const cell = image?.animation && image.width && image.height ? gifSurfaceCell(image.animation, image.width, image.height, 0) : null;
  const crop = cell ? [cell.x / image.width, cell.y / image.height, (cell.x + cell.width) / image.width, (cell.y + cell.height) / image.height] : null;
  return (
    <ListGroup title={tr("Реклама")} plain data-busstops-section="poster-picture">
    <SurfacePicture
      label={`${tr("Реклама")}: ${tr("своя картинка")}`}
      src={url}
      aspect={POSTER_ASPECT}
      fit="cover"
      crop={crop}
      caption={image ? `${image.name || tr("Своя картинка")} · ${cell ? `${cell.width} × ${cell.height}` : `${image.width} × ${image.height}`}` : ""}
      hint={tr("PNG, JPEG, WebP или гифка — встанет на рекламный щит остановок сразу")}
      accept={GIF_ACCEPT}
      dropLabel={tr("Отпустите — встанет на рекламу")}
      onFile={take}
      /* «×» — реклама как в игре (своё — всегда с «×», п. 21). */
      onClear={image ? () => onChange({ mode: "standard" }, "Реклама: как в игре") : null}
      clearLabel={tr("как в игре")}
      data-busstops-part="poster-picture"
    />
    </ListGroup>
  );
}

/* Что стоит у части сейчас — подписью её строки. */
/* Подпись — только у части не как в игре: «Стандарт» ×4 подряд ничего не говорил (разбор критика 30.10.2026). */
const partModeText = (settings) => {
  if (settings?.mode === "standard") return null;
  const option = SURFACE_MODE_OPTIONS.find(([mode]) => mode === settings?.mode);
  return option ? tr(option[1]) : "";
};

/*
 * «Цвет и текстура» (18.10.2026, владелец: панели «перегружены», как в
 * «Большой карте»): части строками «имя · что стоит ›», часть — своей
 * страницей. Раньше четыре раздела «Отделка · Студия · абзац» стояли
 * подряд. Щелчок по части в кадре открывает её страницу. Под частями —
 * прозрачность всей остановки (критик 31.10.2026: страница «Прозрачность»
 * с одним ползунком «Непрозрачность» читалась словом наоборот): 0 % — как
 * в игре, больше — сквозь остановку видно улицу.
 */
function PaintTool({ project, target, focus = null, onSurface, onOpacity, onOwn, onTargetStandard, onNotice }) {
  useTr();
  const look = editedLook(project, target);
  const parts = partsOfTarget(target);
  const [page, setPage] = useState("");
  useEffect(() => {
    if (focus?.part && Date.now() - focus.at <= PICK_FRESH_MS) setPage(focus.part);
  }, [focus]);
  const part = parts.includes(page) ? page : "";
  if (part)
    return (
      <PanelPage label={tr(partLabel(part))} note={tr(targetLabel(target))} backLabel={tr("Ко всем частям")} onBack={() => setPage("")}>
        <SurfaceSection
          id={part}
          target={target}
          title={partLabel(part)}
          settings={look.parts[part]}
          hint={target === "all" && part === "light" ? `${tr(PART_HINTS.light)} ${trFill("Есть только у вида «{0}».", typesWithPart("light").join("», «"))}` : tr(PART_HINTS[part])}
          gifNote={part === "poster" ? busStopGifNote(project, target) : ""}
          onNotice={onNotice}
          onChange={(patch, label) => onSurface(target, part, patch, label)}
        />
      </PanelPage>
    );
  return (
    <>
      {parts.includes("poster") && (
        <PosterPicture settings={look.parts.poster} onNotice={onNotice} onChange={(patch, label) => onSurface(target, "poster", patch, label)} />
      )}
      <ListGroup title={tr("Части")} help={tr("Правка видна на всех остановках вида сразу — вблизи и издалека.")}>
        {parts.map((id) => (
          <NavRow key={id} title={tr(partLabel(id))} caption={partModeText(look.parts[id])} data-busstops-part={id} onOpen={() => setPage(id)} />
        ))}
      </ListGroup>
      <Section
        id="opacity"
        /* Без заголовка: подпись ползунка и есть имя (п. 17); пояснения — за «?» у имени панели. */
        title=""
        help={[
          tr("0 % — как в игре; больше — сквозь остановку видно улицу"),
          tr("В игре прозрачность — прозрачными шейдерами самой игры: каркас, скамья, реклама и светильник просвечивают, стёкла становятся ещё прозрачнее. Рекламный щит светится как прежде, блика на нём нет."),
        ]}
      >
        <Slider
          label={tr("Прозрачность")}
          value={BUSSTOP_OPACITY.max - look.opacity}
          min={0}
          max={BUSSTOP_OPACITY.max - BUSSTOP_OPACITY.min}
          step={1}
          format={percentText}
          onChange={(clear) => onOpacity(target, BUSSTOP_OPACITY.max - clear, "Прозрачность")}
        />
      </Section>
      <TargetStandard project={project} target={target} onOwn={onOwn} onTargetStandard={onTargetStandard} />
    </>
  );
}

export default function BusStopsInspector({ tool, project, target, focus = null, onSurface, onOpacity, onOwn, onTargetStandard, onStandard, onPreset, onNotice }) {
  useTr();
  const pick = usePickedSection(focus);
  return (
    <PickContext.Provider value={pick}>
      <BusStopsTool
        tool={tool}
        focus={focus}
        project={project}
        target={target}
        onSurface={onSurface}
        onOpacity={onOpacity}
        onOwn={onOwn}
        onTargetStandard={onTargetStandard}
        onStandard={onStandard}
        onPreset={onPreset}
        onNotice={onNotice}
      />
    </PickContext.Provider>
  );
}

function BusStopsTool({ tool, project, target, focus = null, onSurface, onOpacity, onOwn, onTargetStandard, onStandard, onPreset, onNotice }) {
  useTr();
  if (tool === "paint")
    return <PaintTool project={project} target={target} focus={focus} onSurface={onSurface} onOpacity={onOpacity} onOwn={onOwn} onTargetStandard={onTargetStandard} onNotice={onNotice} />;
  return (
    <>
      <BusStopsPresets project={project} onApply={onPreset} />
      <ActionRows
        actions={[
          !busStopsProjectIsStock(project) && {
            id: "standard",
            label: tr("Как в игре"),
            title: tr("Все остановки как в игре одним шагом: цвета, текстуры и прозрачность — штатные, свои облики видов снимаются."),
            onClick: onStandard,
          },
        ]}
      />
    </>
  );
}
