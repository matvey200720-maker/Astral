import {
  DEFAULT_MINIMAP_EFFECTS,
  GAME_SCREEN_FORMS_BY_RATIO,
  MINIMAP_DAMAGE_IMAGE_LIMITS,
  MINIMAP_DAMAGE_SCALE_LIMITS,
  MINIMAP_MAP_OPACITY_LIMITS,
  MINIMAP_OTHERS_SCALE_LIMITS,
  canvasForAspect,
  minimapMapOpacity,
} from "@modovik/minimap-contract";
import Button from "../../../ui/Button.jsx";
import ChoiceRadioGroup from "../../../ui/ChoiceRadioGroup.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import {
  MINIMAP_FRAME_SIDES,
  MINIMAP_FRONTEND_STOCK,
  MINIMAP_OUTLINE_LIMITS,
  MINIMAP_POSITION_PRESETS,
  MINIMAP_ZOOM_RANGE,
  MINIMAP_ZOOM_STATES,
  fitMinimapPlacementToScreen,
  minimapOffScreen,
  minimapPlacementPreset,
  minimapPreviewScreen,
  minimapZoomActive,
  normalizeMinimapPlacement,
  resizeMinimapPlacement,
} from "../minimap-layout.js";
import {
  MINIMAP_FRAME_TEMPLATES,
  matchingFrameTemplate,
} from "./frame-templates.js";
import GameScreenLine from "../../../../features/workshop/game-screen/GameScreenLine.jsx";
import { gameScreenForm } from "../../../../features/workshop/game-screen/game-screen-view.js";
import {
  minimapScreenFormPlan,
  minimapWithScreenForm,
  viewportFollowsGame,
} from "../../../../features/workshop/game-screen/minimap-viewport.js";
import { gameZoomBasis } from "../hud-preview/window-scale.js";
import { Fine } from "./FineSettings.jsx";
import ResolutionControls from "./ResolutionControls.jsx";
import IndicatorSection from "./IndicatorPanel.jsx";
import PlateSection from "./PlatePanel.jsx";
import {
  AssetUpload,
  ColorControl,
  FRAME_SWATCHES,
  Section,
  Toggle,
  VisibilityChoice,
  pickFields,
} from "./parts.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { useMinimapCopy } from "../minimap-lang.js";
import { openWorkshopEditor } from "../../../../features/workshop/editor-links.js";

/*
 * Панели карты и экрана: обводка, дальность обзора, стрелка и компас,
 * размытие, вспышка урона и положение на экране. Их органы не менялись с
 * задачи 8 — сюда они переехали из `MinimapCustomizer.jsx`, когда у каждого
 * инструмента появилась своя панель (задача 15 ТЗ 10.10.2026, вечер).
 */

export const SIDE_LABELS = Object.freeze({
  /* Читаются в момент показа — на языке окна. */
  get top() {
    return tr("Сверху");
  },
  get right() {
    return tr("Справа");
  },
  get bottom() {
    return tr("Снизу");
  },
  get left() {
    return tr("Слева");
  },
});
/* Две дальности радара — как их называет игра: пешком и в машине. */
export const ZOOM_STATE_LABELS = Object.freeze({
  get onFoot() {
    return tr("Пешком");
  },
  get inVehicle() {
    return tr("В машине");
  },
});
/* Множитель штатного масштаба — так его пишут моды «Масштаб мини-карты»
   (x0.25, x0.50), и так его узнают. */
export const formatZoomFactor = (value) => `×${Number(value).toFixed(2)}`;

/*
 * Экраны, на которых смотрят положение. Числа frontend.xml — доли экрана, и
 * разрешение на них не влияет; влияет форма: на широком мониторе та же доля
 * ширины — другая точка. С 14.11.2026 — все девять форм меню игры по возрастанию
 * соотношения сторон, у каждой свой холст (`GAME_SCREEN_FORMS_BY_RATIO`).
 */
export const SCREENS = Object.freeze(
  GAME_SCREEN_FORMS_BY_RATIO.map((form) => {
    const canvas = canvasForAspect(form.ratio);
    return Object.freeze({
      aspect: form.name,
      width: canvas.width,
      height: canvas.height,
    });
  }),
);

/* Поля вспышки, которые «Стандарт» возвращает к договору. */
const DAMAGE_FLASH_FIELDS = Object.freeze([
  "damageFlash",
  "damageFlashStrength",
  "damageFlashDurationMs",
  "damageColorMode",
  "damageColor",
  "damageScale",
  "damageImageFit",
  "damageImageZoom",
  "damageImageX",
  "damageImageY",
]);
const sameFields = (effects, fields) =>
  fields.every((field) => effects[field] === DEFAULT_MINIMAP_EFFECTS[field]);

/*
 * Стороны обводки: кнопка на месте каждой стороны вокруг маленькой карты.
 * Карта посередине красит включённые стороны цветом обводки — человек видит
 * итог, не глядя на большой предпросмотр.
 */
function FrameSides({ outline, onToggle }) {
  useTr();
  const border = (side) =>
    outline[side]
      ? { style: "solid", color: outline.color }
      : { style: "dashed", color: undefined };
  return (
    <div className="mmc-sides" role="group" aria-label={tr("Стороны обводки")}>
      {MINIMAP_FRAME_SIDES.map((side) => (
        <Button
          key={side}
          variant="secondary"
          size="sm"
          block
          active={outline[side]}
          aria-pressed={outline[side]}
          data-side={side}
          onClick={() => onToggle(side, !outline[side])}
        >
          {SIDE_LABELS[side]}
        </Button>
      ))}
      <span
        className="mmc-sides-map"
        aria-hidden="true"
        style={{
          borderTopStyle: border("top").style,
          borderTopColor: border("top").color,
          borderRightStyle: border("right").style,
          borderRightColor: border("right").color,
          borderBottomStyle: border("bottom").style,
          borderBottomColor: border("bottom").color,
          borderLeftStyle: border("left").style,
          borderLeftColor: border("left").color,
        }}
      />
    </div>
  );
}

/* Рисунок плитки шаблона: радар и его рамка теми же сторонами, цветом, толщиной и прозрачностью. */
function FrameTemplateArt({ outline }) {
  const width = 100;
  const height = 64;
  const on = outline.enabled === true;
  const stroke = Math.max(1, (outline.width || 2) * 0.9);
  const line = (side, x1, y1, x2, y2) =>
    on && outline[side] !== false ? (
      <line
        key={side}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={outline.color}
        strokeOpacity={(outline.opacity ?? 100) / 100}
        strokeWidth={stroke}
        strokeLinecap="square"
      />
    ) : null;
  return (
    <svg
      className="mmc-frame-art"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <rect className="mmc-structure-map" x="12" y="8" width="76" height="48" />
      {line("top", 12, 8, 88, 8)}
      {line("right", 88, 8, 88, 56)}
      {line("bottom", 12, 56, 88, 56)}
      {line("left", 12, 8, 12, 56)}
    </svg>
  );
}

/* Шаблоны рамки плитками: быстрый старт, цвет и стороны правятся ниже (ТЗ 22.10). */
function FrameTemplates({ outline, onPick }) {
  useTr();
  const matching = matchingFrameTemplate(outline);
  return (
    <ChoiceRadioGroup
      label={tr("Шаблоны рамки")}
      className="mmc-frame-templates"
      value={matching}
      onChange={(id) =>
        onPick(MINIMAP_FRAME_TEMPLATES.find((item) => item.id === id))
      }
      options={MINIMAP_FRAME_TEMPLATES.map((template) => ({
        value: template.id,
        title: tr(template.label),
        description: tr(template.note),
        media: (
          <FrameTemplateArt outline={{ ...outline, ...template.outline }} />
        ),
      }))}
    />
  );
}

export function OutlinePanel({ config, patchOutline, title = "" }) {
  useTr();
  const copy = useMinimapCopy();
  const { frame } = config;
  return (
    <Section title={title}>
      <FrameTemplates
        outline={frame.outline}
        onPick={(template) =>
          patchOutline(
            template.outline,
            `${tr("Рамка")}: ${tr(template.label)}`,
          )
        }
      />
      <Toggle
        label={tr("Линия по краю")}
        checked={frame.outline.enabled}
        onChange={(enabled) =>
          patchOutline(
            { enabled },
            enabled
              ? tr("Включена обводка карты")
              : tr("Выключена обводка карты"),
          )
        }
      />
      {frame.outline.enabled && (
        <>
          <ColorControl
            label={tr("Цвет обводки")}
            value={frame.outline.color}
            swatches={FRAME_SWATCHES}
            onChange={(color) =>
              patchOutline({ color }, tr("Изменён цвет обводки карты"))
            }
          />
          <Slider
            label={tr("Толщина обводки")}
            value={frame.outline.width}
            min={MINIMAP_OUTLINE_LIMITS.width[0]}
            max={MINIMAP_OUTLINE_LIMITS.width[1]}
            step={0.5}
            unit=" px"
            onChange={(width) =>
              patchOutline({ width }, tr("Изменена толщина обводки карты"))
            }
          />
          <Slider
            label={tr("Непрозрачность")}
            value={frame.outline.opacity}
            min={MINIMAP_OUTLINE_LIMITS.opacity[0]}
            max={MINIMAP_OUTLINE_LIMITS.opacity[1]}
            unit="%"
            onChange={(opacity) =>
              patchOutline({ opacity }, tr("Изменена непрозрачность обводки"))
            }
          />
          <FrameSides
            outline={frame.outline}
            onToggle={(side, on) =>
              patchOutline(
                { [side]: on },
                copy.outlineSide(SIDE_LABELS[side], on),
              )
            }
          />
        </>
      )}
    </Section>
  );
}

/* Меньше — дальше: так считают моды «Масштаб мини-карты» из каталога, и так
   эти числа уже привыкли читать. */
export function ZoomPanel({ config, patchZoom, title = "" }) {
  useTr();
  const zoomActive = minimapZoomActive(config.zoom);
  return (
    <Section title={title}>
      {MINIMAP_ZOOM_STATES.map((state) => (
        <Slider
          key={state}
          label={ZOOM_STATE_LABELS[state]}
          value={config.zoom[state]}
          min={MINIMAP_ZOOM_RANGE.min}
          max={MINIMAP_ZOOM_RANGE.max}
          step={MINIMAP_ZOOM_RANGE.step}
          format={formatZoomFactor}
          onChange={(value) => patchZoom(state, value)}
        />
      ))}
      <p className="mmc-section-hint">
        {zoomActive
          ? tr(
              "Какую дальность показывать на карте, переключается в углу кадра.",
            )
          : tr(
              "Сейчас как в игре; в игру уходит та же таблица ступеней, что у модов «Масштаб мини-карты».",
            )}
      </p>
      <BigMapLink />
    </Section>
  );
}

/*
 * Ссылка на «Большую карту» (17.10, ТЗ владельца): картинка на радаре — это
 * плитки большой карты. С 22.10 выключателя у неё нет: применённая карта идёт
 * на мини-карту сама. Кнопка открывает «Большую карту», чтобы её поправить.
 */
export function BigMapLink() {
  useTr();
  return (
    <div className="mmc-big-map-link" data-testid="minimap-big-map-link">
      <p className="mmc-section-hint">
        {tr("Применённая «Большая карта» встаёт и на мини-карту сама.")}
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => openWorkshopEditor({ slotId: "large-map" })}
      >
        {tr("Открыть «Большую карту»")}
      </Button>
    </div>
  );
}

export function MarkerPanel({
  config,
  patchEffects,
  uploadVisualAsset,
  title = "",
}) {
  useTr();
  const { effects } = config;
  return (
    <Section title={title}>
      <VisibilityChoice
        label={tr("Стрелка игрока")}
        value={effects.playerMarkerMode}
        options={[
          ["stock", tr("Как в игре")],
          ["custom", tr("Своя")],
          ["hidden", tr("Скрыть")],
        ]}
        onChange={(playerMarkerMode) =>
          patchEffects({ playerMarkerMode }, tr("Изменена стрелка игрока"))
        }
      />
      {effects.playerMarkerMode !== "hidden" && (
        <>
          <AssetUpload
            label={tr("Своя стрелка")}
            loaded={Boolean(effects.playerMarkerAssetId)}
            onChange={(file) =>
              uploadVisualAsset("playerMarker", file, "playerMarkerAssetId", {
                playerMarkerMode: "custom",
              })
            }
          />
          <ColorControl
            label={tr("Цвет стрелки")}
            value={effects.playerMarkerColor}
            onChange={(playerMarkerColor) =>
              patchEffects({ playerMarkerColor }, tr("Изменён цвет стрелки"))
            }
          />
          <Slider
            label={tr("Размер стрелки")}
            value={Math.round(effects.playerMarkerScale * 100)}
            min={10}
            max={300}
            unit="%"
            onChange={(value) =>
              patchEffects(
                { playerMarkerScale: value / 100 },
                tr("Изменён размер стрелки"),
              )
            }
          />
        </>
      )}
      <Toggle
        label={tr("Буква N")}
        checked={effects.showNorth}
        onChange={(showNorth) =>
          patchEffects(
            { showNorth },
            showNorth ? tr("Показана буква N") : tr("Скрыта буква N"),
          )
        }
      />
    </Section>
  );
}

/*
 * Метки других людей (задача 1 ТЗ 17.10.2026, кадр владельца с кружком
 * игрока): кружки игроков и людей на радаре — «как в игре», своя картинка
 * силуэтом или скрыть, и размер. Цвет каждому игроку даёт игра, поэтому
 * цвета здесь нет. Что меняется и где не меняется — подсказкой, коротко.
 */
export function OthersPanel({ config, patchEffects, uploadVisualAsset }) {
  useTr();
  const { effects } = config;
  return (
    <Section
      title={tr("Метки других игроков")}
      standard={effects.othersMode === "stock" && effects.othersScale === 1}
      onStandard={() =>
        patchEffects(
          { othersMode: "stock", othersScale: 1 },
          tr("Метки других игроков — как в игре"),
        )
      }
    >
      <VisibilityChoice
        label={tr("Кружки людей")}
        value={effects.othersMode}
        options={[
          ["stock", tr("Как в игре")],
          ["custom", tr("Своя")],
          ["hidden", tr("Скрыть")],
        ]}
        onChange={(othersMode) =>
          patchEffects({ othersMode }, tr("Изменены метки других игроков"))
        }
      />
      {effects.othersMode !== "hidden" && (
        <>
          <AssetUpload
            label={tr("Своя метка")}
            loaded={Boolean(effects.othersAssetId)}
            onChange={(file) =>
              uploadVisualAsset("othersMarker", file, "othersAssetId", {
                othersMode: "custom",
              })
            }
          />
          <Slider
            label={tr("Размер меток")}
            value={Math.round(effects.othersScale * 100)}
            min={MINIMAP_OTHERS_SCALE_LIMITS[0] * 100}
            max={MINIMAP_OTHERS_SCALE_LIMITS[1] * 100}
            unit="%"
            onChange={(value) =>
              patchEffects(
                { othersScale: value / 100 },
                tr("Изменён размер меток других игроков"),
              )
            }
          />
        </>
      )}
      <p className="mmc-section-hint">
        {effects.othersMode === "custom"
          ? tr(
              "Картинка встанет вместо кружка и кружков «выше/ниже»; цвет каждому игроку даст игра.",
            )
          : tr("Сработает, если сервер метит игроков кружком игры.")}
      </p>
    </Section>
  );
}

/*
 * Непрозрачность карты (задача 1 ТЗ 17.10.2026) — ползунок вместо
 * выключателя «Карта». 0 % — карты нет (прежнее «Скрыть карту»: стрелка, N и
 * значки радара уходят вместе с ней), остальное — яркость маски карты в
 * graphics.ytd (`minimapMapOpacity`). Как в игре — 73 %: карта игры сама
 * чуть прозрачна, и ползунок показывает это число, а не «100».
 */
export function MapOpacityControl({ config, patchMap }) {
  useTr();
  const map = config.layout.map;
  const value = minimapMapOpacity(map);
  const stock = !map.hidden && (map.opacity ?? null) === null;
  return (
    <div className="mmc-map-opacity" data-map-opacity={value}>
      <Slider
        editable
        label={tr("Карта")}
        value={value}
        min={MINIMAP_MAP_OPACITY_LIMITS[0]}
        max={MINIMAP_MAP_OPACITY_LIMITS[1]}
        unit="%"
        onChange={(next) =>
          patchMap(
            next <= 0
              ? { ...map, hidden: true }
              : { ...map, hidden: false, opacity: next },
            next <= 0
              ? tr("Карта скрыта — остались HP и броня")
              : tr("Изменена непрозрачность карты"),
          )
        }
      />
      <p className="mmc-section-hint">
        {value <= 0
          ? tr(
              "0 % — карты нет: в игре на её месте мир, а HP и броня остаются.",
            )
          : tr(
              "Как в игре — 73 %, 100 % — карта без прозрачности. Стрелка, значки и HP остаются чёткими.",
            )}
      </p>
      {!stock && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            patchMap(
              { ...map, hidden: false, opacity: null },
              tr("Карта — как в игре"),
            )
          }
        >
          {tr("Как в игре")}
        </Button>
      )}
    </div>
  );
}

/* Новая мини-карта стоит чёткой, и размытие трогают последним, если вообще
   трогают. */
export function BlurPanel({ config, patchFrame, title = "" }) {
  useTr();
  const { frame } = config;
  return (
    <Section title={title}>
      <VisibilityChoice
        label={tr("Размытие")}
        value={frame.blur}
        options={[
          ["none", tr("Убрать")],
          ["game", tr("Как в игре")],
        ]}
        onChange={(blur) =>
          patchFrame(
            { blur },
            blur === "none"
              ? tr("Убрано размытие вокруг карты")
              : tr("Размытие вокруг карты — как в игре"),
          )
        }
      />
      <p className="mmc-section-hint">
        {frame.blur === "none"
          ? tr("Край карты в игре чёткий, ореола вокруг нет.")
          : tr("Как в игре: тёмный ореол вокруг карты и мягкий край.")}
      </p>
    </Section>
  );
}

/*
 * Вспышка урона (задача 8 ТЗ 10.10.2026): вспышка игры или своя картинка —
 * с силой, длительностью, цветом и размером. Вылетающие цифры переехали в
 * «Как отнимается HP» (задача 15 ТЗ 10.10.2026, вечер).
 */
export function FlashPanel({
  config,
  patchEffects,
  uploadVisualAsset,
  holdFlash = false,
  onHoldFlash = null,
  /* Заголовок блока и то, что стоит над выключателем (в «Значках» — подсказка и кнопки пробы урона под заголовком «Урон с картинками»). */
  title = null,
  lead = null,
}) {
  useTr();
  const { effects } = config;
  const mapHidden = config.layout.map.hidden === true;
  return (
    <Section
      title={title ?? tr("Вспышка")}
      standard={
        sameFields(effects, DAMAGE_FLASH_FIELDS) && !effects.damageAssetId
      }
      onStandard={() =>
        patchEffects(
          {
            ...pickFields(DEFAULT_MINIMAP_EFFECTS, DAMAGE_FLASH_FIELDS),
            damageAssetId: "",
          },
          tr("Вспышка урона — как в игре"),
        )
      }
    >
      {lead}
      {mapHidden && (
        <p className="mmc-section-hint">
          {tr(
            "Карта скрыта — вспышке негде мигать, в игру она не уйдёт. Цифры урона над полосами остаются.",
          )}
        </p>
      )}
      <Toggle
        label={tr("Вспышка / фото при уроне")}
        checked={effects.damageFlash}
        onChange={(damageFlash) =>
          patchEffects({ damageFlash }, tr("Изменена вспышка урона"))
        }
      />
      {effects.damageFlash && (
        <>
          <AssetUpload
            label={tr("Своя картинка урона")}
            loaded={Boolean(effects.damageAssetId)}
            onChange={(file) =>
              uploadVisualAsset("damage", file, "damageAssetId", {
                damageFlash: true,
              })
            }
          />
          <Fine>
            <Section title={tr("Сила, цвет и размер вспышки")}>
              {/* Вспышка гаснет за свою длительность — настраивать её на лету
              нельзя было разглядеть (ТЗ 05.11.2026). В проект не сохраняется. */}
              {onHoldFlash && (
                <Toggle
                  label={tr("Держать вспышку в предпросмотре")}
                  checked={holdFlash}
                  onChange={onHoldFlash}
                />
              )}
              {/* Место своей картинки (ТЗ 05.11.2026): без обрезки, масштаб и
              сдвиг — то же место уходит в игру. */}
              {effects.damageAssetId && (
                <>
                  <VisibilityChoice
                    label={tr("Картинка на радаре")}
                    value={effects.damageImageFit}
                    options={[
                      ["cover", tr("Заполнить")],
                      ["contain", tr("Целиком")],
                    ]}
                    onChange={(damageImageFit) =>
                      patchEffects(
                        { damageImageFit },
                        tr("Изменено, как картинка урона лежит на радаре"),
                      )
                    }
                  />
                  <p className="mmc-section-hint">
                    {effects.damageImageFit === "contain"
                      ? tr(
                          "Картинка видна вся, без обрезки; по краям радара может остаться карта.",
                        )
                      : tr(
                          "Картинка закрывает весь радар, лишнее по краям обрезается.",
                        )}
                  </p>
                  <Slider
                    label={tr("Масштаб картинки")}
                    value={effects.damageImageZoom}
                    min={MINIMAP_DAMAGE_IMAGE_LIMITS.zoom[0]}
                    max={MINIMAP_DAMAGE_IMAGE_LIMITS.zoom[1]}
                    step={5}
                    unit="%"
                    onChange={(damageImageZoom) =>
                      patchEffects(
                        { damageImageZoom },
                        tr("Изменён масштаб картинки урона"),
                      )
                    }
                  />
                  <Slider
                    label={tr("Сдвиг по горизонтали")}
                    value={effects.damageImageX}
                    min={MINIMAP_DAMAGE_IMAGE_LIMITS.offset[0]}
                    max={MINIMAP_DAMAGE_IMAGE_LIMITS.offset[1]}
                    unit="%"
                    onChange={(damageImageX) =>
                      patchEffects(
                        { damageImageX },
                        tr("Картинка урона сдвинута"),
                      )
                    }
                  />
                  <Slider
                    label={tr("Сдвиг по вертикали")}
                    value={effects.damageImageY}
                    min={MINIMAP_DAMAGE_IMAGE_LIMITS.offset[0]}
                    max={MINIMAP_DAMAGE_IMAGE_LIMITS.offset[1]}
                    unit="%"
                    onChange={(damageImageY) =>
                      patchEffects(
                        { damageImageY },
                        tr("Картинка урона сдвинута"),
                      )
                    }
                  />
                </>
              )}
              <Slider
                label={tr("Сила вспышки")}
                value={effects.damageFlashStrength}
                min={0}
                max={100}
                unit="%"
                onChange={(value) =>
                  patchEffects(
                    { damageFlashStrength: value },
                    tr("Изменена сила вспышки"),
                  )
                }
              />
              {/* 2100 мс — вид игры: 1,5 с гаснет вспышка после 0,2 с задержки;
              остальное в игре в той же доле. */}
              <Slider
                label={tr("Длительность вспышки")}
                value={effects.damageFlashDurationMs}
                min={100}
                max={5000}
                step={50}
                unit={tr(" мс")}
                onChange={(damageFlashDurationMs) =>
                  patchEffects(
                    { damageFlashDurationMs },
                    tr("Изменена длительность вспышки"),
                  )
                }
              />
              {/* Свой цвет: у вспышки игры — её цвет, у своей картинки — оттенок
              умножением. Размер — доля радара вокруг середины. */}
              <VisibilityChoice
                label={
                  effects.damageAssetId
                    ? tr("Оттенок картинки")
                    : tr("Цвет вспышки")
                }
                value={effects.damageColorMode}
                options={[
                  [
                    "game",
                    effects.damageAssetId
                      ? tr("Без оттенка")
                      : tr("Как в игре"),
                  ],
                  ["custom", tr("Свой")],
                ]}
                onChange={(damageColorMode) =>
                  patchEffects(
                    { damageColorMode },
                    damageColorMode === "custom"
                      ? tr("Свой цвет вспышки урона")
                      : tr("Цвет вспышки урона — как в игре"),
                  )
                }
              />
              {effects.damageColorMode === "custom" && (
                <ColorControl
                  label={
                    effects.damageAssetId ? tr("Оттенок") : tr("Свой цвет")
                  }
                  value={effects.damageColor}
                  swatches={FRAME_SWATCHES}
                  onChange={(damageColor) =>
                    patchEffects(
                      { damageColor },
                      tr("Изменён цвет вспышки урона"),
                    )
                  }
                />
              )}
              <Slider
                label={tr("Размер вспышки")}
                value={effects.damageScale}
                min={MINIMAP_DAMAGE_SCALE_LIMITS[0]}
                max={MINIMAP_DAMAGE_SCALE_LIMITS[1]}
                unit="%"
                onChange={(damageScale) =>
                  patchEffects(
                    { damageScale },
                    tr("Изменён размер вспышки урона"),
                  )
                }
              />
            </Section>
          </Fine>
        </>
      )}
    </Section>
  );
}

/* Где открывается развёрнутый радар (`MINIMAP_EXPANDED_PLACES`); подписи — русские ключи словаря, `tr` в отрисовке. */
const EXPANDED_PLACES = Object.freeze({ left: "Слева", center: "По центру" });

export function PositionPanel({
  config,
  commit,
  patchMap,
  mapToggle,
  onDetachVitals,
  screenInfo = null,
  /* Элемент группы HP, взятый в окне (общий с «Полосками»), и правка элемента — для «Где стоят HP и броня». */
  selected = null,
  onSelect = null,
  onPatchWidget = null,
  /* Панель двух инструментов (22.11.2026): `"hp"` — «Положение HP» (выключатель, готовые раскладки, тонкая настройка), `"map"` — «Положение карты». */
  mode = "map",
  /* Экран игры, как его прочитала игра (без разрешения, указанного человеком): для строки «В настройках игры сейчас…». */
  gameInfo = null,
}) {
  useTr();
  const placement = normalizeMinimapPlacement(config.layout.map);
  const mapHidden = config.layout.map.hidden === true;
  /* Экран, на котором показан кадр: форма — «Экран» ниже, отступ
     безопасной зоны — из игры игрока (ТЗ 11.10.2026, день). */
  const screen = minimapPreviewScreen({
    ...config,
    gameScreen: { inset: screenInfo?.inset },
  });
  const keepOnScreen = (map) =>
    fitMinimapPlacementToScreen(map, {
      from: screen,
      to: screen,
      stock: MINIMAP_FRONTEND_STOCK,
    });
  const offScreen = minimapOffScreen(
    config.layout.map,
    MINIMAP_FRONTEND_STOCK,
    screen,
  );
  /* Форма экрана игры — ближайшая из девяти (ТЗ H1, 14.11.2026); `null`, пока экран неизвестен. */
  const gameForm = gameScreenForm(screenInfo);
  const screenDiffers =
    Boolean(gameForm) && gameForm.name !== config.targetViewport.aspect;
  /* Форму за игрой не меняют, если её выбрал человек: тогда строка говорит «показано для…». */
  const followsGame = viewportFollowsGame(config);
  /* Форма идёт за игрой, но долю экрана в пределах окна не удержать: шаг не сделан, работа осталась под своей формой —
     строка так и говорит («Работа показана под формой X, а в игре Y»), установка пересчитает сама. */
  const followBlocked =
    followsGame &&
    screenDiffers &&
    minimapScreenFormPlan(config, gameForm.name, { inset: screenInfo?.inset })
      ?.keeps === false;
  /* Настройки игры говорят одно, а на экране у человека другое: ему виднее (ТЗ 02.11.2026). */
  const asShown = config.targetViewport.gameAspect === "screen";
  const trustScreen = (on) => {
    const { gameAspect: _dropped, ...viewport } = config.targetViewport;
    commit(
      {
        ...config,
        targetViewport: on ? { ...viewport, gameAspect: "screen" } : viewport,
      },
      `${tr("Экран")} ${config.targetViewport.aspect}`,
      "targetViewport",
    );
  };
  /* Другая форма экрана — кадр держит свой край (как при установке), а
     не те же числа: те же числа на 4:3 шире и уезжают вправо. Выбор человека —
     `manual`, форма из игры — `detected` (`minimap-viewport.js`). */
  const showScreen = (name, source = "manual") =>
    commit(
      minimapWithScreenForm(config, name, { inset: screenInfo?.inset, source }),
      `${tr("Экран")} ${name}`,
      "targetViewport",
    );
  if (mode === "hp") {
    return (
      <>
        <Section>
          {!mapHidden && onDetachVitals && (
            /*
             * HP отдельно от карты (задача 1 ТЗ 17.10.2026; до того — кнопка
             * «Двигать HP по карте», задача 1 ТЗ 11.10.2026). Выключатель:
             * включён — карта стоит, а HP тянутся по всему экрану; выключен —
             * HP встают под карту, как в игре. Полосы — часть фильма
             * мини-карты, и игра рисует его только в окне записи frontend.xml:
             * когда группа выходит за кадр, сцена и записи `minimap` и `bigmap`
             * растут вокруг своего центра (`extendMinimapFrontend`), а иначе
             * файлы как у обычной работы.
             */
            <div className="mmc-loss-numbers" data-vitals-limit>
              <Toggle
                label={tr("HP отдельно от карты")}
                checked={config.layout.vitalsDetached === true}
                onChange={onDetachVitals}
              />
              <p className="mmc-section-hint">
                {config.layout.vitalsDetached
                  ? tr("Тяните HP по всему экрану — карта останется на месте.")
                  : tr("Выключено — HP и броня под картой, как в игре.")}
              </p>
            </div>
          )}
          {mapHidden && (
            <p className="mmc-section-hint">
              {tr(
                "Карта скрыта: тяните полосы по экрану — в игре на этом месте будут только HP и броня.",
              )}
            </p>
          )}
        </Section>
        {/* Индикатор HP по долям экрана: список элементов с полями X/Y и две готовые раскладки у прицела. Карта скрыта — HP едут с ней,
            выключателя «HP отдельно от карты» нет, и раздел с этим именем уже стоит выше. */}
        {!mapHidden && onDetachVitals && onPatchWidget && (
          <IndicatorSection
            config={config}
            screen={screen}
            commit={commit}
            selected={selected}
            onSelect={onSelect}
            onPatchWidget={onPatchWidget}
          />
        )}
        {/* Подложка под HP и бронёй: плашка вокруг значков и цифр, броня «только когда она есть», цвет пустой части шкалы (21.11.2026). */}
        <Fine>
          <PlateSection config={config} commit={commit} />
        </Fine>
      </>
    );
  }
  return (
    <>
      <Section
        title={mapHidden ? tr("Где стоят HP и броня") : tr("Где стоит карта")}
      >
        {mapToggle}
        {mapHidden && (
          <p className="mmc-section-hint">
            {tr(
              "Карта скрыта: тяните полосы по экрану — в игре на этом месте будут только HP и броня.",
            )}
          </p>
        )}
        <div className="mmc-position-grid">
          {MINIMAP_POSITION_PRESETS.map(({ id, label }) => (
            <Button
              key={id}
              variant="secondary"
              size="sm"
              onClick={() =>
                patchMap(
                  minimapPlacementPreset(
                    config.layout.map,
                    id,
                    MINIMAP_FRONTEND_STOCK,
                    screen,
                  ),
                  `${tr("Положение")}: ${tr(label)}`,
                )
              }
            >
              {tr(label)}
            </Button>
          ))}
        </div>
        {offScreen && (
          /* Работы, сохранённые до 11.10.2026: окно считало числа иначе,
             и «у самого края» в игре было за краем. Установка сама вернёт
             кадр на экран; кнопка делает то же здесь, чтобы было видно. */
          <div className="mmc-loss-numbers" data-offscreen>
            <p className="mmc-section-hint">
              {tr(
                "Кадр выходит за экран игры — то, что за краем, в игре не видно. При установке Astral вернёт его к краю экрана.",
              )}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                patchMap(
                  keepOnScreen(config.layout.map),
                  tr("Мини-карта возвращена на экран"),
                )
              }
            >
              {tr("Вернуть на экран")}
            </Button>
          </div>
        )}
      </Section>
      <Section title={tr("Размер на экране")}>
        <Slider
          label={tr("Размер")}
          value={Math.round(placement.scale * 100)}
          min={60}
          max={200}
          unit="%"
          onChange={(value) =>
            patchMap(
              resizeMinimapPlacement(
                config.layout.map,
                { scale: value / 100 },
                MINIMAP_FRONTEND_STOCK,
                screen,
              ),
              tr("Изменён размер мини-карты"),
            )
          }
        />
        <Slider
          label={tr("Ширина")}
          value={Math.round(placement.stretch * 100)}
          min={70}
          max={160}
          unit="%"
          onChange={(value) =>
            patchMap(
              resizeMinimapPlacement(
                config.layout.map,
                { stretch: value / 100 },
                MINIMAP_FRONTEND_STOCK,
                screen,
              ),
              tr("Изменена ширина мини-карты"),
            )
          }
        />
      </Section>
      {!mapHidden && (
        /* Где открывается развёрнутый радар (2 ноября 2026): «Слева» — как в игре, HUD сервера стоит на месте. */
        <Fine>
          <Section title={tr("Развёрнутый радар")}>
            <SegmentedControl
              label={tr("Где открывается развёрнутый радар")}
              size="sm"
              value={placement.expanded}
              onChange={(expanded) =>
                patchMap(
                  { ...config.layout.map, expanded },
                  `${tr("Развёрнутый радар")}: ${tr(EXPANDED_PLACES[expanded])}`,
                )
              }
              options={Object.entries(EXPANDED_PLACES).map(
                ([value, label]) => ({
                  value,
                  label: tr(label),
                }),
              )}
            />
            <p className="mmc-section-hint">
              {placement.expanded === "center"
                ? tr("Увеличенный радар открывается над серединой мини-карты.")
                : tr(
                    "Увеличенный радар открывается слева, как в игре: HUD сервера остаётся на своём месте.",
                  )}
            </p>
          </Section>
        </Fine>
      )}
      <Section title={tr("Разрешение игры")}>
        {/* Одна строка «Экран игры» на все редакторы (ТЗ H1, 14.11.2026): откуда известен экран и «изменить» —
            ручной выбор из девяти форм. Фраза — шаблонами словаря: собранная из кусков, она уходила в de/pl
            наполовину русской («Im Spiel: экран», дизайн 12.10). */}
        <GameScreenLine
          info={screenInfo}
          chosen={
            followsGame && screenInfo?.known && !followBlocked
              ? null
              : config.targetViewport.aspect
          }
          ofWork
          zoomBasis={
            gameZoomBasis(screenInfo?.width) === "monitor" ? "monitor" : null
          }
          onChange={(name) => {
            if (name) showScreen(name, "manual");
            else if (gameForm) showScreen(gameForm.name, "detected");
          }}
        />
        <ResolutionControls
          config={config}
          commit={commit}
          screenInfo={screenInfo}
          gameInfo={gameInfo}
        />
        {screenDiffers && (
          <p className="mmc-section-hint">
            {!asShown
              ? tr(
                  "При установке Astral поставит карту под экран игры так, что на мониторе она займёт то же место, что здесь.",
                )
              : tr(
                  "Вы указали, что в игре {0}: карта ставится под него.",
                ).replace("{0}", config.targetViewport.aspect)}
          </p>
        )}
        {screenDiffers && (
          <div className="mmc-position-grid">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => showScreen(gameForm.name, "detected")}
            >
              {tr("Показать как в игре")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => trustScreen(!asShown)}
            >
              {asShown
                ? tr("Как в настройках игры")
                : tr("В игре у меня {0}").replace(
                    "{0}",
                    config.targetViewport.aspect,
                  )}
            </Button>
          </div>
        )}
      </Section>
    </>
  );
}
