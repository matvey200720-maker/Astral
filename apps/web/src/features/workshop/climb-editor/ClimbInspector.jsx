/*
 * Панель инструмента залазов.
 *
 * Мастерская «как в Photoshop» (владелец, 03.10.2026): каждый раздел прежней
 * колонки — свой инструмент слева, и панель показывает только раздел
 * взятого (`tool`). Первые три — про выбранную метку: вид, надпись, своя
 * картинка. Дальше — про набор целиком: цвета, обводка, ореол, размер,
 * свечение ночью, и что уйдёт в игру. Так читают и в игре: у каждой метки
 * своё лицо, а цвет и свет у набора один. Свои цвета у метки — отдельным
 * выключателем, когда стрелку хочется красной, а остальное оставить набором.
 *
 * Органы — из словаря (`components/ui`): плитки видов — `ChoiceTile`, цвета
 * — `ColorField`, выключатели — `Switch`. Раздел — `ui-panel fx-section`, как
 * у прицела и эффектов; заголовок раздела — заголовок панели, второй такой
 * же строкой ниже он не повторяется.
 */

import { memo, useRef } from "react";
import { UploadSimple } from "../../../components/ui/icons.jsx";
import {
  CLIMB_FONTS,
  CLIMB_LIMITS,
  CLIMB_TEXTURE_SIZES,
  CLIMB_TEXT_SUGGESTIONS,
  CLIMB_VARIANTS,
  climbMarkerColours,
  climbVariant,
  createDefaultClimbDesign,
  findClimbSlot,
} from "@modovik/climb-contract";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { climbCssFont } from "./climb-fonts.js";
import FontSources from "../emblem/FontSources.jsx";
import { ownFontStack } from "../emblem/own-font.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Быстрые цвета: чем красят метки залазов на RP-серверах. */
export const CLIMB_FILL_SWATCHES = Object.freeze([
  "#ffffff",
  "#5ce1ff",
  "#b6ff3d",
  "#ffcc00",
  "#ff8a1f",
  "#ff3b3b",
  "#ff4fd8",
  "#b388ff",
]);

const OUTLINE_SWATCHES = Object.freeze([
  "#000000",
  "#101419",
  "#1f2937",
  "#3b0a0a",
  "#ffffff",
]);

const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.dds";

/* Пары меток, у которых вид обычно один: надписи от первого и третьего лица. */
const TWINS = Object.freeze({ firstpov: "thirdpov", thirdpov: "firstpov" });

/* Щит мода пуст: «Как в моде» у него — ничего, и это говорится прямо. */
const BLANK_NOTE =
  "В моде этот щит пустой: картинка на нём прозрачная, и в игре его не видно. Принесите свою картинку — фото встанет на щит — или возьмите значок или слова.";

/* Раздел панели. Имя — для читалки экрана: видимый заголовок у раздела —
   заголовок панели инструмента. */
function Section({ label, children }) {
  return (
    <section className="ui-panel fx-section climb-section" aria-label={label}>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Вид метки
 * ------------------------------------------------------------------ */

const VariantTile = memo(function VariantTile({
  variant,
  href,
  selected,
  onSelect,
}) {
  return (
    <ChoiceTile
      className="climb-variant"
      selected={selected}
      media={
        href ? (
          <img src={href} alt="" />
        ) : (
          <span className="climb-variant-empty">
            <UploadSimple />
          </span>
        )
      }
      title={variant.label}
      tooltip={variant.description}
      onClick={() => onSelect(variant)}
    />
  );
});

function MarkerSection({
  slot,
  marker,
  twin,
  thumbnails,
  onPatchMarker,
  onCopyToTwin,
  onPickImage,
}) {
  useTr();
  const fileRef = useRef(null);
  /* Плитки «Своя картинка» среди видов нет: своя картинка — рамкой первым блоком вкладки (разбор критика 30.10.2026). */
  const variants = CLIMB_VARIANTS[slot.id].filter((variant) => variant.id !== "image" || marker.variant === "image");
  const select = (variant) => {
    if (variant.id === "image" && !marker.image) {
      fileRef.current?.click();
      return;
    }
    onPatchMarker(
      { variant: variant.id },
      `Метка «${slot.label}»: вид «${variant.label}»`,
      "variant",
    );
  };
  return (
    <>
    <Section label={`Вид метки «${slot.label}»`}>
      {/* Выключатель метки — первой строкой: заголовок «Вид · …» стоит у
          панели, а что делает метка — подписью под выключателем. */}
      <label className="fx-switch is-inline" title={tr(slot.description)}>
        <span>
          <b>{tr("Метка в игре")}</b>
        </span>
        <Switch
          checked={marker.enabled}
          label={`${marker.enabled ? tr("Скрыть") : tr("Показать")} метку «${slot.label}» в игре`}
          onChange={(enabled) =>
            onPatchMarker(
              { enabled },
              `Метка «${slot.label}» ${enabled ? tr("показана") : tr("скрыта")}`,
              "enabled",
            )
          }
        />
      </label>
      {marker.enabled ? (
        <>
          <div
            className="ui-choice-grid climb-variants"
            role="group"
            aria-label={tr("Вид метки")}
            title={slot.blank && marker.variant === "original" ? tr(BLANK_NOTE) : undefined}
          >
            {variants.map((variant) => (
              <VariantTile
                key={variant.id}
                variant={variant}
                href={
                  variant.id === "image" && !marker.image
                    ? ""
                    : thumbnails[variant.id]
                }
                selected={marker.variant === variant.id}
                onSelect={select}
              />
            ))}
          </div>
        </>
      ) : null}
      <input
        ref={fileRef}
        className="climb-file-input"
        type="file"
        accept={IMAGE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onPickImage(slot.id, event)}
      />
    </Section>
    {/* Надписи от первого и третьего лица почти всегда хотят одного
        вида: пара правится одним нажатием, а надписи у каждой свои. */}
    {twin && marker.enabled && (
      <ListGroup>
        <ListRow title={trFill("Так же у «{0}»", tr(twin.label))} trailing={null} onOpen={onCopyToTwin} />
      </ListGroup>
    )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Надписи
 * ------------------------------------------------------------------ */

/* Быстрые надписи — сегменты словаря: своя надпись в поле выше просто не
   подсвечивает ни одного. Подписи клавиш — `<kbd>`: это имена клавиш,
   и прописными они написаны так же, как на самой клавише. Остальные слова —
   те, что встанут на стену: мод пишет их прописными («STAY HERE», «JUMP
   SPACE»), и в подсказке они такие же, как на метке. */
function Suggestions({ values, current, onPick, label, keys = false }) {
  return (
    <SegmentedControl
      className="climb-suggestions"
      label={label}
      size="sm"
      options={values.map((value) => ({
        value,
        label: keys ? (
          <kbd>{value}</kbd>
        ) : (
          <span data-audit-ignore="caps">{value}</span>
        ),
      }))}
      value={current}
      onChange={onPick}
    />
  );
}

/* Образец шрифта — сами слова метки, прописными, как их пишет мод. */
const FontTile = memo(function FontTile({ font, sample, selected, onSelect }) {
  return (
    <ChoiceTile
      className="climb-font"
      selected={selected}
      media={
        <span
          className="climb-font-sample"
          style={font.id === "custom" ? { fontFamily: font.family } : climbCssFont(font.id)}
          data-audit-ignore="caps"
        >
          {sample}
        </span>
      }
      title={font.label}
      onClick={() => onSelect(font)}
    />
  );
});

/*
 * Надпись — у меток со словами (у всех, кроме стрелки); у стрелки
 * инструмента нет вовсе (`hidden` в `ClimbCustomizer.jsx`). Когда слов нет
 * на самой метке — скрыта она, нарисована значком или своей картинкой, —
 * панель говорит об этом одной строкой, а не стоит пустой.
 *
 * У вида «Своим шрифтом» слова — две строки, как у мода («JUMP» и
 * «SPACE»); у видов с клавишей — надпись и клавиша.
 */
function TextSection({ slot, marker, style, onPatchMarker, onPatchStyle, onNotice }) {
  useTr();
  const variant = climbVariant(slot.id, marker.variant);
  if (!slot.text) return null;
  const label = `Надпись метки «${slot.label}»`;
  /* Слов на метке нет — одна строка, которая их заводит (без абзаца «почему»: что сейчас на метке — в подписи строки). */
  if (!marker.enabled || marker.variant === "image" || marker.variant === "original" || !variant?.text)
    return (
      <ListGroup label={label}>
        <ListRow
          title={tr("Своя надпись и шрифт")}
          caption={
            !marker.enabled
              ? tr("Метка скрыта в игре")
              : marker.variant === "image"
                ? tr("Сейчас своя картинка")
                : marker.variant === "original"
                  ? tr("Как в игре")
                  : tr("Сейчас значок")
          }
          trailing={null}
          onOpen={() =>
            onPatchMarker(
              { variant: "lines", ...(marker.enabled ? {} : { enabled: true }) },
              `Метка «${slot.label}»: своя надпись`,
              "variant",
            )
          }
        />
      </ListGroup>
    );
  /* «Свой» в ряду плиток, когда файл шрифта выбран: он остаётся в макете и когда выбран шрифт набора. */
  const own = style.fontAsset
    ? [{ id: "custom", label: style.fontName || tr("Свой шрифт"), family: ownFontStack(style.fontAsset, "Impact, sans-serif") }]
    : [];
  const fonts = [...CLIMB_FONTS, ...own];
  const showLabel = variant.text === "label" || variant.text === "both";
  const showKey = variant.text === "key" || variant.text === "both";
  const asLines = variant.id === "lines";
  const suggestions = CLIMB_TEXT_SUGGESTIONS[slot.id];
  const setLabel = (value) =>
    onPatchMarker({ label: value }, `Метка «${slot.label}»: надпись`, "label");
  const setKey = (value) =>
    onPatchMarker(
      { key: value },
      `Метка «${slot.label}»: ${asLines ? tr("вторая строка") : tr("клавиша")}`,
      "key",
    );
  return (
    <Section label={label}>
      {showLabel && (
        <>
          <TextField
            label={asLines ? tr("Первая строка") : tr("Надпись")}
            value={marker.label}
            maxLength={CLIMB_LIMITS.labelLength}
            spellCheck={false}
            onChange={setLabel}
          />
          <Suggestions
            label={tr("Быстрые надписи")}
            values={suggestions.label}
            current={marker.label}
            onPick={setLabel}
          />
        </>
      )}
      {showKey && (
        <>
          <TextField
            label={asLines ? tr("Вторая строка") : tr("Клавиша")}
            value={marker.key}
            maxLength={CLIMB_LIMITS.keyLength}
            spellCheck={false}
            onChange={setKey}
          />
          <Suggestions
            keys={!asLines}
            label={asLines ? tr("Быстрые слова") : tr("Быстрые клавиши")}
            values={suggestions.key}
            current={marker.key}
            onPick={setKey}
          />
        </>
      )}
      <h4 className="climb-subhead">{tr("Шрифт набора")}</h4>
      <div
        className="ui-choice-grid climb-fonts"
        role="group"
        aria-label={tr("Шрифт надписей")}
      >
        {fonts.map((item) => (
          <FontTile
            key={item.id}
            font={item}
            sample={marker.label || slot.text.label}
            selected={style.font === item.id}
            onSelect={(picked) =>
              onPatchStyle(
                { font: picked.id },
                `Шрифт надписей: ${picked.label}`,
                "font",
              )
            }
          />
        ))}
      </div>
      {/* Свой шрифт — файлом или из установленных на ПК (ТЗ 23.10.2026, п. F). */}
      <FontSources
        onFont={(picked) => onPatchStyle({ font: "custom", ...picked }, `Шрифт надписей: ${picked.fontName}`, "font")}
        onNotice={onNotice}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Своя картинка
 * ------------------------------------------------------------------ */

const ROTATIONS = Object.freeze([
  { value: "0", label: "0°" },
  { value: "90", label: "90°" },
  { value: "180", label: "180°" },
  { value: "270", label: "270°" },
]);

const FITS = Object.freeze([
  { value: "contain", label: "Вписать" },
  { value: "cover", label: "Заполнить" },
]);

/*
 * Своя картинка — у любой видимой метки: принесённый файл сразу рисует
 * метку (вид «Своя картинка»), как и плитка этого вида в «Виде».
 *
 * Как картинка ложится в метку: «Вписать» — целиком, с полями, «Заполнить»
 * — на всю метку, лишнее срезано. Увеличение и положение кадрируют снимок:
 * какую его часть показать на метке. Положение двигает саму картинку.
 */
function PictureSection({
  slot,
  marker,
  asset,
  picture,
  thumbnails = {},
  onPatchMarker,
  onPickImage,
}) {
  useTr();
  const label = `Своя картинка метки «${slot.label}»`;
  if (!marker.enabled)
    return (
      <ListGroup label={label}>
        <ListRow
          title={tr("Показать метку")}
          caption={tr("Метка скрыта в игре")}
          trailing={null}
          onOpen={() => onPatchMarker({ enabled: true }, `Метка «${slot.label}» показана`, "enabled")}
        />
      </ListGroup>
    );
  const image = marker.image;
  const patchImage = (values, label, path) =>
    onPatchMarker({ image: { ...image, ...values } }, label, `image.${path}`);
  const hasBody = picture?.state === "failed" || (image && marker.variant === "image");
  return (
    <>
      {/*
        Своя картинка — первым блоком, во всю ширину (правило 10 `design-qa.md`, слово владельца 30.10.2026): в рамке — метка со своей
        картинкой, как она ляжет на стену; щелчок открывает выбор файла, файл можно бросить на колонку.
      */}
      <SurfacePicture
        label={label}
        src={image && marker.variant === "image" ? thumbnails.image || "" : ""}
        aspect={1}
        fit="contain"
        caption={asset ? (picture?.state === "ready" ? `${asset.name} · ${picture.width}×${picture.height}` : asset.name) : ""}
        hint={tr("Принесите PNG или JPEG — впишите в метку или кадрируйте, цветом метки его можно подкрасить")}
        accept={IMAGE_ACCEPT}
        dropLabel={tr("Отпустите — встанет на метку")}
        onFile={(file) => onPickImage(slot.id, file)}
        /* «×» — метка снова как в моде, картинка снята (своё — всегда с «×», п. 21). */
        onClear={marker.variant === "image" ? () => onPatchMarker({ variant: "original", image: null }, `Метка «${slot.label}»: как в моде`, "variant") : null}
        clearLabel={tr("Как в моде")}
      />
      {image && marker.variant !== "image" && (
        <ListGroup label={label}>
          <ListRow
            title={tr("Рисовать метку этой картинкой")}
            trailing={null}
            onOpen={() => onPatchMarker({ variant: "image" }, `Метка «${slot.label}» рисуется своей картинкой`, "variant")}
          />
        </ListGroup>
      )}
      {hasBody && (
    <Section label={label}>
      {picture?.state === "failed" && (
        <p className="climb-note is-warning">
          {tr("Картинку не удалось разобрать — метка рисуется так, как в моде.")}
        </p>
      )}
      {image && marker.variant === "image" && (
        <>
          <div className="climb-row">
            <span>{tr("Как ложится")}</span>
            <SegmentedControl
              label={tr("Как картинка ложится в метку")}
              size="sm"
              options={FITS}
              value={image.fit}
              onChange={(fit) =>
                patchImage(
                  { fit },
                  fit === "cover"
                    ? tr("Картинка заполняет метку")
                    : tr("Картинка вписана в метку"),
                  "fit",
                )
              }
            />
          </div>
          <Slider
            label={tr("Увеличение")}
            value={image.zoom}
            min={CLIMB_LIMITS.zoom.min}
            max={CLIMB_LIMITS.zoom.max}
            unit=" %"
            onChange={(zoom) =>
              patchImage({ zoom }, "Увеличение своей картинки", "zoom")
            }
          />
          <Slider
            label={tr("Положение по горизонтали")}
            value={image.x}
            min={CLIMB_LIMITS.offset.min}
            max={CLIMB_LIMITS.offset.max}
            onChange={(x) => patchImage({ x }, "Положение своей картинки", "x")}
          />
          <Slider
            label={tr("Положение по вертикали")}
            value={image.y}
            min={CLIMB_LIMITS.offset.min}
            max={CLIMB_LIMITS.offset.max}
            onChange={(y) => patchImage({ y }, "Положение своей картинки", "y")}
          />
          <Slider
            label={tr("Подкраска в цвет метки")}
            value={image.tint}
            min={0}
            max={100}
            unit=" %"
            onChange={(tint) =>
              patchImage({ tint }, "Подкраска своей картинки", "tint")
            }
          />
          <label className="fx-switch" title={tr("Белое или чёрное поле вокруг рисунка станет прозрачным.")}>
            <span>
              <b>{tr("Убрать однотонный фон")}</b>
            </span>
            <Switch
              checked={image.keyOut}
              label={tr("Убрать однотонный фон картинки")}
              onChange={(keyOut) =>
                patchImage(
                  { keyOut },
                  keyOut ? tr("Фон картинки убран") : tr("Фон картинки оставлен"),
                  "keyOut",
                )
              }
            />
          </label>
          {/* Как должна смотреть стрелка — подсказкой у строки поворота, не абзацем под ней (ТЗ 29.10.2026). */}
          <div
            className="climb-row"
            title={slot.id === "arrow" ? tr("Стрелка на картинке должна смотреть вверх: модель в игре уже стоит на стене остриём туда, куда лезть, как стрелка мода.") : undefined}
          >
            <span>{tr("Поворот")}</span>
            <SegmentedControl
              label={tr("Поворот картинки")}
              size="sm"
              options={ROTATIONS}
              value={String(image.rotate)}
              onChange={(value) =>
                patchImage(
                  { rotate: Number(value) },
                  "Поворот своей картинки",
                  "rotate",
                )
              }
            />
          </div>
        </>
      )}
    </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Цвета набора
 * ------------------------------------------------------------------ */

function ColourSection({ slot, design, onPatchStyle, onPatchMarker }) {
  useTr();
  const marker = design.markers[slot.id];
  const own = Boolean(marker.colors);
  const colours = climbMarkerColours(design, slot.id);
  const style = design.style;
  const setFill = (value) =>
    own
      ? onPatchMarker(
          { colors: { ...marker.colors, fill: value } },
          `Цвет метки «${slot.label}»`,
          "colors.fill",
        )
      : onPatchStyle({ fill: value }, "Цвет меток", "fill");
  const setOutline = (value) =>
    own
      ? onPatchMarker(
          { colors: { ...marker.colors, outline: value } },
          `Обводка метки «${slot.label}»`,
          "colors.outline",
        )
      : onPatchStyle({ outline: value }, "Цвет обводки меток", "outline");
  return (
    <Section label={tr("Цвет")}>
      {/* Свой цвет метки — одним органом: сегмент словами, цвета под ним (правило «Свой цвет», 30.10.2026). */}
      <SegmentedControl
        label={trFill("Цвета метки «{0}»", slot.label)}
        size="sm"
        options={[
          { value: "all", label: tr("Как у всех меток") },
          { value: "own", label: tr("Свой цвет") },
        ]}
        value={own ? "own" : "all"}
        onChange={(value) => {
          const enabled = value === "own";
          onPatchMarker(
            { colors: enabled ? { fill: colours.fill, outline: colours.outline } : null },
            enabled ? `Свои цвета у «${slot.label}»` : `«${slot.label}» в цветах набора`,
            "colors",
          );
        }}
      />
      <ColorField
        label={tr("Метка")}
        value={colours.fill}
        swatches={CLIMB_FILL_SWATCHES}
        editable
        onChange={setFill}
      />
      {!own && (
        <>
          <label className="fx-switch" title={tr("Сверху — цвет метки, снизу — второй цвет.")}>
            <span>
              <b>{tr("Градиент")}</b>
            </span>
            <Switch
              checked={style.gradient}
              label={tr("Градиент меток")}
              onChange={(gradient) =>
                onPatchStyle(
                  { gradient },
                  gradient ? tr("Градиент включён") : tr("Градиент выключен"),
                  "gradient",
                )
              }
            />
          </label>
          {style.gradient && (
            <ColorField
              label={tr("Второй цвет")}
              value={style.fill2}
              swatches={CLIMB_FILL_SWATCHES}
              editable
              onChange={(value) =>
                onPatchStyle({ fill2: value }, "Второй цвет градиента", "fill2")
              }
            />
          )}
        </>
      )}
      <ColorField
        label={tr("Обводка и надписи на табличке")}
        value={colours.outline}
        swatches={OUTLINE_SWATCHES}
        editable
        onChange={setOutline}
      />
      <Slider
        label={tr("Толщина обводки")}
        value={style.outlineWidth}
        min={0}
        max={100}
        unit=" %"
        onChange={(outlineWidth) =>
          onPatchStyle({ outlineWidth }, "Толщина обводки", "outlineWidth")
        }
      />
      <Slider
        label={tr("Ореол")}
        value={style.glow}
        min={0}
        max={100}
        unit=" %"
        onChange={(glow) => onPatchStyle({ glow }, "Ореол меток", "glow")}
      />
      <Slider
        label={tr("Непрозрачность")}
        value={style.opacity}
        min={CLIMB_LIMITS.opacity.min}
        max={CLIMB_LIMITS.opacity.max}
        unit=" %"
        onChange={(opacity) =>
          onPatchStyle({ opacity }, "Непрозрачность меток", "opacity")
        }
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Размер и свет
 * ------------------------------------------------------------------ */

/** Свечение меток ночью, как у мода: его возвращает строка внизу «Размера». */
const STOCK_BRIGHTNESS = createDefaultClimbDesign().style.brightness;

function SizeSection({
  slot,
  design,
  onPatchStyle,
  onPatchMarker,
  onPatchTexture,
}) {
  useTr();
  const marker = design.markers[slot.id];
  return (
    <>
    <Section label={tr("Размер")}>
      <Slider
        label={tr("Размер всех меток")}
        value={design.style.scale}
        min={CLIMB_LIMITS.scale.min}
        max={CLIMB_LIMITS.scale.max}
        unit=" %"
        onChange={(scale) =>
          onPatchStyle({ scale }, "Размер всех меток", "scale")
        }
      />
      <Slider
        label={`Размер «${slot.label}»`}
        value={marker.scale}
        min={CLIMB_LIMITS.scale.min}
        max={CLIMB_LIMITS.scale.max}
        unit=" %"
        disabled={!marker.enabled}
        onChange={(scale) =>
          onPatchMarker({ scale }, `Размер метки «${slot.label}»`, "scale")
        }
      />
      <div className="climb-row">
        <span>{tr("Чёткость текстуры")}</span>
        <SegmentedControl
          label={tr("Чёткость текстуры")}
          size="sm"
          options={CLIMB_TEXTURE_SIZES.map((size) => ({ value: String(size), label: `${size}` }))}
          value={String(design.texture.size)}
          onChange={(value) => onPatchTexture({ size: Number(value) }, "Чёткость текстуры", "size")}
        />
      </div>
    </Section>
    {/* Ползунка свечения ночью нет (владелец 30.10.2026: свечение картинки — «бесполезная функция»); шаблон с другим
        свечением снимается строкой внизу. */}
    <ActionRows
      actions={[
        design.style.brightness !== STOCK_BRIGHTNESS && {
          id: "brightness-stock",
          label: tr("Вернуть яркость как в игре"),
          onClick: () => onPatchStyle({ brightness: STOCK_BRIGHTNESS }, "Свечение меток ночью", "brightness"),
        },
      ]}
    />
    </>
  );
}

export default function ClimbInspector({
  tool = "marker",
  design,
  slotId,
  thumbnails,
  asset,
  picture,
  installError,
  onPatchStyle,
  onPatchTexture,
  onPatchMarker,
  onPickImage,
  onNotice = null,
}) {
  const slot = findClimbSlot(slotId);
  const marker = design.markers[slotId];
  const patchMarker = (values, label, path) =>
    onPatchMarker(slotId, values, label, path);
  const twin = findClimbSlot(TWINS[slotId]);
  const copyToTwin = () =>
    onPatchMarker(
      twin.id,
      {
        variant: marker.variant,
        image: marker.image,
        colors: marker.colors,
        scale: marker.scale,
        enabled: true,
      },
      `Метка «${twin.label}»: вид как у «${slot.label}»`,
      "variant",
    );
  /* Вкладки «Установка в игру» нет (18.10.2026, владелец: блоки «что уйдёт в
     игру» убрать): установлено ли — говорит кнопка «Обновить в игре» в шапке,
     снять — «⋯ → Снять из игры». Ошибка установки — сверху любой вкладки. */
  const panel = toolPanel();
  return installError ? (
    <>
      <p className="climb-note is-warning" role="alert">
        {installError}
      </p>
      {panel}
    </>
  ) : (
    panel
  );

  function toolPanel() {
  switch (tool) {
    case "marker":
      return (
        <>
        {marker.enabled && (
          <PictureSection
            slot={slot}
            marker={marker}
            asset={asset}
            picture={picture}
            thumbnails={thumbnails}
            onPatchMarker={patchMarker}
            onPickImage={onPickImage}
          />
        )}
        <MarkerSection
          slot={slot}
          marker={marker}
          twin={twin}
          thumbnails={thumbnails}
          onPatchMarker={patchMarker}
          onCopyToTwin={copyToTwin}
          onPickImage={onPickImage}
        />
        </>
      );
    case "text":
      return (
        <TextSection
          slot={slot}
          marker={marker}
          style={design.style}
          onPatchMarker={patchMarker}
          onPatchStyle={onPatchStyle}
          onNotice={onNotice}
        />
      );
    case "picture":
      return (
        <PictureSection
          slot={slot}
          marker={marker}
          asset={asset}
          picture={picture}
          thumbnails={thumbnails}
          onPatchMarker={patchMarker}
          onPickImage={onPickImage}
        />
      );
    case "colour":
      return (
        <ColourSection
          slot={slot}
          design={design}
          onPatchStyle={onPatchStyle}
          onPatchMarker={patchMarker}
        />
      );
    case "size":
      return (
        <SizeSection
          slot={slot}
          design={design}
          onPatchStyle={onPatchStyle}
          onPatchMarker={patchMarker}
          onPatchTexture={onPatchTexture}
        />
      );
    default:
      return null;
  }
  }
}
