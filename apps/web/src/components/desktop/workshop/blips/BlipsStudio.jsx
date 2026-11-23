/*
 * Редактор значков и маршрута GPS.
 *
 * Модуль «Blips и GPS» жил одними ползунками: рядом с ними стоял макет из трёх
 * прямоугольников на нарисованном радаре, и по нему нельзя было ответить на
 * единственный вопрос, ради которого значки и настраивают, — видно ли их на
 * карте и не спорят ли они друг с другом. Поэтому здесь кадр игры, настоящий
 * кусок карты из установки человека и весь набор значков сразу.
 *
 * Кадр держит общее двумерное окно (`hud-preview`), подложку читает общий
 * загрузчик плиток (`hud-map-field`) — тот же, которым живёт мини-карта. Своей
 * сцены и своего чтения архивов у редактора нет: карта у игры одна, и второе
 * мнение о том, где у неё север, никому не нужно.
 *
 * ПОЧЕМУ НЕТ КНОПКИ «ПРИМЕНИТЬ»
 *
 * Проверено по тому, чем в игру ставят соседи, а не на глаз.
 *
 * Цвет. Значки и маршрут игра красит своей палитрой интерфейса, и обращение к
 * ней сидит внутри Scaleform-ролика радара: в `minimap-gfx-compiler.js`
 * (`patchLowHealthColor`) единственный способ поменять один такой цвет —
 * найти в байт-коде ActionScript вызов, который тянет цвет из палитры, и
 * заменить его литералом RGB, уложившись байт в байт в тот же блок. Это
 * делается для одного заранее отсмотренного места на отсмотренном ролике, а не
 * «для любого цвета».
 *
 * Значки. Сами картинки лежат текстурами в архивах игры, как плитки карты
 * (`minimap_*.ytd`), и меняются тем же путём, что у большой карты: собрать
 * патч архива и поставить его нативным движком (`install-rpf-patch`,
 * ArchiveFix, точка отката). Это отдельный модуль на стороне приложения и своя
 * пара каналов моста; наружу мост (`preload.cjs`) из карты отдаёт только
 * чтение плиток и применение мини-карты и большой карты — до значков там
 * ничего нет.
 *
 * Ни то, ни другое не дёшево и не делается из веб-части. Кнопка, которая
 * ничего не делает, хуже её отсутствия, поэтому её здесь нет, а вместо неё под
 * кадром сказано прямо: пока это просмотр и проект.
 *
 * Работа лежит там же, где у соседей: снимок в хранилище браузера, чтобы
 * вернуться на то же место, и файл рядом — чтобы унести с собой.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadSimple,
  Eye,
  EyeSlash,
  FolderOpen,
  MagnifyingGlassPlus,
  MapTrifold,
} from "../../../ui/icons.jsx";
import EditorActions from "../../../ui/EditorActions.jsx";
import EditorNoInstall from "../../../ui/EditorNoInstall.jsx";
import EditorShell from "../../../ui/EditorShell.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import PageTabs from "../../../ui/PageTabs.jsx";
import Slider from "../../../ui/Slider.jsx";
import HudPreviewWindow from "../hud-preview/HudPreviewWindow.jsx";
import { HUD_DEFAULT_DESIGN } from "../hud-preview/hud-frame.js";
import GameScreenFrame from "../../../../features/workshop/game-screen/GameScreenFrame.jsx";
import GameScreenLine from "../../../../features/workshop/game-screen/GameScreenLine.jsx";
import { resolveScreenView } from "../../../../features/workshop/game-screen/game-screen-view.js";
import { useGameScreenInfo } from "../../../../features/workshop/game-screen/useGameScreen.js";
import {
  MINIMAP_FIELD_TILE_GAME,
  loadMinimapField,
} from "../hud-preview/hud-map-field.js";
import { useSkyHistory } from "../useSkyHistory.js";
import BlipArt from "./BlipArt.jsx";
import BlipsInspector from "./BlipsInspector.jsx";
import BlipsRadar from "./BlipsRadar.jsx";
import {
  BLIP_KINDS,
  hexLuminance,
  createBlipsProject,
  defaultBlipsProject,
  describeBlipsProject,
  parseBlipsProject,
  serializeBlipsProject,
  blipsProjectIsDefault,
  blipsProjectStats,
} from "./blips-model.js";
import {
  BLIP_SCENES,
  DEFAULT_SCENE,
  DEFAULT_ZOOM,
  RADAR_ZOOMS,
  atlasPoint,
  blipScene,
  fieldAligned,
  radarPlacement,
  radarView,
} from "./blips-scene.js";
import {
  blipContrast,
  contrastVerdict,
  probeLuminance,
  sampleMapField,
} from "./blips-contrast.js";
import useHistoryKeys from "../../../../hooks/useHistoryKeys.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { fill } from "./blips-lang.js";
/* Свой лист — ленивый (18.10): окно эту студию не открывает. */
import "./blips-studio.css";

const STORAGE_KEY = "astral.blips-studio.project.v1";

const TABS = [
  { value: "blips", label: "Значки" },
  { value: "route", label: "Маршрут" },
];

/** Сколько точек каждого типа стоит на каждом месте. Места не меняются. */
const SCENE_COUNTS = new Map(
  BLIP_SCENES.map((scene) => [
    scene.id,
    scene.blips.reduce((counts, blip) => {
      counts[blip.kind] = (counts[blip.kind] || 0) + 1;
      return counts;
    }, {}),
  ]),
);

/*
 * Курс — обычное состояние React, а не CSS-переменная в обход раскладки.
 *
 * Соблазн держать его вне пересчёта понятен, но прижать значок к настоящему
 * краю радара можно только ПОСЛЕ поворота: край у повёрнутой карты остаётся
 * прямоугольным. Пересчёт стоит десяток точек и пять узлов маршрута на кадр —
 * меньше, чем перерисовка тех же значков, которая при повороте всё равно
 * обязана произойти.
 */
const HEADING_RANGE = { min: 0, max: 359, step: 1 };

/** Радар в пикселях холста высотой 1080 — они не зависят от формы экрана. Нужен, чтобы перевести значок в доли атласа. */
const RADAR_RECT = radarPlacement({ design: HUD_DEFAULT_DESIGN });

export default function BlipsStudio({ onExit, onNotice }) {
  useTr();
  const language = useUiLanguage();
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const commit = history.commit;

  const [tab, setTab] = useState("blips");
  /* Что правят сейчас. Тип, а не отдельный значок: в игре настройка живёт у
     типа, и «покрасить вон ту заправку» — настройка, которой не существует. */
  const [selected, setSelected] = useState("shop");
  /* Взгляд, а не работа: убранные со сцены типы, масштаб куска карты и лупа в
     проект не попадают и «Сохранить» не зажигают. */
  const [hidden, setHidden] = useState([]);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [place, setPlace] = useState(DEFAULT_SCENE);
  const [heading, setHeading] = useState(0);
  /* Лупа включена сразу. Радар настоящего размера — это две сотни точек в углу
     кадра, и значки в нём читаются цветными квадратиками, а не значками: то
     есть ровно тот вопрос, ради которого редактор открывают, на нём и не
     решается. Врать при этом не приходится — лупа растит радар вместе со
     значками, пропорции остаются игровыми, и выключается она одной кнопкой. */
  const [magnified, setMagnified] = useState(true);
  const [frameId, setFrameId] = useState(null);
  /* Экран игрока (ТЗ H1, 14.11.2026): форма и безопасная зона — как у мини-карты; «изменить» меняет только предпросмотр. */
  const { info: screenInfo } = useGameScreenInfo();
  const [chosenForm, setChosenForm] = useState(null);
  const screenView = useMemo(
    () =>
      resolveScreenView({
        info: screenInfo,
        chosen: chosenForm,
        surface: "frontend",
      }),
    [screenInfo, chosenForm],
  );
  const screenDesign = useMemo(
    () => ({
      width: screenView.canvas.width,
      height: screenView.canvas.height,
    }),
    [screenView.canvas.width, screenView.canvas.height],
  );
  const [field, setField] = useState(null);
  const [probe, setProbe] = useState(null);
  const projectInput = useRef(null);

  /*
   * Подложка ищется один раз на открытие редактора: чтение архивов игры стоит
   * секунды, а от настроек не зависит вовсе. Дальше слой рисуется поверх уже
   * собранного кадра, и ни одно движение ползунка к архивам не возвращается.
   *
   * Плитка берётся заводская, а не та, что хватает подложке размером с ладонь:
   * радар показывает поперёк себя меньше двух километров мира, и на мелкой
   * плитке карта под значками мылится ровно там, где по ней и работают.
   * Просить её отдельно, а не поднимать умолчание, приходится потому, что
   * платят за неё вчетверо большей текстурой, а мини-карте и HUD она не нужна.
   * Значение постоянное и в зависимостях эффекта не участвует — иначе «крупнее»
   * означало бы перечитывание архивов.
   */
  useEffect(() => {
    let active = true;
    let loaded = null;
    loadMinimapField({ tile: MINIMAP_FIELD_TILE_GAME }).then((result) => {
      if (!active) {
        result.revoke();
        return;
      }
      loaded = result;
      setField(result);
    });
    return () => {
      active = false;
      loaded?.revoke();
    };
  }, []);

  useEffect(() => {
    try {
      if (blipsProjectIsDefault(project) && project.name === "Мои значки") {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, serializeBlipsProject(project));
    } catch {
      /* приватный режим или переполненное хранилище работе не мешают */
    }
  }, [project]);

  useHistoryKeys(history);

  /* История склеивает подряд идущие правки одного поля: иначе одно движение
     ползунка стоит тридцать нажатий «отменить». */
  const patchKind = useCallback(
    (values) => {
      const keys = Object.keys(values);
      commit(
        (current) => ({
          ...current,
          kinds: {
            ...current.kinds,
            [selected]: { ...current.kinds[selected], ...values },
          },
        }),
        keys.length === 1 ? `kind:${selected}:${keys[0]}` : null,
      );
    },
    [commit, selected],
  );

  const patchRoute = useCallback(
    (values) => {
      const keys = Object.keys(values);
      commit(
        (current) => ({ ...current, route: { ...current.route, ...values } }),
        keys.length === 1 ? `route:${keys[0]}` : null,
      );
    },
    [commit],
  );

  const resetSection = useCallback(
    () =>
      commit((current) => {
        const base = defaultBlipsProject();
        if (tab === "route") return { ...current, route: base.route };
        return {
          ...current,
          kinds: { ...current.kinds, [selected]: base.kinds[selected] },
        };
      }, null),
    [commit, tab, selected],
  );

  /*
   * Проба подложки для расчёта контраста.
   *
   * Снимается один раз с уменьшенной копии и живёт, пока живёт подложка: сам
   * атлас заводской плиткой — около ста мегабайт живых точек, и держать его
   * ради замеров значило бы утроить память вкладки. Отказ (нет подложки, нет
   * двумерного контекста, картинка не прочиталась) — нормальный ответ: тогда
   * чисел просто нет, а редактор работает.
   */
  useEffect(() => {
    if (!field?.url || !fieldAligned(field)) {
      setProbe(null);
      return undefined;
    }
    let active = true;
    sampleMapField(field).then((sampled) => {
      if (active) setProbe(sampled);
    });
    return () => {
      active = false;
    };
  }, [field]);

  const stats = useMemo(() => blipsProjectStats(project), [project]);
  const metres = useMemo(
    () =>
      (RADAR_ZOOMS.find((item) => item.id === zoom) || RADAR_ZOOMS[1]).metres,
    [zoom],
  );
  const aligned = fieldAligned(field);
  const scene = blipScene(place);
  const counts = SCENE_COUNTS.get(scene.id) || {};

  /*
   * Контраст выбранного типа с картой под ним.
   *
   * Берётся худшая из точек этого типа на сцене, а не средняя: набор
   * настраивают по тому месту, где значок теряется, а среднее ровно это место и
   * прячет. Поворот в расчёт не входит — под значком та же карта, как её ни
   * крути, — поэтому протяжка курса эту работу не будит.
   */
  const contrast = useMemo(() => {
    const style = project.kinds[selected];
    if (!probe)
      return {
        ratio: null,
        reason: aligned
          ? tr("Контраст считается, когда подложка прочитана.")
          : tr(
              "Под значками рисунок: контраст с настоящей картой по нему не посчитать.",
            ),
      };
    const view = radarView({ centre: scene.centre, metres });
    /* Радиус пробы — половина значка, переведённая из точек экрана в доли
       атласа через тот же кусок карты, который лежит под радаром. По каждой
       оси свой: доли атласа по горизонтали и вертикали разной длины в метрах,
       и один радиус на обе оси растянул бы кружок под значком в эллипс. */
    const radius = (style.size / 2 / RADAR_RECT.width) * view.du;
    const radiusV = (style.size / 2 / RADAR_RECT.height) * view.dv;
    const ink = hexLuminance(style.color);
    const edgeInk = hexLuminance(style.outlineColor);
    let worst = null;
    for (const item of scene.blips) {
      if (item.kind !== selected) continue;
      const spot = atlasPoint(item);
      const map = probeLuminance(probe, spot.u, spot.v, radius, radiusV);
      const ratio = blipContrast({
        luminance: ink,
        map,
        opacity: style.opacity,
        /* Обводка и размер — в одних единицах (пиксели макета), поэтому их
           отношение и есть доля канта, каким бы ни был масштаб окна. */
        outline: style.outline,
        size: style.size,
        outlineLuminance: edgeInk,
      });
      if (ratio !== null && (worst === null || ratio < worst)) worst = ratio;
    }
    return worst === null
      ? { ratio: null, reason: tr("Значков этого типа на месте нет.") }
      : { ratio: worst, verdict: contrastVerdict(worst) };
    /* Язык — зависимость: подписи причин переводятся внутри расчёта. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe, aligned, project.kinds, selected, scene, metres, language]);

  function openProject(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    file
      .text()
      .then((raw) => {
        history.reset(parseBlipsProject(raw));
        onNotice?.(tr("Проект значков загружен"));
      })
      .catch((error) => onNotice?.(String(error?.message || error), "error"));
  }

  function saveProject() {
    downloadBlob(
      new Blob([serializeBlipsProject(project)], { type: "application/json" }),
      `${slugify(project.name)}.astral-blips.json`,
    );
    onNotice?.(tr("Проект значков сохранён"));
  }

  return (
    <EditorShell
      className="blips-studio"
      onBack={onExit}
      kicker={tr("Мастерская")}
      title={tr("Значки и GPS")}
      status={describeBlipsProject(project)}
      tabs={
        <PageTabs
          className="blips-tabs"
          label={tr("Разделы значков")}
          role="tablist"
          value={tab}
          options={TABS.map((item) => ({ ...item, label: tr(item.label) }))}
          onChange={setTab}
        />
      }
      actions={
        <EditorActions
          onUndo={history.undo}
          canUndo={history.canUndo}
          onRedo={history.redo}
          canRedo={history.canRedo}
          more={[
            {
              value: "open",
              label: tr("Открыть проект"),
              icon: <FolderOpen />,
            },
            {
              value: "save",
              label: tr("Сохранить проект"),
              icon: <DownloadSimple />,
              disabled: stats.changes === 0,
            },
          ]}
          onMore={(action) =>
            action === "open" ? projectInput.current?.click() : saveProject()
          }
          onCancel={onExit}
        />
      }
      rail={
        <>
          <span className="blips-rail-title">{tr("Типы значков")}</span>
          {/*
            Список — то, из чего выбирают: он меняет предмет работы, а не
            правит его. Глаз рядом убирает тип со сцены: набор проверяют
            вместе, и единственный способ понять, мешает ли зелёный магазин
            жёлтому заданию, — убрать магазины и посмотреть ещё раз.
          */}
          {BLIP_KINDS.map((kind) => {
            const style = project.kinds[kind.id];
            const off = hidden.includes(kind.id);
            return (
              <div
                key={kind.id}
                className={`blips-rail-row${kind.id === selected ? " is-active" : ""}${off ? " is-off" : ""}`}
              >
                <button
                  type="button"
                  className="blips-rail-pick"
                  aria-pressed={kind.id === selected}
                  onClick={() => setSelected(kind.id)}
                >
                  {/* Тот же рисунок, что в кадре: форма, обводка, силуэт и
                      прозрачность — свои. Два изображения одного значка,
                      нарисованные разным кодом, всегда однажды расходятся.
                      Размер сюда идёт СВОЙ, а показывается свотч в постоянной
                      коробке: размер — это делитель, которым обводка
                      переводится в единицы рисунка, и значок в 12 точек с
                      обводкой 3 иначе показывался бы значком в 26 с той же
                      обводкой, то есть вчетверо тоньше окантованным. */}
                  <i>
                    <BlipArt style={style} size={style.size} box={26} />
                  </i>
                  <b>{tr(kind.label)}</b>
                  <small>
                    {counts[kind.id] || 0} {tr("на сцене")}
                  </small>
                </button>
                <button
                  type="button"
                  className="blips-rail-eye"
                  aria-pressed={!off}
                  aria-label={
                    off
                      ? fill(tr("Показать: {name}"), { name: tr(kind.label) })
                      : fill(tr("Скрыть со сцены: {name}"), {
                          name: tr(kind.label),
                        })
                  }
                  title={off ? tr("Показать на сцене") : tr("Убрать со сцены")}
                  onClick={() =>
                    setHidden((current) =>
                      current.includes(kind.id)
                        ? current.filter((id) => id !== kind.id)
                        : [...current, kind.id],
                    )
                  }
                >
                  {off ? <EyeSlash /> : <Eye />}
                </button>
              </div>
            );
          })}
        </>
      }
      inspector={
        <>
          <EditorNoInstall
            what={tr(
              "Значки правятся в проекте: в игру отсюда пока не ставятся.",
            )}
            reason={tr(
              "Цвет значка и маршрута игра берёт из своей палитры интерфейса внутри minimap.gfx, а сами значки — спрайты в текстурных архивах. И то, и другое меняется только разбором Scaleform и пересборкой архива игры.",
            )}
            instead={tr(
              "Работа живёт в проекте: «Ещё» → «Сохранить проект» унесёт её файлом, и открытый проект вернётся на то же место.",
            )}
          />
          <BlipsInspector
            tab={tab}
            name={project.name}
            onName={(name) =>
              commit((current) => ({ ...current, name }), "name")
            }
            onReset={resetSection}
            selected={selected}
            project={project}
            contrast={contrast}
            onKind={patchKind}
            onRoute={patchRoute}
          />
        </>
      }
    >
      <input
        ref={projectInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={openProject}
      />

      {/* Полоса стоит над кадром, а не поверх него: выбор кадра окно рисует
          само, в своём углу, и вторая плашка сверху накрыла бы его. */}
      <div className="blips-view-bar">
        {/* Мест три, и выбраны они по цвету подложки, а не по красоте: на одном
            тёмном квартале даунтауна белого игрока и зелёный магазин проверить
            физически негде. */}
        <SegmentedControl
          className="blips-places"
          label={tr("Где стоим")}
          size="sm"
          value={place}
          options={BLIP_SCENES.map((item) => ({
            value: item.id,
            label: tr(item.label),
          }))}
          onChange={setPlace}
        />
        <SegmentedControl
          className="blips-zooms"
          label={tr("Кусок карты")}
          size="sm"
          value={zoom}
          options={RADAR_ZOOMS.map((item) => ({
            value: item.id,
            label: tr(item.label),
          }))}
          onChange={setZoom}
        />
        <output className="blips-metres">
          {metres} {tr("м поперёк радара")}
        </output>
        <button
          type="button"
          className={`blips-magnify${magnified ? " is-active" : ""}`}
          aria-pressed={magnified}
          title={tr("Увеличить радар вместе со значками")}
          onClick={() => setMagnified((value) => !value)}
        >
          <MagnifyingGlassPlus />
          <span>{tr("Крупно")}</span>
        </button>
        {/* На что человек смотрит: на карту из своей игры или на рисунок.
            Молча подменять одно другим нельзя — тогда «вижу, значит так и
            будет» перестаёт работать ровно у тех, у кого игры нет. */}
        <b className="blips-field-source" title={field?.reason || undefined}>
          <MapTrifold />
          {field ? field.label : tr("Ищем карту в игре…")}
        </b>
        {/* Курс отдельной строкой: в игре радар повёрнут по направлению
            взгляда, и север-вверх — единственное положение, в котором он
            никогда не бывает. Ползунок стоит здесь, а не в инспекторе, потому
            что курс — взгляд, а не работа: в проект он не попадает. */}
        <GameScreenLine
          className="blips-screen-line"
          info={screenInfo}
          chosen={chosenForm}
          onChange={setChosenForm}
        />
        <Slider
          className="blips-heading"
          label={tr("Курс")}
          hint={tr("радар повёрнут, как в игре")}
          value={heading}
          {...HEADING_RANGE}
          unit="°"
          onChange={setHeading}
        />
      </div>

      {/* Система координат слоя — холст формы экрана игрока высотой 1080: размеры значков и
          толщина маршрута заданы пикселями экрана 1080p. Коробка берётся из памяти
          (`screenDesign`), а не пишется здесь литералом: новый объект на каждую
          перерисовку пересчитывал бы всю геометрию окна и раскладку сцены. Растянутый
          экран — кадр монитора с холстом внутри (`GameScreenFrame`). */}
      <GameScreenFrame view={screenView}>
        <HudPreviewWindow
          className="blips-window"
          design={screenDesign}
          safeInset={screenView.inset}
          stretch={screenView.stretch}
          frameId={frameId}
          onFrameChange={setFrameId}
        >
          {(geometry) => (
            <BlipsRadar
              geometry={geometry}
              project={project}
              field={field}
              metres={metres}
              magnified={magnified}
              hidden={hidden}
              place={place}
              heading={heading}
              inset={screenView.inset}
            />
          )}
        </HudPreviewWindow>
      </GameScreenFrame>

      <p className="blips-hint-bar">
        {aligned
          ? tr(
              "Значки стоят по мировым координатам игры: заправки — на настоящих заправках, маршрут идёт по кварталам центра.",
            )
          : tr(
              "Под значками рисованная подложка: расстояния между ними верные, а кварталы под ними — нет. С установленной игрой сюда встанут плитки её карты.",
            )}
      </p>
    </EditorShell>
  );
}

/* ---------- вспомогательное ---------- */

/* Своя выгрузка вместо общей из `workshop-export.js`: та тянет за собой весь
   модуль проектов мастерской, а редактор грузится отдельным куском. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const slugify = (value) =>
  String(value || "blips")
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "blips";

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return parseBlipsProject(stored);
  } catch {
    /* повреждённый снимок не должен мешать открыть редактор */
  }
  return createBlipsProject();
}
