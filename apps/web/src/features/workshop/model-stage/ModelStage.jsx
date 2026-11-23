/*
 * Общий 3D-кадр редакторов перекраски: «Зоны», «Завод», «Ангар», «Маппинг»,
 * «Арена». Камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ —
 * вращение, щелчок ПКМ — полёт, колесо — приближение. Плашки полёта нет
 * (18.10.2026): выход — тот же щелчок ПКМ или Esc.
 *
 * Холст заводится вместе со сценой и уходит вместе с ней: у каждого монтажа
 * свой контекст WebGL, и снятый кадр освобождает его целиком
 * (`forceContextLoss`) — так же, как кадр укрытия «Прострелов». Сцена набора
 * грузится по адресу (`scene-asset.js`), облик материалов приходит функцией
 * `look` редактора и меняется мгновенно — без пересборки сцены.
 *
 * Модель поворачивается сама, пока кадр виден (`watchFrameGate`: окно в
 * фокусе и кадр на экране); рука человека её останавливает, через несколько
 * секунд поворот продолжается.
 *
 * Фон — матовая плашка редактора (`recolor-editor.css`): никакого неба и
 * радуги под моделью, как и у превью остальных вкладок.
 */

import { forwardRef, useContext, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { watchFrameGate } from "../../../attention.js";
import { FollowStageContext, LiveStageContext } from "../finish/live-finish.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { claimWindowRenderer, releaseWindowRenderer } from "../engine/window-renderer.js";
import { createOrbitStage } from "./orbit-stage.js";
import { QUALITY_PROFILES, currentQuality, warmGpuLevel } from "./quality-profile.js";
import StageTextField from "./StageTextField.jsx";
import StageHoverTip from "./StageHoverTip.jsx";
import { edgeFieldWanted } from "./edge-field.js";
import { loadSceneAsset } from "./scene-asset.js";
import { keepFramesInterval, stageExperiments } from "./stage-exp.js";
import { mountKeepFrames } from "./keep-frames.js";
import { growWindowBuffer } from "./window-buffer.js";
import { stageMark, stageMarksOn } from "./stage-marks.js";
import { FrameHoldContext, useStageBusy } from "../../../components/ui/stage-busy.js";
import StageLoader, { StageStrip } from "../stage-loader/StageLoader.jsx";
import { LIMIT_MS, READER_STALL_MS, useSheetsProgress } from "../stage-loader/use-sheets-progress.js";
import { LONG_SHOW_AFTER_MS, MAX_SHOWN_MS, SHOW_AFTER_MS, useStageLoad } from "../stage-loader/use-stage-load.js";
import { tr, useTr } from "../../../locales/ui.js";
import { livePoseOf, recallStageView, rememberStageView, takeStageView, trackLivePose, trackStageView } from "../../hibernation/stage-views.js";
import { COVER_VIEWS } from "../covers/cover-views.js";
import { registerFrameShot } from "../frame-shot.js";

/* Запасной срок ожидания листов у куска карты, мс, — для кадра без `sceneSheetsSettled`. Кадр из этого дерева ждёт не по часам, а пока читатель отвечает (тишина — `READER_STALL_MS`): холодное место
   грузится дольше шести секунд, и показанный раньше срока город вставал в среднем цвете (находка 1 ревью тестового ПК, 15.11.2026). */
const SETTLE_MS = 6000;

/* «Shift — ещё» у курсора — один раз на компьютер (п. 5 `docs/3D-ELEMENTS-PICTURES.md`): `true`, если ещё не показывали. */
const SHIFT_HINT_KEY = "astral-stage-shift-hint";
let shiftHintShown = false;
function takeShiftHint() {
  if (shiftHintShown) return false;
  shiftHintShown = true;
  try {
    if (window.localStorage.getItem(SHIFT_HINT_KEY)) return false;
    window.localStorage.setItem(SHIFT_HINT_KEY, "1");
  } catch {
    /* Хранилища нет — подсказка один раз за запуск. */
  }
  return true;
}

/* Сколько показанных сцен кадр помнит для быстрого возврата (орбитальный кадр держит столько же построенных сцен). */
const SHOWN_SCENES = 3;

/**
 * `scene` — адрес `scene.bin`; `look(index, info)` — облик материала;
 * `parts` — видимые части (`null` — все); `hiddenEntities` — спрятанные вещи сцены интерьера (номера
 * сущностей, `entity` сетки; ссылка должна быть стабильной, пока набор тот же); `frame(asset)` — рамка кадра
 * (`{ bounds, view, zoomRange, ground, person, inside, free, lighting }`),
 * считается от загруженной сцены; `label` — подпись холста для читалки
 * экрана; `onScene(asset)` — сцена загрузилась; `onPick(hit)` — щелчок по
 * модели; `onAim(hit)` — щелчок ЛКМ без протяжки или нажатие колеса по кадру:
 * что править (`{ point, normal, material, part, entity?, info?, uv?, pick?, model?, additive? }`,
 * `orbit-stage.js`; `entity` — номер предмета сцены, `additive` — щелчок с Shift, Ctrl или Cmd: «добавить к выбранному»;
 * набор вещей собирает `items-panel/use-scene-items.js`, п. 7 `docs/3D-ELEMENTS-PICTURES.md`); `aimTarget(hit)` — что именно будет правиться по этому
 * попаданию: `true` (весь лист материала), описание подсветки (`{ materials?,
 * parts?, where?, uvRects?, none? }`, `selection-highlight.js`) или `null` —
 * править нечего (ничего не подсвечивается и `onAim` по щелчку не зовётся); `onMiss()` — щелчок ЛКМ мимо правящегося: снять выбор
 * (п. 7 `docs/3D-ELEMENTS-PICTURES.md`), камера стоит; `multi` — редактор берёт несколько вещей Shift+щелчком: после первого выбора
 * подпись у курсора один раз говорит «Shift — ещё» (п. 5 там же);
 * без `aimTarget` сетки не выбираются, остаются только свои модели; `onHover(hit | null)` —
 * под курсором (после паузы) то, что `aimTarget` признал правимым, или ничего — для вещей
 * кадра (`userData.pick`), чью подсветку рисует сам редактор; `highlight` — выбранное в редакторе тем же
 * описанием (`undefined` — по последнему щелчку, `null` — нигде); `markup` — загруженная разметка выделения сцены
 * (`use-selection-markup.js`): с ней попадание называет элемент разметки (`hit.element`), без неё — как прежде; `hoverSpec` —
 * подсветка по строке списка (наведение на строку «Предметов» показывает её места в кадре, уход снимает; курсор в кадре главнее);
 * `resetKey` — вкладка или категория редактора: смена снимает выбор щелчком, наведение и строку списка; `onCamera(mode, { speed })` — сменился род камеры (`orbit`,
 * `inside`, `fly`) или скорость полёта; `autoRotate` — вращать ли
 * модель самой; `shadows` — тени сцены (по умолчанию есть); `lights` — огни сцены (`[{ position, colour, intensity,
 * distance }]`); `lamps` — лампы моделей игры (`[{ position, colour, intensity, distance, direction, cone,
 * type }]`, светят ближние к глазу); `placing` — редактор эмблемы: левая кнопка ставит и ведёт
 * наклейку (`onPlace(hit, phase)` получает точку стены — `start`, `move` — и
 * `end`), правая — поворачивает камеру, колесо и клавиши — размер и поворот
 * (`onAdjust({ kind, factor | delta })`). `instances` — копии моделей
 * (`[{ asset, part, matrices }]`, другие кресла на местах кресел), `objects`
 * — свои объекты с движением (`[{ object, update? }]`), `insideFocus` — куда
 * плавно перелететь взгляду изнутри (`{ eye, yaw, pitch, fov }`; `null` —
 * камера стоит, домой — `insideHome`). `prepare(asset)` — своя раскладка загруженной сцены до кадра
 * (новый объект, кэш сцены не трогается; может вернуть обещание — кадр ждёт его): у арены — свой материал каждого
 * полотна у арок, чтобы его можно было показать своим видом; у зала Majestic — стены под свою картинку (`arena-finish-walls.js`). `reduce(asset)` — то же, но от выбора в редакторе: сцена только
 * из нужного (запретная зона на чёрном — её здание, земля и дорога вокруг, `zones-isolate.js`); пересчитывается, когда меняется
 * `reduceKey`; кадр, рамка, облик и `onScene` получают уже оставшееся, а загруженная сцена остаётся в кэше целой.
 *
 * Свои модели мест (задача 1 ТЗ 11.10.2026, вечер): `models` — их облик
 * (`usePlaceModelLooks`), `modelSelection` — `{ id, canEdit, mode }`
 * выбранной (ручки — только у инструмента «Модели»), `modelHandlers` —
 * `{ onSelect, onTransform, onMode, onDelete }` (`useModelsEditor`).
 *
 * Время суток (`daylight`, ТЗ 19.10.2026): `{ sun, ambient, exposure, sunColour, … }` — свет кадра (`orbit-stage.js`,
 * `setDaylight`), без него светит студия. `workLight` — рабочий свет редактора (`setWorkLight`, ТЗ 29.10.2026): фон не
 * темнее кадра без ламп, нейтральный свет и ключевой свет из-за плеча камеры; выключен — свет как задан. `lockView` — камеру нельзя двигать (мышь, колесо, двойной щелчок, клавиши ничего не делают). `edgeFade` — мягкий край куска карты: цвет уходит к краю сцены
 * (`true`, число — доля короткой стороны, `{ width, box }`; по умолчанию выключен — `orbit-stage.js`, `setEdgeFade`). `holdScene` — при смене адреса прежняя сцена стоит, пока грузится новая:
 * кадр не пустеет между двумя местами, а новое место встречает подлёт камеры (`frame().arrive`). `softLoad` — мелкие правки
 * (шаблон, крыша маппинга, тип зоны): после первого показа прежний кадр стоит, как у `holdScene`, а вместо карточки загрузки
 * сверху идёт тонкая полоса (`StageStrip`). Смена места у такого кадра без `edgeFade` (маппинг, вода, интерьеры Majestic) тоже идёт на прежнем кадре: пришла сцена нового места — её листы просятся до подмены
 * (`stage.holdSheets`), прежняя сцена стоит, пока они не ответили (тишина читателя — `READER_STALL_MS`), и новая встаёт сразу целиком, с листами; у куска карты с краем (`edgeFade`) то же делает `settling`.
 */
function ModelStage(
  {
    scene,
    look,
    meshRooms = null,
    loadTitle = "",
    /* Набор подписей карточки загрузки этого редактора (`stage-loader/loader-kits.js`); по умолчанию — зал арены. */
    loadKit = "hall",
    parts = null,
    hiddenEntities = null,
    frame,
    frameKey = "",
    label = "",
    onScene = null,
    prepare = null,
    reduce = null,
    reduceKey = "",
    onPick = null,
    onAim = null,
    onMiss = null,
    multi = false,
    aimTarget = null,
    onHover = null,
    highlight,
    markup = null,
    hoverSpec = null,
    resetKey = undefined,
    onCamera = null,
    /* Камера встала после движения (`orbit-stage.js`, `onCameraRest`): видно ли выбранное — проверяет редактор (`seenAt`). */
    onCameraRest = null,
    onPlace = null,
    onAdjust = null,
    /* Двойной щелчок по надписи (`onDoubleClick(hit)` → `true`) — правка слов на месте; вид по умолчанию — по пустому. */
    onDoubleClick = null,
    /* Поле ввода слов прямо у надписи в кадре (`StageTextField`): `{ item, onChange, onDone }`. */
    textEdit = null,
    /* Сама модель не вращается (18.10.2026): кадр стоит, пока его не повернут. */
    autoRotate = false,
    shadows = true,
    lights = null,
    lamps = null,
    placing = false,
    instances = null,
    objects = null,
    insideFocus = null,
    /* «Вернуть камеру» изнутри — явно: число выросло — глаз летит домой. Снятый фокус (`insideFocus` → `null`) камеру не уводит
       (владелец 31.10.2026: «Esc — и меня в центр зала, бесит»; п. 23 `design-qa.md`). */
    insideHome = 0,
    daylight = null,
    workLight = false,
    /* Перетаскивание своей вещи кадра мышью (`setObjectDrag`): `{ test(pick), onDrag(pick, delta, phase) }` или `null`. */
    objectDrag = null,
    holdScene = false,
    /* Мелкие правки без карточки: после первого показа прежний кадр стоит (как `holdScene`), а загрузку показывает тонкая
       полоса сверху (П6.2, 22.10.2026). Карточка — только при открытии редактора и при ошибке. */
    softLoad = false,
    /* Адреса сцены ещё нет, а редактор уже её готовит (читает каталог и собирает помещение вне окна): карточка загрузки стоит
       на этом этапе (`read`, ключ шага из `LOADER_STAGES`), а не пустой кадр с подписью. Пришёл адрес — карточка та же, процент не
       откатывается: загрузка сцены идёт этапом «собираю», листы — по счёту. */
    pendingStage = "",
    edgeFade = false,
    lockView = false,
    models = null,
    modelSelection = null,
    modelHandlers = null,
    className = "",
    children = null,
  },
  ref,
) {
  useTr();
  /* Опыт `gpu-probe` (`stage-exp.js`, выключен): название видеочипа проверяет поток, пока идёт первый показ кадра, а не одноразовый контекст на главном потоке в `currentQuality` ниже. Без опыта и после первого раза — ничего. */
  warmGpuLevel();
  const hostRef = useRef(null);
  const stageRef = useRef(null);
  /* Холст закрыт заставкой (`load.waiting`): кадр, что создаётся позже слоя эффектов, узнаёт об этом при создании. */
  const coveredRef = useRef(false);
  /* Закрыт ли холст в последнем коммите (а не в последней отрисовке компонента): по нему решается, держать ли закрытый кадр, пока сцена не взглянула на свои листы. */
  const frameCovered = useRef(false);
  const pickRef = useRef(onPick);
  const aimRef = useRef(onAim);
  const missRef = useRef(onMiss);
  const multiRef = useRef(multi);
  const aimTargetRef = useRef(aimTarget);
  const hoverRef = useRef(onHover);
  /* Имя того, что под курсором (`label` цели наведения), — подписью у курсора (`StageHoverTip`). */
  const [hoverLabel, setHoverLabel] = useState("");
  /* «Shift — ещё» к подписи у курсора: один раз, после первого выбора щелчком (`multi`); сменилось то, что под курсором, — подсказки нет. */
  const [shiftHint, setShiftHint] = useState(false);
  /* Вещь кадра в руке (протяжка мышью): внизу кадра — подсказка, как отвести её дальше и приблизить. */
  const [holding, setHolding] = useState(false);
  const hoverNow = useRef("");
  const cameraRef = useRef(onCamera);
  const restRef = useRef(onCameraRest);
  const placeRef = useRef(onPlace);
  const adjustRef = useRef(onAdjust);
  const doubleRef = useRef(onDoubleClick);
  const [loadedAsset, setAsset] = useState(null);
  /*
   * Сцены, что этот кадр уже показывал (адрес → загруженная и подготовленная сцена): вернулись к адресу — кадр ставит её
   * сразу, без чтения, заставки и сборки (`orbit-stage.js`, кэш построенных сцен; П6.1, 22.10.2026). Последние три.
   */
  const shown = useRef(new Map());
  const sourceRef = useRef(null);
  /* Листы нового места «в руках» (`stage.holdSheets`) и сцена, под которую их держат: отпускаются, когда сцена встала на кадр (эффект ниже), или когда место отменили. */
  const heldSheets = useRef(null);
  const reduceKeyRef = useRef(reduceKey);
  reduceKeyRef.current = reduceKey;
  /* Облик и выбор части сцены на момент прихода сцены: по ним просятся листы вперёд (`stage.requestSheetsAhead`). */
  const lookRef = useRef(look);
  lookRef.current = look;
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  /* Сцена кадра: загруженная или оставшаяся от неё после `reduce` (выбор в редакторе поменялся — собирается заново). */
  const asset = useMemo(() => (loadedAsset && reduce ? reduce(loadedAsset) || loadedAsset : loadedAsset), [loadedAsset, reduceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [failure, setFailure] = useState("");
  /* Комната редактора, пока открывается, ждёт первую отрисовку сцены или отказ кадра (ТЗ 24.10.2026 вечер,
     `components/ui/screen-ready.js`): держим её с первого слоя эффектов, отпускаем по `onPresented` кадра. Новая сцена
     в уже открытой комнате (смена инструмента, района) занавеса не возвращает — комната давно готова. */
  const roomHold = useContext(FrameHoldContext);
  const roomHoldId = useId();
  useLayoutEffect(() => {
    if (!roomHold) return undefined;
    roomHold(roomHoldId, true);
    return () => roomHold(roomHoldId, false);
  }, [roomHold, roomHoldId]);
  useEffect(() => {
    if (failure) roomHold?.(roomHoldId, false);
  }, [failure, roomHold, roomHoldId]);
  const [loading, setLoading] = useState(true);
  const sceneBusyRef = useRef(false);
  const warmSceneRef = useRef(false);
  /* Кусок карты из игры (`edgeFade`) показывается, когда листы приехали: иначе дома стоят голыми цветными коробками и
     дорисовываются на глазах (задача 40). Ждём, пока листы текущей сцены отвечают (`sceneSheetsSettled`), а не заданное время. */
  const [settling, setSettling] = useState(false);
  /* Адрес сцены, чья сетка сейчас на кадре: с `holdScene` рамка и объекты ждут её, а не адрес из пропсов. */
  const loadedScene = useRef(null);
  /*
   * Край кадра — опция или функция сцены `(asset) => опция` (17.11.2026): редактор, чей край зависит от самой сцены (круг мира `ringEdgeFade(asset)`), прежде брал сцену из `onScene`, ставил её в своё состояние и
   * отдавал край следующим проходом — через 40 мс после сборки материалов: края меняют определения (`RC_FADE`), и программы, собранные прогревом сцены, оказывались ненужными — прогрев шёл ещё раз, а первая
   * отрисовка ждала его (Ангар, повторный вход: `warm` на 143–153 мс, готов на 212–236 мс). Функция получает сцену в тот же слой эффектов, где кадр её ставит, край уходит кадру до `setScene`, и материалы собираются
   * уже с ним. Пока сцены нет — `edgeFade(null)`. Правило «мелкая правка места без края» (`softLoad`, прежняя сцена стоит, пока листы нового не ответили) смотрит на запасной край, `edgeFade(null)`: у «Маппинга» с кругом мира он `false`, и держание, что объектом `ringEdgeFade(asset)` отключалось кругом прежнего места, снова работает. Не функция — всё как было.
   */
  const edgeOf = (loaded) => (typeof edgeFade === "function" ? edgeFade(loaded || null) : edgeFade);
  const edgeSent = useRef(null);
  /* Сцена, рамка и сетка, под которые камера встала в последний раз: с неё она и запоминается, когда кадр уходит. */
  const framed = useRef(null);
  /* Прежний кадр стоит, пока грузится новый: у `holdScene` всегда, у `softLoad` — после первого показа. */
  const hold = holdScene || (softLoad && Boolean(loadedScene.current));
  const sceneReady = () => !hold || loadedScene.current === scene;

  pickRef.current = onPick;
  aimRef.current = onAim;
  missRef.current = onMiss;
  multiRef.current = multi;
  aimTargetRef.current = aimTarget;
  hoverRef.current = onHover;
  cameraRef.current = onCamera;
  restRef.current = onCameraRest;
  placeRef.current = onPlace;
  adjustRef.current = onAdjust;
  doubleRef.current = onDoubleClick;

  /* Кадр в окне студии: текстура холста меняется на месте — кадр перерисовывается по её сигналу (`live-finish.js`). */
  const liveRepaint = useContext(LiveStageContext);
  /* Близнец кадра редактора (окно «3D-вид» студии): первая рамка — на камере живого кадра той же сцены. `self` — чтобы не брать позу у себя. */
  const followLive = useContext(FollowStageContext);
  const followRef = useRef(followLive);
  followRef.current = followLive;
  const self = useRef({});
  useEffect(() => liveRepaint?.subscribe(() => stageRef.current?.repaint?.()), [liveRepaint]);

  useImperativeHandle(
    ref,
    () => ({
      /* Кадр уже держит эту сцену построенной: переключение на неё мгновенное (плашки «Обновляю…» не нужно). */
      hasScene: (url) => shown.current.has(url) && Boolean(stageRef.current?.hasScene?.(`${url}|${reduceKeyRef.current}`)),
      resetView: () => stageRef.current?.resetView(),
      repaint: () => stageRef.current?.repaint?.(),
      orbitOnce: () => stageRef.current?.orbitOnce(),
      toggleFly: () => stageRef.current?.toggleFly(),
      pick: (x, y) => stageRef.current?.pick(x, y) || null,
      project: (point, size) => stageRef.current?.project?.(point, size) || null,
      seenAt: (point) => stageRef.current?.seenAt?.(point) || null,
      modelSpot: () => stageRef.current?.modelSpot?.() || null,
      snapshotItem: (keys, box, size) => stageRef.current?.snapshotItem?.(keys, box, size) || null,
      snapshotItemPixels: (keys, box, options) => stageRef.current?.snapshotItemPixels?.(keys, box, options) || null,
      /* Листы кадра пришли и облик устоялся: до этого снимок предмета видит материалы без листов (`sheets-ready.js`). Кадра нет — ждать нечего. */
      sheetsReady: (options) => stageRef.current?.sheetsReady?.(options) ?? Promise.resolve(true),
      floorBelow: (point) => stageRef.current?.floorBelow?.(point) ?? null,
      get mode() {
        return stageRef.current?.mode || "orbit";
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    /* Адреса нет, а редактор готовит сцену (`pendingStage`): ждём его; прежняя сцена другого интерьера на кадре не остаётся. */
    if (!scene && pendingStage) {
      setLoading(true);
      if (!holdScene) {
        loadedScene.current = null;
        setAsset(null);
      }
      return undefined;
    }
    /* Уже показывали: тот же адрес встаёт из кэша кадра — чтения и заставки нет, прежняя сцена уходит в кэш (`orbit-stage.js`). */
    const again = shown.current.get(scene);
    /*
     * Мелкая правка (`softLoad`) места без мягкого края (`edgeFade` держит свой `settling`): прежняя сцена стоит, пока листы нового не ответили, — потом новая встаёт сразу целиком, а не в среднем цвете
     * с листами на виду (находка 1 ревью, вторая половина). Первый показ (сцены ещё не было) идёт закрытием холста, как прежде. Сцена, что кадр держит построенной (`hasScene`), встаёт из кэша сразу.
     */
    const holdOld = softLoad && !edgeOf(null) && Boolean(loadedScene.current) && loadedScene.current !== scene;
    const builtAlready = () => Boolean(again && stageRef.current?.hasScene?.(`${scene}|${reduceKeyRef.current}`));
    let inHand = null;
    let swapped = false;
    /* Загрузка стартует сразу, в слое эффектов — до создания кадра, что стоит ниже и занимает главный поток на полсекунды (15.11.2026, шаг 2 плана входа): чтение и разбор сцены в потоке от него
       не зависят. Опыт `early-load-off` возвращает прежний срок — после слоя эффектов, микрозадачей. */
    const startLoad = () => (edgeFieldWanted(edgeOf(null)) ? loadSceneAsset(scene, { footprint: true }) : loadSceneAsset(scene));
    const early = !stageExperiments().has("early-load-off");
    /* Листы вперёд — только с опытом `ahead`: замер (`docs/perf/speed-3d-rust/08-next-series.md`, 2.2 и 8) честного выигрыша «готово» не дал; код оставлен для держания прежнего кадра у `softLoad`. */
    const ahead = stageExperiments().has("ahead");
    if (!again) {
      setLoading(true);
      if (!(holdScene || (softLoad && loadedScene.current))) setAsset(null);
    } else if (holdOld && !builtAlready()) setLoading(true);
    /* Поле контура мягкого края — заодно в потоке разбора, а не в окне при первом кадре. */
    /* Сцена уже разобрана и лежит в кэше загрузчика (повторный вход): читать нечего, карточка по короткому сроку в 140 мс не нужна — решает правило длинного срока (`warmSceneRef`, `use-stage-load.js`). Ответ кэша — в самом вызове, до таймера карточки. */
    const requested = again ? null : early ? startLoad() : null;
    warmSceneRef.current = Boolean(again) || requested?.settled === true;
    const arrival = again
      ? Promise.resolve(again)
      : (requested || Promise.resolve().then(startLoad)).then(async (loaded) => ({ loaded, prepared: prepare ? await prepare(loaded) : loaded }));
    /* Ответ — всегда следующей задачей: эффекты этого же прохода (мягкий край, рамка) ещё видят прежнюю сцену и ждут новую. */
    arrival
      .then(async ({ loaded, prepared }) => {
        if (cancelled) return;
        /* Сцена кадра после `reduce` — одна на обе просьбы вперёд (опыт `ahead` и держание прежнего кадра): выбор считается один раз. */
        let reduced = null;
        const reducedOf = () => reduced || (reduced = reduceRef.current ? reduceRef.current(prepared) || prepared : prepared);
        /* Сцена пришла: листы просятся сразу, не дожидаясь `setScene` → `setLook`; тот же состав и ключи, что у кадра (`sheet-wants.js`). Закрыли редактор — `cancelled`, просьбы нет. */
        if (!again && ahead) stageRef.current?.requestSheetsAhead?.(reducedOf(), lookRef.current);
        /* Листы нового места просятся до подмены, прежняя сцена на кадре стоит: ожидание — по правилу тишины читателя (`READER_STALL_MS`, как у `sceneSheetsSettled`), пока оно идёт, `loading` держит полоску. */
        if (holdOld && !builtAlready()) {
          inHand = stageRef.current?.holdSheets?.(reducedOf(), lookRef.current) || null;
          if (inHand) {
            heldSheets.current = { hold: inHand, prepared };
            if (stageMarksOn()) stageMark("hold>", inHand.size);
            const answered = await inHand.wait({ silenceMs: READER_STALL_MS, alive: () => !cancelled });
            if (stageMarksOn()) stageMark("hold<", cancelled ? "cancel" : answered ? "answered" : "silence");
            if (cancelled) return;
          }
        }
        loadedScene.current = scene;
        sourceRef.current = loaded;
        shown.current.delete(scene);
        shown.current.set(scene, { loaded, prepared });
        while (shown.current.size > SHOWN_SCENES) shown.current.delete(shown.current.keys().next().value);
        swapped = true;
        setAsset(prepared);
        setFailure("");
      })
      .catch((error) => {
        if (!cancelled) setFailure(humanFailure(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      /* Место сменили или кадр закрыли, пока листы ехали: они в руках зря — отпускаем (сцена отменённого места нигде не держится, итога на чужой сцене нет). После подмены листы отпускает эффект сцены. */
      if (inHand && !swapped) {
        inHand.release();
        if (heldSheets.current?.hold === inHand) heldSheets.current = null;
      }
    };
    // Раскладка сцены меняется вместе с её адресом, а не каждой новой функцией.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    /* Рендерер окна (фаза 5): один контекст WebGL на окно, кадр подаётся в свой холст редактора (на нём мышь и
       рамка). Занят другим кадром (живое окно рядом) — свой контекст на этом же холсте, как прежде. */
    const owner = {};
    const shared = claimWindowRenderer(owner, { antialias: QUALITY_PROFILES[currentQuality()].antialias });
    /* Опыт `size-first` (`window-buffer.js`, по умолчанию выключен): настоящий буфер холста окна растёт до окна приложения сейчас, пока видеочип свободен, — до окружения комнаты и первой отрисовки, что строит `createOrbitStage`. */
    if (shared?.canvas && stageExperiments().has("size-first")) growWindowBuffer(shared.canvas, globalThis, QUALITY_PROFILES[currentQuality()].pixelRatio);
    const canvas = document.createElement("canvas");
    canvas.className = "model-stage-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    host.prepend(canvas);
    /* Опыт `keep-frames` (`keep-frames.js`, по умолчанию выключен): раз в N мс перерисовывается элемент 1×1 ПОД холстом (в DOM перед ним, холст закрывает его целиком) — окно не замирает после покоя. Снимается вместе с холстом. */
    const keepMs = keepFramesInterval(stageExperiments());
    const stopKeep = keepMs ? mountKeepFrames(canvas, keepMs) : null;
    let stage;
    /*
     * Размер холста читается не в том же такте, что запись в DOM (16.11.2026, профиль входа «Завод», «Ашан», Мегамолл на закрытой ×4: `getBoundingClientRect ← measure` — 116–173 мс собственного времени в самой долгой задаче
     * входа): монтаж редактора только что записал страницу, и чтение заставляло браузер пересчитать раскладку целиком посреди задачи. Первый раз — в первом кадре экрана: `requestAnimationFrame` заказан раньше
     * `createOrbitStage`, значит выходит раньше любой отрисовки, что кадр успеет заказать, и в том же кадре экрана; дальше размер приходит от `ResizeObserver` (его колбэк идёт после раскладки, чтение в нём бесплатное).
     * Тот же размер и то же отношение пикселей кадру второй раз не передаются. Раскладку это не отменяет, а переносит туда, где браузер считает её сам.
     */
    let measured = "";
    const measure = () => {
      if (!stage) return;
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const next = `${box.width}|${box.height}|${ratio}`;
      if (next === measured) return;
      measured = next;
      stage.resize(box.width, box.height, ratio);
    };
    const firstFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(measure) : 0;
    try {
      stage = createOrbitStage({
        canvas,
        shared,
        onPresented: () => roomHold?.(roomHoldId, false),
        onContextLost: () => setFailure("видеокарта отобрала контекст — откройте редактор заново"),
        onPick: (hit) => pickRef.current?.(hit),
        /* Колесо (средняя кнопка) — выбрать на правку то, во что целятся. */
        onAim: (hit) => {
          aimRef.current?.(hit);
          if (multiRef.current && hit && !hit.additive && hoverNow.current && takeShiftHint()) setShiftHint(true);
          else if (hit?.additive) setShiftHint(false);
        },
        onMiss: () => missRef.current?.(),
        /* Что правится по щелчку и наведению: говорит редактор; не сказал — сетки не выбираются. */
        aimTarget: (hit) => (aimTargetRef.current ? aimTargetRef.current(hit) : null),
        aimEnabled: () => Boolean(aimRef.current),
        onHover: (hit, target) => {
          hoverRef.current?.(hit);
          const next = typeof target?.label === "string" ? target.label : "";
          if (next !== hoverNow.current) setShiftHint(false);
          hoverNow.current = next;
          setHoverLabel(next);
        },
        onCamera: (mode, info) => cameraRef.current?.(mode, info),
        onCameraRest: () => restRef.current?.(),
        onPlace: (hit, phase) => placeRef.current?.(hit, phase),
        onAdjust: (step) => adjustRef.current?.(step),
        onDoubleClick: (hit) => doubleRef.current?.(hit) === true,
        onObjectHold: setHolding,
      });
    } catch (error) {
      if (firstFrame) cancelAnimationFrame(firstFrame);
      setFailure(humanFailure(error));
      stopKeep?.();
      canvas.remove();
      if (shared) releaseWindowRenderer(owner);
      return undefined;
    }
    stageRef.current = stage;
    stage.setCovered?.(coveredRef.current);
    if (import.meta.env?.DEV) window.__astralModelStage = stage;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(canvas);
    /* Нет кадров экрана (старое окружение) — размер сразу, как прежде. */
    if (!firstFrame) measure();
    const stopGate = watchFrameGate(canvas, (open) => stage.setActive(open));
    return () => {
      if (firstFrame) cancelAnimationFrame(firstFrame);
      stopGate();
      observer?.disconnect();
      stage.dispose();
      stopKeep?.();
      canvas.remove();
      if (shared) releaseWindowRenderer(owner);
      stageRef.current = null;
    };
    // Кадр создаётся один раз на окно; `roomHold` и его id — те, что встали при первой отрисовке, и не меняются.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    /* Ключ кэша кадра: адрес и выбор `reduce`; источник — загруженная сцена (подготовка и выбор дают новые объекты). */
    if (asset && typeof edgeFade === "function") {
      /* Край этой сцены — кадру до сцены (`defer`): материалы получают его при сборке, одним прогревом. Эффект края ниже второй раз его не ставит. */
      const option = edgeFade(asset);
      edgeSent.current = option && typeof option === "object" ? JSON.stringify(option) : String(option);
      stageRef.current?.setEdgeFade?.(option, { defer: true });
    }
    /* Комнаты стен — кадру до сцены (`defer`), как край: сцена встаёт сразу с ними. Эффект комнат ниже ставит их после сцены и пересобирал её второй раз (`setMeshRooms` → `setScene`): первая, недособранная, освобождалась (замер «Арен», 17.11.2026). Тот же `meshRooms` второй раз ничего не делает. */
    if (asset) stageRef.current?.setMeshRooms?.(meshRooms, { defer: true });
    if (asset) stageRef.current?.setScene(asset, { key: `${scene}|${reduceKey}`, source: sourceRef.current });
    else stageRef.current?.setScene(asset);
    /* Сцена собрана, листы, что держали, легли на материалы при сборке (`orbit-stage.js: textureFor`) — в руках им делать нечего. */
    if (heldSheets.current && heldSheets.current.prepared === loadedAsset) {
      heldSheets.current.hold.release();
      heldSheets.current = null;
    }
    if (asset) onScene?.(asset);
    // onScene — сообщение наружу, а не зависимость сцены.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  /* Камера помнится, пока человек в редакторе (П6.3, 22.10.2026): сцена ушла из кадра («Снаружи»), кадр закрылся
     (выход из студии) — поза ложится в память до эффектов, что ставят новую сцену и рамку; вернулись — встаёт с неё. */
  const rememberCamera = () => {
    const past = framed.current;
    framed.current = null;
    if (past && stageRef.current) rememberStageView(past.scene, past.frameKey, stageRef.current.pose);
  };
  useLayoutEffect(() => {
    if (framed.current && framed.current.asset !== asset) rememberCamera();
    // Поза уходит из кадра вместе со сценой, а не с каждой новой функцией.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);
  useLayoutEffect(() => rememberCamera, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!asset || !frame || !sceneReady()) return;
    /* Без `holdScene` адрес уже новый, а сетка на кадре ещё старая (её снимут или заменят следующим проходом): рамка новой
       сцены на старой сетке камеру только сбросила бы — раньше, чем кадр запомнит, откуда ушли. */
    if (loadedScene.current !== scene) return;
    const stage = stageRef.current;
    /* Рамка сменилась на той же сцене (выбрали другую часть) — кадр заново; сцена пришла другая или вернулась — её прежняя камера. */
    const sameScene = framed.current?.asset === asset;
    const next = frame(asset);
    /* Другая часть на той же сцене — камера летит к ней (П6.4); новая сцена встаёт на месте. */
    stage?.setFrame(sameScene && next && next.glide === undefined ? { ...next, glide: true } : next);
    /* После спячки окна — камера с того места, откуда ушли (один раз, `features/hibernation/stage-views.js`). */
    const view = takeStageView(scene);
    if (view) stage?.setView(view);
    if (!view && !sameScene) {
      const pose = (followRef.current ? livePoseOf(scene, self.current) : null) || recallStageView(scene, frameKey);
      if (pose) stage?.setPose?.(pose);
    }
    framed.current = { scene, frameKey, asset };
    // Рамка меняется ключом (часть, вид), а не каждой новой функцией.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, frameKey]);

  /* Вид камеры — в снимок спячки окна. */
  useEffect(() => trackStageView(scene, () => stageRef.current?.view), [scene]);
  /* Поза камеры — близнецу этой сцены (окну «3D-вид» студии). */
  useEffect(() => trackLivePose(scene, self.current, () => stageRef.current?.pose), [scene]);

  /* Снимок работы при «Сохранить» и «Применить» (`frame-shot.js`): кадр сам встаёт на вид по умолчанию, рисует и возвращается — человек этого не видит. */
  const coverSource = useRef(null);
  coverSource.current = { asset, frame };
  useEffect(
    () =>
      registerFrameShot({
        shoot: async (kind) => {
          const stage = stageRef.current;
          const { asset: shown, frame: frameOf } = coverSource.current;
          if (!stage?.snapshotHome || !shown) return null;
          const orbit = COVER_VIEWS[kind]?.orbit || null;
          const current = frameOf?.(shown) || null;
          /* Ангар на картинке — как открывается предпросмотр: снаружи, даже если человек сейчас в зале. */
          if (kind === "hangar" && current?.inside) {
            const { HANGAR_SHOWCASE_YAW } = await import("../hangar-editor/hangar-text.js");
            const outside = { bounds: current.bounds, ground: true, person: true, view: { yaw: HANGAR_SHOWCASE_YAW, pitch: 0.34, zoom: 0.78 } };
            return stage.snapshotHome({ frame: outside, restoreFrame: current });
          }
          return stage.snapshotHome({ orbit });
        },
      }),
    [],
  );

  useEffect(() => {
    if (asset) stageRef.current?.setParts(parts);
  }, [asset, parts]);

  useEffect(() => {
    if (asset) stageRef.current?.setHiddenEntities?.(hiddenEntities);
  }, [asset, hiddenEntities]);

  /* Правка облика (ползунок, цвет) ставит облик только материалам, чей облик сменился (`diff`, `look-memo.js`): не всей сцене на каждый тик. */
  useEffect(() => {
    if (asset && look) stageRef.current?.setLook(look, { diff: true });
  }, [asset, look]);

  /* Комнаты стен (облик комнаты): сцену пересобирают, только когда сменилась сама функция комнат. */
  useEffect(() => {
    if (asset) stageRef.current?.setMeshRooms?.(meshRooms);
  }, [asset, meshRooms]);

  useEffect(() => {
    stageRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  /* Мягкий край куска карты: после сцены (материалы уже есть); ключ — по смыслу, а не по новому объекту. */
  useEffect(() => {
    stageRef.current?.setViewLocked?.(lockView);
  }, [asset, lockView]);

  const edgeNow = edgeOf(asset);
  const edgeFadeKey = edgeNow && typeof edgeNow === "object" ? JSON.stringify(edgeNow) : String(edgeNow);
  useEffect(() => {
    /* Край уже ушёл кадру вместе со сценой (функция сцены, см. выше): второй раз тот же не ставится — он пересобрал бы карту контура впустую. */
    if (asset && edgeSent.current === edgeFadeKey) {
      edgeSent.current = null;
      return;
    }
    /* Сцена сменилась вместе с краем (арена: «Снаружи» — новый адрес и край сразу): старой сцене край не ставится — иначе
       поле контура зала считалось в окне и его материалы пересобирали программы впустую, — а запоминается для новой:
       она получит его сразу при сборке (сцена из кэша приходит тем же проходом, 22.10.2026). */
    if (asset && loadedScene.current !== scene) {
      stageRef.current?.setEdgeFade?.(edgeNow, { defer: true });
      return;
    }
    stageRef.current?.setEdgeFade?.(edgeNow);
    // Край меняется ключом, а не новым объектом с теми же числами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, edgeFadeKey]);

  const mapPiece = Boolean(edgeNow);
  useEffect(() => {
    if (!asset || !mapPiece) {
      setSettling(false);
      return undefined;
    }
    let cancelled = false;
    setSettling(true);
    const done = () => {
      if (!cancelled) setSettling(false);
    };
    /* Облик ложится теми же эффектами и просит листы — спрашиваем, что едет, уже после них. */
    const timer = setTimeout(() => {
      const stage = stageRef.current;
      if (!stage?.texturesSettled) done();
      else Promise.resolve(stage.sceneSheetsSettled ? stage.sceneSheetsSettled({ silenceMs: READER_STALL_MS }) : stage.texturesSettled(SETTLE_MS)).then(done, done);
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [asset, mapPiece]);

  /* Время суток: свет кадра; смена не перелетает камеру. Ключ — по смыслу, а не по новому объекту. */
  const daylightKey = daylight ? JSON.stringify(daylight) : "";
  const daylit = useRef(false);
  useEffect(() => {
    if (!daylight && !daylit.current) return;
    stageRef.current?.setDaylight?.(daylight);
    daylit.current = Boolean(daylight);
    // Свет меняется ключом, а не новым объектом с теми же числами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daylightKey]);

  useEffect(() => {
    stageRef.current?.setShadows?.(shadows);
  }, [asset, shadows]);

  /* Рабочий свет редактора: те же источники сцены, переключение без пересборки программ. */
  useEffect(() => {
    stageRef.current?.setWorkLight?.(workLight);
  }, [asset, workLight]);

  /* Перетаскивание своих вещей кадра: редактор решает, что можно тащить и куда (замена вещи зала). */
  useEffect(() => {
    stageRef.current?.setObjectDrag?.(objectDrag);
  }, [asset, objectDrag]);

  /* Смена вкладки или инструмента (`resetKey`) снимает выбор щелчком — раньше, чем кадр получит подсветку нового: иначе сброс принимал
     охват нового инструмента за «снятый щелчком мимо» и гасил его (п. 7.1: «Контейнеры · 14 вещей», а в кадре не обведено ни одной). */
  const resetSeen = useRef(resetKey);
  useEffect(() => {
    if (resetSeen.current === resetKey) return;
    resetSeen.current = resetKey;
    stageRef.current?.clearSelection?.();
  }, [resetKey]);

  /* Подсветка выбранного: описание от редактора; без него — по последнему щелчку. */
  useEffect(() => {
    stageRef.current?.setHighlight?.(highlight);
  }, [asset, highlight]);

  /* Разметка выделения: попадание называет элемент (предмет, класс стен, планшет). */
  useEffect(() => {
    stageRef.current?.setMarkup?.(markup);
  }, [asset, markup]);

  /* Подсветка по строке списка и сброс при смене вкладки (раздел E). */
  useEffect(() => {
    stageRef.current?.setListHover?.(hoverSpec);
  }, [asset, hoverSpec]);

  useEffect(() => {
    stageRef.current?.setPointLights(lights || []);
  }, [lights]);

  /* Лампы моделей игры: ближние к глазу светят (`lamp-slots.js`). */
  useEffect(() => {
    stageRef.current?.setLamps?.(lamps || []);
  }, [asset, lamps]);

  useEffect(() => {
    stageRef.current?.setPlacing(placing);
  }, [placing]);

  useEffect(() => {
    /* Копии и свои объекты нужны не всем кадрам — без них кадр их не трогает. */
    if (asset && (instances || stageRef.current?.hasInstances)) stageRef.current?.setInstances?.(instances || []);
  }, [asset, instances]);

  useEffect(() => {
    if (!sceneReady()) return;
    if (objects || stageRef.current?.hasObjects) stageRef.current?.setObjects?.(objects || []);
    // С `holdScene` объекты встают и вместе с новой сценой (asset), а не только с новым списком.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, hold ? asset : null]);

  /* Свои модели: облик, выбранная и её ручки, мышь в кадре — редактору. */
  const modelHandlersRef = useRef(modelHandlers);
  modelHandlersRef.current = modelHandlers;
  const withModels = Boolean(models?.length || modelHandlers);
  useEffect(() => {
    if (!withModels) return;
    stageRef.current?.setModelHandlers?.({
      onSelect: (id) => modelHandlersRef.current?.onSelect?.(id),
      onDeselect: () => modelHandlersRef.current?.onDeselect?.(),
      onTransform: (id, values, phase) => modelHandlersRef.current?.onTransform?.(id, values, phase),
      onMode: (mode) => modelHandlersRef.current?.onMode?.(mode),
      onDelete: (id) => modelHandlersRef.current?.onDelete?.(id),
      onPlace: (spot) => modelHandlersRef.current?.onPlace?.(spot),
      onPlaceCancel: () => modelHandlersRef.current?.onPlaceCancel?.(),
    });
  }, [withModels]);
  useEffect(() => {
    stageRef.current?.setModels?.(models || []);
  }, [models]);
  const selectionKey = modelSelection ? `${modelSelection.id}|${modelSelection.canEdit}|${modelSelection.mode}|${modelSelection.placing ? 1 : 0}` : "";
  useEffect(() => {
    if (!modelSelection && !models?.length) return;
    stageRef.current?.setModelSelection?.(modelSelection?.id || "", { canEdit: modelSelection?.canEdit, mode: modelSelection?.mode, ...(modelSelection?.placing ? { placing: true } : {}) });
    // Выбор меняется ключом, а не новым объектом с теми же полями.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, models]);

  /* Перелёт — после рамки: вид изнутри уже знает, где стоит глаз. Фокус сняли — камера стоит, где стоит; домой — `insideHome`. */
  const focusKey = insideFocus ? JSON.stringify(insideFocus) : "";
  useEffect(() => {
    if (asset && insideFocus) stageRef.current?.flyInside?.(insideFocus);
    // Перелёт меняется местом цели, а не новым объектом с тем же местом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, focusKey]);
  const homed = useRef(insideHome);
  useEffect(() => {
    if (!asset || !insideHome || homed.current === insideHome) return;
    homed.current = insideHome;
    stageRef.current?.flyInside?.(null);
  }, [asset, insideHome]);

  useEffect(() => {
    hostRef.current?.querySelector("canvas")?.setAttribute("aria-label", label);
  }, [label]);

  /* Заставка загрузки (ТЗ 42В): пока грузится сама сцена, затем — пока едут её листы и текстуры. Полоса идёт по настоящему
     счёту листов; пока сцена читается, счёта нет — полоса неопределённая. Инструменты оболочки приглушены, пока заставка стоит. */
  /* Первый взгляд на листы сцены `asset` делает эффект `useSheetsProgress` — уже после коммита, где сцена встала: этот коммит рисуется со счётом прежней сцены (листов нет, «не едут»). Закрытый кадр
     в этот промежуток не открывается (`holdForLook`): иначе при сцене из кэша окна (повторный вход, заставка ещё не показалась) холст открывался на один кадр экрана — с листами в пути, а
     потом закрывался снова. Открытый кадр (правка выбора `reduce` на показанной сцене) этим не закрывается. */
  const [seenAsset, setSeenAsset] = useState(null);
  const sheets = useSheetsProgress(stageRef, asset, setSeenAsset);
  const sceneBusy = (loading && !(hold && asset)) || settling;
  /* Для таймера карточки: идёт ли чтение самой сцены в миг срабатывания (а не на последней отрисовке React) и не из кэша ли она. */
  sceneBusyRef.current = sceneBusy;
  /* Мелкая правка (`softLoad`, кадр уже показывал сцену) — полоса вместо карточки. */
  const soft = softLoad && Boolean(loadedScene.current);
  const holdForLook = !failure && !soft && Boolean(asset) && seenAsset !== asset && frameCovered.current;
  /* Комнату держит первая отрисовка сцены (выше), а не листы: модель с карточкой «грузится» под открытой комнатой —
     как задумано (ТЗ 42В), занавес уходит, когда кадр уже показал сцену. */
  /* Потолок ожидания: пока читается сама сцена — прежние 30 с (там нет счёта «идёт или стоит»: сцена, что не ответила, не должна держать заставку минуты);
     пока едут листы — свой длинный (`use-sheets-progress.js`: «листы не идут» отпускает сам, а честно идущая подгрузка заставку держит). */
  /* Волна листов после первого «готово» (показали материалы, сменили отделку; `use-sheets-progress.js`) — лёгкая загрузка: полоска, холст открыт, а материалы, что показали,
     встают сами, когда волна доехала (`reveal-queue.js`). Карточка и закрытый холст — только первой загрузке сцены. */
  const sheetWave = sheets.pending && sheets.wave === true;
  /* Карточка уже стоит, а сцена ещё не взглянула на свои листы (`holdForLook`): карточку держим. Между «сцена встала» и «листы поехали»
     `busy` на миг падал, карточка начинала растворяться и тут же возвращалась (замер в настоящем Electron 16.11.2026: на холодном входе в
     «Завод», «Арены», «Мегамолл» и «Зоны каптов» заставка уходила на 50–290 мс и вставала снова). Карточку, которая ещё не показалась
     (повторный вход, сцена из кэша), это не поднимает: держится только уже стоящая. */
  const cardUp = useRef(false);
  /*
   * Правило карточки загрузки (`use-stage-load.js`; замер `docs/perf/speed-3d-rust/08-next-series.md`, 2.1): пока читается сама сцена (`sceneBusy`) — карточка через `SHOW_AFTER_MS`; сцена пришла раньше, чем карточка
   * показалась (повторный вход, сцена из кэша окна), — карточка только если холст закрыт дольше `LONG_SHOW_AFTER_MS` от НАЧАЛА закрытия: отсчёт не сбрасывается на коммите прихода сцены (`busy` в нём гаснет:
   * `sceneBusy` снят, а `sheets.pending` взводит эффект счёта листов уже после коммита и тяжёлых `setScene` / `setLook`; закрытие держит `holdForLook`, и в `keep` карточки оно входит) и заново не стартует.
   * Опыт `card-from-cover=<мс>` задаёт длинный срок, `card-from-cover=off` снимает только эту добавку (таймер от последнего включения `busy`, разрыв не склеен).
   * Удержание уже стоящей карточки (`cardUp` выше, сторож `sheet-standin.test.js`, тест `model-stage-card-hold.test.jsx`) — механизм `main`, он остаётся при любом `card-from-cover`; `keep` на стоящей карточке его перекрывает, и это безвредно:
   * новое у `keep` — счёт длинного срока от начала закрытия для ещё не показанной карточки.
   */
  const cardRule = useMemo(() => {
    const exp = stageExperiments();
    if (String(exp.text("card-from-cover")).toLowerCase() === "off") return { keep: false, longAfterMs: 0 };
    return { keep: true, longAfterMs: exp.value("card-from-cover", LONG_SHOW_AFTER_MS) };
  }, []);
  const cardKeep = cardRule.keep && holdForLook;
  const load = useStageLoad(!failure && !soft && (sceneBusy || (sheets.pending && !sheetWave) || (holdForLook && cardUp.current)), { holdRoom: false, maxMs: sceneBusy ? MAX_SHOWN_MS : LIMIT_MS + 5000, keep: cardKeep, showAfterMs: SHOW_AFTER_MS, longAfterMs: cardRule.longAfterMs, reading: () => sceneBusyRef.current && !warmSceneRef.current });
  cardUp.current = load.shown && load.phase === "in";
  const strip = useStageLoad(!failure && (soft ? loading || settling || sheets.pending : sheetWave && !sceneBusy), { holdRoom: false });
  /* Кадр знает, что холст закрыт, — и не рисует сцену на каждую пачку листов под заставкой (`cover-gate.js`). Слой эффектов идёт после того, как React поставил или снял класс
     `is-covered`: открытие не обгоняет отрисовку (кадр рисуется в следующем кадре экрана, а холст и так уже нарисован итогом). */
  /* Холст закрыт, пока заставка ждёт (`load.waiting`) и пока сцена не взглянула на свои листы (`holdForLook`). Удержание — только холст: в `busy` заставки оно не входит, таймер карточки (`SHOW_AFTER_MS`)
     и её показ остаются прежними, а карточка в повторном входе не мелькает. */
  const covered = load.waiting || holdForLook;
  coveredRef.current = covered;
  useLayoutEffect(() => {
    stageRef.current?.setCovered?.(covered);
  }, [covered]);
  useLayoutEffect(() => {
    frameCovered.current = covered;
  }, [covered]);
  /* Метки занятости заставки для замера (`window.__astralStageMarks`, `stage-marks.js`): что именно держит закрытие и карточку в этот коммит. */
  useEffect(() => {
    if (!stageMarksOn()) return;
    stageMark("busy", `scene:${sceneBusy ? 1 : 0} pending:${sheets.pending ? 1 : 0}${sheetWave ? "(wave)" : ""} hold:${holdForLook ? 1 : 0} waiting:${load.waiting ? 1 : 0} covered:${covered ? 1 : 0} card:${load.shown ? load.phase : "-"}`);
  }, [sceneBusy, sheets.pending, sheetWave, holdForLook, load.waiting, load.shown, load.phase, covered]);
  useStageBusy(load.shown && load.phase === "in");
  const loadProgress = sceneBusy && !asset ? null : { done: 1 + sheets.done, total: 1 + sheets.total };
  /* Этап без счёта листов: пока адреса нет — тот, что назвал редактор; пока сцена читается — «собираю»; дальше счёт листов. */
  const loadStage = pendingStage ? (!scene ? pendingStage : sceneBusy && !asset ? "build" : "") : "";

  return (
    <div className={`model-stage-frame${className ? ` ${className}` : ""}${settling ? " is-settling" : ""}${covered ? " is-covered" : ""}`} ref={hostRef}>
      {failure ? (
        <p className="model-stage-note">3D-кадр недоступен: {failure}</p>
      ) : load.shown ? (
        <StageLoader variant={load.variant} phase={load.phase} progress={loadStage ? null : loadProgress} stage={loadStage} title={loadTitle} kit={loadKit} />
      ) : strip.shown ? (
        <StageStrip phase={strip.phase} />
      ) : null}
      {textEdit && <StageTextField stage={stageRef} {...textEdit} />}
      <StageHoverTip hostRef={hostRef} label={failure ? "" : shiftHint && hoverLabel ? `${hoverLabel} · ${tr("Shift — ещё")}` : hoverLabel} />
      {holding && !failure && (
        <p className="model-stage-hold-hint" role="status">
          {tr("W — дальше, S — ближе")}
        </p>
      )}
      {children}
    </div>
  );
}

export default forwardRef(ModelStage);
