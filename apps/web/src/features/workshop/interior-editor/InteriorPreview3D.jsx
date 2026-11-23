/*
 * Объёмный предпросмотр помещения, которое правят.
 *
 * В кадре стоит та самая комната, что выбрана в проекте, — и стоит она моделями
 * из установленной игры. Раньше здесь всегда был зал Auto Shop из mptuner —
 * сорок два метра поперёк, — а правился магазин на одиннадцать: человек смотрел
 * на одно, а двигал объекты в другом. Потом на его место встала схема верного
 * размера. Теперь — сам магазин: стены, прилавок, полки и вывески Rockstar.
 *
 * Отделка следует за помещением, а не за редактором. Варианты, которые Rockstar
 * положила отдельными моделями — восемь стилей зала, девять антресолей, шесть
 * наборов баннеров и шесть схем освещения, — принадлежат ровно одному
 * помещению, залу Auto Shop, и показываются только тогда, когда в кадре он: на
 * стенде окна и витрине мода, где проекта нет вовсе. У магазина 24/7 своих
 * вариантов отделки в игре не лежит: он собран раз и навсегда, и ряд кнопок над
 * его кадром означал бы, что они на что-то влияют.
 *
 * Подписи у вариантов номерные, потому что номера и есть всё, что Rockstar про
 * них написала.
 *
 * Кадр здесь чужой. Раньше на этом месте стоял собственный `WebGLRenderer`,
 * собственный цикл кадров и выключатель «День/Ночь» на два положения — два
 * подобранных цвета фона и два набора яркостей. Теперь рендерер, камера, небо,
 * солнце, туман и сам кадр приходят из общего окна мастерской
 * (`components/desktop/workshop/preview/PreviewWindow.jsx`), а оно берёт их из
 * таймцикла игры. Отсюда в него уезжает только зал — переходником
 * `interior-scene.js`.
 *
 * Что это дало залу: настоящую шкалу часов вместо двух положений. Свет ламп при
 * этом от часа не зависит — под крышей он и не должен, — а вот сколько дневного
 * света попадает внутрь, теперь считает таймцикл, а не выключатель.
 *
 *
 * МАКЕТ И КАДР — ОДНО ОКНО
 *
 * Здесь же кадр перестал быть картинкой, на которую только смотрят. Раскладка
 * макета приезжает свойством и уезжает в сцену; щелчки и протяжки в зале
 * возвращаются наверх обработчиками. Всё, что этот файл про них знает, — как их
 * передать: где стоит объект, считает редактор вместе с
 * `@modovik/interior-contract`, а как он выглядит — сцена.
 *
 * Без раскладки компонент остаётся тем, чем был: залом с отделкой. Так его и
 * зовут из теста и со стенда.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsOutCardinal,
  Cube,
  PersonSimpleWalk,
  X,
} from "../../../components/ui/icons.jsx";
import { hasDesktopBridge } from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import PreviewWindow from "../../../components/desktop/workshop/preview/PreviewWindow.jsx";
import { gameRoomParts, variantLabel } from "./interior-models.js";
import { createFloorPlan } from "./interior-layout.js";
import { frameRoom } from "./interior-room.js";
import {
  createInteriorScene,
  stockInteriorSelection,
} from "./interior-scene.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Час, на котором открывается редактор.
 *
 * Полдень: отделку смотрят при свете, а не при лампах. Ночь отсюда в одном
 * движении ползунка — и на ней видно ровно то, ради чего в зале горят
 * собственные лампы.
 */
const OPENING_HOUR = 13;

/*
 * Погода превью. Зала она почти не касается — неба из-под крыши не видно, — но
 * дневной свет, который попадает внутрь, приходит именно из неё. Ясное небо
 * даёт самую честную разницу между полуднем и полуночью.
 */
const PREVIEW_WEATHER = "EXTRASUNNY";

/* Метры пишутся с запятой и одним знаком: «11,5 × 7,5 × 3,6 м». Сантиметры в
   подписи под кадром не читаются, а по десятым видно, что комната настоящая. */
const metres = (value) => value.toFixed(1).replace(".", ",");

/*
 * Строка про модели предметов. Пустая, пока сказать нечего: до первого ответа
 * игры сообщать не о чем, а «всё настоящее» стоит говорить прямо — это то, за
 * чем в редактор и приходят.
 */
const propsNote = ({ status, ready, total, reason }) => {
  if (!status || !total) return "";
  if (status === "game") return tr("Предметы: настоящие модели из вашей GTA V");
  const head =
    status === "partial"
      ? `Предметы: ${ready} из ${total} типов настоящей моделью, остальные коробкой`
      : tr("Предметы нарисованы коробками, а не моделями из игры");
  return reason ? `${head} · ${reason}` : head;
};

const roomSize = (room) =>
  `${metres(room.width)} × ${metres(room.depth)} × ${metres(room.height)} м`;

/* Нажатая кнопка остаётся нажатой, пока её вариант едет из игры: мигание на
   месте выбора хуже медленной загрузки, о которой предупредили. */
const chipClass = (active, busy) =>
  `${active ? "is-active" : ""}${busy ? " is-busy" : ""}`.trim();

/*
 * Ракурсы. Первый — взгляд изнутри, второй вернулся из прошлого редактора: там
 * был план сверху из прямоугольников, и расставлять по нему было удобнее, чем
 * изнутри зала. План ушёл вместе с появлением настоящего помещения — теперь
 * это не вторая картинка, а та же камера над тем же залом.
 *
 * Третий — полёт: свободная камера вместо орбиты. Зал разглядывают не с одной
 * точки, а обходя его, и орбита вокруг середины комнаты этого не даёт —
 * подойти к полке вплотную ею нельзя.
 */
const VIEWS = Object.freeze([
  { id: "inside", label: "Изнутри", icon: Cube },
  { id: "top", label: "Сверху", icon: ArrowsOutCardinal },
  { id: "fly", label: "Полёт", icon: PersonSimpleWalk },
]);

/**
 * @param {object} props
 * @param {object} [props.layout] Раскладка макета для сцены: комната, зоны,
 *   типы объектов, сами объекты и выбранный. Не передали — в кадре только зал.
 * @param {string} [props.roomLabel] Как называется помещение проекта. Пусто —
 *   проекта нет, и в кадре зал витрины: он называет себя сам.
 * @param {string} [props.armedPropId] Объект из каталога, который сейчас ставят.
 * @param {Function} [props.onSelect] Выбрали объект в зале (или сняли выбор).
 * @param {Function} [props.onPlace] Щёлкнули по полу, держа объект каталога.
 * @param {Function} [props.onMove] Протяжка закончилась: новое место и поворот.
 * @param {Function} [props.probe] Что скажет проверка, если объект встанет сюда.
 * @param {Function} [props.onCancelArmed] Отменили постановку.
 * @param {Function} [props.onPlaceAtCentre] Поставить в середину зоны — путь для
 *   тех, у кого кадра нет вовсе (нет WebGL, старый вебвью).
 * @param {Array} [props.finish] Чем покрашены поверхности помещения.
 * @param {string} [props.selectedSurfaceId] Выбранная поверхность: в кадре она
 *   светится, в панели отделки — открыта.
 * @param {Function} [props.onSurfaces] Что в зале нашлось покрасить.
 * @param {Function} [props.onPickSurface] Щёлкнули по самому помещению.
 * @param {Function} [props.loadTexture] Принесённая человеком картинка по
 *   ссылке из макета: читает её редактор, кадр только кладёт на материал.
 */
export default function InteriorPreview3D({
  hasGame = hasDesktopBridge,
  layout = null,
  roomLabel = "",
  armedPropId = "",
  armedLabel = "",
  onSelect = null,
  onPlace = null,
  onMove = null,
  probe = null,
  onCancelArmed = null,
  onPlaceAtCentre = null,
  finish = null,
  selectedSurfaceId = "",
  onSurfaces = null,
  onPickSurface = null,
  loadTexture = null,
}) {
  useTr();
  const [hour, setHour] = useState(OPENING_HOUR);
  const [view, setView] = useState("inside");
  /* Что проверка говорит про объект под рукой. Приезжает из сцены и только
     когда ответ изменился — на каждое движение мыши React не перерисовывают. */
  const [issue, setIssue] = useState(null);
  const [selection, setSelection] = useState(stockInteriorSelection);
  /*
   * `greeted` — «в кадре уже что-то стоит».
   *
   * Сцена докладывает `loading` на каждое чтение из игры, в том числе на смену
   * отделки поверх готового зала. Заслонка же нужна только первому чтению,
   * когда показывать ещё нечего: накрыть ею стоящий зал ради новых баннеров
   * значит спрятать ровно ту картинку, ради которой на кнопку и нажали.
   */
  const [source, setSource] = useState(() => {
    const status = hasGame() ? "loading" : "schematic";
    return { status, reason: "", greeted: status !== "loading" };
  });
  /* Какую группу тронули последней. Пометку «грузится» несёт нажатая кнопка, а
     не все выбранные разом: иначе не видно, какой именно вариант едет. */
  const [pressed, setPressed] = useState("");

  /*
   * Что стоит в кадре — тем же расчётом, каким это считает сцена.
   *
   * Своей арифметики здесь нет намеренно: разойдись два ответа, подпись под
   * кадром называла бы один размер, а стены встали бы по другому.
   */
  const room = useMemo(
    () =>
      frameRoom(
        createFloorPlan(layout?.room),
        layout?.zones || [],
        layout?.roomId,
      ),
    [layout],
  );
  /* Отделка принадлежит помещению, а не редактору: у комнат реестра своих
     вариантов в игре не лежит, и ряд кнопок над их кадром был бы обманом. */
  const variants = gameRoomParts(room.id)?.groups || [];

  /*
   * Переходник поднимается ОДИН раз.
   *
   * Окно пересоздаёт сцену, когда меняется свойство `scene`, — то есть новый
   * переходник на каждую перерисовку означал бы новый контекст WebGL на каждое
   * движение ползунка времени. Обработчик поэтому ходит через ссылку, а сам
   * переходник остаётся тем же самым.
   */
  /*
   * Что известно про модели предметов. Отдельно от помещения: комната и
   * предметы приезжают из игры порознь, и «зал схемой, предметы настоящие» —
   * обычное сочетание, а не ошибка.
   */
  const [propSource, setPropSource] = useState({
    status: "",
    ready: 0,
    total: 0,
    reason: "",
  });

  const bridge = useRef({});
  bridge.current.onProps = setPropSource;
  bridge.current.onRoom = (next) =>
    setSource((current) => ({
      ...next,
      greeted: current.greeted || next.status !== "loading",
    }));
  /* Обработчики макета ходят через ту же ссылку и по той же причине: они
     пересоздаются на каждую правку проекта, а переходник обязан остаться тем
     же самым — иначе окно пересоздаёт контекст WebGL на каждый сдвинутый
     объект. */
  bridge.current.onSelect = onSelect;
  bridge.current.onPlace = onPlace;
  bridge.current.onMove = onMove;
  bridge.current.probe = probe;
  bridge.current.onSurfaces = onSurfaces;
  bridge.current.onPickSurface = onPickSurface;
  bridge.current.loadTexture = loadTexture;
  const scene = useMemo(
    () =>
      createInteriorScene({
        hasGame: () => hasGame(),
        onRoom: (state) => bridge.current.onRoom?.(state),
        onProps: (state) => bridge.current.onProps?.(state),
        onSelect: (id) => bridge.current.onSelect?.(id),
        onPlace: (request) => bridge.current.onPlace?.(request),
        onMove: (id, patch) => bridge.current.onMove?.(id, patch),
        probe: (request) => bridge.current.probe?.(request),
        onProbe: setIssue,
        onSurfaces: (list) => bridge.current.onSurfaces?.(list),
        onPickSurface: (id) => bridge.current.onPickSurface?.(id),
        loadTexture: (reference) => bridge.current.loadTexture?.(reference),
      }),
    [hasGame],
  );

  useEffect(() => {
    scene.apply(selection);
  }, [scene, selection]);

  useEffect(() => {
    scene.setLayout(layout);
  }, [scene, layout]);

  useEffect(() => {
    scene.setArmed(armedPropId);
  }, [scene, armedPropId]);

  useEffect(() => {
    scene.setFinish(finish || []);
  }, [scene, finish]);

  useEffect(() => {
    scene.setHighlightedSurface(selectedSurfaceId);
  }, [scene, selectedSurfaceId]);

  /* Полёт — это режим камеры окна, а не второй зал: сцене он приходит как
     взгляд изнутри, чтобы освещение и рамки помещения остались теми же. */
  useEffect(() => {
    scene.setView(view === "fly" ? "inside" : view);
  }, [scene, view]);

  /* Пока объект в руке, Esc его отпускает: другого способа передумать у жеста
     «щёлкните по полу» нет, а щелчок мимо пола поставил бы объект. */
  useEffect(() => {
    if (!armedPropId || !onCancelArmed) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCancelArmed();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armedPropId, onCancelArmed]);

  const pickView = useCallback((next) => {
    setView(next);
  }, []);

  const choose = (groupId, value) => {
    setPressed(groupId);
    setSelection((current) => ({ ...current, [groupId]: value }));
  };

  /* Группа, чей вариант сейчас едет из игры поверх уже собранного зала. */
  const busyGroup =
    source.status === "loading" && source.greeted ? pressed : "";

  /*
   * Шторка окна. Во весь кадр — только на первое чтение, когда показывать
   * ещё нечего: подмена схемы настоящим залом на глазах читается как сбой.
   * Дальше — мягкая: зал остаётся открытым, а о принятом нажатии говорят и
   * кнопка, и метка в углу кадра.
   */
  const loading =
    source.status !== "loading"
      ? null
      : source.greeted
        ? { soft: true, title: tr("Читаем отделку из GTA V…") }
        : {
            title: tr("Загружаем помещение из GTA V"),
            detail:
              tr("Читаем помещение и выбранную отделку из установленной игры"),
          };

  /*
   * Плашки макета лежат ВНУТРИ кадра, а не под ним: и «щёлкните по полу», и
   * ответ проверки говорят про то место, куда человек сейчас смотрит. Ответ
   * ниже кадра он прочитает уже после того, как поставит объект не туда.
   *
   * Пусто — значит `null`, а не пустая накладка: окно заводит слой поверх кадра
   * только тогда, когда в нём есть что показать.
   */
  const hud =
    armedPropId || issue ? (
      <>
        {armedPropId ? (
          <div className="interior-hint" role="status">
            <b>Ставим «{armedLabel}»</b>
            {/* Именно комнаты: зал вокруг неё в мод не поедет, и объект в
                нём не останется — он прижмётся к обводке. */}
            <span>{tr("Щёлкните по полу обведённой комнаты. Esc — отмена.")}</span>
            <div className="interior-hint-actions">
              {onPlaceAtCentre ? (
                <Button variant="ghost" size="sm" onClick={onPlaceAtCentre}>
                  {tr("В середину зоны")}
                </Button>
              ) : null}
              {onCancelArmed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<X />}
                  aria-label={tr("Отменить постановку")}
                  onClick={onCancelArmed}
                />
              ) : null}
            </div>
          </div>
        ) : null}
        {issue ? (
          <p
            className={`interior-hint interior-hint-issue is-${issue.level}`}
            role="status"
            aria-live="polite"
          >
            {issue.message}
          </p>
        ) : null}
      </>
    ) : null;

  return (
    <section className="interior-preview" aria-label={tr("Предпросмотр помещения")}>
      {/*
        Выбор отделки стоит НАД кадром, а не поверх него: своя шкала времени у
        окна уже есть — цветная, под кадром, — и плашка, положенная сверху,
        накрыла бы её ровно там, где человек будет её искать.

        Ряд кнопок, а не список. Списками это тридцать пять вариантов под
        четырьмя закрытыми крышками: чтобы сравнить четвёртый стиль с пятым,
        надо открыть, выбрать, закрыть, посмотреть и открыть снова — четыре
        шага там, где нужен один, и нажатое видно только внутри закрытой
        крышки. На кнопке номер, а полное имя — подписью при наведении: почему
        именно номер, сказано в шапке файла.
      */}
      <div className="interior-view-bar">
        {/*
          Ракурс стоит первым в той же полосе, что и отделка: это тоже «как я
          сейчас смотрю на зал», и отдельная плашка ради двух кнопок означала бы
          второй ряд органов над кадром.
        */}
        <div
          className="interior-variant-group"
          role="group"
          aria-label={tr("Ракурс")}
        >
          <span>{tr("Ракурс")}</span>
          <div className="interior-variant-chips">
            {VIEWS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={chipClass(view === item.id, false)}
                  aria-pressed={view === item.id}
                  onClick={() => pickView(item.id)}
                >
                  <Icon />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {variants.map((group) => {
          const chosen = selection[group.id];
          const busy = busyGroup === group.id;
          return (
            <div
              className="interior-variant-group"
              key={group.id}
              role="group"
              aria-label={group.label}
            >
              <span>{group.label}</span>
              <div className="interior-variant-chips">
                {/* Зал снять нельзя — без него смотреть не на что, — а отделку
                    можно, поэтому «Нет» стоит только у необязательных групп. */}
                {group.optional ? (
                  <button
                    type="button"
                    className={chipClass(!chosen, busy && !chosen)}
                    aria-pressed={!chosen}
                    title={`Убрать: ${group.label.toLowerCase()}`}
                    onClick={() => choose(group.id, "")}
                  >
                    {tr("Нет")}
                  </button>
                ) : null}
                {group.items.map((item, index) => {
                  const active = chosen === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      className={chipClass(active, busy && active)}
                      aria-pressed={active}
                      title={variantLabel(group, index)}
                      onClick={() => choose(group.id, item)}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="interior-preview-stage">
        <PreviewWindow
          className="interior-preview-window"
          scene={scene}
          timeOfDay={hour}
          onTimeOfDayChange={setHour}
          weather={PREVIEW_WEATHER}
          quality="auto"
          camera={view === "fly" ? "fly" : "orbit"}
          loading={loading}
        >
          {hud}
        </PreviewWindow>
      </div>

      {/*
        Подпись называет помещение, его размер и откуда оно взялось.
        «Схематичный зал» здесь стоял общей фразой на все случаи, и по ней
        нельзя было понять, ту ли комнату показывают: ровно на этом расхождение
        и держалось.
      */}
      <p className="interior-preview-note" aria-live="polite">
        {[
          roomLabel || room.label,
          roomSize(room),
          source.status === "game"
            ? tr("взято из установленной GTA V")
            : tr("собрано по шаблону помещения"),
          source.status === "schematic" && source.reason ? source.reason : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {/*
        Про предметы кадр говорит отдельной строкой и только когда есть что
        сказать. Коробка с именем на боку вместо автомата — штатное состояние
        без подключённой игры, но молчаливое: человек видит, что предметы не
        те, и не знает, ждать ли модель или чинить что-то у себя.
      */}
      {propsNote(propSource) ? (
        <p className="interior-preview-note is-props" aria-live="polite">
          {propsNote(propSource)}
        </p>
      ) : null}
      {view === "fly" ? (
        <p className="interior-preview-note" aria-live="polite">
          {tr("Полёт: WASD — вперёд и вбок, Q и E — вниз и вверх, Shift — быстрее, протяжка мышью — осмотреться. Камера держится внутри помещения: за стеной у зала из игры видна изнанка стен.")}
        </p>
      ) : null}
    </section>
  );
}
