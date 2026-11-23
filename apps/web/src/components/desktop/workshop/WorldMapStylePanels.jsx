import { useEffect, useMemo, useRef } from "react";
import { ImageSquare, Prohibit } from "../../ui/icons.jsx";
import {
  MAP_COLOR_ROLES,
  MAP_TEXTURES,
  MAP_TEXTURE_MAP,
  generateMapTexture,
} from "@modovik/vector-map";
import ChoiceTile from "../../ui/ChoiceTile.jsx";
import ColorField from "../../ui/ColorField.jsx";
import Select from "../../ui/Select.jsx";
import Slider from "../../ui/Slider.jsx";
import { context2d } from "./effects-preview.js";
import { UploadGuide } from "./world-map-panel-parts.jsx";
import { Disclosure } from "./world-map/MapPanelParts.jsx";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { lowerFor, mapText } from "./world-map/map-copy.js";

/*
 * Панели стиля растровой подложки: цвета карты по ролям и текстура.
 *
 * Вынесены из общей панели карты: там уже шесть слоёв, а эти две секции —
 * самостоятельная вещь со своими органами (строка роли, образец текстуры).
 */

const BLEND_LABELS = Object.freeze([
  ["normal", "Обычно"],
  ["multiply", "Затемнить"],
  ["screen", "Осветлить"],
  ["overlay", "Контрастно"],
  ["soft-light", "Мягкий свет"],
  ["color", "Перекрасить"],
  ["hue", "Только оттенок"],
  ["lighten", "Светлее из двух"],
  ["darken", "Темнее из двух"],
]);

/** Режимы наложения с подписями на языке окна — собираются при отрисовке. */
export const blendOptions = () => BLEND_LABELS.map(([value, label]) => [value, tr(label)]);

const ROLE_LABEL = Object.fromEntries(
  MAP_COLOR_ROLES.map((role) => [role.id, role.label]),
);
const ROLE_OPTIONS = MAP_COLOR_ROLES.map((role) => [role.id, role.label]);
const roleLabel = (role) => tr(ROLE_LABEL[role]);

/* Порядок строк — как читают карту: от больших заливок к линиям и воде. */
const ROLE_ORDER = MAP_COLOR_ROLES.map((role) => role.id).filter(
  (id) => id !== "keep",
);

/**
 * Цвета карты из игры.
 *
 * Строка — роль: слева цвета, которыми она нарисована на карте человека,
 * справа цвет, в который они красятся. Правка цвета сразу включает
 * перекраску: человек пришёл менять цвет, а не искать выключатель.
 *
 * Ниже, свёрнуто, — какой цвет карты чем считать. Редактор угадывает это сам,
 * но угадывает по цвету: на чужой карте «дороги» могут оказаться парками, и
 * поправить это должно быть можно одним выбором.
 */
export function MapColorsPanel({ base, colors, onPatch }) {
  useTr();
  const language = useUiLanguage();
  const byRole = useMemo(() => {
    const groups = new Map();
    for (const item of colors) {
      if (!groups.has(item.role)) groups.set(item.role, []);
      groups.get(item.role).push(item);
    }
    return groups;
  }, [colors]);

  const setRole = (color, role) => {
    const rest = base.roleOverrides.filter((item) => item.color !== color);
    onPatch(
      { roleOverrides: [...rest, { color, role }], recolor: true },
      mapText("Цвет карты {color}: {role}", { color, role: roleLabel(role) }),
      `base.role.${color}`,
    );
  };

  if (!colors.length)
    return (
      <small className="wmc-hint">
        {tr("Цвета появятся, когда карта прочитается из игры: редактор найдёт, чем на ней нарисованы суша, дороги и вода, и даст перекрасить каждое.")}
      </small>
    );

  return (
    <>
      <div className="wmc-role-list">
        {ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => (
          <div className="wmc-role" key={role}>
            <span className="wmc-role-from" aria-hidden="true">
              {byRole.get(role).map((item) => (
                <i key={item.color} style={{ background: item.color }} />
              ))}
            </span>
            <ColorField
              className="wmc-color"
              label={roleLabel(role)}
              value={base[role]}
              onChange={(value) =>
                onPatch(
                  { [role]: value, recolor: true },
                  mapText("Цвет: {role}", { role: lowerFor(language, roleLabel(role)) }),
                  `base.${role}`,
                )
              }
            />
          </div>
        ))}
      </div>
      {/* Раскрывашка — общая кнопка `Disclosure`: мишень в рост пальца и
          содержимое только у открытой (закрытый <details> Chromium всё равно
          раскладывает, и сверка видела списки под соседними разделами). */}
      <Disclosure label={tr("Какой цвет карты чем считать")}>
        <small className="wmc-hint">
          {tr("Редактор сам нашёл цвета вашей карты и угадал, что ими нарисовано. Если ошибся — поправьте: цвета с одной ролью красятся вместе.")}
        </small>
        <div className="wmc-source-list">
          {colors.map((item) => (
            <div className="wmc-source" key={item.color}>
              <i style={{ background: item.color }} aria-hidden="true" />
              <Select
                className="wmc-select"
                label={item.color}
                value={item.role}
                options={ROLE_OPTIONS.map(([id, label]) => [id, tr(label)])}
                onChange={(role) => setRole(item.color, role)}
              />
            </div>
          ))}
        </div>
      </Disclosure>
    </>
  );
}

/** Образец готовой текстуры: тот же генератор, что красит карту. */
function TextureSwatch({ id }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = context2d(canvas);
    if (!context) return;
    const side = 96;
    const texture = generateMapTexture(id, side);
    if (!texture) return;
    canvas.width = side;
    canvas.height = side;
    const lines = texture.kind === "lines";
    const image = context.createImageData(side, side);
    for (let index = 0; index < texture.data.length; index += 4) {
      /* Линии показываются светлым по тёмной плашке, рельеф — как есть. */
      const alpha = texture.data[index + 3] / 255;
      const value = lines ? 28 + alpha * 200 : texture.data[index];
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = lines ? value + 8 : value;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [id]);
  return <canvas ref={canvasRef} className="wmc-texture-swatch" />;
}

/**
 * Текстура поверх карты.
 *
 * Готовая текстура ставится вместе со своим наложением, силой и размером —
 * теми, с которыми она выглядит как задумано: «бумага» затемнением, «сетка»
 * осветлением. Дальше всё правится руками.
 */
export function MapTexturePanel({ base, hasOwnTexture, onPatch, onUpload }) {
  useTr();
  const language = useUiLanguage();
  const definition = MAP_TEXTURE_MAP[base.textureId] || null;
  const active = base.textureId !== "none";
  const pick = (item) =>
    onPatch(
      {
        textureId: item.id,
        textureBlend: item.blend,
        textureOpacity: item.opacity,
        textureScale: item.scale,
      },
      mapText("Текстура: {name}", { name: lowerFor(language, tr(item.label)) }),
      "base.texture",
    );
  return (
    <>
      <div
        className="wmc-texture-grid ui-choice-grid"
        role="radiogroup"
        aria-label={tr("Текстура карты")}
      >
        <ChoiceTile
          role="radio"
          aria-checked={!active}
          selected={!active}
          media={
            <i className="wmc-texture-none">
              <Prohibit aria-hidden="true" />
            </i>
          }
          /* В плитке в треть колонки два слова переносились и ломали ряд:
             значок «запрещено» и так говорит «без текстуры». */
          title={tr("Нет")}
          tooltip={tr("Без текстуры")}
          ariaLabel={tr("Без текстуры")}
          onClick={() =>
            onPatch({ textureId: "none" }, tr("Текстура снята"), "base.texture")
          }
        />
        {MAP_TEXTURES.map((item) => (
          <ChoiceTile
            key={item.id}
            role="radio"
            aria-checked={base.textureId === item.id}
            selected={base.textureId === item.id}
            media={<TextureSwatch id={item.id} />}
            title={tr(item.label)}
            onClick={() => pick(item)}
          />
        ))}
      </div>
      <label className="wmc-upload">
        <span>
          <ImageSquare />
          {hasOwnTexture ? tr("Заменить свою текстуру") : tr("Своя текстура…")}
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = "";
          }}
        />
      </label>
      <UploadGuide kind="texture" />
      {base.textureId === "image" && (
        <small className="wmc-hint">
          {tr("Стоит ваша картинка. Бесшовная повторяется без стыков; обычная — поставьте «Повторов» на 1, и она ляжет на штат целиком.")}
        </small>
      )}
      {active && (
        <>
          <Select
            className="wmc-select"
            label={tr("Наложение")}
            value={base.textureBlend}
            options={blendOptions()}
            onChange={(textureBlend) =>
              onPatch(
                { textureBlend },
                tr("Наложение текстуры"),
                "base.textureBlend",
              )
            }
          />
          <Slider
            label={tr("Сила")}
            value={base.textureOpacity}
            min={0}
            max={100}
            unit="%"
            onChange={(textureOpacity) =>
              onPatch(
                { textureOpacity },
                tr("Сила текстуры"),
                "base.textureOpacity",
              )
            }
          />
          <Slider
            label={tr("Повторов на ширину карты")}
            value={base.textureScale}
            min={1}
            max={32}
            onChange={(textureScale) =>
              onPatch({ textureScale }, tr("Размер текстуры"), "base.textureScale")
            }
          />
          {definition?.kind === "lines" && (
            <ColorField
              className="wmc-color"
              label={tr("Цвет линий")}
              value={base.textureColor}
              onChange={(textureColor) =>
                onPatch(
                  { textureColor },
                  tr("Цвет линий текстуры"),
                  "base.textureColor",
                )
              }
            />
          )}
        </>
      )}
    </>
  );
}
