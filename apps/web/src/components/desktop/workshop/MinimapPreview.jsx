import { useEffect, useRef, useState } from "react";
import {
  MINIMAP_BUILTIN_ICONS,
  MINIMAP_LAYOUT_SCHEMA_VERSION,
  MINIMAP_RADAR,
  MINIMAP_SCENE,
  MINIMAP_STOCK_BARS,
  MINIMAP_STOCK_BAR_PADS,
  MINIMAP_STOCK_BAR_PAD_OPACITY,
  MINIMAP_STRIP,
  MINIMAP_EDITOR_UNITS,
  minimapBarIconRect,
  minimapBarsUseStockStrip,
  minimapFrameRects,
  minimapIconRect,
  minimapOutlineRects,
  minimapUnitsToScene,
  syncLegacyMinimapFields,
} from "./minimap-layout.js";
import {
  MINIMAP_GAME_MAP_OPACITY,
  MINIMAP_LOSS_SPEEDS,
  MINIMAP_PLAYER_POINT,
  MINIMAP_RADAR_ASPECT,
  minimapBarAnimated,
  minimapDamageImageBox,
  minimapFillActive,
  minimapOverlayBox,
  minimapTierColor,
  minimapTierFills,
  minimapTierOf,
} from "@modovik/minimap-contract";
import {
  MINIMAP_BIG_RADAR,
  MINIMAP_BIG_SCALE,
  minimapBigOverlayBox,
  minimapBigViewConfig,
} from "./minimap-big-view.js";
import { DEMO_ARMOR_MAX, DEMO_HEALTH_MAX } from "./minimap-demo.js";
import { MINIMAP_RADAR_FIELD } from "./hud-preview/hud-map-field.js";
import { BLIP_GLYPH_ART } from "./blips/blips-art.js";
import { getWorkshopAsset } from "./workshop-assets.js";
import FillCanvas, { useFillVideoImage } from "./minimap-fill/FillCanvas.jsx";
import AuthoredVitals from "./MinimapAuthored.jsx";
import { VitalGauge } from "./minimap-tools/VitalShape.jsx";
import VitalPlate from "./minimap-tools/VitalPlate.jsx";
import { numberIsInside, vitalIconStyle } from "./minimap-tools/vital-icon-view.js";
import { ARMOUR_PRESENT_MIN } from "./minimap-tools/vital-plate-view.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useMinimapCopy } from "./minimap-lang.js";

/*
 * Мини-карта в той же геометрии, в какой её собирает компилятор.
 *
 * Коробка — вся сцена minimap.gfx (191×136): радар 179×115 в точке (6, 8) и
 * поля вокруг, куда можно вынести полосы. Под радаром — штатная подложка
 * полос, пока полосы в ней стоят; ушли на карту — подложки нет, как и в игре.
 * Раньше предпросмотр был картой 180:131 без полей, и полосы «у края» в
 * редакторе и в игре стояли в разных местах.
 *
 * Полоса складывается из тех же слоёв, что в игре: лента под радаром, тёмная
 * подложка `bar_bg`, дорожка и полупрозрачная заливка. Поэтому «как в игре» в
 * редакторе — приглушённый зелёный, каким он и выходит на экране, а не чистый
 * цвет палитры.
 *
 * Компонент общий: редактор рисует им большую карту и миниатюры видов,
 * библиотека и «Мои работы» — обложку работы.
 */

/* Запас демонстрации — в общем модуле хода урона (`minimap-demo.js`); отсюда он по-прежнему доступен тем, кто читает его у предпросмотра. */
export { DEMO_ARMOR_MAX, DEMO_HEALTH_MAX };

/* Обложка работы: HP целиком, броня наполовину — видно и заливку, и дорожку. */
export const MINIMAP_COVER_DEMO = Object.freeze({
  health: DEMO_HEALTH_MAX,
  armor: DEMO_ARMOR_MAX / 2,
  trail: 0,
  trailTarget: "armor",
  flash: false,
});

/*
 * Метки других людей для примера (задача 1 ТЗ 17.10.2026): два кружка цветами
 * игроков из hudcolor.dat (HUD_COLOUR_NET_PLAYER2 и _NET_PLAYER5). Нарисованы
 * окном — в игре кружок и цвет даёт сама игра; подпись кадра так и говорит.
 */
const DEMO_OTHERS = Object.freeze([
  Object.freeze({ x: 0.27, y: 0.34, color: "#a0c2f2" }),
  Object.freeze({ x: 0.74, y: 0.63, color: "#e19a41" }),
]);
/** Сторона штатного кружка человека, точек сцены (`radar_level`). */
const OTHERS_SCENE_SIDE = 13;

/* Стрелка игрока — тот же силуэт, что у значка игрока в редакторе значков.
   Рамка обрезана по самой стрелке. */
const PLAYER_ARROW_PATH = BLIP_GLYPH_ART.arrow[0];
const PLAYER_ARROW_BOX = "22 20 56 60";
/* Высота штатной стрелки — 16 точек сцены. */
const MARKER_SCENE_HEIGHT = 16;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/*
 * Дорожка полосы так, как её рисует игра: фигура серая 204 с прозрачностью
 * 50%, окрашенная `Colourise` — к каждому каналу прибавляется цвет минус
 * 255. Получается тёмный тон цвета полосы, а не отдельный цвет подложки.
 */
export function minimapTrackColor(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(String(hex || "")) ? hex : "#ffffff";
  const channels = [1, 3, 5].map((start) =>
    clamp(Number.parseInt(value.slice(start, start + 2), 16) - 51, 0, 255),
  );
  return `rgba(${channels.join(", ")}, 0.5)`;
}

/** Цвет с прозрачностью в процентах — так, как его кладёт фигура в игре. */
export function minimapColorWithOpacity(hex, percent) {
  const value = /^#[0-9a-f]{6}$/i.test(String(hex || "")) ? hex : "#ffffff";
  const channels = [1, 3, 5].map((start) =>
    Number.parseInt(value.slice(start, start + 2), 16),
  );
  return `rgba(${channels.join(", ")}, ${clamp(Number(percent) || 0, 0, 100) / 100})`;
}
const sceneX = (x) =>
  `${((MINIMAP_RADAR.x + x * MINIMAP_RADAR.width) / MINIMAP_SCENE.width) * 100}%`;
const sceneY = (y) =>
  `${((MINIMAP_RADAR.y + y * MINIMAP_RADAR.height) / MINIMAP_SCENE.height) * 100}%`;
const sceneWidth = (width) =>
  `${((width * MINIMAP_RADAR.width) / MINIMAP_SCENE.width) * 100}%`;
const sceneHeight = (height) =>
  `${((height * MINIMAP_RADAR.height) / MINIMAP_SCENE.height) * 100}%`;
/* Точки сцены — долей коробки: так приходят линии обводки и подложки игры. */
const pointsX = (points) => `${(points / MINIMAP_SCENE.width) * 100}%`;
const pointsY = (points) => `${(points / MINIMAP_SCENE.height) * 100}%`;
/* Точки проекта (360 на ширину радара) в CSS. `--mmc-unit` задан листом. */
const unit = (value) => `calc(var(--mmc-unit, 1px) * ${value})`;
/* Точки сцены — в тех же единицах. */
const sceneUnits = (points) =>
  unit((points * MINIMAP_EDITOR_UNITS) / MINIMAP_RADAR.width);

/*
 * Контур полосы в долях самой полосы.
 *
 * Считается тем же `minimapFrameRects`, каким компилятор кладёт контур в
 * игру: длина берётся вся (заливку игра сжимает, а рамка стоит), линия идёт
 * внутрь, углы принадлежат верхней и нижней.
 */
function barOutlineRects(widget, effects) {
  const box = {
    x: 0,
    y: 0,
    width: widget.width * MINIMAP_RADAR.width,
    height: (widget.height * effects.barThickness * MINIMAP_RADAR.height) / 8,
  };
  return minimapFrameRects(
    box,
    minimapUnitsToScene(effects.barOutlineWidth),
    {},
    "inside",
  ).map((line) => ({
    side: line.side,
    left: (line.x / box.width) * 100,
    top: (line.y / box.height) * 100,
    width: (line.width / box.width) * 100,
    height: (line.height / box.height) * 100,
  }));
}

/*
 * Элементы, которые человек двигает по карте. Порядок — порядок полки в
 * инспекторе: сперва полосы, потом цифры, потом значки.
 */
export const MINIMAP_WIDGET_LABELS = Object.freeze({
  /* Читаются в момент показа: строка берётся на языке окна. */
  get healthBar() {
    return tr("Полоса HP");
  },
  get armorBar() {
    return tr("Полоса брони");
  },
  get healthNumber() {
    return tr("Цифры HP");
  },
  get armorNumber() {
    return tr("Цифры брони");
  },
  get healthIcon() {
    return tr("Значок HP");
  },
  get armorIcon() {
    return tr("Значок брони");
  },
});

export const MINIMAP_WIDGET_IDS = Object.freeze(
  Object.keys(MINIMAP_WIDGET_LABELS),
);

/** Что это за элемент: полоса, цифры или значок. */
export function minimapWidgetKind(id) {
  if (id.endsWith("Bar")) return "bar";
  if (id.endsWith("Number")) return "number";
  return "icon";
}

function builtInIconUrl(kind, preset) {
  return (
    MINIMAP_BUILTIN_ICONS[kind].find((item) => item.id === preset)?.src || ""
  );
}

/* Картинка значка HP или брони: свой файл человека или шаблон. */
export function vitalIconUrl(config, isHealth, assetUrls) {
  const preset = isHealth
    ? config.effects.healthIconPreset
    : config.effects.armorIconPreset;
  return preset === "custom"
    ? assetUrls?.[isHealth ? "healthIcon" : "armorIcon"]
    : builtInIconUrl(isHealth ? "health" : "armor", preset);
}

/* Рисуется ли значок на карте: шкала — всегда, картинка — когда у неё есть адрес (иначе `VitalWidget` его не ставит, и плашке нечего обводить). */
function vitalIconDrawn(config, isHealth, assetUrls) {
  return (
    vitalIconStyle(config.effects, isHealth ? "health" : "armour") !== null ||
    Boolean(vitalIconUrl(config, isHealth, assetUrls))
  );
}

/*
 * Свои картинки проекта (значки, стрелка, урон) из хранилища мастерской.
 * Адреса отзываются, когда компонент уходит с экрана.
 */
export function useMinimapAssetUrls(project, config) {
  const [assetUrls, setAssetUrls] = useState({});
  const urlsRef = useRef({});
  const effects = config?.effects || {};
  /* Свои картинки на карте (задача 1 ТЗ 17.10.2026): слот —
     `overlay:<номер>:<файл>`, строкой JSON — чтобы эффект не перезапускался
     от каждой новой ссылки на тот же список. */
  const overlayAssets = JSON.stringify(
    (Array.isArray(config?.overlays) ? config.overlays : [])
      .filter((item) => item?.kind === "image" && item.image?.assetId)
      .map((item) => [`overlay:${item.id}:${item.image.assetId}`, item.image.assetId]),
  );
  useEffect(() => {
    let active = true;
    const fields = {
      healthIcon: effects.healthIconAssetId,
      armorIcon: effects.armorIconAssetId,
      playerMarker: effects.playerMarkerAssetId,
      othersMarker: effects.othersAssetId,
      damage: effects.damageAssetId,
      /* Лист кадров своего видео заливки (задача 8). */
      healthFill: effects.healthFill?.video?.assetId,
      armorFill: effects.armorFill?.video?.assetId,
      ...Object.fromEntries(JSON.parse(overlayAssets)),
    };
    Promise.all(
      Object.entries(fields).map(async ([slot, assetId]) => {
        if (!assetId || urlsRef.current[slot]) return null;
        const asset = project?.assets?.find((item) => item.id === assetId);
        if (!asset?.storageKey) return null;
        const blob = await getWorkshopAsset(asset.storageKey).catch(() => null);
        if (!blob) return null;
        return [slot, URL.createObjectURL(blob)];
      }),
    ).then((entries) => {
      const next = Object.fromEntries(entries.filter(Boolean));
      if (!active) {
        for (const url of Object.values(next)) URL.revokeObjectURL(url);
        return;
      }
      if (Object.keys(next).length)
        setAssetUrls((current) => {
          const merged = { ...current, ...next };
          urlsRef.current = merged;
          return merged;
        });
    });
    return () => {
      active = false;
    };
  }, [
    project?.assets,
    effects.healthIconAssetId,
    effects.armorIconAssetId,
    effects.playerMarkerAssetId,
    effects.othersAssetId,
    effects.damageAssetId,
    effects.healthFill?.video?.assetId,
    effects.armorFill?.video?.assetId,
    overlayAssets,
  ]);
  useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current))
        URL.revokeObjectURL(url);
    },
    [],
  );
  /* Своя картинка, только что выбранная человеком, до сохранения в
     хранилище: редактор кладёт её сюда сам. */
  const remember = (slot, url) =>
    setAssetUrls((current) => {
      const previous = current[slot];
      if (previous && previous !== url) URL.revokeObjectURL(previous);
      const merged = { ...current, [slot]: url };
      urlsRef.current = merged;
      return merged;
    });
  return [assetUrls, remember];
}

/*
 * Счёт вниз (задача 15 ТЗ 10.10.2026, вечер): цифра тает до нового значения
 * с той же скоростью, что в игре (`MINIMAP_LOSS_SPEEDS`, единиц в секунду),
 * — в игре её ведёт счётчик в кадре minimap.gfx, здесь кадры браузера. Без
 * счёта, в обложке и в неподвижном кадре — сразу новое значение.
 */
/* Размер своей картинки урона: место на радаре считается от её пропорций. */
function useImageSize(url) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setSize({ url, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  return url && size?.url === url ? size : null;
}

function useCountdown(target, rate, enabled) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame !== "function") {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now) => {
      const seconds = Math.max(0, (now - last) / 1000);
      last = now;
      const delta = target - shownRef.current;
      if (Math.abs(delta) <= rate * seconds) {
        shownRef.current = target;
        setShown(target);
        return;
      }
      shownRef.current += Math.sign(delta) * rate * seconds;
      setShown(shownRef.current);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, rate, enabled]);
  return enabled ? shown : target;
}

/*
 * Что пишут цифры: у каждой полосы своё или одна общая — пока есть броня,
 * она, потом HP (`lossDisplay: "combined"`, на месте цифр HP).
 */
function numberValue(id, numbers, effects) {
  if (id === "healthNumber" && effects.lossDisplay === "combined")
    return numbers.armor >= 0.5 ? numbers.armor : numbers.health;
  return id === "healthNumber" ? numbers.health : numbers.armor;
}

function VitalWidget({
  id,
  config,
  demo,
  numbers,
  selected,
  onSelect,
  onPointerDown,
  still,
  iconUrl = "",
  /* Лист кадров своего видео заливки этой полосы (задача 8). */
  fillVideo = null,
  /* Большая карта: цифры стоят в кадре, который игра уменьшает в `MINIMAP_BIG_SCALE` раз вместе со значками (`fontHeight = numberSize × frame.scale` в сборке). */
  big = false,
}) {
  const copy = useMinimapCopy();
  const widget = config.layout.widgets[id];
  if (!widget?.visible) return null;
  const { effects } = config;
  /* Одна общая цифра стоит на месте цифр HP — цифр брони тогда нет. */
  if (id === "armorNumber" && effects.lossDisplay === "combined") return null;
  const isHealth = id.startsWith("health");
  const kind = minimapWidgetKind(id);
  const isBar = kind === "bar";
  const value =
    kind === "number"
      ? numberValue(id, numbers, effects)
      : isHealth
        ? demo.health
        : demo.armor;
  const maximum = isHealth ? DEMO_HEALTH_MAX : DEMO_ARMOR_MAX;
  const fill = clamp((value / maximum) * 100, 0, 100);
  /* Значок-шкала (10.11.2026): фигура убывает с запасом, картинка не нужна. */
  const gaugeSide = isHealth ? "health" : "armour";
  const gauge = kind === "icon" && vitalIconStyle(effects, gaugeSide) !== null;
  if (kind === "icon" && !iconUrl && !gauge) return null;
  const thickness = isBar ? effects.barThickness / 8 : 1;
  /* Значок всегда квадрат: доли радара по ширине и высоте разные, и размер у
     значка один — тот же расчёт кладёт его в игру. */
  const box = kind === "icon" ? minimapIconRect(widget) : widget;
  /* «Броню показывать, только когда она есть» (21.11.2026): значок и цифры брони при нуле гаснут, с бронёй возвращаются; в раскладке они стоят на месте. */
  const fades = effects.armourOnlyWhenPresent === true && !isHealth && !isBar;
  const absent = fades && numbers.armor < ARMOUR_PRESENT_MIN;
  const style = {
    left: sceneX(box.x),
    top: sceneY(box.y),
    width: sceneWidth(box.width),
    height: sceneHeight(box.height * thickness),
    opacity: absent ? 0 : widget.opacity,
    transform: `translate(-50%, -50%) rotate(${isBar ? widget.rotation : 0}deg)`,
    zIndex: widget.zIndex,
  };
  /* Красный хвост урона у игры есть только у HP (`healthBarRed`). */
  const trail = isHealth && demo.trailTarget === "health" ? demo.trail : 0;
  /*
   * Заливка по порогам (задача 8): во всю длину полосы, а долю отрезает
   * край — как маска полосы в игре. У каждого порога свой слой: готовый вид
   * или ровный цвет порога (`minimapTierColor`, та же функция, что ступени в
   * игре); у HP при малом запасе с ровным цветом — анимация полной полосы,
   * умноженная на «Мало HP», как и в игре.
   */
  const side = isHealth ? "health" : "armor";
  const tierFills = isBar ? minimapTierFills(effects, side) : null;
  const tier = isBar ? minimapTierOf(effects, side, fill) : "full";
  const animated = isBar && minimapBarAnimated(effects, side);
  const lowTint =
    animated &&
    isHealth &&
    tier === "low" &&
    !minimapFillActive(tierFills.low) &&
    minimapFillActive(tierFills.full);
  const shownFill = !animated
    ? null
    : minimapFillActive(tierFills[tier])
      ? tierFills[tier]
      : lowTint
        ? tierFills.full
        : null;
  const color = !isBar
    ? isHealth
      ? effects.healthColor
      : effects.armorColor
    : minimapTierColor(effects, side, fill);
  const className = `mmc-widget is-${kind}${selected ? " is-selected" : ""}${fades ? (absent ? " is-absent" : " is-fading") : ""}`;
  const content =
    kind === "number" ? (
      <b
        className={`mmc-indicator is-font-${effects.numberFont}`}
        /* Кегль цифр — настройка мода («Размер цифр»), в миниатюре ещё и
           доля ширины карты. Мерить его шкалой подписей лаунчера — спорить
           с самой настройкой. */
        data-audit-ignore="type-min type-scale"
        style={{
          fontSize: unit(big ? effects.numberSize * MINIMAP_BIG_SCALE : effects.numberSize),
          color: isHealth ? effects.healthNumberColor : effects.armorNumberColor,
        }}
      >
        {Math.round(value)}
      </b>
    ) : gauge ? (
      <VitalGauge effects={effects} side={gaugeSide} percent={fill} still={still} />
    ) : kind === "icon" ? (
      <i
        className="mmc-widget-icon"
        aria-hidden="true"
        style={{
          backgroundColor: isHealth
            ? effects.healthIconColor
            : effects.armorIconColor,
          maskImage: `url(${iconUrl})`,
          WebkitMaskImage: `url(${iconUrl})`,
        }}
      />
    ) : (
    /* Дорожку игра красит тоном цвета полосы, а при малом здоровье — красным;
       своя подложка — отдельная фигура, и её игра не трогает вовсе. */
    <span
      className="mmc-vital-track"
      style={{
        background:
          effects.trackMode === "custom"
            ? minimapColorWithOpacity(effects.trackColor, effects.trackOpacity)
            : minimapTrackColor(color),
      }}
    >
      {trail > 0 && (
        <i
          className="mmc-damage-trail"
          style={{
            width: `${Math.min(100, fill + trail)}%`,
            background: effects.lowHealthColor,
          }}
        />
      )}
      {shownFill ? (
        <FillCanvas
          className="mmc-vital-anim"
          fill={shownFill}
          alpha={effects.barOpacity / 100}
          low={lowTint ? effects.lowHealthColor : ""}
          video={shownFill === tierFills.full ? fillVideo : null}
          aspect={
            (widget.width * MINIMAP_RADAR.width) /
            Math.max(0.01, widget.height * thickness * MINIMAP_RADAR.height)
          }
          still={still}
          style={{ clipPath: `inset(0 ${100 - fill}% 0 0)` }}
        />
      ) : (
        <i
          className="mmc-vital-fill"
          style={{
            width: `${fill}%`,
            background: minimapColorWithOpacity(color, effects.barOpacity),
          }}
        />
      )}
      {/* Контур — те же прямоугольники, что уходят в игру, а не рамка CSS:
          Chrome округляет толщину рамки вниз до целых точек, и контур в две
          точки рисовался одной. */}
      {effects.barOutline &&
        barOutlineRects(widget, effects).map((line) => (
          <i
            key={line.side}
            className="mmc-vital-outline"
            data-side={line.side}
            style={{
              left: `${line.left}%`,
              top: `${line.top}%`,
              width: `${line.width}%`,
              height: `${line.height}%`,
              background: effects.barOutlineColor,
            }}
          />
        ))}
    </span>
  );
  if (still || !onPointerDown)
    return (
      <span className={className} style={style}>
        {content}
      </span>
    );
  return (
    <button
      type="button"
      className={className}
      style={style}
      onPointerDown={(event) => onPointerDown(event, id)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(id);
      }}
      aria-label={copy.widgetDrag(MINIMAP_WIDGET_LABELS[id])}
      aria-pressed={selected}
      /* Размер этой кнопки — не размер мишени, а сама правимая настройка:
         полоска HP такой и будет в игре. Размер и положение правятся полями
         в инспекторе напротив. Шкалы значков «двойного кольца» стоят одна в другой
         нарочно (общий центр) — перекрытие для них не находка; так же число внутри кольца стоит по центру своего значка. */
      data-audit-ignore={gauge || (kind === "number" && numberIsInside(config, id)) ? "hit-target covered" : "hit-target"}
    >
      {content}
    </button>
  );
}

/*
 * Вылетающие цифры (задача 8 ТЗ 10.10.2026) — та же надпись, что кладёт в
 * игру компилятор: над серединой своей полосы, выше на её толщину;
 * поднимается, чуть растёт и гаснет за время из настройки. Демонстрация урона
 * подкладывает их в `demo.floats`.
 */
const FLOAT_KINDS = Object.freeze({
  damage: { widget: "healthBar", sign: "-", color: "damageNumberColor", on: "floatingHealthDamage" },
  heal: { widget: "healthBar", sign: "+", color: "healNumberColor", on: "floatingHeal" },
  armour: { widget: "armorBar", sign: "-", color: "armorDamageNumberColor", on: "floatingArmorDamage" },
});

function FloatingNumbers({ floats, config, big = false }) {
  const { effects, layout } = config;
  if (!effects.damageNumbers || !floats?.length) return null;
  return floats.map((item) => {
    const kind = FLOAT_KINDS[item.kind];
    const widget = kind && layout.widgets[kind.widget];
    if (!widget?.visible || !effects[kind.on]) return null;
    return (
      <b
        key={item.id}
        /* Как вылетает (задача 15 ТЗ 10.10.2026, вечер): те же кадры, что
           кладёт в игру компилятор, — вверх, вниз, вспышкой, в сторону. */
        className={`mmc-float-number is-${effects.floatStyle || "rise"}`}
        aria-hidden="true"
        /* Кегль — сама настройка мода, как у цифр HP. */
        data-audit-ignore="type-min type-scale"
        style={{
          left: sceneX(widget.x),
          top: sceneY(widget.y - widget.height),
          color: effects[kind.color],
          fontSize: unit(big ? effects.damageNumberSize * MINIMAP_BIG_SCALE : effects.damageNumberSize),
          animationDuration: `${effects.damageNumberDurationMs}ms`,
        }}
      >
        {kind.sign}
        {Math.round(item.value)}
      </b>
    );
  });
}

/*
 * Своя картинка на карте (задача 1 ТЗ 17.10.2026): лист кадров сеткой; GIF
 * листает кадры со своими задержками, в обложке и неподвижном кадре стоит
 * первый кадр — так же, как лист уходит в игру.
 */
function OverlayPicture({ image, url, still }) {
  const [frame, setFrame] = useState(0);
  const animated = !still && image.frames > 1;
  useEffect(() => {
    if (!animated) return undefined;
    const timer = window.setTimeout(
      () => setFrame((current) => (current + 1) % image.frames),
      image.delays[frame] || 100,
    );
    return () => window.clearTimeout(timer);
  }, [animated, frame, image.frames, image.delays]);
  const shown = animated ? frame % image.frames : 0;
  const rows = Math.ceil(image.frames / image.columns);
  const column = shown % image.columns;
  const row = Math.floor(shown / image.columns);
  return (
    <i
      className="mmc-overlay-picture"
      aria-hidden="true"
      data-frame={shown}
      style={{
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: `${image.columns * 100}% ${rows * 100}%`,
        backgroundPosition: `${image.columns > 1 ? (column / (image.columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
      }}
    />
  );
}

/* Свои надписи и картинки на карте: стоят под полосами, как в игре. */
function OverlayLayer({ overlays, assetUrls, still, selected, onPointerDown, onSelect, big = false }) {
  const copy = useMinimapCopy();
  return overlays.map((overlay) => {
    if (!overlay.visible) return null;
    /* Большая карта: центр — по её правилу, размер — малый × `scale` (`minimapBigOverlayBox`). */
    const box = big ? minimapBigOverlayBox(minimapOverlayBox(overlay)) : minimapOverlayBox(overlay);
    const style = {
      left: sceneX(box.x),
      top: sceneY(box.y),
      width: sceneWidth(box.width),
      height: sceneHeight(box.height),
      opacity: overlay.opacity / 100,
    };
    const content =
      overlay.kind === "text" ? (
        <b
          className={`mmc-overlay-text is-font-${overlay.font}`}
          /* Кегль — сама настройка надписи, а не подпись лаунчера. */
          data-audit-ignore="type-min type-scale contrast"
          style={{ fontSize: unit(big ? overlay.size * MINIMAP_BIG_SCALE : overlay.size), color: overlay.color }}
        >
          {overlay.text}
        </b>
      ) : (
        <OverlayPicture
          image={overlay.image}
          url={assetUrls?.[`overlay:${overlay.id}:${overlay.image.assetId}`]}
          still={still}
        />
      );
    const className = `mmc-overlay is-${overlay.kind}${selected === overlay.id ? " is-selected" : ""}`;
    if (still || !onPointerDown)
      return (
        <span key={overlay.id} className={className} style={style} data-overlay={overlay.id}>
          {content}
        </span>
      );
    return (
      <button
        key={overlay.id}
        type="button"
        className={className}
        style={style}
        data-overlay={overlay.id}
        aria-label={copy.widgetDrag(overlay.kind === "text" ? overlay.text || "—" : overlay.image.name || overlay.id)}
        aria-pressed={selected === overlay.id}
        /* Размер — сама надпись или картинка, какой она будет в игре. */
        data-audit-ignore="hit-target"
        onPointerDown={(event) => onPointerDown(event, overlay.id)}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(overlay.id);
        }}
      >
        {content}
      </button>
    );
  });
}

function IconLayer({ id, rect, url, color, zIndex, opacity = 1 }) {
  if (!url) return null;
  return (
    <i
      data-icon={id}
      className="mmc-bar-icon"
      aria-hidden="true"
      style={{
        left: sceneX(rect.x),
        top: sceneY(rect.y),
        width: sceneWidth(rect.width),
        height: sceneHeight(rect.height),
        opacity,
        zIndex,
        backgroundColor: color,
        maskImage: `url(${url})`,
        WebkitMaskImage: `url(${url})`,
      }}
    />
  );
}

/*
 * Карта дальше штатной: тот же квартал, уменьшенный во столько же раз, и его
 * зеркальные копии вокруг — улицы сходятся на стыках, и видно, сколько
 * города ляжет на радар. Это мерка дальности, а не другой район: картинка
 * подложки одна, и подпись над ней так и говорит — «карта для примера».
 * Пяти копий в ряд хватает до ×0.2; предел настройки — ×0.25.
 */
const MOSAIC = 5;

function RadarMosaic({ factor, label }) {
  const centre = (MOSAIC - 1) / 2;
  const cells = [];
  for (let row = 0; row < MOSAIC; row += 1)
    for (let column = 0; column < MOSAIC; column += 1)
      cells.push(
        <img
          key={`${row}-${column}`}
          src={MINIMAP_RADAR_FIELD}
          alt=""
          draggable="false"
          style={{
            transform: `scale(${(column - centre) % 2 ? -1 : 1}, ${(row - centre) % 2 ? -1 : 1})`,
          }}
        />,
      );
  return (
    <div
      className="mmc-radar-mosaic"
      role="img"
      aria-label={label}
      data-zoom={factor}
      style={{
        width: `${MOSAIC * factor * 100}%`,
        height: `${MOSAIC * factor * 100}%`,
      }}
    >
      {cells}
    </div>
  );
}

export default function MinimapPreview({
  config: rawConfig,
  demo = MINIMAP_COVER_DEMO,
  selected = null,
  onSelect = null,
  onWidgetPointerDown = null,
  compact = false,
  still = false,
  /* Сцена без обрезки: HP стоят за её краем («HP отдельно от карты») и всё равно видны. */
  open = false,
  damageImage = "",
  /* «Держать вспышку в предпросмотре»: вспышка стоит на пике, пока её настраивают. */
  holdFlash = false,
  assetUrls = {},
  /* Своя картинка радара вместо штатного квартала (обложка мода). */
  radarSrc = "",
  label: rawLabel,
  radarRef = null,
  /* Какую дальность показать: пешком или в машине. Штатная (×1) рисуется
     одной картинкой, как и обложки. */
  zoomState = "onFoot",
  /* Направляющие магнита, пока редактор тянет элемент
     (`minimap-tools/minimap-snap.js`): `[{axis, at, from, to}]` в долях радара. */
  guides = null,
  /* Показать метки других людей для примера (инструмент «Метки игроков»). */
  others = false,
  /* Вид полос из самого `minimap.gfx` мода (обложка части редукса, `MinimapAuthored.jsx`): вместо
     полос редактора и штатной ленты — прямоугольники файла, цифры и буква N как у автора. */
  look: rawLook = null,
  /* Вид карты: «small» — малая, «big» — развёрнутая («большая карта»): радар 115×120 в (38, 8), элементы — по
     правилу `@modovik/minimap-contract/big-map`. Только просмотр: тянуть там нечего. */
  view = "small",
  /* Свои надписи и картинки: выбранная и протяжка (инструмент «Надписи и
     картинки»); без обработчиков — просто стоят на карте. */
  selectedOverlay = null,
  onOverlayPointerDown = null,
  onOverlaySelect = null,
}) {
  useTr();
  const label = rawLabel ?? tr("Предпросмотр мини-карты GTA V");
  const smallConfig =
    rawConfig?.layoutSchemaVersion === MINIMAP_LAYOUT_SCHEMA_VERSION &&
    rawConfig?.layout?.map &&
    rawConfig?.frame
      ? rawConfig
      : syncLegacyMinimapFields(rawConfig);
  const big = view === "big";
  const config = big ? minimapBigViewConfig(smallConfig) : smallConfig;
  const { effects, layout } = config;
  /* Радар вида: места карты, значка севера, метки игрока и вспышки считаются от него. */
  const radar = big ? MINIMAP_BIG_RADAR : MINIMAP_RADAR;
  const atX = (x) => `${((radar.x + x * radar.width) / MINIMAP_SCENE.width) * 100}%`;
  const atY = (y) => `${((radar.y + y * radar.height) / MINIMAP_SCENE.height) * 100}%`;
  /* Где стоит игрок на радаре: малый радар — точка контракта (измерено H2 14.11.2026, ниже центра), развёрнутый — центр, как был:
     у него точку игрока не измеряли (разбирается отдельно). */
  const player = big ? { x: 0.5, y: 0.5 } : MINIMAP_PLAYER_POINT;
  const atWidth = (width) => `${((width * radar.width) / MINIMAP_SCENE.width) * 100}%`;
  const atHeight = (height) => `${((height * radar.height) / MINIMAP_SCENE.height) * 100}%`;
  const markerSize = sceneUnits(MARKER_SCENE_HEIGHT * effects.playerMarkerScale);
  /* Вид из файла мода заменяет полосы редактора целиком (лента, подложки, полосы,
     цифры, значки на полосах); в редакторе его нет. */
  const look = rawLook?.version === 1 && !onWidgetPointerDown ? rawLook : null;
  /* Штатную ленту и подложки под радаром большой карты не рисуем: у неё свои места, а лента — часть малой сцены. */
  const strip = !look && !big && minimapBarsUseStockStrip(config);
  /* «Скрыть карту» (задача 8): ни карты, ни стрелки, ни N, ни обводки —
     в игре на месте радара мир. В редакторе остаётся пунктир, чтобы было
     видно, откуда считаются полосы. */
  const mapHidden = layout.map?.hidden === true;
  const damageImageSize = useImageSize(damageImage);
  const damageImageBox = damageImageSize
    ? minimapDamageImageBox(effects, damageImageSize.width, damageImageSize.height, MINIMAP_RADAR_ASPECT)
    : null;
  /* Непрозрачность карты (задача 1 ТЗ 17.10.2026): картинка-пример — это
     уже вид игры (73 %), поэтому прозрачнее она становится только ниже
     него. */
  const mapOpacity =
    layout.map?.opacity === null || layout.map?.opacity === undefined
      ? 1
      : Math.min(1, layout.map.opacity / MINIMAP_GAME_MAP_OPACITY);
  const outline = mapHidden
    ? []
    : big
      ? minimapOutlineRects(config.frame, MINIMAP_BIG_RADAR, MINIMAP_BIG_SCALE)
      : minimapOutlineRects(config.frame);
  const outlineColor = minimapColorWithOpacity(
    config.frame.outline.color,
    config.frame.outline.opacity,
  );
  const barIcons =
    effects.barIcons && !look
      ? ["healthBar", "armorBar"].filter((id) => layout.widgets[id].visible)
      : [];
  const zoomFactor = Number(config.zoom?.[zoomState]) || 1;
  /* Цифры HP и брони: при счёте вниз они тают до нового значения. */
  const counting = !still && effects.lossMode === "countdown";
  const rate = MINIMAP_LOSS_SPEEDS[effects.lossSpeed] || MINIMAP_LOSS_SPEEDS.normal;
  const numbers = {
    health: useCountdown(demo.health, rate, counting),
    armor: useCountdown(demo.armor, rate, counting),
  };
  /* Листы кадров своего видео заливки — картинками для холста полосы. */
  const healthVideoImage = useFillVideoImage(
    effects.healthFill?.mode === "video" ? assetUrls.healthFill : "",
  );
  const armorVideoImage = useFillVideoImage(
    effects.armorFill?.mode === "video" ? assetUrls.armorFill : "",
  );
  const fillVideos = {
    healthBar: healthVideoImage
      ? { ...effects.healthFill.video, image: healthVideoImage }
      : null,
    armorBar: armorVideoImage
      ? { ...effects.armorFill.video, image: armorVideoImage }
      : null,
  };
  return (
    <div
      className={`mmc-map${compact ? " is-compact" : ""}${still ? " is-still" : ""}${open ? " is-open" : ""}${big ? " is-big" : ""}`}
      data-view={big ? "big" : "small"}
      onClick={still || !onSelect ? undefined : () => onSelect(null)}
    >
      <div
        className={`mmc-radar${mapHidden ? " is-hidden" : mapOpacity < 1 ? " is-translucent" : ""}`}
        ref={radarRef}
        style={mapOpacity < 1 && !mapHidden ? { "--mmc-map-opacity": mapOpacity } : undefined}
        {...(mapHidden && !still
          ? { role: "img", "aria-label": tr("Карта скрыта: в игре здесь только HP и броня") }
          : {})}
      >
        {mapHidden ? null : !still && !big && zoomFactor < 1 ? (
          <RadarMosaic factor={zoomFactor} label={label} />
        ) : (
          <img
            src={radarSrc || MINIMAP_RADAR_FIELD}
            alt={still ? "" : label}
            draggable="false"
          />
        )}
      </div>
      {strip && (
        <span
          className="mmc-strip"
          aria-hidden="true"
          style={{
            left: sceneX(0),
            top: pointsY(MINIMAP_STRIP.top),
            width: sceneWidth(1),
            height: pointsY(MINIMAP_STRIP.bottom - MINIMAP_STRIP.top),
          }}
        />
      )}
      {/* `bar_bg` игры: тёмные подложки на штатных местах полос. За полосой,
          которую сдвинули внутри ленты, они не едут — как и в игре. */}
      {strip &&
        MINIMAP_STOCK_BAR_PADS.map((pad) => (
          <span
            key={pad.x}
            className="mmc-strip-pad"
            aria-hidden="true"
            style={{
              left: pointsX(MINIMAP_RADAR.x + pad.x),
              top: sceneY(
                MINIMAP_STOCK_BARS.healthBar.y -
                  MINIMAP_STOCK_BARS.healthBar.height / 2,
              ),
              width: pointsX(pad.width),
              height: sceneHeight(MINIMAP_STOCK_BARS.healthBar.height),
              opacity: MINIMAP_STOCK_BAR_PAD_OPACITY / 100,
            }}
          />
        ))}
      {/* Обводка карты — те же прямоугольники, что уходят в игру
          (`minimapOutlineRects`), а не рамка CSS: угол и обрыв линии у
          выключенной стороны совпадают до точки. */}
      {outline.map((line) => (
        <i
          key={line.side}
          className="mmc-outline"
          data-side={line.side}
          aria-hidden="true"
          style={{
            left: pointsX(line.x),
            top: pointsY(line.y),
            width: pointsX(line.width),
            height: pointsY(line.height),
            background: outlineColor,
          }}
        />
      ))}
      {effects.showNorth && !mapHidden && (look ? look.north : true) && (
        <b
          className="mmc-north-marker"
          aria-hidden="true"
          /* Буква — значок севера на самой карте игры и растёт вместе с
             кадром: в обложке библиотеки кадр — доля карточки, и кегль
             подписей лаунчера к ней не относится. */
          data-audit-ignore="type-min type-scale"
          style={{
            left: atX(0.5),
            top: atY(0.075),
            width: sceneUnits(12),
            height: sceneUnits(12),
            fontSize: sceneUnits(8),
          }}
        >
          N
        </b>
      )}
      {effects.playerMarkerMode === "stock" && !mapHidden && (
        <svg
          className="mmc-player-marker is-stock"
          viewBox={PLAYER_ARROW_BOX}
          aria-hidden="true"
          style={{
            left: atX(player.x),
            top: atY(player.y),
            color: effects.playerMarkerColor,
            width: markerSize,
            height: markerSize,
          }}
        >
          <path
            d={PLAYER_ARROW_PATH}
            fill="currentColor"
            stroke="#0b0d10"
            strokeWidth="3"
            paintOrder="stroke"
          />
        </svg>
      )}
      {effects.playerMarkerMode === "custom" && assetUrls.playerMarker && !mapHidden && (
        <i
          className="mmc-player-marker is-custom"
          aria-hidden="true"
          style={{
            left: atX(player.x),
            top: atY(player.y),
            width: markerSize,
            height: markerSize,
            backgroundColor: effects.playerMarkerColor,
            maskImage: `url(${assetUrls.playerMarker})`,
            WebkitMaskImage: `url(${assetUrls.playerMarker})`,
          }}
        />
      )}
      {others &&
        !mapHidden &&
        effects.othersMode !== "hidden" &&
        DEMO_OTHERS.map((blip) => {
          const side = sceneUnits(OTHERS_SCENE_SIDE * effects.othersScale);
          const custom = effects.othersMode === "custom" && assetUrls.othersMarker;
          return (
            <i
              key={`${blip.x}:${blip.y}`}
              className={`mmc-other-blip${custom ? " is-custom" : ""}`}
              data-others={effects.othersMode}
              aria-hidden="true"
              style={{
                left: atX(blip.x),
                top: atY(blip.y),
                width: side,
                height: side,
                color: blip.color,
                ...(custom
                  ? {
                      maskImage: `url(${assetUrls.othersMarker})`,
                      WebkitMaskImage: `url(${assetUrls.othersMarker})`,
                    }
                  : {}),
              }}
            />
          );
        })}
      <OverlayLayer
        overlays={config.overlays || []}
        assetUrls={assetUrls}
        still={still}
        selected={selectedOverlay}
        onPointerDown={onOverlayPointerDown}
        onSelect={onOverlaySelect}
        big={big}
      />
      {look && <AuthoredVitals look={look} demo={demo} />}
      {/* Плашка под HP и бронёй (21.11.2026): под значками и цифрами; вид и цвет — из проекта. Вид из файла мода рисует свои полосы и плашки не знает. */}
      {!look && (
        <VitalPlate
          config={config}
          armour={numbers.armor}
          drawn={{
            health: vitalIconDrawn(config, true, assetUrls),
            armour: vitalIconDrawn(config, false, assetUrls),
          }}
          big={big}
        />
      )}
      {(look ? [] : MINIMAP_WIDGET_IDS).map((id) => (
        <VitalWidget
          key={id}
          id={id}
          config={config}
          demo={demo}
          numbers={numbers}
          selected={!still && selected === id}
          onSelect={onSelect}
          onPointerDown={onWidgetPointerDown}
          still={still}
          big={big}
          iconUrl={
            minimapWidgetKind(id) === "icon"
              ? vitalIconUrl(config, id === "healthIcon", assetUrls)
              : ""
          }
          fillVideo={fillVideos[id] || null}
        />
      ))}
      {/* Значок на самой полосе — своим слоем: он привязан к полосе, едет и
          растёт вместе с ней, и двигать его отдельно нельзя. Место считает
          контракт, тем же расчётом значок уходит в игру. */}
      {barIcons.map((id) => (
        <IconLayer
          key={id}
          id={id}
          rect={minimapBarIconRect(layout.widgets[id], effects.barThickness)}
          url={vitalIconUrl(config, id === "healthBar", assetUrls)}
          color={effects.barIconColor}
          opacity={layout.widgets[id].opacity}
          zIndex={layout.widgets[id].zIndex + 1}
        />
      ))}
      {/* Направляющая «по центру» — поверх всех элементов, в тех же долях
          радара, что и они: линия стоит ровно там, куда встал центр. */}
      {!still &&
        guides?.map((guide) => (
          <i
            key={`${guide.axis}:${guide.at}`}
            className={`mmc-snap-guide is-${guide.axis}`}
            data-axis={guide.axis}
            aria-hidden="true"
            style={
              guide.axis === "x"
                ? {
                    left: sceneX(guide.at),
                    top: sceneY(guide.from),
                    height: sceneHeight(guide.to - guide.from),
                  }
                : {
                    top: sceneY(guide.at),
                    left: sceneX(guide.from),
                    width: sceneWidth(guide.to - guide.from),
                  }
            }
          />
        ))}
      {!still && <FloatingNumbers floats={demo.floats} config={config} big={big} />}
      {(demo.flash || holdFlash) && effects.damageFlash && !mapHidden && (
        <div
          key={demo.flashId || 0}
          className={`mmc-damage-flash${damageImage ? " has-image" : ""}${holdFlash ? " is-held" : ""}`}
          style={{
            left: atX(0),
            top: atY(0),
            width: atWidth(1),
            height: atHeight(1),
            /* Пик — сила вспышки, гаснет за её длительность: та же доля,
               что уходит в твин игры. */
            "--mmc-flash-peak": effects.damageFlashStrength / 100,
            /* Свой цвет: у вспышки игры — её цвет, у своей картинки —
               оттенок; размер — вокруг середины радара. */
            "--mmc-flash-color":
              effects.damageColorMode === "custom" ? effects.damageColor : undefined,
            transform: effects.damageScale < 100 ? `scale(${effects.damageScale / 100})` : undefined,
            animationDuration: `${effects.damageFlashDurationMs}ms`,
          }}
        >
          {/* Своя картинка — на месте из `minimapDamageImageBox`, том же, что
              уходит в игру: «Заполнить» или «Целиком», масштаб и сдвиг. */}
          {damageImage && damageImageSize && (
            <i
              className="mmc-damage-image"
              style={{
                left: `${damageImageBox.left * 100}%`,
                top: `${damageImageBox.top * 100}%`,
                width: `${damageImageBox.width * 100}%`,
                height: `${damageImageBox.height * 100}%`,
                backgroundImage: `url(${damageImage})`,
              }}
            >
              {effects.damageColorMode === "custom" && (
                <i className="mmc-damage-tint" style={{ background: effects.damageColor }} />
              )}
            </i>
          )}
        </div>
      )}
    </div>
  );
}
