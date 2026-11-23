/*
 * Кадр здания торгового центра в мастерской.
 *
 * Всё, что про свет и небо, живёт в общем окне (`preview/PreviewWindow.jsx`);
 * всё, что про само здание, — в переходнике сцены (`mega-mall-scene.js`).
 * Здесь остаётся то, что принадлежит редактору и не имеет смысла без него:
 * кнопки сторон, состояние загрузки модели и рамка безопасной зоны.
 *
 * Сцена лежит отдельным файлом, а не рядом с разметкой, потому что смотреть на
 * неё надо и без редактора: стенд окна превью берёт `*-scene.js` глобом, а
 * приложение целиком в браузере не поднимается.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import PreviewWindow from "./preview/PreviewWindow.jsx";
import { createMegaMallScene } from "./mega-mall-scene.js";
import { tr, useTr } from "../../../locales/ui.js";

const MODEL_HINTS = Object.freeze({
  real: "Геометрия и текстуры прочитаны из установленной GTA V",
  loading: "Читаем геометрию из установленной GTA V",
});

/* Что именно читается сейчас: манифест расстановки или один из бандлов. */
const STAGE_LABELS = Object.freeze({
  manifest: "расстановка секции",
  hd: "здание",
  lod: "подмены издалека",
  near: "соседи квартала",
  props: "пропы",
});

/*
 * Цвет рамки безопасной зоны — свой, не как у выделения (штрихи и контур акцента,
 * `selection-highlight.js`). На одной стене это две разные вещи:
 * «поверхность выбрана» и «внутрь этого не срежет геометрией», и одинаковым
 * цветом человек прочитал бы их как одну.
 */
const SAFE_AREA_LINE = 0xffd166;
/*
 * Отступ рамки к зрителю. Рамка выделения отходит от стены на 0.045 — две
 * линии на одной глубине спорят за пиксель и обе мерцают, поэтому запас стоит
 * чуть впереди неё.
 */
const SAFE_AREA_OFFSET = 0.06;

/**
 * Рамка безопасной зоны — надстройка над переходником здания.
 *
 * Она принадлежит редактору, а не зданию: без кнопки «Safe area» её не
 * существует вовсе, и стенд окна превью, который поднимает ту же сцену без
 * редактора, про неё знать не обязан. Поэтому здание собирает
 * `mega-mall-scene.js`, а рамку добавляет этот файл — и добавляет тем же
 * способом, каким в кадр попадает всё остальное трёхмерное в мастерской: через
 * переходник сцены, у которого окно зовёт `mount`, `update` и `dispose`.
 *
 * Надстройка сделана прототипом, а не копией через `{ ...building }`: у
 * переходника есть свойство-геттер `modelRadius`, и копия сняла бы с него один
 * снимок — ноль, пока модель из игры ещё едет, — навсегда.
 */
function withSafeAreaFrame(building) {
  let ctx = null;
  let frame = null;
  /* Что показывать: `{ surfaceId, rect }` либо `null` — кнопка отжата, доли
     неизвестны, поверхности нет в профиле. Хранится здесь, потому что редактор
     успевает распорядиться рамкой до того, как окно поднимет сцену: покрытия
     едут асинхронно, и `mount` случается позже первой перерисовки. */
  let target = null;

  /**
   * Панель стены в сцене здания.
   *
   * Размеры и положение стен знает `mega-mall-scene.js` и никому их не отдаёт,
   * но саму панель он ставит в кадр и помечает `userData.surfaceId`. Читать
   * рамку с неё честнее, чем повторять здесь таблицу раскладки: копия
   * разъехалась бы с оригиналом молча — рамка осталась бы висеть по старым
   * метрам на стене, которую подвинули.
   */
  function findPanel(surfaceId = null) {
    let found = null;
    ctx?.scene?.traverse((object) => {
      const id = object.userData?.surfaceId;
      if (found || !id) return;
      if (surfaceId === null || id === surfaceId) found = object;
    });
    return found;
  }

  function place() {
    if (!frame) return;
    const panel = target ? findPanel(target.surfaceId) : null;
    const rect = target?.rect;
    /* Поверхность, которой нет в профиле, рамки не получает: долей взять
       неоткуда, а прямоугольник из воздуха соврал бы про запас, которого никто
       не мерил. */
    if (!panel || !rect) {
      if (frame.visible) {
        frame.visible = false;
        ctx?.requestRender?.();
      }
      return;
    }

    /* Метры стены снимаются с её собственной геометрии, а не из раскладки. */
    panel.geometry.computeBoundingBox();
    const box = panel.geometry.boundingBox;
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;

    const THREE = ctx.THREE;
    frame.geometry.dispose();
    /* Исходный прямоугольник нужен только затем, чтобы снять с него рёбра: в
       сцену он не попадает и жить дальше ему незачем. */
    const outline = new THREE.PlaneGeometry(
      width * rect.width,
      height * rect.height,
    );
    frame.geometry = new THREE.EdgesGeometry(outline);
    outline.dispose();

    frame.position.copy(panel.position);
    frame.rotation.copy(panel.rotation);
    /*
     * Прямоугольник задан долями поверхности, и его середина не обязана
     * совпадать с серединой стены: смещение считается по долям, а не «поля со
     * всех сторон одинаковы». Сейчас профильный запас и правда симметричен —
     * и ровно поэтому на нём оба слагаемых равны нулю и ничего не проверяют, —
     * но профиль симметрии не обещает, и на смещённом запасе рамка иначе
     * встала бы не там.
     *
     * Знак по Y обратный: в прямоугольнике ось отсчитывается сверху, как в
     * картинке, а у плоскости растёт вверх.
     */
    frame.translateX((rect.x + rect.width / 2 - 0.5) * width);
    frame.translateY(-(rect.y + rect.height / 2 - 0.5) * height);
    frame.translateZ(SAFE_AREA_OFFSET);
    frame.visible = true;
    ctx?.requestRender?.();
  }

  const adapter = Object.create(building);

  adapter.mount = (context) => {
    /* Здание встаёт первым: рамка садится на его панель, а панелей до
       `mount` переходника не существует. */
    building.mount(context);
    ctx = context;
    const THREE = context.THREE;
    frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({
        color: SAFE_AREA_LINE,
        transparent: true,
        opacity: 0.85,
        /* Запас — орган редактора, а не предмет в кадре: плёночная кривая окна
           опустила бы его в полдень вместе со всем остальным, и человек
           перестал бы видеть границу ровно тогда, когда светлее всего. Ровно
           по этой же причине идёт мимо кривой и рамка выделения. */
        toneMapped: false,
      }),
    );
    frame.name = "mega-mall-safe-area";
    frame.renderOrder = 6;
    frame.visible = false;
    /* В ту же группу, что и панели: здание сцена двигает целиком, и рамка,
       оставленная в корне сцены, отвязалась бы от стены при первом же
       переносе. Группу забирает `dispose` переходника — своё содержимое
       освобождаем сами, ниже. */
    (findPanel()?.parent || context.scene).add(frame);
    place();
  };

  adapter.dispose = () => {
    frame?.geometry?.dispose?.();
    frame?.material?.dispose?.();
    frame?.parent?.remove?.(frame);
    frame = null;
    ctx = null;
    building.dispose();
  };

  /** Показать запас выбранной поверхности. `rect === null` — рамки нет. */
  adapter.setSafeArea = (surfaceId, rect) => {
    target = rect ? { surfaceId, rect } : null;
    place();
  };

  return adapter;
}

/**
 * Кадр здания в мастерской: общее окно превью плюс то, что принадлежит
 * редактору фасадов, — выбор стены, состояние модели и рамка безопасной зоны.
 */
export default function MegaMall3DPreview({
  profileId,
  surfaceId,
  surfaces,
  previewUrls,
  timeOfDay = 12,
  onTimeOfDayChange = null,
  distance = "near",
  safeArea = false,
  onSelectSurface,
  onError = null,
  /* Настройки кадра из редактора: детализация, что показывать, цвета
     вершин, каркас. Сцена применяет их на живом кадре. */
  options = null,
  onStats = null,
  /* Счётчики-команды: каждое приращение — «навести камеру на выбранную
     стену» и «пересобрать секцию из игры». Числа, а не флаги, потому что
     одну и ту же команду дают повторно. */
  focusTick = 0,
  reloadTick = 0,
}) {
  useTr();
  const [model, setModel] = useState({ status: "loading", reason: "" });
  const statsRef = useRef(onStats);
  statsRef.current = onStats;
  /*
   * Обработчики живут в ссылках, а не в зависимостях сцены: стрелка, написанная
   * прямо в разметке, — а её напишут именно так, — пересоздавала бы переходник
   * на каждую перерисовку редактора, а вместе с ним и контекст WebGL.
   */
  const selectRef = useRef(onSelectSurface);
  selectRef.current = onSelectSurface;

  /*
   * Сцена создаётся один раз на здание. Профиль в зависимостях потому, что
   * Ашан и торговый центр — разная геометрия и разные поверхности: это другое
   * здание, а не другая настройка того же.
   */
  const scene = useMemo(
    () =>
      withSafeAreaFrame(
        createMegaMallScene({
          profileId,
          onSelect: (id) => selectRef.current?.(id),
          onModel: setModel,
          onStats: (next) => statsRef.current?.(next),
        }),
      ),
    [profileId],
  );

  useEffect(() => {
    if (options) scene.setOptions?.(options);
  }, [scene, options]);

  useEffect(() => {
    if (focusTick > 0) scene.focusSurface?.(surfaceId);
    /* Стена берётся та, что выбрана в момент команды: смена стены сама по
       себе камеру не двигает — человек мог просто листать слои. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, focusTick]);

  useEffect(() => {
    if (reloadTick > 0) scene.reload?.({ rebuild: true });
  }, [scene, reloadTick]);

  useEffect(() => {
    scene.apply({ surfaceId, previewUrls });
  }, [scene, surfaceId, previewUrls]);

  useEffect(() => {
    scene.setDistance(distance);
  }, [scene, distance]);

  /*
   * Запас берётся из профиля (`surface.safeArea`), а не считается здесь: доли
   * меряют по настоящей геометрии здания, и второй набор чисел в редакторе
   * означал бы две разных правды про одну стену.
   */
  const rect = useMemo(
    () => surfaces.find((entry) => entry.id === surfaceId)?.safeArea || null,
    [surfaces, surfaceId],
  );

  /* Статус модели — в зависимостях намеренно: когда приезжает здание из
     игры, панели переезжают на настоящие стены, и рамка обязана переехать
     за ними, а не остаться висеть на схеме. */
  useEffect(() => {
    scene.setSafeArea(surfaceId, safeArea ? rect : null);
  }, [scene, surfaceId, rect, safeArea, model.status]);

  /* Что сейчас едет из игры — все бандлы в полёте, а не первый из них:
     они читаются параллельно. */
  const pending =
    model.progress?.pending ||
    (model.progress?.stage ? [model.progress.stage] : []);
  const stage = pending.map((id) => (STAGE_LABELS[id] ? tr(STAGE_LABELS[id]) : id)).join(", ") || null;
  /* Шторка окна: во весь кадр, пока нет самого здания; мягкая — когда поверх
     готового здания доезжают соседи, пропы и подмены. */
  const loading =
    model.status === "loading"
      ? {
          title: tr("Загружаем здание из GTA V"),
          detail: stage
            ? `${tr("Читаем из установленной игры:")} ${stage}`
            : tr("Читаем геометрию и текстуры из установленной игры"),
        }
      : stage
        ? { soft: true, title: `${tr("Читаем из GTA V:")} ${stage}…` }
        : null;

  return (
    <div className="mega-mall-3d-preview" data-testid="mega-mall-3d-preview">
      <PreviewWindow
        scene={scene}
        timeOfDay={timeOfDay}
        onTimeOfDayChange={onTimeOfDayChange}
        weather="EXTRASUNNY"
        quality="auto"
        camera="orbit"
        onError={onError}
        loading={loading}
      />
      <div className="mega-mall-3d-hud">
        <span>{tr("ЛКМ по стене — выбрать")}</span>
        <span>{tr("Потяните — вращать · колесо — масштаб")}</span>
        <span
          className="mega-mall-3d-source"
          data-state={model.status}
          title={
            (MODEL_HINTS[model.status] && tr(MODEL_HINTS[model.status])) ||
            `${tr("Схематичное здание — настоящее не прочиталось.")} ${model.reason}`
          }
        >
          {model.status === "real"
            ? stage
              ? `${tr("Модель из GTA V ·")} ${stage}…`
              : tr("Модель из GTA V")
            : model.status === "loading"
              ? stage
                ? `${tr("Загрузка:")} ${stage}…`
                : tr("Загрузка модели из GTA V…")
              : tr("Схема")}
        </span>
        {safeArea ? (
          <b title={tr("Внутри рамки картинку не срежет геометрией")}>
            SAFE AREA · {surfaceId}
          </b>
        ) : null}
      </div>
      <div className="mega-mall-3d-surface-buttons">
        {surfaces.map((surface) => (
          <button
            type="button"
            key={surface.id}
            className={surface.id === surfaceId ? "is-active" : ""}
            aria-label={`${surface.kind === "sign" ? tr("Редактировать поверхность") : tr("Редактировать стену")}: ${surface.label}`}
            aria-pressed={surface.id === surfaceId}
            onClick={() => onSelectSurface?.(surface.id)}
          >
            {previewUrls[surface.id] ? (
              <img
                src={previewUrls[surface.id]}
                alt={`${tr("Предпросмотр:")} ${surface.label}`}
              />
            ) : null}
            {surface.label}
          </button>
        ))}
      </div>
    </div>
  );
}
