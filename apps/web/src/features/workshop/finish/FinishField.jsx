/*
 * Отделка поверхности в колонке правок — один орган на «Ангар» и «Завод».
 *
 * Сверху — как отделать (Select «Отделка»: стандарт GTA, как в моде, свой
 * цвет, узор, своя картинка, градиент и режимы редактора вроде радуги),
 * ниже — органы выбранного режима:
 *
 *   узор     — плитки каталога настоящими пикселями узора (та же функция,
 *              что пишет листы установщик), три цвета и масштаб;
 *   картинка — загрузка файла, «Растянуть» или «Замостить», подкраска;
 *   градиент — готовые градиенты плитками, как небо «Тайм-циклов», цвета
 *              кружками с «+» (как переход трассера) и направление.
 *
 * Органы — из словаря (`components/ui`): Select, ColorField, Slider,
 * SegmentedControl, Button. Раздел рисует редактор; здесь — его начинка.
 */

import { memo, useEffect, useRef, useState } from "react";
import { Buildings, Check, CircleHalf, Cube, GameController, ImageSquare, LinkSimple, PaintBucket, Palette, Plus, Shapes, Sparkle, SquaresFour, Trash, UploadSimple } from "../../../components/ui/icons.jsx";
import {
  FINISH_FITS,
  FINISH_FIT_LABELS,
  FINISH_GRADIENTS,
  FINISH_LIMITS,
  FINISH_PATTERNS,
  GRADIENT_DIRECTIONS,
  GRADIENT_DIRECTION_LABELS,
  GRADIENT_STOPS,
  findFinishPattern,
  patternTile,
} from "@modovik/climb-contract/recolor/finish";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import { gifSurfaceCell } from "@modovik/climb-contract/recolor/gif-surface";
import { firstFramePicture, saveGifSurfacePicture } from "../models/model-assets.js";
import { FINISH_IMAGE_ACCEPT, saveFinishImage, useFinishImage } from "./finish-assets.js";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import StudioEntry from "../texture-studio/StudioEntry.jsx";
import ChoiceRows from "../choice-rows.jsx";
import { placeStudioImage } from "../texture-studio/studio-place.js";
import { materialIndexBitmap, materialSheetBitmap, materialSheetRegion, sceneSheetBitmap } from "../texture-studio/scene-base.js";
import { finishView3d, useStudioLive } from "../texture-studio/StudioLive.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/* «100 %» — с неразрывным пробелом (п. 18 `design-qa.md`). */
const percent = (value) => `${Math.round(value)}\u00a0%`;

/* Значок строки отделки (строки выбора `rows`): у каждого способа — свой, у прочих режимов редактора — ведёрко. */
const MODE_ICONS = Object.freeze({
  colour: <Palette />,
  pattern: <Shapes />,
  image: <ImageSquare />,
  gradient: <CircleHalf />,
  rainbow: <Sparkle />,
  classic: <SquaresFour />,
  buildings: <Buildings />,
});
const TILE = 48;

/* Плитка узора: настоящие пиксели узора в его цветах. */
const PatternSwatch = memo(function PatternSwatch({ pattern, colours, active, onPick }) {
  useTr();
  const canvasRef = useRef(null);
  const key = `${pattern.id}|${colours.join(",")}`;
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.("2d");
    if (!context || typeof ImageData === "undefined") return;
    const rgba = patternTile({ id: pattern.id, colours, scale: 100 }, TILE);
    context.putImageData(new ImageData(rgba, TILE, TILE), 0, 0);
    // Плитка перерисовывается ключом узора и цветов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <button
      type="button"
      className={`finish-pattern${active ? " is-active" : ""}`}
      aria-pressed={active}
      aria-label={`${tr("Узор")}: ${tr(pattern.label)}`}
      title={tr(pattern.label)}
      onClick={() => onPick(pattern)}
    >
      <canvas ref={canvasRef} width={TILE} height={TILE} aria-hidden="true" />
      {active && <Check weight="bold" aria-hidden="true" />}
    </button>
  );
});

export function PatternControls({ pattern, swatches, onChange }) {
  useTr();
  const current = findFinishPattern(pattern.id);
  return (
    <>
      <div className="finish-patterns" role="group" aria-label={tr("Узоры")}>
        {FINISH_PATTERNS.map((item) => (
          <PatternSwatch
            key={item.id}
            pattern={item}
            colours={item.id === current.id ? pattern.colours : item.colours}
            active={item.id === current.id}
            onPick={(picked) => onChange({ pattern: { id: picked.id, colours: [...picked.colours], scale: pattern.scale } }, "Узор")}
          />
        ))}
      </div>
      {/* Имя взятого узора — подсказкой и именем его плитки (отмечена галкой), а не строкой под плитками (п. 1 `design-qa.md`). */}
      {[tr("Основа"), tr("Узор"), tr("Детали")].map((label, index) => (
        <ColorField
          key={label}
          label={label}
          value={pattern.colours[index]}
          swatches={swatches}
          editable
          onChange={(colour) =>
            onChange(
              { pattern: { ...pattern, colours: pattern.colours.map((item, at) => (at === index ? colour : item)) } },
              `Узор: ${label.toLowerCase()}`,
            )
          }
        />
      ))}
      <Slider
        label={tr("Масштаб")}
        value={pattern.scale}
        min={FINISH_LIMITS.scale[0]}
        max={FINISH_LIMITS.scale[1]}
        step={5}
        format={percent}
        onChange={(scale) => onChange({ pattern: { ...pattern, scale } }, "Узор: масштаб")}
      />
    </>
  );
}

/* Гифка (постер остановки, `gif` — место из `GIF_SURFACE_PROFILES`) принимается и анимированными PNG и WebP. */
const GIF_ACCEPT = `${FINISH_IMAGE_ACCEPT},image/gif,image/apng,.gif,.apng`;

/*
 * «Студия» у поверхности (ТЗ 18.10.2026, Session 1, задача 6): холст — лист
 * этой поверхности (`studio`: размер, основа из игры, цвет под ней), итог
 * встаёт её своей картинкой «Растянуть» — тем же путём, что и загруженный файл.
 * `studio` — описание или функция, что его отдаёт (`{ id, title, width, height,
 * base, baseColour, placeLabel }`); без размера холст — 2048 × 2048.
 */
/*
 * Стена, по которой щёлкнули в кадре редактора (`StudioLiveProvider wall`, 3Б ТЗ 18.10.2026), —
 * если она из этой поверхности (`match(info)`): студия откроется на ней, а не на всей части.
 */
const wallFor = (live, surface) => (live?.wall && typeof surface?.match === "function" && live.wall.info && surface.match(live.wall.info) ? live.wall : null);

/* Подсказка кадру редактора: стена — своим контуром, без неё — подсветка материалов выбранной поверхности (`selection-highlight.js`). */
const surfaceHint = (surface, wall = null) => {
  if (wall) return { ...(surface.hint || {}), wall };
  return typeof surface.match === "function" ? { ...(surface.hint || {}), focus: { where: (info) => surface.match(info) } } : surface.hint;
};

/* `title` и `caption` — своё имя и подпись строки (страница оболочки арены: «Нарисовать в студии»); без них — «Студия» и общая подпись. */
export function StudioButton({ studio, label, mode, image, onChange, onNotice, title = "", caption = "" }) {
  useTr();
  const live = useStudioLive();
  const describe = () => {
    const given = typeof studio === "function" ? studio() : studio;
    return Promise.resolve(given).then(async ({ wallPlate = null, ...surface }) => {
      const size = { width: surface.width || 2048, height: surface.height || 2048 };
      const wall = wallFor(live, surface);
      /* Своя картинка только этой стене (3В): поверхность умеет (`wallPlate(wall)` → `{ surface, onPlace }`), и стена выбрана — студия откроется на ней. */
      const plate = wall && typeof wallPlate === "function" ? await wallPlate(wall).catch(() => null) : null;
      return {
        ...size,
        baseColour: "#202226",
        placeLabel: "Поставить на поверхность",
        slug: surface.id,
        current: mode === "image" && image.asset ? { asset: image.asset } : null,
        /* `baseSheet` — `{ scene, texture }`: лист поверхности из сцены редактора; он и есть основа. */
        ...(surface.baseSheet && !surface.base ? { base: () => sceneSheetBitmap(surface.baseSheet.scene, surface.baseSheet.texture) } : {}),
        /* `scene` и `match(info)` — материалы поверхности: основа — лист того, у кого больше граней. */
        ...(surface.scene && surface.match && !surface.base ? { base: () => materialSheetBitmap(surface.scene, surface.match) } : {}),
        /* `scene` и `match`: область листа, что занимает эта поверхность, — студия открывается на ней, а не на всём листе (задача 3 ТЗ 18.10.2026); `region` у описания — своя область. */
        ...(surface.scene && surface.match && surface.region === undefined ? { region: () => materialSheetRegion(surface.scene, surface.match) } : {}),
        /* `path` — место поверхности в работе: окно студии рисует кадр самого редактора с картинкой на этом месте; грани выбранной поверхности (`match`) подсвечены (`hint.focus`). */
        ...(surface.path && !surface.view3d ? { view3d: finishView3d(live, { ...surface, ...size, hint: surfaceHint(surface, wall) }) } : {}),
        ...surface,
        /* Стена: лист — её материала, слои — свои у каждого материала, вид «стена» в окне студии. */
        ...(wall ? { id: `${surface.id}:m${wall.material}`, wall, ...(surface.scene ? { base: () => materialIndexBitmap(surface.scene, wall.material) } : {}) } : {}),
        ...(plate ? { plate } : {}),
      };
    });
  };
  /* Подпись кнопки — по описанию поверхности, если оно готовое (у функции оно считается по нажатию). */
  const staticWall = typeof studio === "function" ? null : wallFor(live, studio);
  return (
    <StudioEntry
      label={staticWall ? tr("Студия · эта стена") : title}
      caption={caption}
      getSurface={describe}
      onNotice={(text, tone) => onNotice?.(text, tone)}
      onPlace={async (blob) => {
        const saved = await placeStudioImage(blob, String(studio?.slug || studio?.id || label || "studio").replace(/[^a-zA-Z0-9_-]+/g, "-"));
        const { animation: _previous, ...rest } = image;
        /* Картинка студии — готовый лист поверхности, основу она уже несёт в себе: деталей штатного листа поверх неё не нужно (`shade: 0`, вернуть можно ползунком «Светотень»). */
        onChange({ mode: "image", image: { ...rest, ...saved, fit: "stretch" }, shade: 0 }, `${label}: студия`);
        return { asset: saved.asset };
      }}
    />
  );
}

/* Как ляжет картинка — подсказкой сегмента «Как лечь», а не абзацем под ним. */
function fitHint(fit, surface) {
  if (fit === "stretch") {
    return surface === "wall"
      ? tr("Картинка растянута на всю стену: у каждой стены — своя.")
      : tr("Картинка ложится на лист целиком; игра повторяет лист по модели, как у штатной текстуры.");
  }
  return surface === "wall"
    ? tr("Картинка повторяется по стенам плиткой — масштаб задаёт её размер.")
    : tr("Картинка повторяется по листу плиткой — масштаб задаёт, сколько раз.");
}

function ImageControls({ image, surface, swatches, onChange, onNotice, gif = null, gifStill = "", studioButton = null, picture = false, active = true, onClear = null, clearLabel = "" }) {
  useTr();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const bitmap = useFinishImage(picture ? "" : image.asset);
  /* Рамкой первым блоком (`picture`, п. 10 `design-qa.md`) — картинка адресом, а не холстом превью. */
  const url = useHangarEmblemUrl(picture && active ? image.asset : "");
  const previewRef = useRef(null);

  useEffect(() => {
    const canvas = previewRef.current;
    const context = canvas?.getContext?.("2d");
    if (!canvas || !context || !bitmap) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    /* Гифка в листе кадров — в превью первый кадр, а не весь лист. */
    const cell = image.animation ? gifSurfaceCell(image.animation, bitmap.width, bitmap.height, 0) : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const fit = Math.min(canvas.width / cell.width, canvas.height / cell.height);
    const width = cell.width * fit;
    const height = cell.height * fit;
    context.drawImage(bitmap, cell.x, cell.y, cell.width, cell.height, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }, [bitmap, image.animation]);

  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await take(file);
  }

  async function take(file) {
    if (!file) return;
    setBusy(true);
    try {
      /* Гифка — листом кадров (до 1024 px) и «Растянуть»: плашка постера всегда растянута; обычная картинка — как была. */
      /* Где гифке не играть (`gifStill` — почему), она встаёт первым кадром, и сказано об этом прямо. */
      const still = gifStill && !gif ? await firstFramePicture(file) : null;
      const { notice, ...saved } = gif ? await saveGifSurfacePicture(file, gif, { save: saveFinishImage }) : await saveFinishImage(still?.file || file);
      const { animation: _previous, ...rest } = image;
      onChange({ mode: "image", image: { ...rest, ...saved, ...(saved.animation ? { fit: "stretch" } : {}) } }, "Своя картинка");
      if (notice) onNotice?.(notice);
      if (still?.frames > 1) onNotice?.(trFill("Гифка из {0} кадров встанет первым кадром: {1}", still.frames, gifStill));
    } catch (error) {
      onNotice?.(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  const accept = gif || gifStill ? GIF_ACCEPT : FINISH_IMAGE_ACCEPT;
  const formats = gif
    ? tr("Любая картинка — с Pinterest, своя фотография, логотип. PNG, JPEG или WebP до 8 МБ. Гифка (и анимированные PNG и WebP) — живой постер.")
    : tr("Любая картинка — с Pinterest, своя фотография, логотип. PNG, JPEG или WebP до 8 МБ.");
  return (
    <>
      {picture ? (
        <>
          <SurfacePicture
            label={tr("Своя картинка")}
            src={url}
            aspect={active && image.width && image.height ? image.width / image.height : 16 / 9}
            fit="contain"
            /* У гифки — сколько кадров и как она ложится (подсказкой, не абзацем): то же, что у прежней строки файла. */
            caption={
              active && image.asset ? (
                <span title={image.animation ? tr("Каждый кадр гифки растянут на весь постер; подкраска ложится на все кадры.") : undefined}>
                  {`${image.name || tr("Своя картинка")} · ${image.width} × ${image.height}`}
                  {image.animation ? ` · ${trFill("гифка, кадров: {0}", image.animation.frames)}` : ""}
                </span>
              ) : (
                ""
              )
            }
            empty={tr("Своя картинка")}
            accept={accept}
            hint={formats}
            busy={busy}
            /* Полей отделки на странице бывает два (стены и пол ангара): файл бросают на рамку, а не на всю колонку. */
            dropSelf
            onFile={take}
            /* «×» рамки — отделка, что была до картинки: как у группы или как в игре (своё — всегда с «×», п. 21). */
            onClear={active ? onClear : null}
            clearLabel={clearLabel}
          />
          {studioButton && <ListGroup label={tr("Студия")}>{studioButton}</ListGroup>}
        </>
      ) : null}
      {!picture && <input ref={input} type="file" accept={accept} hidden onChange={pick} />}
      {!picture && image.asset ? (
        <div className="finish-image">
          <canvas ref={previewRef} width={96} height={64} aria-hidden="true" />
          <span>
            <b>{image.name || tr("Своя картинка")}</b>
            <small title={image.animation ? tr("Каждый кадр гифки растянут на весь постер; подкраска ложится на все кадры.") : undefined}>
              {image.width} × {image.height}
              {image.animation ? ` · ${trFill("гифка, кадров: {0}", image.animation.frames)}` : ""}
            </small>
          </span>
        </div>
      ) : null}
      {/* Что подходит — подсказкой кнопки, а не абзацем (слово владельца 29.10.2026, `design-qa.md`). */}
      {!picture && (
        <Button size="sm" variant="secondary" icon={<UploadSimple />} disabled={busy} title={formats} onClick={() => input.current?.click()}>
          {busy ? tr("Читаем картинку…") : image.asset ? tr("Заменить картинку") : tr("Загрузить картинку")}
        </Button>
      )}
      {!picture && studioButton}
      {/* Подгонка и подкраска — только при своей картинке (п. 10 `design-qa.md`). */}
      {active && image.asset && (
        <>
          {/* Гифка на постере всегда растянута: плашка перед постером тоже растянута на всю сторону. */}
          {!image.animation && (
            <SegmentedControl
              label={picture ? tr("Подгонка") : tr("Как лечь")}
              size="sm"
              value={image.fit}
              options={FINISH_FITS.map((fit) => ({ value: fit, label: FINISH_FIT_LABELS[fit], title: fitHint(fit, surface) }))}
              onChange={(fit) => onChange({ image: { ...image, fit } }, "Картинка: как лечь")}
            />
          )}
          {image.fit === "tile" && !image.animation && (
            <Slider
              label={tr("Масштаб")}
              value={image.scale}
              min={FINISH_LIMITS.scale[0]}
              max={FINISH_LIMITS.scale[1]}
              step={5}
              format={percent}
              onChange={(scale) => onChange({ image: { ...image, scale } }, "Картинка: масштаб")}
            />
          )}
          <ColorField
            label={tr("Подкрасить")}
            value={image.tint}
            swatches={swatches}
            editable
            onChange={(tint) =>
              onChange({ image: { ...image, tint, strength: image.strength || 50 } }, "Картинка: подкраска")
            }
          />
          <Slider
            label={tr("Сила подкраски")}
            value={image.strength}
            min={FINISH_LIMITS.strength[0]}
            max={FINISH_LIMITS.strength[1]}
            format={percent}
            onChange={(strength) => onChange({ image: { ...image, strength } }, "Картинка: сила подкраски")}
          />
        </>
      )}
    </>
  );
}

/* Следующий цвет перехода — не повторяет соседей. */
function nextStop(stops, swatches) {
  return swatches.find((colour) => !stops.includes(colour)) || swatches[stops.length % swatches.length] || "#ffffff";
}

function GradientControls({ gradient, swatches, onChange }) {
  useTr();
  const [active, setActive] = useState(0);
  const stops = gradient.colours;
  const index = Math.min(active, stops.length - 1);
  const bar = `linear-gradient(90deg, ${stops.join(", ")})`;
  const matching = FINISH_GRADIENTS.find((item) => item.colours.join() === stops.join());
  return (
    <>
      <div className="finish-gradients" role="group" aria-label={tr("Готовые градиенты")}>
        {FINISH_GRADIENTS.map((item) => {
          const selected = item === matching;
          return (
            <button
              type="button"
              key={item.id}
              className={`finish-gradient${selected ? " is-active" : ""}`}
              style={{ background: `linear-gradient(0deg, ${item.colours.join(", ")})` }}
              aria-pressed={selected}
              aria-label={`Градиент: ${item.label}`}
              title={item.label}
              onClick={() => {
                onChange({ gradient: { ...gradient, colours: [...item.colours] } }, "Градиент");
                setActive(0);
              }}
            >
              {selected && <Check weight="bold" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="fx-stops">
        <div className="fx-stop-row" role="group" aria-label={tr("Цвета градиента")}>
          {stops.map((colour, position) => (
            <button
              type="button"
              key={`${position}-${colour}`}
              className={`fx-stop${position === index ? " is-active" : ""}`}
              style={{ background: colour }}
              aria-pressed={position === index}
              aria-label={`Цвет ${position + 1}: ${colour}`}
              title={`Цвет ${position + 1}`}
              onClick={() => setActive(position)}
            />
          ))}
          {stops.length < GRADIENT_STOPS[1] && (
            <button
              type="button"
              className="fx-stop is-add"
              aria-label={tr("Добавить цвет")}
              title={tr("Добавить цвет")}
              onClick={() => {
                onChange({ gradient: { ...gradient, colours: [...stops, nextStop(stops, swatches)] } }, "Градиент: цвет");
                setActive(stops.length);
              }}
            >
              <Plus />
            </button>
          )}
        </div>
        <span className="fx-stop-bar" aria-hidden="true" style={{ background: bar }} />
        <span className="fx-stop-ends" aria-hidden="true">
          <small>{gradient.direction === "vertical" ? tr("низ") : tr("начало")}</small>
          <small>{gradient.direction === "vertical" ? tr("верх") : tr("конец")}</small>
        </span>
        <ColorField
          /* Ангар стандартный (ТЗ 12.10.2026, ночь): подпись поля ввода слой
             перевода разметки не трогает — переводится здесь. */
          label={tr(`Цвет ${index + 1}`)}
          value={stops[index]}
          swatches={swatches}
          editable
          onChange={(colour) =>
            onChange(
              { gradient: { ...gradient, colours: stops.map((item, position) => (position === index ? colour : item)) } },
              "Градиент: цвет",
            )
          }
        />
        {stops.length > GRADIENT_STOPS[0] && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash />}
            onClick={() => {
              onChange({ gradient: { ...gradient, colours: stops.filter((_, position) => position !== index) } }, "Градиент: цвет");
              setActive(Math.max(0, index - 1));
            }}
          >
            Убрать цвет {index + 1}
          </Button>
        )}
      </div>
      <SegmentedControl
        label={tr("Направление градиента")}
        size="sm"
        value={gradient.direction}
        options={GRADIENT_DIRECTIONS.map((direction) => ({ value: direction, label: GRADIENT_DIRECTION_LABELS[direction] }))}
        onChange={(direction) => onChange({ gradient: { ...gradient, direction } }, "Градиент: направление")}
      />
    </>
  );
}

/**
 * `settings` — группа или сторона работы (`mode`, `colour`, `pattern`,
 * `image`, `gradient`, `shade`); `modes` — `[[режим, подпись]]`;
 * `onChange(patch, подпись шага)`; `children` — органы режимов редактора
 * (цвет и его яркость, наклейки); `hints` — подписи режимов; `surface` —
 * `wall` (ангар: по стенам) или `sheet` (завод: по листу); `shadeLabel` —
 * как назвать светотень основы (или не показывать); `gif` — место гифки
 * (`GIF_SURFACE_PROFILES`): с ним картинка может быть гифкой; `gifStill` —
 * почему гифке тут не играть (стены арены): файл-гифка принимается и встаёт
 * первым кадром, об этом сказано (`onNotice`); `studio` — холст «Студии» этой
 * поверхности (`StudioButton`), без него кнопки нет.
 *
 * `rows` — выбор отделки строками группы, а не выпадающим списком (п. 13 `design-qa.md`, разбор 30.10.2026). Взятое отмечено всегда, и
 * штатное тоже (ведущая 31.10.2026, критик, третий круг, п. 22): сверху `inherit` — `{ mode, label }` наследования («Как у всего корпуса»),
 * затем «Как в игре» (`base`, по умолчанию `standard`) и вид мода, ниже своя отделка — как «Облик места» у маппинга. Своя картинка —
 * рамкой выше строк, её состояние — в имени группы. `title` — имя группы (по умолчанию «Отделка»; пустое, когда так названа панель);
 * `baseLabel` — слово исходного облика («Как на сервере» у арены Majestic).
 * Студия — строкой группы «Нарисовать в студии». Без `rows` поле прежнее: выбор списком. Своё (картинка, цвет, узор) — со «×» рядом
 * (п. 21): у рамки и у взятой строки — назад к наследованию или «Как в игре»; `resetRow` — ещё и «Вернуть как в игре» строкой внизу поля,
 * где у страницы своей нижней строки отката нет.
 */
function FinishField({
  label,
  settings,
  modes,
  swatches,
  onChange,
  hints = {},
  surface = "sheet",
  shadeLabel = "Детали основы",
  onNotice = null,
  gif = null,
  gifStill = "",
  studio = null,
  rows = false,
  base = "standard",
  inherit = null,
  title = "Отделка",
  baseLabel = "Как в игре",
  resetRow = false,
  children = null,
}) {
  useTr();
  const mode = settings.mode;
  const finish = mode === "pattern" || mode === "image" || mode === "gradient";
  /* Гифке студия не нужна: живой постер — это клипы кадров, а не одна картинка. */
  const studioButton =
    studio && !gif && modes.some(([value]) => value === "image") ? (
      <StudioButton
        studio={studio}
        label={label}
        mode={mode}
        image={settings.image}
        onChange={onChange}
        onNotice={onNotice}
        {...(rows ? { title: tr("Нарисовать в студии"), caption: tr("Кисть, слои, текст") } : {})}
      />
    ) : null;
  /* Строки: наследование, «Как в игре», вид мода, затем своя отделка; своя картинка — рамкой выше, строки у неё нет. */
  const picture = rows && modes.some(([value]) => value === "image");
  const has = (value) => modes.some(([item]) => item === value);
  const modOption = rows ? modes.find(([value]) => value === "mod") : null;
  /* «×» своего — назад к тому, с чего начинают строки: наследование («Как у корпусов»), иначе «Как в игре»; одним шагом «Отменить». */
  const back = inherit && has(inherit.mode) ? { mode: inherit.mode, label: inherit.label } : has(base) ? { mode: base, label: baseLabel } : null;
  const clearOwn = back ? () => onChange({ mode: back.mode }, `${label}: ${tr(back.label)}`) : null;
  const choices = [
    inherit && has(inherit.mode) && { value: inherit.mode, label: tr(inherit.label), icon: <LinkSimple /> },
    has(base) && { value: base, label: tr(baseLabel), icon: <GameController /> },
    modOption && { value: "mod", label: tr(modOption[1]), icon: <Cube /> },
    /* Своя отделка (цвет, узор, градиент, режимы редактора) — со «×» у взятой строки: назад к наследованию или «Как в игре» (п. 21). */
    ...modes
      .filter(([value]) => value !== base && value !== inherit?.mode && value !== "mod" && !(picture && value === "image"))
      .map(([value, text]) => ({ value, label: tr(text), icon: MODE_ICONS[value] || <PaintBucket />, ...(back ? { onClear: clearOwn, clearLabel: tr(back.label) } : {}) })),
  ].filter(Boolean);
  /* Имя группы называет состояние, только когда его не показывает отмеченная строка: своя картинка стоит в рамке. */
  const heading = !title ? "" : mode === "image" && picture ? `${tr(title)} · ${tr("своя картинка").toLowerCase()}` : tr(title);
  return (
    /* Что значит выбранная отделка — подсказкой поля, а не строкой под ним (слово владельца 29.10.2026, `design-qa.md`). */
    <div className="finish-field" title={hints[mode] || undefined}>
      {/* Своя картинка — рамкой первым блоком (п. 10 `design-qa.md`): файл в рамку и делает отделку своей картинкой; студия — строкой под ней. */}
      {picture && (
        <ImageControls
          image={settings.image}
          surface={surface}
          swatches={swatches}
          onChange={onChange}
          onNotice={onNotice}
          gif={gif}
          gifStill={gifStill}
          studioButton={studioButton}
          picture
          active={mode === "image"}
          onClear={clearOwn}
          clearLabel={back ? tr(back.label) : ""}
        />
      )}
      {rows ? (
        /* Чем отделать — строками со значком; взятая отмечена полосой и галкой, штатная тоже (ведущая 31.10.2026). */
        <ChoiceRows title={heading} label={`${label}: отделка`} options={choices} value={mode} onChange={(next) => onChange({ mode: next }, `${label}: отделка`)} />
      ) : (
        <Select
          label={tr("Отделка")}
          ariaLabel={`${label}: отделка`}
          value={mode}
          options={modes}
          onChange={(next) => onChange({ mode: next }, `${label}: отделка`)}
        />
      )}
      {/* Цвет и наклейки — сразу под строками отделки, не через студию. */}
      {rows && children}
      {!rows && mode !== "image" && studioButton && <div className="recolor-actions">{studioButton}</div>}
      {rows && !picture && studioButton && <ListGroup label={tr("Студия")}>{studioButton}</ListGroup>}
      {mode === "pattern" && <PatternControls pattern={settings.pattern} swatches={swatches} onChange={onChange} />}
      {!picture && mode === "image" && (
        <ImageControls image={settings.image} surface={surface} swatches={swatches} onChange={onChange} onNotice={onNotice} gif={gif} gifStill={gifStill} studioButton={studioButton} picture={rows} />
      )}
      {mode === "gradient" && <GradientControls gradient={settings.gradient} swatches={swatches} onChange={onChange} />}
      {finish && shadeLabel && (
        <Slider
          label={tr(shadeLabel)}
          /* Пояснение у ползунка — подписью под ним только у старого поля; в строках — нет (п. 18 `design-qa.md`). */
          hint={rows ? null : tr("Сколько теней, швов и грязи основы остаётся под отделкой")}
          value={settings.shade}
          min={FINISH_LIMITS.shade[0]}
          max={FINISH_LIMITS.shade[1]}
          format={percent}
          onChange={(shade) => onChange({ shade }, `${label}: детали основы`)}
        />
      )}
      {!rows && children}
      {/* «Вернуть как в игре» — строкой внизу, пока стоит своё (наследование и вид мода своим не считаются); «×» у своего — к тому, что было до него. */}
      {resetRow && has(base) && mode !== base && mode !== inherit?.mode && mode !== "mod" && (
        <ActionRows label={`${label}: ${tr(baseLabel)}`} actions={[{ id: "finish-standard", label: tr("Вернуть как в игре"), onClick: () => onChange({ mode: base }, `${label}: ${tr(baseLabel)}`) }]} />
      )}
    </div>
  );
}

export default memo(FinishField);
