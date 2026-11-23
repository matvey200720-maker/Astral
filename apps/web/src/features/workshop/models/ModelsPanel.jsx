/*
 * Панель инструмента «Модели» — свои модели места слоями (задача 1 ТЗ
 * 11.10.2026, вечер: «под все эти модельки выдели отдельный инструмент …
 * ниже кнопка добавить ещё … как слой раскрыть для настройки и закрыть»).
 *
 * Облегчена (ТЗ 11.10.2026, ночь, задача 1: «облегчи … чтобы было легче его
 * крутить»): у выбранной на виду только простой путь — форма, размер,
 * повороты шагами и движение; место и наклон модель берёт сама, когда её
 * тянут по поверхностям в кадре. Точные цифры — место X/Y/Z, три оси
 * поворота, непрозрачность, свечение, дальность и имя — в свёрнутом разделе
 * «Точно».
 *
 * Строка слоя: снимок картинки, имя и что это за модель, глаз (скрытая в
 * игру не едет), копия, «Убрать». Внизу — «Добавить модель»: картинка (PNG,
 * JPEG, WebP), живая картинка (GIF, APNG, анимированный WebP) или модель
 * (GLB, glTF, OBJ).
 */

import { useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  CaretRight,
  Copy,
  Eye,
  EyeSlash,
  Trash,
} from "../../../components/ui/icons.jsx";
import {
  PLACE_MODEL_ANIMATED_SHAPES,
  PLACE_MODEL_IMAGE_SHAPES,
  PLACE_MODEL_LABEL_LIMIT,
  PLACE_MODEL_LIMIT,
  PLACE_MODEL_LIMITS,
  PLACE_MODEL_MOTIONS,
  PLACE_MODEL_MOTION_LABELS,
  PLACE_MODEL_SHAPE_LABELS,
  PLACE_MODEL_SHAPE_NOTES,
  placeModelAnimationDuration,
  placeModelSceneProblem,
  placeModelSceneRules,
  placeModelTitle,
} from "@modovik/climb-contract/recolor/place-models";
import { placeModelGifSummary, placeModelsGifPlan } from "@modovik/climb-contract/recolor/gif-surface";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import { PLACE_MODEL_ACCEPT } from "./model-assets.js";
/* интерьеры: только изнутри (12.10) — подпись поля файла через tr: слой перевода разметки поля ввода не трогает. */
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import SectionHeading from "../section-help.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";

const number = (value, digits = 1) =>
  String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");
const metres = (value) => `${number(value, 2)} м`;
const degrees = (value) => `${number(value, 0)}°`;
const percent = (value) => `${Math.round(value)} %`;
const times = (value) => `×${number(value, 2)}`;

const MOTION_OPTIONS = Object.freeze(
  PLACE_MODEL_MOTIONS.map((motion) => [
    motion,
    PLACE_MODEL_MOTION_LABELS[motion],
  ]),
);
const shapeOptions = (animated) =>
  PLACE_MODEL_IMAGE_SHAPES.filter(
    (shape) => !animated || PLACE_MODEL_ANIMATED_SHAPES.includes(shape),
  ).map((shape) => ({
    value: shape,
    label: PLACE_MODEL_SHAPE_LABELS[shape],
    title: PLACE_MODEL_SHAPE_NOTES[shape],
  }));
const AXES = Object.freeze(["X", "Y", "Z"]);
const PLACE_NOTES = Object.freeze([
  "X — с запада на восток",
  "Y — с юга на север",
  "Z — высота",
]);
const TURN_NOTES = Object.freeze([
  "Наклон вперёд и назад (вокруг X)",
  "Наклон вбок (вокруг Y)",
  "Поворот вокруг вертикали (вокруг Z)",
]);

/* Что за модель — одной строкой под именем. */
function rowNote(item, place = "") {
  const shape = PLACE_MODEL_SHAPE_LABELS[item.shape];
  const parts = [shape, metres(item.size)];
  if (item.animation) parts.push("живая");
  if (place) parts.push(place);
  if (item.motion !== "none")
    parts.push(PLACE_MODEL_MOTION_LABELS[item.motion].toLowerCase());
  if (item.hidden) parts.push("скрыта");
  return parts.join(" · ");
}

function Thumb({ item }) {
  const url = useHangarEmblemUrl(
    item.shape === "mesh" ? item.texture : item.asset,
  );
  /* Живая картинка — снимок первого кадра: атлас целиком в строке не нужен. */
  const cell = item.animation
    ? {
        width: `${item.animation.columns * 100}%`,
        height: `${item.animation.rows * 100}%`,
        maxWidth: "none",
        objectFit: "fill",
      }
    : null;
  return (
    <span
      className={`place-models-thumb is-${item.shape}${cell ? " is-live" : ""}`}
    >
      {url ? (
        <img src={url} alt="" style={cell || undefined} />
      ) : (
        <i aria-hidden="true" />
      )}
    </span>
  );
}

function Row({
  item,
  selected,
  open,
  onSelect,
  onToggleHidden,
  onDuplicate,
  onRemove,
  full,
  place = "",
  children,
}) {
  const title = placeModelTitle(item);
  return (
    <li
      className={`place-models-row${selected ? " is-selected" : ""}${item.hidden ? " is-hidden" : ""}`}
    >
      <div className="place-models-head">
        <button
          type="button"
          className="place-models-pick"
          aria-expanded={selected && open}
          aria-pressed={selected}
          onClick={() => onSelect(item.id)}
        >
          <span className="place-models-caret" aria-hidden="true">
            {selected && open ? <CaretDown /> : <CaretRight />}
          </span>
          <Thumb item={item} />
          <span className="place-models-copy">
            <b data-audit-ignore="caps">{title}</b>
            <small>{rowNote(item, place)}</small>
          </span>
        </button>
        <Button
          size="sm"
          variant="ghost"
          icon={item.hidden ? <EyeSlash /> : <Eye />}
          ariaLabel={item.hidden ? `Показать: ${title}` : `Скрыть: ${title}`}
          title={
            item.hidden
              ? "Показать — снова поедет в игру"
              : "Скрыть — в кадре и в игре её не будет"
          }
          onClick={() => onToggleHidden(item.id)}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy />}
          ariaLabel={`Копия: ${title}`}
          title="Копия рядом"
          disabled={full}
          onClick={() => onDuplicate(item.id)}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash />}
          ariaLabel={`Убрать: ${title}`}
          title="Убрать модель"
          onClick={() => onRemove(item.id)}
        />
      </div>
      {selected && open && children}
    </li>
  );
}

/* Ползунки по трём осям: место или поворот. */
function AxisSliders({
  group,
  values,
  range,
  step,
  format,
  label,
  notes,
  onChange,
}) {
  return (
    <div className="place-models-axes" role="group" aria-label={group}>
      {AXES.map((axis, index) => (
        <Slider
          key={axis}
          label={`${label} ${axis}`}
          hint={notes[index]}
          value={values[index]}
          min={range[index]?.[0] ?? range[0]}
          max={range[index]?.[1] ?? range[1]}
          step={step}
          format={format}
          onChange={(value) => onChange(index, value)}
        />
      ))}
    </div>
  );
}

/* Пределы места по сцене кадра: рамка сцены с запасом в обе стороны. */
function positionRange(bounds, value) {
  const [low, high] = PLACE_MODEL_LIMITS.position;
  return [0, 1, 2].map((axis) => {
    const min = bounds?.min?.[axis];
    const max = bounds?.max?.[axis];
    const margin = axis === 2 ? 60 : 40;
    let from = Number.isFinite(min) ? Math.floor(min - margin) : -200;
    let to = Number.isFinite(max)
      ? Math.ceil(max + (axis === 2 ? 150 : margin))
      : 200;
    /* Модель за рамкой (поставили цифрами) остаётся на дорожке. */
    from = Math.max(low, Math.min(from, Math.floor(value[axis])));
    to = Math.min(high, Math.max(to, Math.ceil(value[axis])));
    return [from, to];
  });
}

/*
 * Живая картинка: сколько кадров и как долго круг, чёткость листа (высокая 2048 по умолчанию / экономная 1024) и что получится на кадр — «кадр 256 × 256 px»; в зале Majestic гифка
 * стоит картинкой (у модели зала нет словаря клипов — сменять кадры нечем).
 */
function LiveNote({ item, rules, edit }) {
  if (!item.animation) return null;
  if (!rules.animation) return <p className="fx-hint place-models-live-note">{tr("В зале Majestic гифка стоит картинкой: сервер не даёт её проигрывать")}</p>;
  const summary = placeModelGifSummary(item.animation);
  return (
    <>
      <p className="fx-hint place-models-live-note">
        {trFill("Живая картинка: кадров {0}, круг {1} с — в игре кадры сменяет клип развёртки.", item.animation.frames, number(placeModelAnimationDuration(item.animation), 1))}
      </p>
      <SegmentedControl
        label="Чёткость"
        size="sm"
        options={SHARPNESS_OPTIONS}
        value={item.animation.economy ? "economy" : "sharp"}
        onChange={(value) => edit.patch(item.id, { animation: { ...item.animation, economy: value === "economy" } }, "Модель: чёткость гифки")}
      />
      <p className="fx-hint place-models-live-frame">{trFill("Кадр {0} × {1} px · кадров: {2} · лист {3} px", summary.cell[0], summary.cell[1], summary.frames, summary.sheet[0])}</p>
    </>
  );
}

const SHARPNESS_OPTIONS = Object.freeze([
  { value: "sharp", label: "Высокая (2048)" },
  { value: "economy", label: "Экономная (1024)" },
]);

/*
 * Нагрузка живых гифок на место (профиль `places`): «Гифок: N · видеопамять ≈ X МБ»; с десяти — жёлтое предупреждение; что не влезло в предел или вес — первым кадром, с причиной.
 * Гифки зала Majestic и скрытые в счёт не идут: первые стоят картинкой, вторые в игру не едут.
 */
function GifLoad({ items, edit }) {
  const live = items.filter((item) => item.animation && !item.hidden && !placeModelSceneRules(item.scene || edit.scene).hall);
  if (!live.length) return null;
  const plan = placeModelsGifPlan(live);
  const names = (reason) => live.filter((item) => plan.still.get(item.id) === reason).map(placeModelTitle).join(", ");
  const limited = names("limit");
  const heavy = names("weight");
  return (
    <div className="place-models-load" role="status">
      <p className="fx-hint place-models-load-total">{trFill("Гифок: {0} · видеопамять ≈ {1} МБ", plan.count, number(plan.bytes / (1024 * 1024), 1))}</p>
      {plan.warn && <p className="fx-hint place-models-warn">{trFill("Гифок {0}: с десяти игре тяжелее. На место — не больше 16, вес живых листов — до 96 МБ.", plan.count)}</p>}
      {limited && <p className="fx-hint place-models-warn">{trFill("Первым кадром встанут {0}: живых гифок не больше 16.", limited)}</p>}
      {heavy && <p className="fx-hint place-models-warn">{trFill("Первым кадром встанут {0}: живые листы не тяжелее 96 МБ.", heavy)}</p>}
    </div>
  );
}

/* Точные цифры — свёрнутым разделом. */
function Exact({ item, edit, bounds, rules }) {
  const id = item.id;
  const set = (values, label) => edit.patch(id, values, label);
  const axis = (key, label) => (index, value) => {
    const next = [...item[key]];
    next[index] = value;
    set({ [key]: next }, `${label} ${AXES[index]}`);
  };
  return (
    <div
      className="place-models-exact"
      role="group"
      aria-label={`Точно: ${placeModelTitle(item)}`}
    >
      <TextField
        label="Имя в списке"
        value={item.label || ""}
        maxLength={PLACE_MODEL_LABEL_LIMIT}
        placeholder={placeModelTitle({ ...item, label: "" })}
        onChange={(value) => edit.rename(id, value)}
      />
      <AxisSliders
        group="Место модели"
        label="Место"
        notes={PLACE_NOTES}
        values={item.position}
        range={positionRange(bounds, item.position)}
        step={0.05}
        format={metres}
        onChange={axis("position", "Модель: место")}
      />
      <div className="recolor-actions">
        <Button size="sm" variant="ghost" onClick={() => edit.dropToFloor(id)}>
          На пол
        </Button>
        <Button size="sm" variant="ghost" onClick={() => edit.bringHere(id)}>
          Под прицел
        </Button>
      </div>
      <AxisSliders
        group="Поворот модели"
        label="Поворот"
        notes={TURN_NOTES}
        values={item.rotation}
        range={PLACE_MODEL_LIMITS.rotation}
        step={1}
        format={degrees}
        onChange={axis("rotation", "Модель: поворот")}
      />
      <div className="recolor-actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={item.rotation.every((value) => value === 0)}
          onClick={() =>
            set(
              { rotation: [0, 0, 0], normal: [0, 0, 1] },
              "Модель: без поворота",
            )
          }
        >
          Без поворота
        </Button>
      </div>
      <Slider
        label="Непрозрачность"
        value={item.opacity}
        min={PLACE_MODEL_LIMITS.opacity[0]}
        max={PLACE_MODEL_LIMITS.opacity[1]}
        step={1}
        format={percent}
        onChange={(opacity) => set({ opacity }, "Модель: непрозрачность")}
      />
      <Slider
        label="Свечение"
        hint="Светится ночью своими цветами"
        value={item.glow}
        min={PLACE_MODEL_LIMITS.glow[0]}
        max={PLACE_MODEL_LIMITS.glow[1]}
        step={1}
        format={percent}
        onChange={(glow) => set({ glow }, "Модель: свечение")}
      />
      {rules.distance ? (
        <Slider
          label="Видно с"
          hint="Дальше — модель не рисуется"
          value={item.distance}
          min={PLACE_MODEL_LIMITS.distance[0]}
          max={PLACE_MODEL_LIMITS.distance[1]}
          step={10}
          format={(value) => `${Math.round(value)} м`}
          onChange={(distance) => set({ distance }, "Модель: дальность")}
        />
      ) : (
        <p className="fx-hint">
          Дальность — как у модели зала: модель — его часть.
        </p>
      )}
    </div>
  );
}

function Settings({ item, edit, bounds, exact, onExact }) {
  const id = item.id;
  /* Что можно модели — по её сцене (у арены в списке и модели «снаружи», и «в зале»). */
  const rules = placeModelSceneRules(item.scene || edit.scene);
  const set = (values, label) => edit.patch(id, values, label);
  const floating = item.motion === "float" || item.motion === "spinFloat";
  const problem = placeModelSceneProblem({
    ...item,
    scene: item.scene || edit.scene,
  });
  return (
    <div
      className="place-models-settings recolor-subsection"
      role="group"
      aria-label={`Настройки: ${placeModelTitle(item)}`}
    >
      {problem && <p className="fx-hint place-models-problem">{problem}</p>}
      {item.shape === "mesh" ? (
        <p className="fx-hint">
          {tr("Своя модель из файла")}
          {item.vertices
            ? ` · ${trFill("вершин: {0}", item.vertices.toLocaleString(document.documentElement.lang || "ru"))}`
            : ""}
          {`. ${tr("Листы её частей собраны в один лист — в игру он едет вместе с моделью.")}`}
        </p>
      ) : (
        <>
          <SegmentedControl
            label="Форма модели"
            size="sm"
            className="place-models-shapes"
            options={shapeOptions(Boolean(item.animation))}
            value={item.shape}
            onChange={(shape) => set({ shape }, "Модель: форма")}
          />
          {item.shape === "solid" && (
            <Slider
              label="Толщина"
              value={item.depth}
              min={PLACE_MODEL_LIMITS.depth[0]}
              max={PLACE_MODEL_LIMITS.depth[1]}
              step={1}
              format={percent}
              onChange={(depth) => set({ depth }, "Модель: толщина")}
            />
          )}
        </>
      )}
      <LiveNote item={item} rules={rules} edit={edit} />

      <Slider
        label="Размер"
        hint="Длинная сторона модели"
        value={item.size}
        min={PLACE_MODEL_LIMITS.size[0]}
        max={PLACE_MODEL_LIMITS.size[1]}
        step={0.05}
        format={metres}
        onChange={(size) => edit.resize(id, size)}
      />

      <div className="recolor-actions">
        <Button
          size="sm"
          variant={edit.placing ? "secondary" : "ghost"}
          aria-pressed={edit.placing}
          title={tr("Щёлкните по поверхности в кадре — модель встанет на неё плоскостью по стене, отступ 2 см. Esc — отмена")}
          onClick={() => (edit.placing ? edit.stopPlacing() : edit.startPlacing())}
        >
          {edit.placing ? tr("Щёлкните по стене…") : tr("Щелчком по стене")}
        </Button>
      </div>

      <div
        className="place-models-turns"
        role="group"
        aria-label="Повернуть модель"
      >
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowClockwise />}
          title="По часовой стрелке, если смотреть на поверхность"
          onClick={() => edit.turn(id, -90)}
        >
          −90°
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowCounterClockwise />}
          title="Против часовой стрелки, если смотреть на поверхность"
          onClick={() => edit.turn(id, 90)}
        >
          +90°
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Повернуть на 180° — лицом в другую сторону"
          onClick={() => edit.turn(id, 180)}
        >
          Развернуть
        </Button>
      </div>

      {rules.motion ? (
        <>
          <Select
            label="Движение"
            value={item.motion}
            options={MOTION_OPTIONS}
            onChange={(motion) => set({ motion }, "Модель: движение")}
          />
          {item.motion !== "none" && (
            <Slider
              label="Скорость"
              value={item.speed}
              min={PLACE_MODEL_LIMITS.speed[0]}
              max={PLACE_MODEL_LIMITS.speed[1]}
              step={0.05}
              format={times}
              onChange={(speed) => set({ speed }, "Модель: скорость")}
            />
          )}
          {floating && (
            <Slider
              label="Высота парения"
              value={item.lift}
              min={PLACE_MODEL_LIMITS.lift[0]}
              max={PLACE_MODEL_LIMITS.lift[1]}
              step={0.1}
              format={metres}
              onChange={(lift) => set({ lift }, "Модель: высота парения")}
            />
          )}
        </>
      ) : (
        <p className="fx-hint">
          Движения в зале Majestic нет: модель — часть модели зала, а у неё нет
          словаря клипов.
        </p>
      )}

      <Button
        size="sm"
        variant="ghost"
        block
        className="place-models-exact-toggle"
        icon={exact ? <CaretDown /> : <CaretRight />}
        caption="место, наклон, вид, дальность, имя"
        aria-expanded={exact}
        onClick={() => onExact(!exact)}
      >
        Точно
      </Button>
      {exact && <Exact item={item} edit={edit} bounds={bounds} rules={rules} />}
    </div>
  );
}

/**
 * `edit` — от `useModelsEditor`; `bounds` — рамка сцены кадра (`{ min, max }`
 * в метрах сцены) для пределов места; `where` — где место («на заводе»).
 */
export default function ModelsPanel({
  edit,
  bounds = null,
  where = "",
  sceneLabel = null,
}) {
  useTr();
  const input = useRef(null);
  const [exact, setExact] = useState(false);
  const { items, selected, open } = edit;

  function pick(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    edit.add(files);
  }

  return (
    <section
      className="ui-panel fx-section recolor-section place-models"
      aria-label={tr("Свои модели")}
    >
      {/*
        Как добавить модель и чем залы Majestic особенные — под «?» у заголовка (ТЗ 29.10.2026, п. 3.1): два абзаца по
        две строки стояли в панели постоянно. На виду — подзаголовок в три слова, пока моделей нет.
      */}
      {/* Имени у заголовка нет: оно повторило бы имя панели «Модели» (п. 8 разбора 30.10.2026) — остаётся «?». */}
      <SectionHeading
        title=""
        help={edit.blocked ? null : [trFill("Загрузите картинку (PNG, JPEG, WebP) — она станет моделью {0}: плашкой, объёмной фигурой по контуру, кубом, шаром или колонной. Гифка (GIF, APNG, WebP с кадрами) — живой плашкой, у которой сменяются кадры. Или готовую модель: GLB, glTF, OBJ. Модель встанет на поверхность под прицелом — дальше тяните её мышью и крутите кольцом.", tr(where || "в этом месте")), edit.rules?.note ? tr(edit.rules.note) : ""]}
      />
      <input
        ref={input}
        type="file"
        accept={PLACE_MODEL_ACCEPT}
        multiple
        hidden
        onChange={pick}
        aria-label={tr("Файл своей модели")}
      />
      {edit.blocked && <p className="fx-hint">{edit.blocked}</p>}
      {/* Сцена без места в мире (`origin = null` в сборщике): «Добавить» закрыто, а прежние модели установка пропустит — говорим об этом, а не молчим (над списком). */}
      {edit.blocked && <p className="fx-hint place-models-warn">{tr("У этой сцены нет места в мире — модели в игру не поедут")}</p>}
      {/* «Своя модель» — рамкой первым блоком, как «Своя картинка» (второй круг критика 30.10.2026): щелчок открывает выбор файла, файл можно
          бросить на колонку; что подходит и сколько уже стоит — подсказкой рамки. Пока модели есть, рамка ниже ростом и зовётся «Ещё модель». */}
      {!edit.full && !edit.blocked && (
        <SurfacePicture
          className="place-models-drop"
          label={items.length ? tr("Добавить ещё модель") : tr("Своя модель")}
          empty={items.length ? tr("Ещё модель") : tr("Своя модель")}
          aspect={items.length ? 3 : 16 / 9}
          accept={PLACE_MODEL_ACCEPT}
          hint={`${tr("Картинка или 3D-модель")} · ${trFill("{0} из {1}", items.length, PLACE_MODEL_LIMIT)}`}
          dropLabel={tr("Отпустите — встанет моделью")}
          busy={edit.busy}
          data-models-count={`${items.length}/${PLACE_MODEL_LIMIT}`}
          onFile={(file) => edit.add([file])}
        />
      )}
      {items.length ? (
        <ul className="place-models-list" aria-label="Список моделей">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              selected={item.id === selected?.id}
              open={open}
              full={edit.full}
              onSelect={edit.select}
              onToggleHidden={edit.toggleHidden}
              onDuplicate={edit.duplicate}
              onRemove={edit.remove}
              place={
                sceneLabel && item.scene && item.scene !== edit.scene
                  ? sceneLabel(item.scene)
                  : ""
              }
            >
              <Settings
                item={item}
                edit={edit}
                bounds={bounds}
                exact={exact}
                onExact={setExact}
              />
            </Row>
          ))}
        </ul>
      ) : null}
      <GifLoad items={items} edit={edit} />
      {edit.full && (
        <p className="fx-hint">
          {tr("Это {0} моделей — больше на одно место не поставить. Уберите лишнюю.").replace("{0}", () => PLACE_MODEL_LIMIT)}
        </p>
      )}
    </section>
  );
}
