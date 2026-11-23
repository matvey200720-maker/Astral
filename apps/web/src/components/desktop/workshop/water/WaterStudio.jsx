/*
 * Редактор воды.
 *
 * Воду видят с уровня глаз и на скользящем взгляде: там френель максимален, и
 * там она перестаёт быть синей плоскостью — видно дорожку солнца, отражённые
 * горы и то, как бирюза отмели уходит в синь. Обзор сверху не показывает этого
 * ни при каких настройках, поэтому редактор открывается берегом, а ракурс
 * сверху стоит в списке третьим и не первым.
 *
 * И видят воду ВО ВРЕМЕНИ. Полдень отдаёт цветом толщи, закат — почти целиком
 * отражением, ночь показывает, не светится ли пена сама по себе. Поэтому часы
 * стоят рядом с ракурсом, а не спрятаны в настройках окна: настроенная в
 * полдень вода на закате бывает другой водой.
 *
 * Сцену рисует общее окно превью (`preview/PreviewWindow.jsx`): у него
 * рендерер, небо, солнце и туман, одни на все редакторы. Отсюда в него уезжает
 * только залив — переходником `water-scene.js`.
 *
 * Установки в игру здесь нет и не подразумевается, и это сказано в колонке
 * вслух. Зато оба файла, которые правит проект, собираются целиком: квады
 * `water.xml` и модификатор таймцикла. Их выгрузка стоит вплотную к честной
 * плашке — человек спрашивает «как это попадёт в игру» и тут же получает то,
 * что можно унести. Работа при этом ложится в проект мастерской тем же путём,
 * что у соседей: снимок в хранилище браузера, чтобы вернуться на то же место,
 * и файл рядом — чтобы забрать с собой.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadSimple, FolderOpen } from "../../../ui/icons.jsx";
import EditorActions from "../../../ui/EditorActions.jsx";
import EditorShell from "../../../ui/EditorShell.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import PageTabs from "../../../ui/PageTabs.jsx";
import { waterApplySupported } from "../../../../api.js";
import PreviewWindow from "../preview/PreviewWindow.jsx";
import { useSkyHistory } from "../useSkyHistory.js";
import WaterApplyDialog from "./WaterApplyDialog.jsx";
import WaterInspector from "./WaterInspector.jsx";
import { createWaterScene } from "./water-scene.js";
import {
  TIME_MARKS,
  WATER_EYES,
  buildWaterTimecycleXml,
  buildWaterXml,
  createWaterProject,
  defaultWaterProject,
  describeWaterProject,
  parseWaterProject,
  projectFromPreset,
  serializeWaterProject,
  waterProjectIsDefault,
  waterProjectStats,
} from "./water-model.js";
import useHistoryKeys from "../../../../hooks/useHistoryKeys.js";
import { tr, useTr } from "../../../../locales/ui.js";

const STORAGE_KEY = "astral.water-studio.project.v1";

/*
 * Вкладки поделены по адресу правки, а не по виду органов управления.
 *
 * «Волна» уезжает в `water.xml`, «Оптика» — в таймцикл, «Толща» не уезжает
 * никуда. Одна простыня ползунков стёрла бы эту разницу — а она здесь главная:
 * от неё зависит, найдёт человек свою правку в игре или нет.
 */
const TABS = [
  { value: "wave", label: "Волна" },
  { value: "body", label: "Толща" },
  { value: "optics", label: "Оптика" },
];

/** Какие разделы возвращает «Сбросить раздел». */
const TAB_SECTIONS = {
  wave: ["surface"],
  body: ["body", "shore"],
  optics: ["optics"],
};

export default function WaterStudio({ onExit, onNotice }) {
  useTr();
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const commit = history.commit;

  const [tab, setTab] = useState("wave");
  const [assets, setAssets] = useState([]);
  const [stats, setStats] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const projectInput = useRef(null);

  /*
   * Правка с ручек на воде идёт через ссылку: сцена создаётся один раз, а
   * `commit` истории живёт в замыкании текущего рендера. Прямое замыкание
   * заморозило бы историю первого кадра — и «отменить» после жеста по бую
   * возвращало бы не то.
   */
  const editRef = useRef(null);
  editRef.current = (values, editLabel) =>
    patch("surface", values, editLabel || label("surface", values));

  /*
   * Сцена создаётся один раз. Пересоздавать её на каждой правке значило бы
   * пересобирать окно превью целиком — с потерей положения камеры, заново
   * собранными дисками воды и берега и заново заведённым буфером отражения на
   * каждое движение ползунка.
   */
  const scene = useMemo(
    () =>
      createWaterScene({
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
   * Пресет правит поверхность, толщу и берег разом.
   *
   * Это не краска: бассейн отличается от океана не цветом, а нулевой
   * амплитудой, полным гашением и близким дном. Один шаг истории на всё сразу,
   * потому что для человека это одно действие — «сделать бассейн».
   */
  const setPreset = useCallback(
    (presetId) =>
      commit((current) => projectFromPreset(current, presetId), null),
    [commit],
  );

  useEffect(() => {
    try {
      if (waterProjectIsDefault(project)) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, serializeWaterProject(project));
    } catch {
      /* приватный режим или переполненное хранилище работе не мешают */
    }
  }, [project]);

  useHistoryKeys(history);

  const changes = useMemo(() => waterProjectStats(project).changes, [project]);

  /*
   * В игру уезжают только волна и оптика; толща живёт в окне. Кнопка установки
   * судит по этому, а не по общему счётчику правок: проект, где сдвинут лишь
   * цвет глубины, «вставал» бы молча и не менял в игре ничего.
   */
  const canInstall = useMemo(() => {
    const base = defaultWaterProject();
    return (
      JSON.stringify(project.surface) !== JSON.stringify(base.surface) ||
      JSON.stringify(project.optics) !== JSON.stringify(base.optics)
    );
  }, [project]);

  const resetSection = useCallback(
    () =>
      commit((current) => {
        const base = defaultWaterProject();
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
        history.reset(parseWaterProject(raw));
        onNotice?.(tr("Проект воды загружен"));
      })
      .catch((error) => onNotice?.(String(error?.message || error), "error"));
  }

  function saveProject() {
    downloadBlob(
      new Blob([serializeWaterProject(project)], { type: "application/json" }),
      `${slugify(project.name)}.astral-water.json`,
    );
    onNotice?.(tr("Проект воды сохранён"));
  }

  /*
   * Оба файла игры выгружаются кусками, а не «целым water.xml».
   *
   * Настоящий `water.xml` — это тысячи квадов всей карты; подменить его
   * собранным здесь значило бы стереть воду в остальном мире. Отсюда и
   * названия файлов: человек вставляет поля в свои квады, а не кладёт файл
   * поверх игрового.
   */
  function saveWaterXml() {
    downloadBlob(
      new Blob([buildWaterXml(project)], { type: "application/xml" }),
      `${slugify(project.name)}.water-quads.xml`,
    );
    onNotice?.(tr("Квады water.xml выгружены"));
  }

  function saveTimecycleXml() {
    downloadBlob(
      new Blob([buildWaterTimecycleXml(project)], { type: "application/xml" }),
      `${slugify(project.name)}.timecycle.xml`,
    );
    onNotice?.(tr("Модификатор таймцикла выгружен"));
  }

  return (
    <EditorShell
      className="water-studio"
      onBack={onExit}
      kicker={tr("Мастерская")}
      title={tr("Вода")}
      status={describeWaterProject(project)}
      tabs={
        <PageTabs
          className="water-tabs"
          label={tr("Разделы воды")}
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
            waterApplySupported()
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
        <WaterInspector
          tab={tab}
          name={project.name}
          onName={(name) => commit((current) => ({ ...current, name }), "name")}
          onReset={resetSection}
          presetId={project.presetId}
          surface={project.surface}
          body={project.body}
          shore={project.shore}
          optics={project.optics}
          onPreset={setPreset}
          onSurface={(values) =>
            patch("surface", values, label("surface", values))
          }
          onBody={(values) => patch("body", values, label("body", values))}
          onShore={(values) => patch("shore", values, label("shore", values))}
          onOptics={(values) =>
            patch("optics", values, label("optics", values))
          }
          onWaterXml={saveWaterXml}
          onTimecycleXml={saveTimecycleXml}
          installSupported={waterApplySupported()}
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
        бы её ровно там, где человек будет её искать. А на воде накладка поверх
        кадра ещё и прячет блик, то есть ровно то, ради чего сюда пришли.
      */}
      <div className="water-view-bar">
        <SegmentedControl
          className="water-eyes"
          label={tr("Ракурс")}
          size="sm"
          value={project.view.eye}
          options={WATER_EYES.map((entry) => ({
            value: entry.value,
            label: tr(entry.label),
            title: tr(entry.hint),
          }))}
          onChange={(eye) => setView({ eye })}
        />
        <div className="water-hours" role="group" aria-label={tr("Время суток")}>
          {TIME_MARKS.map((mark) => (
            <button
              key={mark.id}
              type="button"
              className={
                Math.abs(project.view.timeOfDay - mark.hour) < 0.35
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
          Цена кадра стоит рядом с ракурсом, а не в консоли разработчика.
          Отражение — единственная настройка этого редактора, которая в самом
          деле удваивает проход по сцене, и человек имеет право видеть, во что
          обходится его выбор, до того как окно начнёт отнимать кадры у игры.
        */}
        {stats && (
          <p className="water-cost" title={tr("Замер предыдущего кадра")}>
            <b>{stats.draws}</b> {tr("вызовов ·")}{" "}
            <b>{Math.round(stats.vertices / 1000)}K</b> {tr("вершин ·")}{" "}
            {stats.reflection ? (
              <>
                {tr("отражение")} <b>{stats.reflection}</b>
              </>
            ) : (
              tr("без отражения")
            )}
          </p>
        )}
      </div>

      <PreviewWindow
        className="water-preview"
        scene={scene}
        timeOfDay={project.view.timeOfDay}
        onTimeOfDayChange={setHour}
        weather="EXTRASUNNY"
        quality="auto"
        camera="orbit"
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
        {/* Ручки видно, но что они делают — нет: у буя и стрелы нет подписи в
            мире, и одна строка в углу кадра дешевле всплывающей школы. */}
        <span className="water-gizmo-legend" aria-hidden="true">
          {tr("Буй тянет уровень воды · стрела — куда и какой волной")}
        </span>
      </PreviewWindow>

      <p className="water-hint-bar">
        {assets.length
          ? tr("Песок берега — текстура из установленной игры. Блеск воде даёт шейдер, а не картинка.")
          : tr("Игра не подключена: песок берега нарисован собственной отрисовкой. Блеск воде даёт шейдер, поэтому сама вода выглядит одинаково с игрой и без неё.")}
      </p>

      {applyOpen && (
        <WaterApplyDialog
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
  String(value || "water")
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "water";

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return parseWaterProject(stored);
  } catch {
    /* повреждённый снимок не должен мешать открыть редактор */
  }
  return createWaterProject();
}
