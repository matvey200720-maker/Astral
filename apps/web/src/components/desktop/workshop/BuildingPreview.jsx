/*
 * Просмотр реального здания из установленной GTA V.
 *
 * Отличается от кастомизатора Ашана намеренно: там за превью стоит контракт
 * поверхностей и overlay-установка, здесь ничего этого нет. Показывать пустой
 * редактор с неработающими слоями было бы обманом, поэтому это именно
 * просмотр — модель, свет и камера.
 *
 * Раз настраивать нечего, весь файл — это три чужие вещи, собранные вместе:
 * каркас редактора (`ui/EditorShell.jsx`), общее окно предпросмотра
 * (`preview/PreviewWindow.jsx`) и переходник сцены (`building-scene.js`), где
 * лежит модель из игры, площадка под ней и её собственный свет. Своего здесь —
 * час суток, погода, качество, ракурс и одна строка о том, что сейчас в кадре.
 *
 * Своего листа стилей у файла нет. Раньше он импортировал
 * `mega-mall-customizer.css` — чужой лист чужого редактора, который к тому же
 * подключён из `styles/index.css`, то есть грузился дважды. Всё, что нужно
 * этому экрану, уже описано каркасом и окном; собственных классов он не заводит.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Buildings } from "../../ui/icons.jsx";
import EditorShell from "../../ui/EditorShell.jsx";
import PageTabs from "../../ui/PageTabs.jsx";
import PreviewWindow from "./preview/PreviewWindow.jsx";
import { BUILDING_VIEWS, createBuildingScene } from "./building-scene.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { pumpsViewLabel } from "./building-lang.js";

/*
 * Час, на котором экран открывается.
 *
 * Не полдень. Всё, ради чего заправку открывают, — навес, вывеска и колонки, —
 * в полдень видно хуже всего: вывеска не горит, лампы не читаются, тени
 * отвесные. И не ночь: в темноте не видно ни материалов, ни формы. Закат
 * показывает и то, и другое разом. Тот же час и по той же причине стоит у
 * кастомизатора Ашана (`MegaMallCustomizer.jsx`).
 */
const OPENING_HOUR = 19.8;

/** Одна честная строка под названием: что сейчас в кадре и откуда оно взялось. */
function describeModel(model, scene, description) {
  if (model.status === "loading")
    return tr("Читаем геометрию из установленной GTA V…");
  if (model.status !== "ready") return model.reason || description;

  /*
   * Подпись перечисляет ровно то, что в кадре настоящее.
   *
   * Модель может приехать из игры, а покрытия — нет: текстуры едут вторым,
   * независимым каналом (`preview/preview-assets.js`), и у человека без
   * извлечённого набора под настоящей станцией лежит процедурная замена. Одна
   * подпись «Модель из GTA V» на оба случая — это ровно та неточность, из-за
   * которой процедурный асфальт полгода принимали за игровой.
   */
  const parts = [tr("Модель из GTA V")];
  parts.push(
    scene?.source === "game" ? tr("покрытие из игры") : tr("покрытие — приближение"),
  );
  if (scene?.lamps) parts.push(`${tr("лампы из модели:")} ${scene.lamps}`);
  return parts.join(" · ");
}

export default function BuildingPreview({
  buildingId,
  title,
  description,
  onExit,
  onNotice,
}) {
  useTr();
  const language = useUiLanguage();
  const heading = title ?? tr("Здание");
  const lead = description ?? tr("Реальная модель из установленной игры");
  const [model, setModel] = useState({ status: "loading", reason: "" });
  const [scene3d, setScene3d] = useState(null);
  const [view, setView] = useState(BUILDING_VIEWS[0].value);
  /* Час, погода и качество — состояние экрана, а не работа: смотреть на
     заправку в грозу не значит что-то в ней поменять, и сохранять тут нечего. */
  const [hour, setHour] = useState(OPENING_HOUR);
  const [weather, setWeather] = useState("EXTRASUNNY");
  const [quality, setQuality] = useState("auto");
  const notice = useRef(onNotice);
  notice.current = onNotice;

  /*
   * Сцена создаётся один раз на здание. Пересоздавать её на каждую перерисовку
   * значило бы поднимать заново контекст WebGL и заново читать модель из игры —
   * от движения ползунка времени.
   */
  const scene = useMemo(
    () =>
      createBuildingScene({
        buildingId,
        onModel: setModel,
        onScene: setScene3d,
      }),
    [buildingId],
  );

  useEffect(() => {
    scene.setView(view);
  }, [scene, view]);

  return (
    <EditorShell
      className="building-preview"
      onBack={onExit}
      kicker={tr("Мастерская")}
      title={heading}
      status={
        <>
          <Buildings />
          {describeModel(model, scene3d, lead)}
        </>
      }
      tabs={
        <PageTabs
          role="group"
          label={tr("Ракурс")}
          value={view}
          options={BUILDING_VIEWS.map((item) => ({
            value: item.value,
            label: item.value === "pumps" ? pumpsViewLabel(language) : item.label,
          }))}
          onChange={setView}
        />
      }
    >
      <PreviewWindow
        scene={scene}
        timeOfDay={hour}
        onTimeOfDayChange={setHour}
        weather={weather}
        /* Ряды погоды и качества окно показывает только тому, кто дал
           обработчик (`preview/PreviewWindow.jsx`). Без них заправку нельзя
           было посмотреть в дождь, хотя весь таймцикл под это готов. */
        onWeatherChange={setWeather}
        quality={quality}
        onQualityChange={setQuality}
        camera="orbit"
        loading={
          model.status === "loading"
            ? {
                title: tr("Загружаем здание из GTA V"),
                detail: tr("Читаем геометрию из установленной игры"),
              }
            : null
        }
        onError={(error) =>
          notice.current?.(
            `${tr("Предпросмотр не открылся:")} ${error?.message || error}`,
            "error",
          )
        }
      />
    </EditorShell>
  );
}
