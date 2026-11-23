/*
 * Редактор растительности.
 *
 * Траву в игре видят с высоты роста и в движении: плотность читается по тому,
 * сколько земли просвечивает между травинками под ногами, высота — по тому, где
 * она кончается относительно колена, а разброс и ветер не читаются вовсе, пока
 * поле стоит неподвижно. Поэтому редактор открывается камерой на высоте глаз, а
 * не обзором сверху, и ветер здесь — не галочка, а два ползунка.
 *
 * Сцену рисует общее окно превью (`preview/PreviewWindow.jsx`): у него
 * рендерер, небо, солнце и туман, одни на все редакторы. Отсюда в него уезжает
 * только поле — переходником `vegetation-scene.js`.
 *
 * В ИГРУ УЕЗЖАЕТ ЧЕТЫРЕ ПОЛЗУНКА ИЗ СЕМИ
 *
 * Трава GTA V живёт таблицей `plantInfos` в `common/data/materials/
 * procedural.meta` — на живой сборке это 269 наземных записей, и густота,
 * рост, разброс и ветер лежат в них отдельными полями. Их и правит установка,
 * множителем поверх собственных чисел каждой записи: «вдвое гуще» — вдвое
 * гуще везде, а разница между лугом и пустыней остаётся. Покров, цвет и
 * дальность в игру не едут: покров — это модели внутри архивов, цвет у каждой
 * записи свой, а дальности в игре нет полем вовсе. Об этом сказано в
 * инспекторе, рядом с кнопкой, а не мелким шрифтом под кадром.
 *
 * Работа человека, как и у соседей, ложится в проект мастерской: снимок в
 * хранилище браузера, чтобы вернуться на то же место, и файл рядом — чтобы
 * унести с собой.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadSimple, FolderOpen } from "../../../ui/icons.jsx";
import { vegetationApplySupported } from "../../../../api.js";
import EditorActions from "../../../ui/EditorActions.jsx";
import EditorShell from "../../../ui/EditorShell.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import PageTabs from "../../../ui/PageTabs.jsx";
import PreviewWindow from "../preview/PreviewWindow.jsx";
import { useSkyHistory } from "../useSkyHistory.js";
import VegetationApplyDialog from "./VegetationApplyDialog.jsx";
import VegetationInspector from "./VegetationInspector.jsx";
import { createVegetationScene } from "./vegetation-scene.js";
import {
  TIME_MARKS,
  VEGETATION_CAMERAS,
  VEGETATION_RANGES,
  coverDefaults,
  createVegetationProject,
  defaultVegetationProject,
  describeVegetationProject,
  parseVegetationProject,
  serializeVegetationProject,
  vegetationProjectIsDefault,
  vegetationProjectStats,
} from "./vegetation-model.js";
import useHistoryKeys from "../../../../hooks/useHistoryKeys.js";
import { tr, useTr } from "../../../../locales/ui.js";

const STORAGE_KEY = "astral.vegetation-studio.project.v1";

const TABS = [
  { value: "cover", label: "Покров" },
  { value: "grass", label: "Трава" },
  { value: "wind", label: "Ветер" },
];

/** Какие разделы возвращает «Сбросить раздел». */
const TAB_SECTIONS = {
  cover: ["cover"],
  grass: ["grass"],
  wind: ["wind"],
};

export default function VegetationStudio({ onExit, onNotice }) {
  useTr();
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const commit = history.commit;

  const [tab, setTab] = useState("cover");
  const [assets, setAssets] = useState([]);
  const [stats, setStats] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const projectInput = useRef(null);

  /*
   * Правка с ручек в поле идёт через ссылку: сцена создаётся один раз, а
   * `commit` истории живёт в замыкании текущего рендера. Прямое замыкание
   * заморозило бы историю первого кадра — и «отменить» после жеста по стреле
   * возвращало бы не то.
   */
  const editRef = useRef(null);
  editRef.current = (values, editLabel) => {
    /* Метка жеста несёт адрес раздела: «wind:arrow» правит ветер,
       «grass:distance» и «grass:height» — траву. Чужой адрес не правит ничего:
       молча положить его в «траву» значило бы испортить проект. */
    const [section] = String(editLabel || "").split(":");
    if (section !== "wind" && section !== "grass") return;
    patch(section, values, editLabel);
  };

  /*
   * Сцена создаётся один раз. Пересоздавать её на каждой правке значило бы
   * пересобирать окно превью целиком — с потерей положения камеры и заново
   * расставленными двадцатью четырьмя тысячами травинок на каждое движение
   * ползунка.
   */
  const scene = useMemo(
    () =>
      createVegetationScene({
        onAssets: setAssets,
        onStats: setStats,
        onEdit: (values, editLabel) => editRef.current?.(values, editLabel),
      }),
    [],
  );
  useEffect(() => {
    scene.apply(project);
  }, [scene, project]);

  const patch = useCallback(
    (section, values, label) =>
      commit(
        (current) => ({
          ...current,
          [section]: { ...current[section], ...values },
        }),
        label,
      ),
    [commit],
  );

  const setView = useCallback((values) => patch("view", values, null), [patch]);

  /* Час суток гуляет чаще всего и работой не является, поэтому в историю он
     идёт одним склеенным шагом, а не тридцатью за секунду. */
  const setHour = useCallback(
    (timeOfDay) => patch("view", { timeOfDay }, "view:timeOfDay"),
    [patch],
  );

  /*
   * Смена покрова тянет за собой числа покрова.
   *
   * Степная метёлка ростом с газонную щётку — это подстриженное поле, а не
   * степь: тип покрытия здесь означает другое растение, а не другую краску.
   * Один шаг истории на всё сразу, потому что для человека это одно действие.
   */
  const setCover = useCallback(
    (kind, extra = {}) =>
      commit((current) => {
        const changed = kind !== current.cover.kind;
        return {
          ...current,
          cover: { ...current.cover, kind, ...extra },
          grass: changed
            ? { ...current.grass, ...coverDefaults(kind) }
            : current.grass,
        };
      }, null),
    [commit],
  );

  useEffect(() => {
    try {
      if (vegetationProjectIsDefault(project)) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(
        STORAGE_KEY,
        serializeVegetationProject(project),
      );
    } catch {
      /* приватный режим или переполненное хранилище работе не мешают */
    }
  }, [project]);

  useHistoryKeys(history);

  const changes = useMemo(
    () => vegetationProjectStats(project).changes,
    [project],
  );

  /*
   * В игру уезжают густота, рост, разброс и ветер, и кнопка судит по ним, а не
   * по общему счётчику правок: проект, где сдвинут лишь цвет или дальность,
   * «вставал» бы молча и не менял в игре ничего. База сравнения — штатные
   * числа ВЫБРАННОГО покрова: смена покрова сама по себе не правка, иначе один
   * щелчок по слову «Степь» делал бы всю траву карты втрое выше.
   */
  const canInstall = useMemo(() => {
    const base = coverDefaults(project.cover.kind);
    const wind = defaultVegetationProject().wind;
    return (
      project.grass.density !== base.density ||
      project.grass.height !== base.height ||
      project.grass.spread !== base.spread ||
      project.wind.strength !== wind.strength ||
      project.wind.speed !== wind.speed
    );
  }, [project]);

  const resetSection = useCallback(
    () =>
      commit((current) => {
        const base = defaultVegetationProject();
        const next = { ...current };
        for (const section of TAB_SECTIONS[tab]) next[section] = base[section];
        return next;
      }, null),
    [commit, tab],
  );

  function openProject(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    file
      .text()
      .then((raw) => {
        history.reset(parseVegetationProject(raw));
        onNotice?.(tr("Проект растительности загружен"));
      })
      .catch((error) => onNotice?.(String(error?.message || error), "error"));
  }

  function saveProject() {
    downloadBlob(
      new Blob([serializeVegetationProject(project)], {
        type: "application/json",
      }),
      `${slugify(project.name)}.astral-vegetation.json`,
    );
    onNotice?.(tr("Проект растительности сохранён"));
  }

  return (
    <EditorShell
      className="vegetation-studio"
      onBack={onExit}
      kicker={tr("Мастерская")}
      title={tr("Растительность")}
      status={describeVegetationProject(project)}
      tabs={
        <PageTabs
          className="veg-tabs"
          label={tr("Разделы растительности")}
          role="tablist"
          value={tab}
          options={TABS.map((entry) => ({ ...entry, label: tr(entry.label) }))}
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
              disabled: changes === 0,
            },
          ]}
          onMore={(action) =>
            action === "open" ? projectInput.current?.click() : saveProject()
          }
          onCancel={onExit}
          apply={
            /* В браузере кнопки установки нет вовсе, а не «есть, но не
               работает»: по нажатой кнопке судят, что мод встал. Вместо неё
               инспектор объясняет, почему установка живёт в приложении. */
            vegetationApplySupported()
              ? {
                  label: tr("Применить"),
                  disabled: !canInstall,
                  onClick: () => setApplyOpen(true),
                }
              : null
          }
        />
      }
      inspector={
        <VegetationInspector
          tab={tab}
          name={project.name}
          onName={(name) => commit((current) => ({ ...current, name }), "name")}
          onReset={resetSection}
          cover={project.cover}
          grass={project.grass}
          wind={project.wind}
          assets={assets}
          onCover={setCover}
          onGrass={(values) => patch("grass", values, label("grass", values))}
          onWind={(values) => patch("wind", values, label("wind", values))}
          installSupported={vegetationApplySupported()}
        />
      }
    >
      <input
        ref={projectInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={openProject}
      />

      {/*
        Полоса стоит над кадром, а не поверх него. Своя шкала времени у окна
        уже есть — цветная, под кадром, — и вторая, положенная сверху, накрыла
        бы её ровно там, где человек будет её искать.
      */}
      <div className="veg-view-bar">
        <SegmentedControl
          className="veg-cameras"
          label={tr("Камера")}
          size="sm"
          value={project.view.camera}
          options={VEGETATION_CAMERAS.map((entry) => ({
            ...entry,
            label: tr(entry.label),
          }))}
          onChange={(camera) => setView({ camera })}
        />
        <div className="veg-hours" role="group" aria-label={tr("Время суток")}>
          {TIME_MARKS.map((mark) => (
            <button
              key={mark.id}
              type="button"
              className={
                /* Полшага ленты, а не «плюс-минус двадцать минут»: лента крутит
                   час шагом 0.1, и порог в 0.35 подсвечивал «День» за три
                   деления до полудня — кнопка врала, что он выбран. Полшага —
                   это ровно «лента стоит на этом делении», с запасом только на
                   дробный шум. */
                Math.abs(project.view.timeOfDay - mark.hour) <
                VEGETATION_RANGES.timeOfDay.step / 2
                  ? "is-active"
                  : ""
              }
              onClick={() => setHour(mark.hour)}
            >
              {tr(mark.label)}
            </button>
          ))}
        </div>
        {/*
          Цена кадра стоит рядом с ползунком плотности, а не в консоли
          разработчика. Плотность — единственная настройка мастерской, которая
          в самом деле может положить окно, и человек имеет право видеть, во
          что обходится его выбор, до того как окно замрёт.
        */}
        {stats && (
          <p className="veg-cost" title={tr("Замер предыдущего кадра")}>
            <b>{stats.draws}</b> {tr("вызовов ·")}{" "}
            <b>{Math.round(stats.vertices / 1000)}K</b> {tr("вершин ·")}{" "}
            <b>{stats.grass.toLocaleString("ru-RU")}</b> {tr("пучков")}
          </p>
        )}
      </div>

      <PreviewWindow
        className="veg-preview"
        scene={scene}
        timeOfDay={project.view.timeOfDay}
        onTimeOfDayChange={setHour}
        weather="EXTRASUNNY"
        quality="auto"
        camera={project.view.camera}
        onError={(error) =>
          onNotice?.(
            tr("Превью не запустилось: {error}").replace(
              "{error}",
              error?.message || error,
            ),
            "error",
          )
        }
      >
        {/* Ручки видно, но что они делают — нет: у стрелы, бусины и столбика
            нет подписи в мире, и одна строка в углу кадра дешевле всплывающей
            школы. */}
        <span className="veg-gizmo-legend" aria-hidden="true">
          {tr("Стрела гонит волну травы · бусина на кольце — дальность · столбик — высота")}
        </span>
      </PreviewWindow>

      <p className="veg-hint-bar">
        {assets.length
          ? tr("Трава, листва и земля — текстуры из установленной игры.")
          : tr("Игра не подключена: трава и листва нарисованы собственной отрисовкой. Форма листа при этом своя, а не из игры.")}
      </p>

      {applyOpen && (
        <VegetationApplyDialog
          project={project}
          projectName={project.name}
          onClose={() => setApplyOpen(false)}
        />
      )}
    </EditorShell>
  );
}

/* ---------- вспомогательное ---------- */

/* История склеивает подряд идущие правки одного поля: иначе одно движение
   ползунка стоит тридцать нажатий «отменить». */
const label = (section, values) => {
  const keys = Object.keys(values);
  return keys.length === 1 ? `${section}:${keys[0]}` : null;
};

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
  String(value || "vegetation")
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "vegetation";

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return parseVegetationProject(stored);
  } catch {
    /* повреждённый снимок не должен мешать открыть редактор */
  }
  return createVegetationProject();
}
