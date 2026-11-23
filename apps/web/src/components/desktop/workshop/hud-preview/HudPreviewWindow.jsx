/*
 * Общее двумерное окно предпросмотра.
 *
 * Одно окно на всех, кто рисует не мир, а слой поверх мира: прицелы,
 * мини-карта и то, что появится после них. Трёхмерная сцена им не нужна —
 * рисовать они умеют сами, SVG или холстом, — а нужен им настоящий кадр игры
 * под слоем и честная геометрия между кадром и слоем. Пока каждый держал свою
 * подложку, кадром была статичная картинка, а «1:1» держалось на пропорции,
 * случайно совпавшей в листе стилей.
 *
 * Разделение то же, что у трёхмерного окна рядом (`preview/PreviewWindow.jsx`):
 * окно владеет кадром, его загрузкой, его геометрией и безопасной зоной;
 * потребитель приносит слой и ничего про кадр не знает. Как только окно узнает
 * про прицел или про мини-карту, оно перестанет быть общим.
 *
 * Кадра может не быть вовсе: у человека может не быть игры, комплект сцены
 * может не доехать, видео может не подняться в браузере без кодека. Это не
 * поломка редактора — редактор работает, — поэтому окно показывает честную
 * подложку и говорит, чего не хватает, а не чёрный прямоугольник.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HUD_DEFAULT_DESIGN,
  HUD_SAFE_INSET,
  hudCoverRect,
  hudLayerRect,
  hudSafeRect,
  hudSize,
  loadHudScene,
  normalizeHudSources,
} from "./hud-frame.js";
import { HUD_SCENES } from "./hud-scenes.js";
import { useFrameGate } from "../../../../attention.js";
import { tr, useTr } from "../../../../locales/ui.js";
/* Лист окна подключён из `styles/index.css` — в этом приложении один вход для
   стилей и явный порядок слоёв, и второй импорт отсюда загрузил бы те же
   правила дважды. */

/** Доля кадра в проценты для inline-стилей. */
const percent = (value) => `${value * 100}%`;

/**
 * @param {object} props
 * @param {{width:number,height:number}|[number,number]} [props.design] Система
 *   координат слоя. Кадр принимает её пропорцию, слой вписывается в кадр без
 *   искажения — на этом держится точность разметки, и менять это нельзя. Без
 *   неё слой ложится на кадр целиком, а координатами считаются координаты
 *   самого кадра (`HUD_DEFAULT_DESIGN`, пока кадра нет).
 * @param {Array|object|string} [props.frames] Сцены: описание кадра, адрес
 *   картинки или `scene.json` с комплектом. По умолчанию — общий список.
 * @param {string|null} [props.frameId] Какая сцена в кадре. Управляемое
 *   свойство: окно само его не меняет.
 * @param {Function|null} [props.onFrameChange] Если передан — окно показывает
 *   переключатель сцен.
 * @param {number} [props.safeInset] Безопасная зона долей кадра.
 * @param {boolean} [props.showSafe] Нарисовать её границу поверх кадра.
 * @param {number} [props.stretch] Во сколько раз снаружи окно растянуто по ширине (`GameScreenFrame`, растянутый экран игры):
 *   замер кадра делит ширину на это число, чтобы слой считался в своих, нерастянутых точках.
 * @param {boolean} [props.paused] Остановить видео. Окно останавливает его и
 *   само — когда на приложение не смотрят или кадр уехал за край экрана.
 * @param {Function|null} [props.onReady] Зовётся с геометрией, когда кадр встал.
 * @param {Function|null} [props.onError] Зовётся, когда кадра не будет.
 * @param {React.ReactNode|Function} props.children Слой потребителя. Функция
 *   получает геометрию: `{design, layer, frame, safe, source, nudge}`.
 */
export default function HudPreviewWindow({
  design = null,
  frames = HUD_SCENES,
  frameId = null,
  onFrameChange = null,
  safeInset = HUD_SAFE_INSET,
  showSafe = false,
  stretch = 1,
  paused = false,
  className = "",
  onReady = null,
  onError = null,
  children,
}) {
  useTr();
  const frameRef = useRef(null);
  const videoRef = useRef(null);
  const [box, setBox] = useState(null);
  const [scenes, setScenes] = useState({});
  const [broken, setBroken] = useState({});

  /* Обработчики живут в ссылках: стрелку `onReady={(g) => …}` напишут прямо в
     разметке, и по зависимостям эффекта она пересоздавала бы наблюдателя и
     перезапускала видео на каждую перерисовку родителя. */
  const readyRef = useRef(onReady);
  const errorRef = useRef(onError);
  readyRef.current = onReady;
  errorRef.current = onError;

  const declared = useMemo(() => normalizeHudSources(frames), [frames]);

  /*
   * Комплекты сцен подтягиваются по одному и запоминаются по адресу, а не по
   * месту в списке: список пересобирается на каждую перерисовку родителя, и
   * привязка к номеру означала бы повторную загрузку видео при каждом движении
   * ползунка в инспекторе. Уже запрошенные адреса помнит ссылка, а не
   * состояние: состояние меняется ответом и перезапустило бы этот же эффект,
   * пока остальные запросы ещё в пути.
   *
   * Помнится сам запрос, а не отметка «уже спрашивали». Разница видна ровно
   * один раз, зато каждый раз: в разработке React монтирует дерево дважды, и
   * ответ на первый запрос отменяется вместе с первым монтированием. С
   * отметкой второе монтирование просто не спрашивало снова — и кадр не
   * появлялся никогда. С запросом оно подписывается на тот же самый ответ.
   */
  const requested = useRef(new Map());
  useEffect(() => {
    let cancelled = false;
    for (const item of declared) {
      if (item.kind !== "scene") continue;
      let pending = requested.current.get(item.scene);
      if (!pending) {
        pending = loadHudScene(item.scene, { id: item.id, label: item.label });
        requested.current.set(item.scene, pending);
      }
      pending
        .then((loaded) => {
          if (cancelled) return;
          setScenes((current) => ({ ...current, [item.scene]: loaded }));
        })
        .catch((error) => {
          if (cancelled) return;
          setBroken((current) => ({
            ...current,
            [item.id]: error?.message || tr("комплект сцены недоступен"),
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [declared]);

  /* Сцена, у которой уже есть чем рисовать. Незагруженные и упавшие в счёт не
     идут — иначе переключатель предлагал бы пустые кнопки. */
  const ready = useMemo(
    () =>
      declared
        .map((item) =>
          item.kind === "scene" ? scenes[item.scene] || null : item,
        )
        .filter((item) => item && !broken[item.id]),
    [declared, scenes, broken],
  );

  const source = ready.find((item) => item.id === frameId) || ready[0] || null;

  /*
   * «Кадра игры нет» — вывод, а не ожидание.
   *
   * Пока хоть один комплект в пути, окно молчит: мигнуть заглушкой на первом
   * кадре и убрать её через сто миллисекунд — значит соврать человеку, что у
   * него не работает то, что работает.
   *
   * Считается по кадрам ИГРЫ, а не по выбранной сцене. Матовая подложка готова
   * всегда — рисовать её нечем, кроме материала окна, — и если мерить наличие
   * кадра по ней, то сообщение не появится никогда: сломанный комплект тихо
   * подменится студийным фоном, и человек решит, что так и задумано. Но и
   * говорить «кадра нет», когда он есть, а человек просто выбрал матовый, —
   * тоже враньё: смотрим на готовность, а не на выбор.
   *
   * И жаловаться есть на что, только если кадр игры вообще просили. Тот, кто
   * принёс одну матовую подложку — редактор прицела, — получил ровно то, что
   * просил, и «кадра игры нет» было бы сообщением о поломке, которой нет.
   */
  const failure = useMemo(() => {
    if (!declared.length) return tr("сцена не задана");
    const pending = declared.some(
      (item) =>
        item.kind === "scene" && !scenes[item.scene] && !broken[item.id],
    );
    if (pending) return "";
    if (!declared.some((item) => item.game)) return "";
    if (ready.some((item) => item.game)) return "";
    const reasons = Object.values(broken).filter(Boolean);
    return reasons[0] || tr("кадр не загрузился");
  }, [declared, ready, scenes, broken]);

  useEffect(() => {
    if (!failure) return;
    errorRef.current?.(new Error(failure));
  }, [failure]);

  /*
   * Кадр меряется всегда, а не только ради холста.
   *
   * Слой ставится по измеренному прямоугольнику, а не растягивается на кадр:
   * пропорция кадра приходит из вёрстки, и стоит кому-нибудь дописать туда
   * `min-height`, как растянутый слой перестанет быть 1:1 — молча и ровно в
   * том месте, где точность и обещана. Измеренный слой в этом случае честно
   * встаёт полосами внутри кадра, сохраняя масштаб.
   *
   * Замер идёт до отрисовки: после неё человек успел бы увидеть слой не на
   * своём месте. Нулевой размер — не размер: так выглядит первый кадр,
   * скрытая вкладка и среда без вёрстки, и там слой равен своей же системе
   * координат.
   */
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      /* `getBoundingClientRect` видит растяжение родителя (`transform: scaleX`), слой — нет: ширина считается до него. */
      const width =
        stretch > 0 && stretch !== 1 ? rect.width / stretch : rect.width;
      setBox((current) =>
        current?.width === width && current?.height === rect.height
          ? current
          : { width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stretch]);

  /*
   * Толчок кадра.
   *
   * Отдача трясёт кадр вместе со всем, что к нему приклеено: искры остаются на
   * той же кирпичной стене, а не съезжают с неё на пиксель. Поэтому двигается
   * общая обёртка кадра и слоя — а рамка, затемнение и плашки поверх стоят
   * снаружи неё и не дёргаются.
   *
   * Сдвиг ставится напрямую в стиль, минуя состояние: трясут его из кадрового
   * цикла шестьдесят раз в секунду, и перерисовывать на это дерево React
   * означало бы платить за дрожание в пару пикселей полной перерисовкой окна.
   */
  const sceneRef = useRef(null);
  const nudge = useCallback((x = 0, y = 0) => {
    const node = sceneRef.current;
    if (!node) return;
    node.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
  }, []);
  useEffect(() => () => nudge(0, 0), [nudge]);

  const geometry = useMemo(() => {
    const own = hudSize(design, null);
    const box2d = own || hudSize(source?.size, HUD_DEFAULT_DESIGN);
    const outer = hudSize(box, null);
    /*
     * Где под слоем оказался сам кадр.
     *
     * Кадр обрезается по контейнеру — это `object-fit: cover` в вёрстке и тот
     * же расчёт в числах здесь. Тому, кто рисует холстом по точкам кадра,
     * нужен именно этот прямоугольник, причём в координатах слоя: холст живёт
     * внутри слоя и на его отступ промахнулся бы.
     */
    const cover = hudCoverRect(
      { x: 0, y: 0, ...(outer || box2d) },
      source?.size,
    );
    /*
     * Слой вписывается в контейнер, только если ему есть что защищать.
     *
     * Своя система координат — это обещание точности: разметку прицела нельзя
     * ни растянуть, ни обрезать, поэтому её коробка вписывается целиком, хоть
     * бы и полосами по краям. А тот, кто рисует по самому кадру, ничего
     * своего в коробке не держит — его точки живут на кадре, и кадр накрывает
     * контейнер целиком. Вписывать такой слой значит обрезать ему края и
     * оставлять по бокам поля там, где в игре картинка идёт до самого края.
     */
    const layer = own
      ? hudLayerRect(box, box2d)
      : { x: 0, y: 0, ...(outer || box2d), scale: cover.scale };
    return {
      design: box2d,
      layer,
      frame: {
        x: cover.x - layer.x,
        y: cover.y - layer.y,
        width: cover.width,
        height: cover.height,
        scale: cover.scale,
      },
      safe: hudSafeRect(box2d, safeInset),
      source,
      nudge,
    };
  }, [box, design, safeInset, source, nudge]);

  const notifyReady = useCallback(() => {
    readyRef.current?.(geometry);
  }, [geometry]);

  /*
   * Видео кадра игры идёт, только пока на него смотрят.
   *
   * Это общее окно мини-карты, прицела, стрельбища, меток и интерфейса, и
   * крутилось видео в каждом из них всегда: в окне за браузером, в окне под
   * игрой, в редакторе, прокрученном так, что кадра не видно. Декодирование
   * кадров — работа процессора и видеочипа на каждом кадре экрана, и ради
   * картинки, которую никто не видит, её не должно быть. Ворота кадров
   * (`attention.js`) закрываются, когда окно без внимания или кадр за краем
   * экрана; видео замирает на текущем кадре и продолжает с него же.
   *
   * Поэтому и `autoPlay` у тега нет: включает видео только этот эффект — иначе
   * редактор, открытый в фоне, успевал бы запустить декодер до первой проверки.
   * Вызов может отклониться и без звука — тогда остаётся постер, и это не
   * поломка.
   */
  const playing = useFrameGate(frameRef) && !paused;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) video.pause?.();
    else video.play?.()?.catch?.(() => {});
  }, [playing, source?.src]);

  const aspect = `${geometry.design.width} / ${geometry.design.height}`;
  const safe = geometry.safe;
  const layerStyle = {
    left: `${geometry.layer.x}px`,
    top: `${geometry.layer.y}px`,
    width: `${geometry.layer.width}px`,
    height: `${geometry.layer.height}px`,
    /* Масштаб слоя отдаётся и в вёрстку: элементы, размер которых человек
       задаёт в пикселях игры, обязаны считаться от кадра, а не от окна. */
    "--hud-layer-scale": geometry.layer.scale,
  };

  return (
    <div
      className={`hud-preview${className ? ` ${className}` : ""}`}
      data-stretch={stretch !== 1 ? "true" : undefined}
      style={stretch !== 1 ? { "--hud-stretch": stretch } : undefined}
    >
      <div
        className="hud-preview-frame"
        ref={frameRef}
        /* Затемнение по краям принадлежит кадру игры: на студийной подложке оно
           читалось бы грязью в углах, а не глубиной. */
        data-matte={source?.kind === "matte" ? "true" : undefined}
        style={{ aspectRatio: aspect }}
      >
        {/* Кадр и слой — одна коробка: их двигает общий толчок, и коробка эта
            повторяет кадр один в один, поэтому координаты слоя от неё не
            зависят. */}
        <div className="hud-preview-scene" ref={sceneRef}>
          {source?.kind === "video" ? (
            <video
              ref={videoRef}
              className="hud-preview-shot"
              key={source.src}
              src={source.src}
              poster={source.poster || undefined}
              muted
              loop
              playsInline
              aria-hidden="true"
              onCanPlay={notifyReady}
              onError={() =>
                setBroken((current) => ({
                  ...current,
                  [source.id]: tr("видео сцены не загрузилось"),
                }))
              }
            />
          ) : null}
          {source?.kind === "image" ? (
            <img
              className="hud-preview-shot"
              key={source.src}
              src={source.src}
              alt=""
              draggable="false"
              onLoad={notifyReady}
              onError={() =>
                setBroken((current) => ({
                  ...current,
                  [source.id]: tr("кадр сцены не загрузился"),
                }))
              }
            />
          ) : null}
          {/* Матовая подложка — выбранная сцена, а не отсутствие кадра: её
            рисует материал продукта, и загружать ей нечего. */}
          {source?.kind === "matte" ? (
            <div className="hud-preview-matte" aria-hidden="true" />
          ) : null}

          {/* Заглушка занимает весь кадр: половинчатая читалась бы как «зависло».
            Слой поверх неё продолжает работать — редактор не останавливается
            из-за того, что под ним нет картинки. */}
          {source ? null : (
            <div className="hud-preview-void" aria-hidden="true" />
          )}

          {/* Безопасная зона живёт в слое, а не в кадре: она задана в координатах
            слоя, и в кадре, обрезанном по-своему, оказалась бы не там. */}
          <div className="hud-preview-layer" style={layerStyle}>
            {showSafe ? (
              <div
                className="hud-preview-safe"
                aria-hidden="true"
                style={{
                  left: percent(safe.x / geometry.design.width),
                  top: percent(safe.y / geometry.design.height),
                  width: percent(safe.width / geometry.design.width),
                  height: percent(safe.height / geometry.design.height),
                }}
              />
            ) : null}
            {typeof children === "function" ? children(geometry) : children}
          </div>
        </div>

        {failure ? (
          <p className="hud-preview-missing" role="status">
            {tr("Кадра игры нет:")} {failure}
            <span>
              {tr(
                "Слой показан на нейтральной подложке — размеры и положение верны, не видно только, как он ляжет на картинку игры.",
              )}
            </span>
          </p>
        ) : null}

        {onFrameChange && ready.length > 1 ? (
          <div
            className="hud-preview-scenes"
            role="group"
            aria-label={tr("Кадр")}
          >
            {ready.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === source?.id ? "is-active" : ""}
                onClick={() => onFrameChange(item.id)}
              >
                {tr(item.label)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
