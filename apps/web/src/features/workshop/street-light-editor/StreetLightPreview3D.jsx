/*
 * Предпросмотр уличного фонаря.
 *
 * Кадр здесь чужой: его рисует общее окно мастерской
 * (`components/desktop/workshop/preview/PreviewWindow.jsx`), и у него свой
 * рендерер, своё небо из таймцикла игры, свой туман и своя шкала суток под
 * кадром. Отсюда в него уезжает только сам фонарь — переходником
 * `street-light-scene.js`.
 *
 * Раньше на этом месте стояла собственная сцена с собственным `WebGLRenderer`,
 * и сутки в ней были из двух пунктов: «Ночь» и «День», плюс два подобранных
 * цвета фона. Фонарь при этом горел одинаково в обоих. Настоящий закат и
 * настоящая ночь — ровно то, чего этому редактору не хватало, и они не могли
 * появиться, пока небо рисовал он сам.
 *
 * Что осталось здесь: час суток, выбор расстояния, подпись для скринридера и
 * плашка про то, чей фонарь стоит в кадре — из игры или схематичный. Разбор
 * дизайна в числа света уехал в сцену вместе с семейством и опорами: сцену
 * поднимают и без редактора (стенд, витрина мода), и штатный фонарь ей нужен
 * там же, где живут эти числа.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { hasDesktopBridge } from "../../../api.js";
import PreviewWindow from "../../../components/desktop/workshop/preview/PreviewWindow.jsx";
import {
  createStreetLightScene,
  streetLightPreviewModel,
} from "./street-light-scene.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Час, на котором открывается редактор.
 *
 * Не полдень: фонарь в полдень погашен, и первый кадр показал бы столб, ради
 * которого сюда никто не заходит. Половина девятого вечера — это уже темнота,
 * но ещё видно, куда светит лампа и на что она ложится.
 */
const OPENING_HOUR = 20.5;

/*
 * Погода превью.
 *
 * Чистое небо, а не «ясно с солнцем в зените»: под безоблачным EXTRASUNNY ночь
 * получается настолько прозрачной, что ореол лампы не во что лечь. Свою погоду
 * редактор не заводит — в фонарях правят фонарь, а не небо, для неба есть
 * таймцикл.
 */
const PREVIEW_WEATHER = "CLEAR";

const MODEL_NOTES = Object.freeze({
  loading: "Читаем модель и текстуры из установленной игры",
  game: "Модель фонаря взята из установленной GTA V",
  schematic: "Игра рядом не найдена — показываем схематичный фонарь",
});

export default function StreetLightPreview3D({
  design,
  contextMultiplier = 1,
  /* Обычный дорожный фонарь с одним рожком: именно его человек и представляет,
     когда говорит «уличный фонарь». Семейство 02 — декоративный двухрожковый
     под старину, для превью читается хуже. Оба есть в coverage-профиле. */
  lightId = "prop-streetlight-03e",
}) {
  useTr();
  const [hour, setHour] = useState(OPENING_HOUR);
  const [distance, setDistance] = useState("near");
  const [modelState, setModelState] = useState(() =>
    hasDesktopBridge() ? "loading" : "schematic",
  );
  const model = useMemo(() => streetLightPreviewModel(design), [design]);

  /*
   * Переходник поднимается один раз.
   *
   * Окно пересоздаёт сцену, когда меняется свойство `scene`, — то есть новый
   * переходник на каждую перерисовку означал бы новый контекст WebGL на каждое
   * движение ползунка. Обработчик поэтому ходит через ссылку, а сам переходник
   * остаётся тем же самым.
   */
  const bridge = useRef({});
  bridge.current.onModelState = setModelState;
  const scene = useMemo(
    () =>
      createStreetLightScene({
        lightId,
        hasGame: hasDesktopBridge,
        onModelState: (state) => bridge.current.onModelState?.(state),
      }),
    [lightId],
  );

  useEffect(() => {
    scene.apply(model, contextMultiplier);
  }, [scene, model, contextMultiplier]);

  useEffect(() => {
    scene.setDistance(distance);
  }, [scene, distance]);

  return (
    <section
      className="street-light-preview"
      aria-label={tr("Приближённый 3D preview фонаря")}
    >
      {/*
        Полоса стоит НАД кадром, а не поверх него: своя шкала времени у окна уже
        есть — цветная, под кадром, — и плашка, положенная сверху, накрыла бы её
        ровно там, где человек будет её искать.
      */}
      <div className="street-light-view-bar">
        <button
          type="button"
          className={distance === "lod" ? "is-active" : ""}
          aria-pressed={distance === "lod"}
          onClick={() =>
            setDistance((value) => (value === "near" ? "lod" : "near"))
          }
        >
          {distance === "near" ? tr("HD / близко") : tr("LOD / далеко")}
        </button>
        <span className="street-light-view-note">
          {MODEL_NOTES[modelState]}
        </span>
        {contextMultiplier !== 1 && (
          <b className="street-light-view-context">
            Timecycle · {Math.round(contextMultiplier * 100)}%
          </b>
        )}
        {/* Честная оговорка: в кадре приближение, а не рендер игры. */}
        <span className="street-light-view-badge">
          {tr("Приближённый предпросмотр")}
        </span>
      </div>

      <div className="street-light-preview-stage">
        <PreviewWindow
          scene={scene}
          timeOfDay={hour}
          onTimeOfDayChange={setHour}
          weather={PREVIEW_WEATHER}
          quality="auto"
          camera="orbit"
          /* Пока фонарь читается из игры, кадр под шторкой окна: подмена одной
             модели другой на глазах читается как сбой, а не как загрузка. */
          loading={
            modelState === "loading"
              ? {
                  title: tr("Загружаем фонарь из GTA V"),
                  detail: MODEL_NOTES.loading,
                }
              : null
          }
        />
      </div>

      <p className="street-light-preview-summary" aria-live="polite">
        {distance === "near" ? "HD" : "LOD"}: RGB {model.color.r},{" "}
        {model.color.g}, {model.color.b}; яркость {model.intensity.toFixed(2)};
        радиус {model.range.toFixed(2)}; corona{" "}
        {model.corona.enabled ? tr("включена") : tr("выключена")}; локальная дымка{" "}
        {model.volumetric.enabled ? tr("включена") : tr("выключена")}; контекст
        timecycle {Math.round(contextMultiplier * 100)}%.
      </p>
    </section>
  );
}
