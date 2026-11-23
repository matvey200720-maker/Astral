/*
 * Общее окно предпросмотра мастерской.
 *
 * Одно окно на всех, кто показывает мир: редактор дорог, кастомизатор арены и
 * то, что появится после них. Своя сцена в каждом редакторе означала бы три
 * разных полудня, три разных тумана и три места, где надо чинить утечку
 * контекста WebGL. Здесь окно отвечает за небо, свет, туман и кадр, а редактор
 * — только за то, что стоит на земле, и приносит это переходником `scene`.
 *
 * Что окно НЕ делает: не знает ни про дорогу, ни про арену, ни про их данные.
 * Как только оно про них узнает, оно перестанет быть общим.
 *
 *
 * ЗЕМЛЯ И ТУМАН — обязанности сцены
 *
 * Туман целиком на окне: цвет, дальность и суточный ход считает оно, сцена
 * задаёт только масштаб мира через `ctx.setFogRange(near, far)`. Отсюда три
 * правила, каждое написано по случившейся поломке.
 *
 * 1. Не писать в `scene.fog.color` своими руками. В униформе тумана лежит
 *    ЭКРАННЫЙ цвет, уже сведённый плёночной кривой, а не линейный: three
 *    накладывает туман после тонмаппинга. Линейный цвет неба в сумерках уходит
 *    за двойку, и подмешивание двойки в кадр, который уже лежит в 0…1, упирает
 *    весь дальний план в белое — по горизонту идёт белая полоса в две-три
 *    строки. Нужен свой цвет тумана — меняйте час и погоду, а не униформу.
 *
 * 2. Земля должна доставать до `ctx.fog.far`, а не обрываться раньше. Ниже
 *    горизонта купол красит ровно цветом тумана, поэтому земля, дошедшая до
 *    насыщения тумана, сходится с небом незаметно. Земля, кончившаяся раньше,
 *    даёт тёмный шов: поверхность ещё не растворилась, а неба на её месте уже
 *    нет. Дальность тумана гуляет по погоде и часу — читайте её в `update` из
 *    `ctx.fog.far`, а не считайте один раз в `mount`.
 *
 * 3. Тянуть землю на километры тоже незачем: всё, что дальше `ctx.fog.far`,
 *    и так залито ровным цветом тумана. Лишние метры не видны, но исправно
 *    жрут карту теней и глубину.
 *
 *
 * СВЕТ ЗАКРЫТОЙ СЦЕНЫ
 *
 * Лампы зала обязаны гореть в кадре одинаково при любой экспозиции: лампа не
 * тускнеет оттого, что на улице полдень. Множитель для этого считает окно и
 * кладёт в кадр:
 *
 *     update(ctx, frame) {
 *       for (const lamp of myLamps) lamp.intensity = MY_CANDELA * frame.interiorGain;
 *     }
 *
 * Считать «единицу делить на экспозицию» руками БОЛЬШЕ НЕ НУЖНО, и подбирать
 * ему потолок — тем более. Так делали раньше, и потолок срабатывал ровно в
 * полдень: лампы недосвечивали, а сутки переворачивались — закат выходил ярче
 * полудня. Диапазон экспозиции знает только окно, поэтому и границы усиления
 * выводятся из него, а не назначаются на глаз.
 *
 * `bias` у `ctx.setExposure` — ручка ДЛЯ ГЛАЗ и только. Освещение зала ею не
 * лепят: для этого есть лампы сцены и `frame.interiorGain` над ними.
 *
 *
 * КАМЕРА ЗАКРЫТОЙ СЦЕНЫ
 *
 * Сцена под крышей обязана задать пределы орбиты — иначе колесо мыши уводит
 * зрителя наружу сквозь стену:
 *
 *     ctx.setOrbit({ target: [0, 4, 0], radius: 30, minRadius: 8, maxRadius: 42 });
 *
 * `minRadius`/`maxRadius` держат расстояние, `minPitch`/`maxPitch` — наклон;
 * колесо и протяжка уважают их сами. Возвращать камеру руками в своём `update`
 * не нужно и вредно: драться каждый кадр с собственным вводом — значит отдать
 * человеку камеру, которая пружинит под рукой.
 *
 * Пределы не заданы — поведение прежнее, открытое: от трёх до шестисот метров.
 *
 *
 * УКАЗАТЕЛЬ — чей этот щелчок
 *
 * Холст один, а мышью на нём работают двое: окно крутит орбиту, редактор
 * двигает своё содержимое. Рассудить их может только тот, кто знает, попал ли
 * указатель в объект, — то есть сцена. Разобрав попадание, она объявляет жест
 * своим:
 *
 *     onPointerDown(event) {
 *       const id = this.hitTest(event);
 *       if (!id) return;            // пустой пол — пусть окно крутит орбиту
 *       ctx.claimPointer(event);    // а это наше
 *       ...
 *     }
 *
 * Заявленный указатель окно пропускает ЦЕЛИКОМ — нажатие, протяжку,
 * отпускание и колесо, — и заявка снимается сама, даже если кнопку отпустили
 * за краем холста или вовсе за краем окна браузера. Одного этого хватает:
 * камера не дёрнется ни в начале жеста, ни на его середине.
 *
 * Порядок подписки больше ничего не решает — решает заявка. ЛОВИТЬ СОБЫТИЕ В
 * ФАЗЕ ПЕРЕХВАТА НА ДОКУМЕНТЕ БОЛЬШЕ НЕ НУЖНО: этот приём завёлся оттого, что
 * слушатели окна висят на холсте и заведены до `mount`, а на общем узле
 * сработавшего первым уже не остановить. Теперь окно разбирает начатую орбиту
 * задним числом, и заявить можно из любого обработчика — на холсте, в любой
 * фазе, хоть после первого движения мыши.
 *
 * Заявка не трогает само событие: останавливать его дальше по дереву — дело
 * сцены и её соседей по холсту, окну для своей орбиты этого не нужно.
 * Сцена, которая ничего не заявляет, разницы не замечает вовсе.
 *
 *
 * ПОСТОБРАБОТКА — необязательная обязанность потребителя
 *
 * Свойство `postProcess` — обработчик готового кадра. Окно зовёт его после
 * каждого нарисованного кадра, отдавая сведённый кадр и накладку поверх него;
 * нарисованное в накладке и есть то, что увидит человек. Этим окно показывает
 * экранные эффекты игры — вспышку после убийства, ночной фильтр — на любой
 * сцене, а не только на той, которая про них знает.
 *
 * Хук стоит ПОСЛЕ сведения кадра, и это не деталь реализации, а то же самое
 * правило, что и у тумана выше: до сведения кадр живёт в линейном HDR, где
 * полуденное небо уходит за тридцать. Экранная заливка «половина
 * непрозрачности поверх кадра», подмешанная туда, не видна вовсе, а число из
 * HDR, подмешанное в сведённый кадр, упирает его в белое. Хук получает те же
 * числа, что и глаз, — иначе настроенный по нему эффект врал бы про игру.
 * Точное место и остальные две причины — в разделе «постобработка кадра»
 * файла `preview-stage.js`.
 *
 * Что хук НЕ меняет: окно по-прежнему рисует ноль кадров, когда его не видно,
 * — а нет кадра, нет и вызова. Эффект, который идёт во времени, обязан просить
 * кадры сам, через `ctx.requestRender()`, ровно как это делает любая правка
 * сцены. Без хука окно не делает за кадр ни одного лишнего действия: накладки
 * не существует в разметке, пока её не попросили.
 *
 *
 * ШТОРКА — пока что-то читается из игры
 *
 * Свойство `loading` размывает кадр и кладёт поверх плашку с подписью: так
 * человек видит, что здание, зал или фонарь ещё едут из файлов игры, а не
 * что сцена зависла. Плашка одна на всех редакторов и живёт здесь, а не в
 * каждом из них: четыре одинаковых спиннера в четырёх листах стилей уже
 * разъезжались по цвету и отступам.
 *
 *     <PreviewWindow loading={{ title: "Загружаем зал из GTA V", detail: "…" }} />
 *
 * `soft: true` — мягкая шторка: лёгкое размытие и метка в углу, когда
 * поверх уже показанного кадра доезжает что-то ещё (соседи квартала после
 * здания, отделка после зала). Своя шторка окна закрывает и самый первый
 * кадр, пока едут покрытия сцены, — редактору о ней знать не нужно.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import useStageHeight from "../useStageHeight.js";
import PreviewControls from "./PreviewControls.jsx";
import { normalizeHour } from "./preview-lighting.js";
import { loadPreviewAssets } from "./preview-assets.js";
import { createPreviewStage } from "./preview-stage.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { useStageBusy } from "../../../ui/stage-busy.js";
import StageLoader from "../../../../features/workshop/stage-loader/StageLoader.jsx";
import { useStageLoad } from "../../../../features/workshop/stage-loader/use-stage-load.js";
/* Лист окна подключён из `styles/index.css` — в этом приложении один вход для
   стилей и явный порядок слоёв, и второй импорт прямо отсюда загрузил бы те же
   правила дважды. */

/* Шторка первого кадра: покрытия сцены едут асинхронно, и до них в кадре
   чёрный прямоугольник — пусть он честно скажет, что ждёт. */
const BOOT_SHADE = Object.freeze({
  title: "Готовим кадр",
  detail: "Загружаем покрытия и небо сцены",
  soft: false,
});

/** Шторка из свойства: булево, строка или `{ title, detail, soft }`. */
function normalizeShade(loading) {
  if (!loading) return null;
  if (loading === true)
    return { title: tr("Загружаем из GTA V"), detail: "", soft: false };
  if (typeof loading === "string")
    return { title: loading, detail: "", soft: false };
  return {
    title: String(loading.title || tr("Загружаем из GTA V")),
    detail: loading.detail ? String(loading.detail) : "",
    soft: Boolean(loading.soft),
    /* `{ done, total }` — настоящий счёт загрузки, если редактор его знает; без него полоса заставки неопределённая. */
    progress: loading.progress && loading.progress.total > 0 ? loading.progress : null,
  };
}

function formatHour(hour) {
  const total = Math.round(normalizeHour(hour) * 60);
  const hours = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * @param {object} props
 * @param {{mount?:Function, update?:Function, dispose?:Function, enclosed?:boolean}} props.scene
 *   Переходник сцены. `mount(ctx)` ставит содержимое, `update(ctx, frame)`
 *   зовётся каждый кадр, `dispose()` убирает за собой. `enclosed: true` для
 *   сцены под крышей: экспозиция перестаёт ключеваться по небу, которого в
 *   таком кадре не видно.
 * @param {number} props.timeOfDay Часы 0…24, управляемое свойство.
 * @param {Function} [props.onTimeOfDayChange] Если передан — окно показывает
 *   собственный скраббер времени.
 * @param {string} props.weather Ключ погоды таймцикла, например `EXTRASUNNY`.
 * @param {"low"|"medium"|"high"|"auto"} props.quality
 * @param {Function} [props.onWeatherChange] Если передан — окно показывает ряд
 *   кнопок погоды. Не передавать тому, у кого погода выведена из собственных
 *   данных: второй орган будет спорить с первым.
 * @param {Function} [props.onQualityChange] Если передан — окно показывает ряд
 *   кнопок качества.
 * @param {"orbit"|"drive"|"static"|"fly"} props.camera Как двигается камера.
 *   `fly` — свободный полёт: WASD ведут камеру, Q и E опускают и поднимают,
 *   Shift ускоряет, протяжка мышью осматривается. Клавиши окно слушает только
 *   в этом режиме и только когда никто не печатает.
 * @param {import("react").ReactNode} [props.children] Накладка поверх кадра —
 *   собственные органы редактора, которым место на самой картинке: ракурсы
 *   арены. Кладётся внутрь кадра намеренно: плашка, выставленная относительно
 *   всей сцены и поднятая на высоту полосы органов, записанную числом, съезжает
 *   ровно тогда, когда у окна появляется новый ряд.
 * @param {boolean|string|{title?:string, detail?:string, soft?:boolean}} [props.loading]
 *   Шторка на время чтения из игры — см. раздел «шторка» в шапке. Кадр
 *   размывается, поверх — плашка с подписью; `soft: true` — мягкая шторка
 *   поверх готового кадра.
 * @param {Function} [props.postProcess] Обработчик готового кадра — см. раздел
 *   «постобработка» в шапке. Получает `{ source, context, canvas, width,
 *   height, deltaSeconds, elapsedSeconds, timeOfDay, lighting }`: `source` —
 *   холст сцены со сведённым кадром, `context` — 2D-контекст накладки поверх
 *   него, размеры в CSS-пикселях. Обработчик, который ничего не нарисовал,
 *   оставляет кадр как есть.
 */
export default function PreviewWindow({
  scene = null,
  children = null,
  timeOfDay = 12,
  onTimeOfDayChange = null,
  weather = "EXTRASUNNY",
  onWeatherChange = null,
  quality = "auto",
  onQualityChange = null,
  camera = "orbit",
  className = "",
  onReady = null,
  onError = null,
  postProcess = null,
  loading = null,
}) {
  useTr();
  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const [failure, setFailure] = useState("");
  const [metrics, setMetrics] = useState(null);
  /* Пока сцена не поднялась: покрытия едут, холста ещё нет. */
  const [booting, setBooting] = useState(true);

  /*
   * Обработчики и текущие настройки живут в ссылках, а не в зависимостях
   * эффекта. Иначе стрелка `onReady={(ctx) => …}`, написанная прямо в разметке
   * — а её напишут именно так, — пересоздаёт контекст WebGL на каждую
   * перерисовку родителя.
   */
  const readyRef = useRef(onReady);
  const errorRef = useRef(onError);
  const settingsRef = useRef({ timeOfDay, weather, quality, camera });
  readyRef.current = onReady;
  errorRef.current = onError;
  settingsRef.current = { timeOfDay, weather, quality, camera, postProcess };

  /*
   * По той же причине к постоянным приводятся и обработчики органов.
   *
   * Полоса под кадром помнит свою разметку — иначе тринадцать плиток суток и
   * пятнадцать кнопок погоды пересобирались бы дважды в секунду, столько раз
   * сцена приносит замер кадра. Память сравнивает пропсы, а стрелку
   * `onWeatherChange={(id) => …}` напишут прямо в разметке редактора. Мост
   * здесь, а не в каждом редакторе: забыть его там можно, и никто не заметит —
   * картинка останется правильной, подешевеет только счёт.
   */
  const handlersRef = useRef(null);
  handlersRef.current = { onTimeOfDayChange, onWeatherChange, onQualityChange };
  const pickTime = useCallback(
    (value) => handlersRef.current.onTimeOfDayChange?.(value),
    [],
  );
  const pickWeather = useCallback(
    (value) => handlersRef.current.onWeatherChange?.(value),
    [],
  );
  const pickQuality = useCallback(
    (value) => handlersRef.current.onQualityChange?.(value),
    [],
  );

  const frame = useStageHeight();

  /*
   * Сцена поднимается один раз на переходник. Всё остальное — время, погода,
   * качество, режим камеры — доезжает отдельными эффектами через императивные
   * методы: пересоздавать контекст WebGL ради смены часа значит мигать чёрным
   * прямоугольником на каждое движение ползунка времени.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let cancelled = false;
    let stage = null;
    let assets = null;
    setBooting(true);

    const quality = settingsRef.current.quality;
    loadPreviewAssets({ quality: quality === "auto" ? "medium" : quality })
      .then((loaded) => {
        assets = loaded;
        if (cancelled) {
          loaded.dispose();
          return;
        }
        /*
         * Настройки читаются здесь, а не при запуске эффекта: покрытия едут
         * асинхронно, и за это время ползунок времени успевает уехать. Снимок,
         * снятый заранее, поднял бы сцену на прошлом часе — а эффект, который
         * должен был это поправить, к тому моменту уже отработал вхолостую,
         * потому что сцены ещё не было.
         */
        const settings = settingsRef.current;
        stage = createPreviewStage(host, {
          scene,
          assets: loaded,
          quality: settings.quality,
          camera: settings.camera,
          timeOfDay: settings.timeOfDay,
          weather: settings.weather,
          postProcess: settings.postProcess,
          onFrame: setMetrics,
        });
        stageRef.current = stage;
        setFailure("");
        setBooting(false);
        readyRef.current?.(stage.context);
      })
      .catch((error) => {
        if (cancelled) return;
        setBooting(false);
        /* Набор текстур сцена забирает себе и убирает вместе с собой. Если
           сцены не случилось — убрать некому, кроме этого места. */
        assets?.dispose();
        assets = null;
        const failed =
          error instanceof Error ? error : new Error(String(error));
        setFailure(failed.message || tr("неизвестная ошибка"));
        errorRef.current?.(failed);
      });

    return () => {
      cancelled = true;
      if (stage) {
        stage.dispose();
      } else {
        assets?.dispose();
      }
      if (stageRef.current === stage) stageRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    stageRef.current?.setTime(timeOfDay, weather);
  }, [timeOfDay, weather]);

  useEffect(() => {
    stageRef.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    stageRef.current?.setCameraMode(camera);
  }, [camera]);

  /*
   * Хук едет отдельным эффектом, а не через ссылку, как `onReady`: окну важно
   * различать «хука нет» и «хук есть», от этого зависит, заводить ли накладку
   * и копировать ли кадр. Постоянная обёртка вокруг ссылки означала бы, что
   * хук есть всегда, и окно платило бы за постобработку у всех редакторов
   * разом — включая тех, кто про неё не слышал.
   */
  useEffect(() => {
    stageRef.current?.setPostProcess(postProcess);
  }, [postProcess]);

  /* Шторка редактора главнее шторки первого кадра: он знает, что именно
     едет; окно — только то, что кадра ещё нет. Под заглушкой ошибки шторки
     нет: размывать нечего, а два сообщения разом читаются как два сбоя. */
  const shade = failure
    ? null
    : normalizeShade(loading) || (booting ? BOOT_SHADE : null);
  /* Полная шторка — заставка загрузки (ТЗ 42В): анимация Astral и полоса; инструменты редактора приглушены, пока она стоит.
     Мягкая шторка (метка в углу) остаётся меткой: кадр под ней живой. */
  const full = Boolean(shade && !shade.soft);
  const load = useStageLoad(full);
  /* Шторка ушла, заставка ещё растворяется: подпись остаётся прежней, а не прыгает на запасную. */
  const lastShade = useRef(null);
  if (shade) lastShade.current = shade;
  const held = shade || lastShade.current;
  useStageBusy(load.shown && load.phase === "in");

  return (
    <div className={`preview-window${className ? ` ${className}` : ""}`}>
      <div
        className={`preview-window-frame${frame.heightVh == null ? "" : " is-resized"}${
          shade ? (shade.soft ? " is-loading-soft" : " is-loading") : ""
        }`}
        ref={frame.frameRef}
        style={frame.style}
      >
        {/* Контейнер остаётся в разметке всегда: холст создаёт и убирает сама
            сцена, потому что второй контекст WebGL на том же холсте завести
            нельзя, а строгий режим React монтирует эффект дважды. */}
        <div
          className="preview-window-stage"
          ref={hostRef}
          aria-hidden={Boolean(failure)}
        />
        {failure ? (
          <p className="preview-window-failure" role="status">
            Трёхмерный предпросмотр недоступен: {failure}
            <span>
              {tr("Редактор работает как обычно — правки сохраняются и устанавливаются, не видно только картинку.")}
            </span>
          </p>
        ) : null}
        {shade?.soft ? (
          <div className="preview-window-loading is-soft" role="status" aria-live="polite">
            <i aria-hidden="true" />
            <b>{shade.title}</b>
            {shade.detail ? <span>{shade.detail}</span> : null}
          </div>
        ) : load.shown ? (
          <StageLoader
            variant={load.variant}
            phase={load.phase}
            progress={held?.progress || null}
            title={held ? tr(held.title) : ""}
            detail={held?.detail ? tr(held.detail) : ""}
          />
        ) : null}
        <div className="preview-window-readout">
          <strong>{formatHour(timeOfDay)}</strong>
          {metrics ? (
            <span title={tr("Качество подбирается по скорости кадра")}>
              {metrics.fps} к/с · {metrics.quality}
              {metrics.assetSource === "game" ? tr(" · текстуры из игры") : ""}
            </span>
          ) : null}
        </div>
        {children ? <div className="preview-window-hud">{children}</div> : null}
        <div className="preview-window-grip" {...frame.handleProps} />
      </div>

      {/* Органы под кадром. Каждый ряд просится отдельно — какие именно,
          решает редактор; окно про его данные по-прежнему ничего не знает. */}
      <PreviewControls
        timeOfDay={timeOfDay}
        weather={weather}
        quality={quality}
        onTimeOfDayChange={onTimeOfDayChange ? pickTime : null}
        onWeatherChange={onWeatherChange ? pickWeather : null}
        onQualityChange={onQualityChange ? pickQuality : null}
      />
    </div>
  );
}
