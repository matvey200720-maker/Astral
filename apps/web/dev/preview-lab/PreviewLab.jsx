/*
 * Стенд окна превью.
 *
 * Одна забота: показать <PreviewWindow /> с живой сценой и дать покрутить то,
 * от чего зависит картинка, — сцену, время суток, погоду, качество и камеру.
 * Ничего из каталога, авторизации и облака здесь нет и быть не должно: стенд
 * существует ровно потому, что та цепочка требует настольного моста.
 *
 * Список сцен собран с диска (`lab-modules.js`), а не написан здесь. Поэтому
 * экран рассчитан и на то, чего раньше быть не могло: сцен нет вовсе, сцена
 * есть, но не той формы, сцен больше, чем влезает в ряд кнопок. Отказ такой
 * сцены не гасит стенд — он остаётся при ней, а соседние открываются.
 *
 * Кроме людей стендом пользуется проверка кадров, поэтому наружу выставлен
 * window.__previewLab — см. useLabBridge ниже.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureFrame, findSceneCanvas } from "./capture.js";
import {
  SCENES,
  dependencyReport,
  findScene,
  loadPreviewWindow,
  loadScene,
} from "./lab-modules.js";

/*
 * Погоды и качества здесь больше нет.
 *
 * Оба ряда переехали в само окно превью — там они и нужны редакторам, — а
 * стенд, который держал бы вторую пару органов рядом, проверял бы уже не окно,
 * а себя: нажатие в стенде шло бы мимо тех кнопок, которые увидит человек.
 * Осталось то, чего у окна нет: выбор сцены и ракурс.
 */
const CAMERAS = Object.freeze([
  { id: "orbit", title: "Орбита" },
  { id: "drive", title: "Проезд" },
  { id: "static", title: "Статика" },
]);

/* Четыре точки суток, по которым стенд сверяют глазами: рассвет, полдень,
   закат, ночь. Кнопки рядом с ползунком — чтобы не ловить их вручную. */
const TIME_MARKS = Object.freeze([
  { value: 6, title: "06:00 рассвет" },
  { value: 13, title: "13:00 полдень" },
  { value: 19.5, title: "19:30 закат" },
  { value: 1, title: "01:00 ночь" },
]);

/* Не экспортируется намеренно: рядом с компонентом любой посторонний экспорт
   выключает Fast Refresh, и правка разметки перезапускала бы сцену целиком. */
function formatTimeOfDay(value) {
  const clamped = Math.min(24, Math.max(0, Number(value) || 0));
  const hours = Math.floor(clamped) % 24;
  const minutes = Math.round((clamped - Math.floor(clamped)) * 60);
  const carry = minutes === 60;
  return `${String((hours + (carry ? 1 : 0)) % 24).padStart(2, "0")}:${String(carry ? 0 : minutes).padStart(2, "0")}`;
}

/* Мост для проверки кадров. Скриншоты панели в этой сессии не снимаются, так
   что доказательством работает сам кадр с холста: сюда ходит скрипт, который
   выставляет время суток и забирает картинку. */
function useLabBridge(bridge) {
  const latest = useRef(bridge);
  latest.current = bridge;

  useEffect(() => {
    window.__previewLab = new Proxy(
      {},
      {
        get(_target, key) {
          return latest.current[key];
        },
        has(_target, key) {
          return key in latest.current;
        },
        ownKeys() {
          return Reflect.ownKeys(latest.current);
        },
        getOwnPropertyDescriptor() {
          return { enumerable: true, configurable: true };
        },
      },
    );
    return () => {
      delete window.__previewLab;
    };
  }, []);
}

export default function PreviewLab() {
  /* Первая по списку, а не «дороги»: список стенду больше не принадлежит, и
     закреплять в нём любимую сцену значит снова знать её по имени. */
  const [sceneId, setSceneId] = useState(() => SCENES[0]?.id ?? "");
  const [timeOfDay, setTimeOfDay] = useState(13);
  const [weather, setWeather] = useState("EXTRASUNNY");
  const [quality, setQuality] = useState("auto");
  const [camera, setCamera] = useState("orbit");

  const [PreviewWindow, setPreviewWindow] = useState(null);
  const [adapter, setAdapter] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sceneError, setSceneError] = useState(null);
  /* Отказы копятся по сценам, а не сбрасываются на каждую смену: файл, который
     не подошёл по форме, остаётся помеченным в списке, пока страницу не
     перезагрузят. Иначе про него узнаёшь заново на каждый заход. */
  const [faults, setFaults] = useState({});
  const [ready, setReady] = useState(false);

  const stageRef = useRef(null);
  /* Контекст окна приезжает в onReady. Из него нужен ровно один метод —
     renderFrame: он рисует кадр синхронно, не спрашивая, показана ли вкладка.
     Без него снимок со скрытой страницы — пустой буфер. */
  const contextRef = useRef(null);
  const deps = useMemo(() => dependencyReport(), []);

  useEffect(() => {
    let alive = true;
    loadPreviewWindow()
      .then((component) => {
        if (alive) setPreviewWindow(() => component);
      })
      .catch((error) => {
        if (alive) setLoadError(error.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!sceneId) return undefined;
    let alive = true;
    setReady(false);
    setAdapter(null);
    setSceneError(null);
    loadScene(sceneId)
      .then((loaded) => {
        if (!alive) return;
        /* Ракурс задаёт сцена, а не стенд: дорогу настраивают из-за руля, зал
           арены — изнутри чаши. Сцена объявляет это свойством `camera`; не
           объявила — значит, ракурс её не волнует и остаётся орбита. */
        setCamera(loaded.camera ?? "orbit");
        setAdapter(loaded);
        setFaults((current) => {
          if (!(sceneId in current)) return current;
          const next = { ...current };
          delete next[sceneId];
          return next;
        });
      })
      .catch((error) => {
        /* Отказ сцены — не поломка стенда: остальные сцены по-прежнему
           открываются, поэтому он ложится на свою сцену, а не в общий
           `loadError`, из которого нет выхода без перезагрузки. */
        if (!alive) return;
        setFaults((current) => ({ ...current, [sceneId]: error.message }));
      });
    return () => {
      alive = false;
    };
  }, [sceneId]);

  const handleReady = useCallback((context) => {
    contextRef.current = context ?? null;
    setReady(true);
    setSceneError(null);
  }, []);

  const handleError = useCallback((error) => {
    contextRef.current = null;
    setReady(false);
    setSceneError(error?.message ?? String(error ?? "неизвестная ошибка"));
  }, []);

  /* Кадр по требованию. Возвращает false, если окно не отдало renderFrame —
     тогда снимок будет тем, что осталось в буфере, и об этом надо знать. */
  const renderFrame = useCallback(() => {
    const render = contextRef.current?.renderFrame;
    if (typeof render !== "function") return false;
    return render() !== false;
  }, []);

  useLabBridge({
    state: () => ({
      sceneId,
      timeOfDay,
      weather,
      quality,
      camera,
      ready,
      hasWindow: Boolean(PreviewWindow),
      hasAdapter: Boolean(adapter),
      loadError,
      sceneError,
      sceneFault: faults[sceneId] ?? null,
      faults,
      deps,
      hasRenderFrame: typeof contextRef.current?.renderFrame === "function",
      canvas: (() => {
        const canvas = findSceneCanvas(stageRef.current);
        return canvas ? { width: canvas.width, height: canvas.height } : null;
      })(),
    }),
    /* Прозвище сцены разрешается тут же: скрипт проверки кадров помнит их
       короткими словами, и ломать его вслед за переездом файла незачем. */
    setScene: (hint) => {
      const scene = findScene(hint);
      if (scene) setSceneId(scene.id);
      return Boolean(scene);
    },
    setTimeOfDay: (value) => setTimeOfDay(Number(value)),
    setWeather,
    setQuality,
    setCamera,
    renderFrame,
    /* Контекст окна наружу — для разбора, а не для управления: посмотреть, где
       стоит камера и что с освещением, когда кадр выглядит не так. */
    context: () => contextRef.current,
    /* Снимок всегда идёт следом за свежим кадром и в том же такте: иначе
       браузер успевает очистить буфер рисования, и на диск уезжает пустота. */
    capture: (options) => {
      const rendered = renderFrame();
      return { ...captureFrame(stageRef.current, options), rendered };
    },
    scenes: SCENES.map((scene) => scene.id),
  });

  /* Пустой набор — это не ошибка загрузки, а состояние диска, и сказать про
     него надо тем же местом, что и про остальное. */
  const emptyList =
    SCENES.length === 0
      ? `Под ${deps.roots.join(" и ")} нет ни одного *-scene.js`
      : null;
  const blocked = loadError ?? emptyList ?? faults[sceneId] ?? sceneError;

  return (
    <div className="lab">
      <header className="lab__bar">
        <span className="lab__brand">Astral · стенд превью</span>

        {/* Список, а не ряд кнопок: сцен теперь столько, сколько их завели на
            диске, и ряд однажды уедет за край панели. */}
        <label className="lab__field lab__field--scene">
          <span className="lab__label">Сцена</span>
          <select
            value={sceneId}
            disabled={SCENES.length === 0}
            onChange={(event) => setSceneId(event.target.value)}
          >
            {SCENES.length === 0 ? (
              <option value="">сцен не найдено</option>
            ) : (
              SCENES.map((scene) => (
                <option key={scene.id} value={scene.id} title={scene.id}>
                  {faults[scene.id]
                    ? `${scene.title} · не по форме`
                    : scene.title}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="lab__field lab__field--wide">
          <span className="lab__label">
            Время суток <b>{formatTimeOfDay(timeOfDay)}</b>
          </span>
          <input
            type="range"
            min="0"
            max="24"
            step="0.25"
            value={timeOfDay}
            onChange={(event) => setTimeOfDay(Number(event.target.value))}
          />
        </label>

        <div className="lab__group" role="group" aria-label="Точки суток">
          {TIME_MARKS.map((mark) => (
            <button
              key={mark.value}
              type="button"
              className="lab__chip lab__chip--ghost"
              onClick={() => setTimeOfDay(mark.value)}
            >
              {mark.title}
            </button>
          ))}
        </div>

        <label className="lab__field">
          <span className="lab__label">Камера</span>
          <select value={camera} onChange={(event) => setCamera(event.target.value)}>
            {CAMERAS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>

        <span className={`lab__state${ready ? " lab__state--on" : ""}`}>
          {ready ? "сцена идёт" : "ожидание"}
        </span>
      </header>

      <main className="lab__stage" ref={stageRef}>
        {PreviewWindow && adapter ? (
          <PreviewWindow
            scene={adapter}
            timeOfDay={timeOfDay}
            onTimeOfDayChange={setTimeOfDay}
            weather={weather}
            onWeatherChange={setWeather}
            quality={quality}
            onQualityChange={setQuality}
            camera={camera}
            onReady={handleReady}
            onError={handleError}
          />
        ) : null}

        {blocked ? (
          <div className="lab__notice" role="status">
            <h1>Стенд поднялся, показывать пока нечего</h1>
            <p>{blocked}</p>
            <ul>
              <li>
                PreviewWindow.jsx —{" "}
                {deps.previewWindow ? "на месте" : "нет на диске"}
              </li>
              {SCENES.length === 0 ? (
                <li>ни одного *-scene.js под {deps.roots.join(" и ")}</li>
              ) : (
                /* В строке — короткое слово, а причина отказа целиком стоит
                   выше, для выбранной сцены: список должен читаться взглядом,
                   а не разбираться по слогам. */
                SCENES.map((scene) => (
                  <li key={scene.id}>
                    {scene.id} —{" "}
                    {faults[scene.id]
                      ? "не по форме"
                      : scene.id === sceneId
                        ? "выбрана"
                        : "найдена"}
                  </li>
                ))
              )}
            </ul>
            <p className="lab__hint">
              Файлы пишут рядом. Обновите страницу, когда они появятся, — стенд
              найдёт их сам: список сцен он собирает с диска, а не держит у себя.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
