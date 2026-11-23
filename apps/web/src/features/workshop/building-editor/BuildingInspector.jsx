/*
 * Панель редактора зданий — настройки взятого инструмента (мастерская «как
 * в Photoshop»): здание и части, стороны, надпись, таблички, эмблемы,
 * текст, шаблоны.
 *
 * Всё по умолчанию «Стандарт» — штатное здание игры. Органы — из словаря
 * (`components/ui`): режимы — `Select` и `SegmentedControl`, цвета —
 * `ColorField`, числа — `Slider` (с полем для числа), текст — `TextField`,
 * да/нет — `Switch`. Поверхности — общая отделка (`FinishField`) с общим
 * полем цветовых эффектов (`ColourEffectField`), эмблемы и надписи — общая
 * система мест (`EmblemSection`, задача 1).
 *
 * Абзацев под органами нет (ТЗ 29.10.2026, вечер: образец — страница вещи «Мастерской арены»): что нужно знать о разделе — по «?»
 * у его заголовка (`Section help`), картинка стороны и щита — первым блоком во всю ширину (`SurfacePicture`, п. 10 `design-qa.md`), сами
 * стороны и щиты — строками под ней (п. 12), «Стандарт» и «как в игре» — строками внизу (`ActionRows`), и только когда есть что возвращать.
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  BUILDING_LOGO_SIZE,
  BUILDING_PART_IDS,
  BUILDING_SIDE_IDS,
  BUILDING_TEXT_LIMIT,
  BUILDING_TITLE_SIZE,
  BUILDING_WALL_LIMIT,
  BUILDING_WALL_WARN,
  buildingBillboards,
  buildingInventory,
  buildingPlaceParts,
  buildingProjectIsStock,
  buildingSide,
  buildingSidePanels,
  buildingSidePixels,
  buildingSideUsesPanels,
  buildingSignPlaceKey,
  buildingSigns,
  buildingTextTargets,
  buildingTitleRetired,
  buildingTitle,
  createBuildingProject,
} from "@modovik/climb-contract/recolor/buildings";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import { Check, ImageSquare } from "../../../components/ui/icons.jsx";
import ListGroup, { ListRow, ListThumb } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SurfaceFit from "../../../components/ui/SurfaceFit.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import EmblemSection from "../emblem/EmblemSection.jsx";
import FontSources from "../emblem/FontSources.jsx";
import FinishField from "../finish/FinishField.jsx";
import SectionHeading from "../section-help.jsx";
import { HANGAR_EMBLEM_ACCEPT, convertedImageText, saveHangarEmblem, saveWallImage, useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import ChoiceRows from "../choice-rows.jsx";
import { buildingSignEntries } from "./building-aim.js";
import { buildingBoardSurface, buildingSideSurface, buildingWallPlate } from "./building-studio.js";
import { trFill } from "../../../locales/tr-fill.js";
import BuildingPresets from "./BuildingPresets.jsx";
import {
  BUILDING_SWATCHES,
  FONT_OPTIONS,
  PART_MODE_OPTIONS,
  SIDE_MODE_OPTIONS,
  SURFACE_MODE_OPTIONS,
  TEXT_BACKGROUND_OPTIONS,
  TEXT_MODE_OPTIONS,
  TEXT_STYLE_OPTIONS,
  aspectText,
  metresText,
  partLabel,
  percentText,
  pixelsText,
} from "./building-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Щелчок по детали в кадре (`{ key, count }`): раздел с этим `id` подводится в
 * поле зрения колонки. Счёт растёт с каждым щелчком, и повторный щелчок по той же
 * детали подводит снова.
 */
const NO_AIM = Object.freeze({ key: "", count: 0 });
const AimContext = createContext(NO_AIM);

/*
 * `help` — что нужно знать о разделе: строка или список строк по «?» у заголовка (абзацев под органами нет). `bare` — без своего заголовка:
 * внутри группа строк (`ListGroup`) со своей подписью, раздел только держит место для щелчка в кадре.
 */
function Section({ id, title, label = "", help = null, bare = false, children }) {
  const aim = useContext(AimContext);
  const holder = useRef(null);
  const wanted = Boolean(aim.count) && aim.key === id;
  useEffect(() => {
    if (!wanted) return undefined;
    const frame = requestAnimationFrame(() => holder.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [wanted, aim.count]);
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title} data-building-section={id} ref={holder}>
      {bare ? null : help && [].concat(help).some(Boolean) ? <SectionHeading title={title} help={[].concat(help).filter(Boolean)} /> : <h3>{title}</h3>}
      {children}
    </section>
  );
}

/* Строка «да / нет»: подпись и переключатель; что значит строка — подсказкой (`hint`), а не строкой под подписью (п. 1 `design-qa.md`). */
function SwitchRow({ title, hint, checked, onChange }) {
  return (
    <label className="fx-switch" title={hint || undefined}>
      <span>
        <b>{title}</b>
      </span>
      <Switch checked={checked} label={title} onChange={onChange} />
    </label>
  );
}

/* Эффекты по развёртке листа: полосе «линия» в метрах там нечего мерить. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

/* ------------------------------------------------------------------ *
 * Здание и части
 * ------------------------------------------------------------------ */

function SurfaceSection({ place, id, title, settings, modes, onChange, onNotice, hint = "", help = null, project = null, onWallPlace = null }) {
  useTr();
  return (
    /* Имени раздела нет, когда оно повторило бы имя панели: «Всё здание» под «Зданием», «Крыша» под «Крышей» (п. 8 разбора 30.10.2026). */
    <Section id={id} title="" label={title} help={help}>
      <FinishField
        label={title}
        settings={settings}
        modes={modes}
        swatches={BUILDING_SWATCHES}
        surface="sheet"
        studio={{
          id: `building:${place}:${id}:sheet`,
          title: `${tr("Здание")} · ${title}`,
          /* Основа — лист игры у частей здания (у «Всё здание» — у самой большой); живой вид — кадр здания с этим листом из студии. */
          scene: buildingInventory(place)?.scenes?.[0]?.url,
          match: id === "building" ? (info) => BUILDING_PART_IDS.includes(info.group) : (info) => info.group === id,
          path: id === "building" ? ["building"] : ["parts", id],
          /* Стена, по которой щёлкнули в кадре, — своя картинка плашкой, только этой стене (3В). */
          ...(onWallPlace ? { wallPlate: (wall) => buildingWallPlate({ place, project, wall, onPlace: onWallPlace }) } : {}),
        }}
        shadeLabel={tr("Светотень листа")}
        hints={{ standard: hint, building: tr("Как всё здание: облик берётся из раздела «Всё здание».") }}
        rows
        inherit={id === "building" ? null : { mode: "building", label: "Как у всего здания" }}
        onNotice={onNotice}
        onChange={onChange}
      >
        {settings.mode === "colour" && (
          <ColourEffectField
            label={tr("Цвет")}
            subject={title}
            value={settings.look}
            swatches={BUILDING_SWATCHES}
            modes={SHEET_EFFECTS}
            directionLabels={{ along: tr("Вдоль листа"), across: tr("Поперёк листа"), height: tr("Снизу вверх") }}
            hints={{ shimmer: tr("Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный.") }}
            onChange={(look, label) => onChange({ look }, label)}
          />
        )}
      </FinishField>
    </Section>
  );
}

/*
 * Картинки на стенах (3В ТЗ 18.10.2026): стены, которым в студии поставили свою картинку («Только эта стена»).
 * Каждая — плашка по стене; список снимает их по одной. Больше `BUILDING_WALL_WARN` — предупреждение:
 * лист плашки — до 2048 px, это до 5,6 МБ видеопамяти с мип-уровнями на каждую.
 */
function WallPlateRow({ wall, onRemove }) {
  useTr();
  const url = useHangarEmblemUrl(wall.asset);
  const [width, height] = wall.metres;
  return (
    <ListRow
      icon={<ImageSquare />}
      title={`${tr("Стена")}${wall.part ? ` · ${tr(partLabel(wall.part))}` : ""}`}
      caption={`${Math.round(width * 10) / 10} × ${Math.round(height * 10) / 10} ${tr("м")} · ${wall.width} × ${wall.height} px`}
      trailing={<ListThumb src={url} />}
      onClear={onRemove}
      clearLabel={tr("Убрать картинку со стены")}
      data-wall-plate={wall.id}
    />
  );
}

function WallPlatesSection({ project, onWallRemove }) {
  useTr();
  const walls = project.walls || [];
  if (!walls.length) return null;
  return (
    <Section
      id="wall-plates"
      title={tr("Картинки на стенах")}
      help={[
        walls.length > BUILDING_WALL_WARN
          ? trFill("Картинок на стенах уже {0} (больше {1} — предел {2}): каждая занимает до 5,6 МБ видеопамяти, на слабых видеокартах игра может просесть.", walls.length, BUILDING_WALL_WARN, BUILDING_WALL_LIMIT)
          : "",
        tr("Каждая картинка — плашка по своей стене: лист игры и другие места с этим листом она не трогает. «Как в игре» снимает их вместе с остальным."),
      ]}
    >
      <ListGroup label={tr("Картинки на стенах")}>
        {walls.map((wall) => (
          <WallPlateRow key={wall.id} wall={wall} onRemove={() => onWallRemove?.(wall.id)} />
        ))}
      </ListGroup>
    </Section>
  );
}

/* Подсказка части: что именно она красит у этого здания. */
const PART_HINTS = Object.freeze({
  ground: "Парковка и земля вокруг — как в игре.",
  accent: "Фирменные стены магазина (у You Tool — оранжевые рамы и пилоны) — как в игре.",
});

/* Что стоит у части сейчас — подписью строки «Частей здания»; исходное — словом «Как в игре», как у всех (разбор 30.10.2026). */
const partModeText = (settings) => {
  if (settings?.mode === "standard") return tr("Как в игре");
  const option = PART_MODE_OPTIONS.find(([mode]) => mode === settings?.mode);
  return option ? tr(option[1]) : "";
};

/*
 * «Здание» (18.10.2026, владелец: «перегружено», как в «Большой карте»):
 * сверху — «Всё здание» целиком, ниже — части строками «имя · что стоит ›».
 * Часть открывается своей страницей (шапка колонки ведёт назад), а не стоит
 * пятым одинаковым разделом «Отделка · Студия · абзац». Щелчок по части в
 * кадре открывает её страницу (`partPage` ведёт студия).
 */
function BuildingTool({ place, project, onBuilding, onPart, onNotice, partPage = "", onPartPage = () => {}, onWallPlace = null, onWallRemove = null }) {
  useTr();
  const parts = buildingPlaceParts(place).map((part) => part.id);
  const initialParts = createBuildingProject(place).parts;
  if (partPage && parts.includes(partPage))
    return (
      <>
        <SurfaceSection
          place={place}
          id={partPage}
          title={partLabel(partPage)}
          settings={project.parts[partPage]}
          modes={PART_MODE_OPTIONS}
          hint={tr(PART_HINTS[partPage] || "Как в игре.")}
          project={project}
          onWallPlace={onWallPlace}
          onNotice={onNotice}
          onChange={(patch, label) => onPart(partPage, patch, label)}
        />
        <WallPlatesSection project={project} onWallRemove={onWallRemove} />
      </>
    );
  return (
    <>
      <SurfaceSection
        place={place}
        id="building"
        title={tr("Всё здание")}
        settings={project.building}
        modes={SURFACE_MODE_OPTIONS}
        hint={tr("Здание как в игре. Свой цвет, узор, картинка или градиент лягут на стены, крышу, отделку и навесы разом — любую часть можно поправить отдельно ниже.")}
        help={tr("Издалека здание того же тона — общей системой дальних планов: узор и картинку с сотен метров не разглядеть, там остаётся их основной цвет.")}
        project={project}
        onWallPlace={onWallPlace}
        onNotice={onNotice}
        onChange={(patch, label) => onBuilding(patch, label)}
      />
      {parts.length > 0 && (
        <Section id="parts" title={tr("Части здания")} bare>
          <ListGroup title={tr("Части здания")}>
            {parts.map((id) => (
              <NavRow
                key={id}
                title={tr(partLabel(id))}
                /* Подпись — только у части, что отличается от исходной (у парковки исходное — «как в игре», у стен — «как всё здание»). */
                caption={project.parts[id]?.mode === (initialParts[id]?.mode ?? "building") ? null : partModeText(project.parts[id])}
                data-building-part={id}
                onOpen={() => onPartPage(id)}
              />
            ))}
          </ListGroup>
        </Section>
      )}
      <WallPlatesSection project={project} onWallRemove={onWallRemove} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Стороны
 * ------------------------------------------------------------------ */

const IMAGE_HINT = "PNG, JPEG, WebP, BMP, GIF или AVIF — большая картинка уменьшится сама до 2048 px. Картинка остаётся на этом компьютере: в код для друга она не едет.";
const WALL_IMAGE_HINT = "PNG, JPEG, WebP, BMP, GIF или AVIF — на широкой стене картинка хранится до 8192 px (Мега Молл — 8192 × 1323). Картинка остаётся на этом компьютере: в код для друга она не едет.";

/*
 * Своя картинка места — первым блоком (`SurfacePicture`, п. 10 `design-qa.md`, 30.10.2026): во всю ширину колонки то, что стоит на
 * стороне или щите сейчас, в его пропорции; щелчок открывает выбор файла, файл можно бросить на колонку — и картинка сразу встаёт на
 * выбранное место. Форматы, рекомендуемый размер и как подгонится — подсказкой рамки (`hint`). Ниже — подгонка (только при картинке) и
 * студия; «Как в игре» и «на все» — строками внизу страницы (`ActionRows`). `onClear` — «×» рамки (своё — всегда с «×», п. 21): место как в игре.
 */
function PlacePicture({ label, image, aspect, fit, background = "", fill = "", empty = "", hint, help = [], save = saveHangarEmblem, dropLabel = "", onImage, onNotice, onClear = null }) {
  useTr();
  const url = useHangarEmblemUrl(image.asset);
  const take = async (file) => {
    try {
      const { converted, ...saved } = await save(file);
      onImage(saved);
      if (converted) onNotice?.(convertedImageText(converted), "info");
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    }
  };
  return (
    <SurfacePicture
      label={label}
      src={image.asset ? url : ""}
      fill={image.asset ? "" : fill}
      aspect={aspect}
      fit={fit}
      background={background}
      caption={image.asset ? `${image.name || tr("из файла")} · ${image.width} × ${image.height}` : ""}
      empty={empty}
      accept={HANGAR_EMBLEM_ACCEPT}
      hint={[tr(hint), ...[].concat(help)].filter(Boolean).join(" ")}
      dropLabel={dropLabel}
      data-building-image={image.asset ? "set" : "empty"}
      onFile={take}
      onClear={onClear}
      clearLabel={tr("как в игре")}
    />
  );
}

/* Совпадает ли картинка с рекомендуемым размером (по пропорции, 2 %). */
function bannerFitText(image, pixels, fit) {
  if (!image.asset || !image.width || !image.height) return "";
  const target = pixels[0] / pixels[1];
  const aspect = image.width / image.height;
  if (Math.abs(aspect / target - 1) <= 0.02)
    return image.width >= pixels[0] * 0.9 ? tr("Картинка ровно по стороне — ляжет без обрезки и полей.") : tr("Пропорция ровно по стороне, но картинка меньше рекомендуемой — в игре она будет мягче.");
  const how = {
    cover: tr("лишнее по краям обрежется поровну, без искажений"),
    contain: tr("картинка встанет целиком, поля — цветом фона"),
    stretch: tr("картинка растянется по стене — пропорции исказятся"),
  }[fit];
  return trFill("Картинка {0} × {1} не по пропорции стороны — Astral подгонит сам: {2}.", image.width, image.height, how);
}

/* Ключ «все четыре стороны сразу» в выборе стороны (его же помнит кадр: `BuildingStudio`). */
export const SIDES_ALL = "all";

const NO_IMAGE = Object.freeze({ asset: "", name: "", width: 0, height: 0 });

/* Цвет стороны для рамки картинки: ровный — сам цвет, переход и полосы — от первого цвета ко второму. */
const lookFill = (look) => (!look ? "" : look.mode === "gradient" || look.mode === "line" ? `linear-gradient(90deg, ${look.colour}, ${look.colour2})` : look.colour);

/* Что стоит на стороне сейчас — подписью её строки. */
const sideModeText = (settings) => tr(SIDE_MODE_OPTIONS.find((option) => option.value === settings?.mode)?.label || "Как в игре");

/*
 * «Стороны» (п. 10 и 12 `design-qa.md`): сверху — баннер выбранной стороны рамкой во всю ширину (щелчок — свой файл), под ним подгонка
 * и студия; ниже — сами стороны строками («Где»): щелчок выбирает сторону, кадр показывает её. Покрасить сторону — второстепенно,
 * выключателем под строками. «Как в игре» — строкой внизу.
 */
function SideTool({ place, project, side: sideId, onSideId, onSide, onNotice }) {
  useTr();
  const sides = BUILDING_SIDE_IDS.map((id) => buildingSide(place, id)).filter(Boolean);
  /* «Все четыре стороны сразу» (ТЗ 26.10.2026): одна картинка и одни настройки на каждую сторону — она берёт из неё свой кусок по своей пропорции. */
  const all = sideId === SIDES_ALL && sides.length > 1;
  const side = all ? sides[0] : buildingSide(place, sideId) || sides[0];
  if (!side) return <p className="fx-hint">{tr("У этого здания нет сторон под баннеры.")}</p>;
  const item = project.sides[side.id];
  const pixels = buildingSidePixels(place, side.id);
  const targets = all ? sides.map((entry) => entry.id) : [side.id];
  const set = (patch, label) => (all ? onSide(targets, patch, `${tr("Все стороны")}: ${label}`) : onSide(side.id, patch, `${side.label}: ${label}`));
  /* Широкая стена (Мега Молл 75 м) — панелями: картинка хранится в полном разрешении (до 8192 px); на все стороны сразу — тоже так. */
  const wide = all || Boolean(buildingSidePanels(place, side.id));
  const paneled = !all && buildingSideUsesPanels(project, place, side.id);
  const fitHow = {
    cover: tr("лишнее по краям обрежется поровну, без искажений"),
    contain: tr("картинка встанет целиком, поля — цветом фона"),
    stretch: tr("картинка растянется по стене — пропорции исказятся"),
  }[item.fit];
  const banner = item.mode === "banner";
  const image = banner ? item.image : NO_IMAGE;
  /* Что это за сторона и как ляжет картинка — подсказкой рамки и «?» у строк сторон, абзацев нет. */
  const sideHelp = all
    ? tr("Одна картинка и одни настройки на все четыре стороны сразу: каждая сторона берёт из неё свой кусок по своей пропорции — от угла до угла и от цоколя до карниза. Для тонкой подгонки выберите сторону по отдельности.")
    : side.blue
      ? trFill(
          "Синяя стена — {0} × {1} ({2}): от серого цоколя до карниза и от угла до угла. Картинка ложится ровно по ней: края картинки — у краёв стены, на углах соседние стороны сходятся встык, без щелей. В кадре её контур обведён жёлтой рамкой.",
          metresText(side.blue.width),
          metresText(side.blue.height),
          aspectText(side.blue.width, side.blue.height),
        )
      : side.banner
        ? trFill("Место под баннер — {0} × {1} ({2}): самая большая часть этой стены — у неё уступ, и над низкой частью небо. Баннер натягивается на неё до краёв, целиком.", metresText(side.banner.width), metresText(side.banner.height), aspectText(side.banner.width, side.banner.height))
        : trFill("Место под баннер — {0} × {1} ({2}): вся верхняя часть стороны над навесами и витринами. Баннер натягивается на неё до краёв, целиком.", metresText(side.width), metresText(side.height), aspectText(side.width, side.height));
  return (
    <>
      <Section id="side-banner" title={tr("Баннер")} bare>
        {/* Баннер — до краёв своей рамки и целиком (05.10.2026, владелец: «баннер ложится обрезанным»): у прямоугольной стены рамка — вся
            сторона, у стены уступом — самая большая её часть. */}
        <PlacePicture
          label={all ? tr("Баннер: все четыре стороны") : trFill("Баннер: {0}", side.label)}
          image={image}
          aspect={pixels[0] / pixels[1]}
          fit={item.fit}
          background={item.background}
          fill={item.mode === "colour" ? lookFill(item.look) : ""}
          empty={tr("Свой баннер")}
          dropLabel={tr("Отпустите — встанет баннером")}
          onClear={item.mode !== "standard" ? () => set({ mode: "standard" }, "как в игре") : null}
          save={wide ? saveWallImage : saveHangarEmblem}
          hint={wide ? WALL_IMAGE_HINT : IMAGE_HINT}
          help={[
            all ? "" : trFill("Рекомендуемый размер картинки: {0} — пропорция стороны {1}. Картинка другого размера подгонится сама.", pixelsText(pixels), aspectText(pixels[0], pixels[1])),
            wide
              ? paneled
                ? tr("Картинка шире 2048 px: стена ложится в игру панелями — каждая своим листом, в полном разрешении картинки.")
                : tr("Картинка шире 2048 px по ширине ляжет на эту стену панелями в полном разрешении; поуже — одной плашкой.")
              : "",
            image.asset ? (all ? trFill("Картинка подгонится к каждой стороне сама: {0}.", fitHow) : bannerFitText(image, pixels, item.fit)) : "",
          ]}
          onImage={(next) => set({ mode: "banner", image: next }, "баннер")}
          onNotice={onNotice}
        />
        {/* Сколько пикселей ждёт сторона и ложится ли она панелями — для тестов и прохода (людям это в подсказке рамки). */}
        <span hidden data-building-pixels={all ? undefined : `${pixels[0]}x${pixels[1]}`} data-building-panels={wide ? (paneled ? "on" : "off") : undefined} />
        {/* Подгонка — общим органом картинки (`SurfaceFit`, п. 19 `design-qa.md`): «Подгонка», «Заполнить | Вписать | Растянуть», фон полей. */}
        {image.asset && (
          <SurfaceFit
            fit={item.fit}
            onFit={(fit) => set({ fit }, "подгонка")}
            background={item.fit === "contain" ? { value: item.background, swatches: BUILDING_SWATCHES, onChange: (background) => set({ background }, "фон") } : null}
          />
        )}
        {/* «Студия»: холст — сама стена, итог — баннер стороны. На все четыре сразу её нет: у них нет одной стены. */}
        {!all && (
          <ListGroup label={tr("Студия")}>
            <StudioPictureButton
              getSurface={() => buildingSideSurface(place, side.id, { project })}
              image={image}
              onImage={(next) => set({ mode: "banner", image: next }, "баннер")}
              onNotice={onNotice}
              save={wide ? saveWallImage : saveHangarEmblem}
              slug={trFill("Баннер: {0}", side.label)}
              label={tr("Нарисовать в студии")}
              caption={tr("Кисть, слои, текст")}
            />
          </ListGroup>
        )}
      </Section>
      <Section id="side" title={tr("Стороны")} bare>
        {/* Имя панели уже «Стороны» — у группы своё имя, вопросом, как у мест страницы вещи арены. */}
        <ListGroup title={tr("Какая сторона")} help={sideHelp}>
          {sides.length > 1 && (
            <NavRow
              className={all ? "is-selected" : ""}
              aria-pressed={all}
              title={tr("Все четыре стороны сразу")}
              data-building-side={SIDES_ALL}
              onOpen={() => onSideId(SIDES_ALL)}
            />
          )}
          {sides.map((entry) => (
            <NavRow
              key={entry.id}
              className={!all && entry.id === side.id ? "is-selected" : ""}
              aria-pressed={!all && entry.id === side.id}
              title={entry.label}
              caption={project.sides[entry.id]?.mode === "standard" ? null : sideModeText(project.sides[entry.id])}
              data-building-side={entry.id}
              onOpen={() => onSideId(entry.id)}
            />
          ))}
        </ListGroup>
      </Section>
      {/* Покрасить сторону — второстепенно, ниже картинки: выключатель, под ним цвет и рельеф. Цвет ложится строго по стене. */}
      <Section id="side-colour" title={tr("Цвет стороны")} bare>
        <SwitchRow
          title={tr("Покрасить сторону")}
          hint={side.blue ? "" : tr("Цвет ложится строго по стене: где стены нет — над низкой крышей, за углом, в проёмах шире двух метров, — краски нет.")}
          checked={item.mode === "colour"}
          onChange={(on) => set({ mode: on ? "colour" : "standard" }, "оформление")}
        />
        {item.mode === "colour" && (
          <>
            {/* Подпись — «Цвет»: «Покрасить сторону» уже строка над ним (дизайн 12.10). */}
            <ColourEffectField
              label={tr("Цвет")}
              subject={tr("Цвет стороны")}
              value={item.look}
              swatches={BUILDING_SWATCHES}
              modes={["solid", "gradient", "rainbow", "shimmer", "line"]}
              directionLabels={{ along: tr("Вдоль стены"), across: tr("Снизу вверх"), height: tr("Снизу вверх") }}
              onChange={(look) => set({ look }, "цвет")}
            />
            <SwitchRow
              title={tr("Рельеф стены")}
              hint={tr("Панели, швы и кирпич штатной стены остаются видны под цветом — сторона выглядит покрашенной")}
              checked={item.relief}
              onChange={(relief) => set({ relief }, "рельеф")}
            />
          </>
        )}
      </Section>
      {item.mode !== "standard" && (
        <Section id="side-opacity" title={tr("Плашка")} help={tr("Издалека сторона того же облика: дальние планы здания получают ту же картинку по плоскости стены.")}>
          <SwitchRow
            title={tr("Надпись и таблички поверх")}
            hint={
              banner
                ? tr("Выключено — баннер чистым полотном до краёв стены. Включите, чтобы надпись и вывески этой стены легли поверх баннера")
                : tr("Надпись и вывески этой стены остаются видны на цвете; убрать их можно в «Надписи» и «Табличках»")
            }
            checked={item.signs}
            onChange={(signs) => set({ signs, signsSet: true }, "надпись поверх")}
          />
          <Slider label={tr("Непрозрачность")} value={item.opacity} min={10} max={100} format={percentText} onChange={(opacity) => set({ opacity }, "непрозрачность")} />
        </Section>
      )}
      <ActionRows
        label={tr("Действия со стороной")}
        actions={[item.mode !== "standard" && { id: "side-standard", label: all ? tr("Все стороны как в игре") : tr("Сторона как в игре"), onClick: () => set({ mode: "standard" }, "как в игре") }]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Щиты на крыше
 * ------------------------------------------------------------------ */

/* Подходит ли фото к щиту — словами, как у баннера стороны. */
function photoFitText(image, pixels, fit) {
  if (!image.asset || !image.width || !image.height) return "";
  const aspect = image.width / image.height;
  if (Math.abs(aspect / (pixels[0] / pixels[1]) - 1) <= 0.02)
    return image.width >= pixels[0] * 0.9 ? tr("Фото ровно по щиту — ляжет без обрезки и полей.") : tr("Пропорция ровно по щиту, но фото меньше рекомендуемого — в игре оно будет мягче.");
  const how = {
    cover: tr("лишнее по краям обрежется поровну, без искажений"),
    contain: tr("фото встанет целиком, поля — цветом фона"),
    stretch: tr("фото растянется по щиту — пропорции исказятся"),
  }[fit];
  return trFill("Фото {0} × {1} не по пропорции щита — Astral подгонит сам: {2}.", image.width, image.height, how);
}

/*
 * «Щиты» (п. 10 и 12 `design-qa.md`): сверху — фото выбранной стороны щита рамкой во всю ширину (щелчок — свой файл), под ним подгонка и
 * студия; ниже — стороны щитов строками: щелчок выбирает, кадр показывает щит крупно. «Это фото на все стороны щитов» и «Убрать фото» —
 * строками внизу.
 */
function BillboardTool({ place, project, billboard: boardId, onBillboardId, onBillboard, onNotice }) {
  useTr();
  const boards = buildingBillboards(place);
  const board = boards.find((item) => item.id === boardId) || boards[0];
  if (!board) return <p className="fx-hint">{tr("У этого здания нет щитов на крыше.")}</p>;
  const item = project.billboards[board.id];
  const set = (patch, label) => onBillboard(board.id, patch, `${board.label}: ${label}`);
  const withPhoto = (id) => project.billboards[id]?.mode === "image" && project.billboards[id].image.asset;
  const others = boards.filter((entry) => entry.id !== board.id);
  const photo = item.mode === "image" ? item.image : NO_IMAGE;
  return (
    <>
      <Section id="billboard-photo" title={tr("Фото")} bare>
        <PlacePicture
          label={trFill("Фото: {0}", board.label)}
          image={photo}
          aspect={board.pixels[0] / board.pixels[1]}
          fit={item.fit}
          background={item.background}
          empty={tr("Своё фото")}
          dropLabel={tr("Отпустите — встанет на щит")}
          hint={IMAGE_HINT}
          help={[
            trFill("Рекомендуемый размер фото: {0} — пропорция щита {1}. Фото другого размера подгонится само.", pixelsText(board.pixels), aspectText(board.pixels[0], board.pixels[1])),
            photo.asset ? photoFitText(photo, board.pixels, item.fit) : "",
          ]}
          onImage={(image) => set({ mode: "image", image }, "фото")}
          onNotice={onNotice}
          onClear={item.mode !== "standard" ? () => set({ mode: "standard" }, "как в игре") : null}
        />
        <span hidden data-building-pixels={`${board.pixels[0]}x${board.pixels[1]}`} />
        {photo.asset && (
          <SurfaceFit
            fit={item.fit}
            onFit={(fit) => set({ fit }, "подгонка")}
            background={item.fit === "contain" ? { value: item.background, swatches: BUILDING_SWATCHES, onChange: (background) => set({ background }, "фон") } : null}
          />
        )}
        <ListGroup label={tr("Студия")}>
          <StudioPictureButton
            getSurface={() => buildingBoardSurface(place, board.id, { project })}
            image={photo}
            onImage={(image) => set({ mode: "image", image }, "фото")}
            onNotice={onNotice}
            slug={trFill("Фото: {0}", board.label)}
            label={tr("Нарисовать в студии")}
            caption={tr("Кисть, слои, текст")}
          />
        </ListGroup>
      </Section>
      <Section id="billboard" title={tr("Щиты")} bare>
        <ListGroup
          title={tr("Какой щит")}
          help={trFill(
            "На углу крыши высокого корпуса стоят двусторонние щиты {0} × {1}: в игре на них пустые панели. Своё фото встаёт плашкой прямо на щит — вблизи и издалека; кадр показывает выбранную сторону крупно.",
            metresText(board.width),
            metresText(board.height),
          )}
        >
          {boards.map((entry) => (
            <NavRow
              key={entry.id}
              className={entry.id === board.id ? "is-selected" : ""}
              aria-pressed={entry.id === board.id}
              title={entry.label}
              caption={withPhoto(entry.id) ? tr("Своё фото") : null}
              data-building-board={entry.id}
              onOpen={() => onBillboardId(entry.id)}
            />
          ))}
        </ListGroup>
      </Section>
      <ActionRows
        label={tr("Действия со щитом")}
        actions={[
          /* Поставить это фото на остальные стороны щитов — строкой внизу, а не кнопкой посреди колонки (п. 10). */
          photo.asset &&
            others.length > 0 && {
              id: "billboards-all",
              label: tr("Это фото на все стороны щитов"),
              onClick: () => onBillboard(others.map((entry) => entry.id), { mode: "image", image: item.image, fit: item.fit, background: item.background }, "Щиты: это фото на все стороны"),
            },
          item.mode !== "standard" && { id: "billboard-standard", label: tr("Убрать фото"), onClick: () => set({ mode: "standard" }, "как в игре") },
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Надпись и таблички
 * ------------------------------------------------------------------ */

/*
 * Что нужно знать о надписи в её режиме — для «?» раздела, где стоят органы надписи (абзацев под ними нет): как в игре — какие там
 * слова, «Убрать» — что останется на месте букв, свой текст на непрозрачном листе — почему фон у плашки всегда цветом.
 */
function textHelp({ settings, defaults, opaque = false, covered = false, erased = false }) {
  if (settings?.mode === "standard") return [trFill("Как в игре: «{0}».", defaults.replace(/\n/g, " "))];
  if (settings?.mode === "hidden")
    return [
      erased
        ? tr("Буквы уберутся с фасада — на их месте останется стена.")
        : covered
          ? tr("Буквы закроет плашка цветом фона — как пустая вывеска.")
          : opaque
            ? tr("У этой таблички нет прозрачности — на её месте останется пустая плашка цветом фона.")
            : tr("Буквы уберутся с листа — на их месте ничего не будет."),
    ];
  if (settings?.mode === "text" && opaque) return [covered ? tr("Плашка закрывает буквы игры, поэтому фон у неё всегда цветом.") : tr("У этой таблички лист без прозрачности: буквы встают на плашку цветом.")];
  return [];
}

function TextControls({ id, title, settings, lines = 1, opaque = false, defaults, onChange }) {
  useTr();
  return (
    <>
      {/* Как показать — строками (п. 13 `design-qa.md`): «Свой текст» и «Убрать»; «Как в игре» — откат, строкой внизу, пока надпись своя. */}
      <ChoiceRows
        label={`${title}: как показать`}
        options={TEXT_MODE_OPTIONS.filter(([mode]) => mode !== "standard").map(([value, text]) => ({ value, label: tr(text) }))}
        value={settings.mode}
        onChange={(mode) => onChange({ mode }, `${title}: режим`)}
      />
      {settings.mode === "text" && (
        <>
          {Array.from({ length: lines }, (_, index) => (
            <TextField
              key={index}
              label={lines > 1 ? trFill("Строка {0}", index + 1) : tr("Текст")}
              value={settings.lines[index] || ""}
              maxLength={BUILDING_TEXT_LIMIT}
              placeholder={defaults.split("\n")[index] || ""}
              onChange={(value) => onChange({ lines: settings.lines.map((line, at) => (at === index ? value : line)) }, `${title}: текст`)}
            />
          ))}
          <Select
            label={tr("Шрифт")}
            value={settings.font}
            options={settings.fontAsset ? [...FONT_OPTIONS, ["custom", `${tr("Свой шрифт")}: ${settings.fontName || tr("шрифт")}`]] : FONT_OPTIONS}
            onChange={(font) => onChange({ font }, `${title}: шрифт`)}
          />
          {/* Свой шрифт — файлом или из установленных на ПК (ТЗ 23.10.2026, п. F). */}
          <FontSources onFont={(font) => onChange({ font: "custom", ...font }, `${title}: шрифт`)} />
          <SegmentedControl label={tr("Буквы")} size="sm" options={TEXT_STYLE_OPTIONS} value={settings.style} onChange={(style) => onChange({ style }, `${title}: буквы`)} />
          <ColorField label={tr("Цвет букв")} value={settings.colour} swatches={BUILDING_SWATCHES} editable onChange={(colour) => onChange({ colour }, `${title}: цвет`)} />
          {settings.style !== "neon" && (
            <ColorField label={tr("Обводка")} value={settings.outline} swatches={BUILDING_SWATCHES} editable onChange={(outline) => onChange({ outline }, `${title}: обводка`)} />
          )}
          {!opaque && (
            <SegmentedControl label={tr("Фон")} size="sm" options={TEXT_BACKGROUND_OPTIONS} value={settings.background} onChange={(background) => onChange({ background }, `${title}: фон`)} />
          )}
          {(opaque || settings.background === "colour") && (
            <ColorField label={tr("Цвет плашки")} value={settings.backgroundColour} swatches={BUILDING_SWATCHES} editable onChange={(backgroundColour) => onChange({ backgroundColour }, `${title}: плашка`)} />
          )}
        </>
      )}
      <span hidden data-building-text={id} />
      <ActionRows label={`${title}: ${tr("как в игре")}`} actions={[settings.mode !== "standard" && { id: "text-standard", label: tr("Вернуть как в игре"), onClick: () => onChange({ mode: "standard" }, `${title}: режим`) }]} />
    </>
  );
}

/*
 * Объёмные буквы названия, что заменяются своими (`tool: "title"` описи —
 * DAVIS MEGA MALL на углу фасада Мегамолла): буквы игры уходят из модели,
 * на их месте — буквы человека.
 */
function LetterSigns({ place, project, onSign }) {
  const signs = buildingSigns(place).filter((sign) => sign.tool === "title" && sign.covers?.length);
  return signs.map((sign) => (
    <Section
      key={sign.id}
      id={`sign-${sign.id}`}
      title={sign.label}
      help={[
        ...textHelp({ settings: project.signs[sign.id], defaults: sign.text || "", erased: true }),
        trFill(
          "{0}. Буквы — объёмные модели: свой текст их заменяет — буквы игры уходят с фасада, на их месте встают ваши (фон — «Только буквы» или плашка цветом). Издалека дальние планы здания показывают то же.",
          sign.covers.map((item) => item.label).join(", "),
        ),
      ]}
    >
      <TextControls
        id={sign.id}
        title={sign.label}
        settings={project.signs[sign.id]}
        lines={sign.lines || 1}
        defaults={sign.text || ""}
        onChange={(patch, label) => onSign(sign.id, patch, label)}
      />
    </Section>
  ));
}

function TitleTool({ place, project, onTitle, onSign, placing, onPlacing }) {
  useTr();
  const title = buildingTitle(place);
  if (!title) return <p className="fx-hint">{tr("У этого здания нет своей надписи.")}</p>;
  const plate = title.kind === "plate";
  const cover = title.kind === "cover";
  const coverPlaces = (title.covers || []).map((item) => item.label.toLowerCase());
  /* У Мегамолла надпись — буквы на стенах здания; пилон у дороги с теми же
     буквами — своя табличка («Таблички»). */
  const target = buildingTextTargets(place).find((item) => item.id === "title");
  const split = Boolean(target?.split);
  /* Буквы MEGA MALL на стенах — как в игре (своя надпись там снята): здесь
     только объёмные буквы, свой текст на стенах — инструментом «Текст». */
  /* Свои надписи на стенах — на первой странице «Текста» (назад — «К своим надписям»). */
  if (buildingTitleRetired(place)) return <LetterSigns place={place} project={project} onSign={onSign} />;
  return (
    <>
    <LetterSigns place={place} project={project} onSign={onSign} />
    <Section
      id="title"
      title={cover ? title.label || tr("Название") : split ? target.label : tr("Надпись")}
      help={[
        ...textHelp({ settings: project.title, defaults: title.text || "", opaque: cover, covered: cover }),
        plate && project.title.mode === "text" ? tr("Своей надписи у здания нет — она встанет плашкой на фасад; место ставится прямо в кадре.") : "",
        cover
          ? trFill(
              "Буквы {0} — объёмные модели. Своё название встаёт плашкой цветом поверх них, во всех местах сразу: {1}. «Убрать» закрывает буквы плашкой цвета фона. Издалека дальние планы получают ту же картинку.",
              title.text,
              coverPlaces.join(", "),
            )
          : "",
        !plate && !cover
          ? split
            ? tr("Только буквы на стенах здания. Пилон у дороги с теми же буквами — в «Табличках»: там свой текст или как в игре.")
            : tr("Надпись ложится в тот же лист, что и штатная, — на её место на фасаде; издалека дальние планы получают ту же картинку.")
          : "",
      ]}
    >
      <TextControls id="title" title={tr("Надпись")} settings={project.title} lines={title.lines || 1} defaults={title.text || ""} opaque={cover} onChange={onTitle} />
      {plate && project.title.mode === "text" && (
        <>
          <div className="recolor-actions">
            <Button size="sm" variant={placing ? "primary" : "secondary"} aria-pressed={placing} onClick={() => onPlacing(!placing)}>
              {placing ? tr("Готово") : tr("Ставить в кадре")}
            </Button>
          </div>
          <Slider
            label={tr("Высота букв")}
            value={project.title.size}
            min={BUILDING_TITLE_SIZE[0]}
            max={BUILDING_TITLE_SIZE[1]}
            step={0.5}
            format={metresText}
            onChange={(size) => onTitle({ size }, "Надпись: высота")}
          />
        </>
      )}
    </Section>
    </>
  );
}

const OPAQUE = /DXT1|BC1/i;

/*
 * Места таблички по одному (задача 10): у таблички много мест — флаги,
 * таблички складов, — и каждое может получить свой текст. Место без своей
 * надписи — как табличка («Все сразу»).
 */
/*
 * Места по сторонам здания и слева направо, как их видно со стороны: номер
 * места в окне идёт по фасаду, а подпись говорит, на какой стороне оно.
 */
function orderedSpots(place, target) {
  const sides = BUILDING_SIDE_IDS.map((id, order) => ({ id, order, side: buildingSide(place, id) })).filter((item) => item.side?.normal);
  const placed = target.places.map((spot, index) => {
    const normal = spot.normal || [0, 0, 1];
    const best = sides.reduce((found, item) => {
      const dot = item.side.normal[0] * normal[0] + item.side.normal[1] * normal[1];
      return !found || dot > found.dot ? { ...item, dot } : found;
    }, null);
    /* Вдоль стороны: слева направо для того, кто смотрит на неё снаружи. */
    const along = best ? (spot.point?.[0] || 0) * best.side.normal[1] - (spot.point?.[1] || 0) * best.side.normal[0] : index;
    return { spot, key: buildingSignPlaceKey(target.id, spot), side: best, along };
  });
  return placed
    .sort((left, right) => (left.side?.order ?? 9) - (right.side?.order ?? 9) || left.along - right.along)
    .map((item, index) => ({ ...item, index, hint: item.side?.side?.label || "" }));
}

function SignPlaces({ place, target, project, opaque, lines, defaults, onSignPlace }) {
  useTr();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  if (!target || target.places.length < 2) return null;
  const spots = orderedSpots(place, target);
  const own = spots.filter((item) => project.signPlaces?.[item.key]).length;
  const chosen = spots.find((item) => item.key === selected) || null;
  const settings = chosen ? project.signPlaces?.[chosen.key] : null;
  const label = (index) => trFill("{0}: место {1}", target.label, index + 1);
  return (
    <Section
      id={`sign-places-${target.id}`}
      title={tr("По одному")}
      help={[
        own
          ? trFill("Мест: {0}, со своей надписью — {1}. Раскройте — и дайте любому месту свой текст; остальные — как табличка.", target.places.length, own)
          : trFill("Мест: {0}. Раскройте — и дайте любому месту свой текст; остальные — как табличка.", target.places.length),
        ...(chosen && settings ? textHelp({ settings, defaults, opaque }) : []),
      ]}
    >
      <div className="recolor-actions">
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? tr("Свернуть") : trFill("Раскрыть · {0}", target.places.length)}
        </Button>
      </div>
      {/* Места — строками «Место 3 · своя надпись · с юга», своё — с «×» (как табличка); плиток нет (владелец 31.10.2026). */}
      {open && (
        <ListGroup label={`${target.label}: по одному`}>
          {spots.map((item) => {
            const on = selected === item.key;
            const row = {
              className: on ? "is-selected" : "",
              "aria-pressed": on,
              title: trFill("Место {0}", item.index + 1),
              caption: `${project.signPlaces?.[item.key] ? tr("Своя надпись") : tr("Как табличка")}${item.hint ? ` · ${item.hint.toLowerCase()}` : ""}`,
              trailing: on ? <Check aria-hidden="true" /> : null,
              "data-building-sign-spot": item.key,
              onOpen: () => setSelected(on ? "" : item.key),
            };
            return project.signPlaces?.[item.key] ? (
              <ListRow key={item.key} {...row} onClear={() => onSignPlace(item.key, null, `${label(item.index)}: ${tr("как табличка")}`)} clearLabel={tr("Как табличка")} />
            ) : (
              <NavRow key={item.key} {...row} />
            );
          })}
        </ListGroup>
      )}
      {open && chosen && (
        <div className="recolor-subsection arena-element-editor" data-building-sign-place={chosen.key}>
          <label className="fx-switch">
            <span>
              <b>{trFill("Место {0}", chosen.index + 1)}</b>
              <small>{settings ? tr("Своя надпись — остальные места как табличка") : tr("Как табличка")}</small>
            </span>
            <Switch
              checked={Boolean(settings)}
              label={`${label(chosen.index)}: своя надпись`}
              onChange={(value) => onSignPlace(chosen.key, value ? { ...project.signs[target.id] } : null, `${label(chosen.index)}: ${value ? tr("своя надпись") : tr("как табличка")}`)}
            />
          </label>
          {settings && (
            <TextControls
              id={chosen.key}
              title={label(chosen.index)}
              settings={settings}
              lines={lines}
              opaque={opaque}
              defaults={defaults}
              onChange={(patch, text) => onSignPlace(chosen.key, patch, text)}
            />
          )}
        </div>
      )}
    </Section>
  );
}

function SignsTool({ place, project, sign: signId, onSignId, onSign, onSignPlace }) {
  useTr();
  const entries = buildingSignEntries(place);
  const entry = entries.find((item) => item.id === signId) || entries[0];
  if (!entry) return <p className="fx-hint">{tr("У этого здания нет табличек.")}</p>;
  const title = buildingTitle(place);
  const sign = entry.sign;
  const textures = new Map((buildingInventory(place)?.building?.textures || []).map((record) => [record.name, record]));
  const covered = Boolean(!entry.target && sign?.covers?.length);
  const opaque = covered || (entry.target?.places || []).every((spot) => OPAQUE.test(textures.get(spot.texture)?.format || ""));
  const places = entry.target ? entry.target.places.length : sign?.covers?.length || 0;
  const split = Boolean(entry.target?.split);
  /* Что стоит у таблички сейчас — подписью её строки. */
  const signModeText = (settings) => tr(TEXT_MODE_OPTIONS.find(([mode]) => mode === (settings?.mode || "standard"))?.[1] || "Как в игре");
  return (
    <>
      <Section
        id={`sign-${entry.id}`}
        title={entry.label}
        help={textHelp({ settings: project.signs[entry.id], defaults: (sign ? sign.text : title?.text) || "", opaque, covered })}
      >
        <TextControls
          id={entry.id}
          title={entry.label}
          settings={project.signs[entry.id]}
          lines={entry.target?.lines || sign?.lines || 1}
          opaque={opaque}
          defaults={(sign ? sign.text : title?.text) || ""}
          onChange={(patch, label) => onSign(entry.id, patch, label)}
        />
      </Section>
      <SignPlaces
        key={entry.id}
        place={place}
        target={entry.target?.source === "title" ? null : entry.target}
        project={project}
        opaque={opaque}
        lines={entry.target?.lines || sign?.lines || 1}
        defaults={(sign ? sign.text : title?.text) || ""}
        onSignPlace={onSignPlace}
      />
      {/* Какая табличка — строками под её правкой (п. 12 `design-qa.md`), а не выпадающим списком: щелчок выбирает, кадр показывает её. */}
      <Section id="sign" title={tr("Табличка")} bare>
        <ListGroup
          title={tr("Какая табличка")}
          help={[
            places > 1 ? trFill("Мест у этой таблички: {0}.", places) : tr("Одно место."),
            covered
              ? tr("Буквы этой таблички — объёмные модели: свой текст встаёт плашкой цветом поверх них.")
              : split
                ? tr("Текст ложится только сюда — другие места с теми же буквами (стены здания, другой пилон) остаются как были или со своим текстом.")
                : tr("Текст и цвет ложатся в лист таблички — на все её места сразу."),
          ]}
        >
          {entries.map((item) => (
            <NavRow
              key={item.id}
              className={item.id === entry.id ? "is-selected" : ""}
              aria-pressed={item.id === entry.id}
              title={item.label}
              caption={(project.signs[item.id]?.mode || "standard") === "standard" ? null : signModeText(project.signs[item.id])}
              data-building-sign={item.id}
              onOpen={() => onSignId(item.id)}
            />
          ))}
        </ListGroup>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Эмблемы и надписи — общая система мест (задача 1)
 * ------------------------------------------------------------------ */

function EmblemsTool({ kind, emblems, onResetEmblem, onNotice }) {
  useTr();
  return (
    <EmblemSection
      edit={emblems}
      kind={kind}
      sizeRange={BUILDING_LOGO_SIZE}
      resetLabel={tr("На фасад")}
      onReset={onResetEmblem}
      intro={
        kind === "text"
          ? tr("Надписи — сколько нужно (до восьми), каждая со своими словами, шрифтом (можно свой файл шрифта), высотой букв, цветом и прозрачностью. Каждую можно поставить на любую стену здания — щелчком в кадре, и в полёте тоже.")
          : tr("Свои картинки — сколько нужно (до восьми): логотип магазина, семьи, вывеска. Загрузите PNG с прозрачным фоном — рекомендуемый размер 1024×1024 px (широкая — 1024×512): крупнее лист плашки в игре не бывает.")
      }
      note={tr("Вблизи эмблема или надпись — плашка на стене, издалека её картинка нарисована в листах дальних моделей здания: она не пропадает и не прыгает.")}
      onNotice={onNotice}
    />
  );
}

/*
 * «Текст» здания — одно место для всех слов (19.10.2026): сверху название здания
 * строкой-переходом (DAVIS MEGA MALL, «Ашан»…; его страница — те же органы, что
 * были у «Надписи»), ниже свои надписи щелчком по стене, как надпись «Большой карты».
 */
function buildingNameCaption(settings, defaults) {
  if (settings?.mode === "text") return settings.lines?.filter((line) => line.trim()).join(" ") || defaults;
  if (settings?.mode === "hidden") return tr("Без надписи");
  return defaults;
}

function TextTool({ place, project, emblems, textPage, onTextPage, onTitle, onSign, placing, onPlacing, onResetEmblem, onNotice }) {
  useTr();
  const title = buildingTitle(place);
  if (title && textPage === "title")
    return <TitleTool place={place} project={project} onTitle={onTitle} onSign={onSign} placing={placing === "title"} onPlacing={(on) => onPlacing(on ? "title" : null)} />;
  /* Название — буквы на углу фасада (Мегамолл) или своя надпись здания. */
  const letters = buildingSigns(place).filter((sign) => sign.tool === "title" && sign.covers?.length);
  const names = buildingTitleRetired(place)
    ? letters.map((sign) => buildingNameCaption(project.signs[sign.id], (sign.text || "").replace(/\n/g, " ")))
    : [buildingNameCaption(project.title, (title?.text || "").replace(/\n/g, " "))];
  return (
    <>
      {/* Сверху — одной строкой: под настройками выбранной надписи её не видно. */}
      {title && (
        <Section id="title" title={tr("Название здания")}>
          {/* Название — данные здания (DAVIS MEGA MALL), а не подпись окна: прописными, как на фасаде. */}
          <NavRow
            title={<span data-audit-ignore="caps">{names.filter(Boolean).join(" · ") || tr("Название здания")}</span>}
            caption={tr("Вместо штатных букв здания")}
            onOpen={() => onTextPage("title")}
          />
        </Section>
      )}
      {emblems && <EmblemsTool kind="text" emblems={emblems} onResetEmblem={onResetEmblem} onNotice={onNotice} />}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Панель
 * ------------------------------------------------------------------ */

function Panel({
  place,
  tool,
  project,
  side,
  onSideId,
  billboard,
  onBillboardId,
  onBillboard,
  sign,
  onSignId,
  emblems = null,
  onResetEmblem = null,
  onBuilding,
  onPart,
  onSide,
  onTitle,
  onSign,
  onSignPlace,
  onStandard,
  onPreset,
  onNotice,
  placing,
  onPlacing,
  textPage = "",
  onTextPage = () => {},
  stampPanel = null,
  partPage = "",
  onPartPage = () => {},
  onWallPlace = null,
  onWallRemove = null,
}) {
  useTr();
  if (tool === "building")
    return (
      <BuildingTool
        place={place}
        project={project}
        onBuilding={onBuilding}
        onPart={onPart}
        onNotice={onNotice}
        partPage={partPage}
        onPartPage={onPartPage}
        onWallPlace={onWallPlace}
        onWallRemove={onWallRemove}
      />
    );
  if (tool === "patterns" && stampPanel) return stampPanel;
  if (tool === "sides") return <SideTool place={place} project={project} side={side} onSideId={onSideId} onSide={onSide} onNotice={onNotice} />;
  if (tool === "billboards")
    return <BillboardTool place={place} project={project} billboard={billboard} onBillboardId={onBillboardId} onBillboard={onBillboard} onNotice={onNotice} />;
  if (tool === "text")
    return (
      <TextTool
        place={place}
        project={project}
        emblems={emblems}
        textPage={textPage}
        onTextPage={onTextPage}
        onTitle={onTitle}
        onSign={onSign}
        placing={placing}
        onPlacing={onPlacing}
        onResetEmblem={onResetEmblem}
        onNotice={onNotice}
      />
    );
  if (tool === "signs") return <SignsTool place={place} project={project} sign={sign} onSignId={onSignId} onSign={onSign} onSignPlace={onSignPlace} />;
  if (tool === "emblem" && emblems) return <EmblemsTool kind="image" emblems={emblems} onResetEmblem={onResetEmblem} onNotice={onNotice} />;
  return (
    <>
      <BuildingPresets place={place} project={project} onApply={onPreset} />
      {/* «Как в игре» — строкой внизу (`ActionRows`) и только когда есть что возвращать: погашенной кнопки, заголовка и абзаца нет (п. 15; «Как в игре» —
          и первый из готовых видов выше); что вернётся — подсказкой строки. */}
      {!buildingProjectIsStock(place, project) && (
        <ActionRows
          label={tr("Действия со зданием")}
          actions={[{ id: "standard", label: tr("Вернуть как в игре"), title: tr("Всё как в игре одним шагом: цвета, стороны, надпись и таблички — штатные, эмблемы и надписи снимаются."), onClick: onStandard }]}
        />
      )}
    </>
  );
}

/* `aim` — раздел, на который щёлкнули в кадре (`{ key, count }`): колонка подводит к нему. */
export default function BuildingInspector({ aim = null, ...props }) {
  return (
    <AimContext.Provider value={aim || NO_AIM}>
      <Panel {...props} />
    </AimContext.Provider>
  );
}
