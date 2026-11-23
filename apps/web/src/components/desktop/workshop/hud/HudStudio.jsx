/*
 * Редактор HUD.
 *
 * HUD рисуется поверх мира, а не в мире, поэтому трёхмерного окна здесь нет и
 * не нужно: под слоем стоит общее двумерное окно (`hud-preview/`) с живым
 * кадром игры, а сам HUD — один SVG в координатах выбранного разрешения. Тем
 * же путём тут живут прицел и мини-карта; своя подложка означала бы, что
 * читаемость проверяют на одной картинке, а получают на другой.
 *
 * ПОЧЕМУ ВЫБОР ЭКРАНА ОБЯЗАТЕЛЕН
 *
 * HUD в GTA прижат к безопасной зоне. На 21:9 зона шире ровно настолько,
 * насколько шире экран, — деньги и звёзды уезжают вправо, а мини-карта
 * остаётся там же по высоте. Редактор, показывающий только 16:9, врёт тем
 * двоим из десяти, у кого монитор другой формы, и врёт незаметно: макет
 * выглядит правильным.
 *
 * ПРО ПРИМЕНЕНИЕ В ИГРУ
 *
 * Кнопки «Применить» на весь HUD здесь нет, и это решение, а не недоделка.
 * Вид HUD в GTA V задают Scaleform-файлы внутри архивов: полосы HP и брони
 * живут в `minimap.gfx`, остальное — в `hud.gfx` и текстурах
 * `scaleform_generic.rpf`. Насколько это «дёшево тронуть», в репозитории уже
 * измерено: чтобы поменять один цвет полосы, `minimap-gfx-compiler.js`
 * разбирает ActionScript по SHA-256-закреплённой базе и подменяет ровно те
 * инструкции, которые прошли ревью.
 *
 * Та часть, у которой маршрут ЕСТЬ, ставится из редактора мини-карты:
 * положение и размер самой карты (`frontend.xml`, слот `minimap-position`) и
 * цвета полос (`minimap.gfx`). Вторая дверь к тем же файлам отсюда спорила бы
 * с первой, поэтому плашка внизу называет соседа по имени, а не притворяется,
 * что дороги нет вовсе. Для остальных элементов маршрута в реестре целей
 * (`packages/mod-targets`) не существует.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CurrencyDollar,
  Crosshair,
  DownloadSimple,
  Eye,
  EyeSlash,
  FolderOpen,
  Heart,
  MapPinLine,
  Shield,
  Star,
} from "../../../ui/icons.jsx";
import EditorActions from "../../../ui/EditorActions.jsx";
import EditorNoInstall from "../../../ui/EditorNoInstall.jsx";
import EditorShell from "../../../ui/EditorShell.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import PageTabs from "../../../ui/PageTabs.jsx";
import HudPreviewWindow from "../hud-preview/HudPreviewWindow.jsx";
import { loadMinimapField } from "../hud-preview/hud-map-field.js";
import { useSkyHistory } from "../useSkyHistory.js";
import HudInspector from "./HudInspector.jsx";
import HudLayer from "./HudLayer.jsx";
import {
  hudNudgeOffsets,
  hudOutsideSafe,
  hudWidgetRects,
} from "./hud-layout.js";
import {
  HUD_ASPECTS,
  HUD_DEFAULT_WIDGETS,
  HUD_SCREENS,
  HUD_WIDGETS,
  createHudProject,
  describeHudProject,
  hudProjectIsDefault,
  hudScreen,
  parseHudProject,
  serializeHudProject,
} from "./hud-model.js";
import useHistoryKeys from "../../../../hooks/useHistoryKeys.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
/* Свой лист — ленивый (18.10): окно эту студию не открывает. */
import "./hud-studio.css";

const STORAGE_KEY = "astral.hud-studio.project.v1";

const hudTabs = () => [
  { value: "element", label: tr("Элемент") },
  { value: "safe", label: tr("Зона") },
  { value: "demo", label: tr("Показ") },
];

const RAIL_ICONS = {
  minimap: MapPinLine,
  health: Heart,
  armor: Shield,
  wanted: Star,
  money: CurrencyDollar,
  weapon: Crosshair,
};

/*
 * Что нарисовать в элементах.
 *
 * Это не часть проекта: полное здоровье и пустой счёт — не настройка мода, а
 * положение дел в игре. Держать их в проекте значило бы, что «сохранить»
 * загорается оттого, что человек подвигал полосу здоровья, чтобы посмотреть
 * на неё в другом положении.
 */
const DEFAULT_DEMO = Object.freeze({
  health: 72,
  armor: 45,
  wanted: 2,
  money: 1284530,
  ammo: Object.freeze([30, 120]),
});

export default function HudStudio({ onExit, onNotice }) {
  useTr();
  const language = useUiLanguage();
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const commit = history.commit;

  const [tab, setTab] = useState("element");
  const [selected, setSelected] = useState(HUD_WIDGETS[0].id);
  const [demo, setDemo] = useState(DEFAULT_DEMO);
  const [field, setField] = useState(null);
  const projectInput = useRef(null);

  /*
   * Подложка мини-карты берётся один раз за открытие редактора.
   *
   * Она собирается из плиток установленной игры — это чтение архивов и
   * склейка холстом, и делать это на каждую правку ползунка нельзя: ровно так
   * тайлинг дороги однажды заливал плитку в видеопамять шестьдесят раз в
   * секунду. Здесь загрузка стоит вне пути перерисовки: пустые зависимости, и
   * ссылка отзывается на выходе.
   */
  useEffect(() => {
    let active = true;
    let loaded = null;
    void loadMinimapField().then((result) => {
      loaded = result;
      if (active) setField(result);
      else result?.revoke?.();
    });
    return () => {
      active = false;
      loaded?.revoke?.();
    };
  }, []);

  const { safe, rects } = useMemo(() => hudWidgetRects(project), [project]);
  const design = useMemo(() => {
    const screen = hudScreen(project.view.screen);
    return { width: screen.width, height: screen.height };
  }, [project.view.screen]);
  const screen = hudScreen(project.view.screen);

  const patchWidget = useCallback(
    (id, values, label) =>
      commit(
        (current) => ({
          ...current,
          widgets: {
            ...current.widgets,
            [id]: { ...current.widgets[id], ...values },
          },
        }),
        /* Одно движение ползунка — один шаг истории, а не тридцать. Метка
           называет и элемент, и поле: переход к другому полю обязан открыть
           новый шаг, иначе «отменить» вернёт заодно чужую правку. */
        label ? `${id}:${label}` : null,
      ),
    [commit],
  );

  const resetWidget = useCallback(
    (id) =>
      commit(
        (current) => ({
          ...current,
          widgets: { ...current.widgets, [id]: { ...HUD_DEFAULT_WIDGETS[id] } },
        }),
        null,
      ),
    [commit],
  );

  const setView = useCallback(
    (values) =>
      commit(
        (current) => ({ ...current, view: { ...current.view, ...values } }),
        null,
      ),
    [commit],
  );

  const setSafeInset = useCallback(
    (inset) =>
      commit((current) => ({ ...current, safeZone: { inset } }), "safe"),
    [commit],
  );

  const patchDemo = useCallback(
    (values) => setDemo((current) => ({ ...current, ...values })),
    [],
  );

  /* Снимок проекта переживает закрытие редактора. Штатный проект не пишется
     вовсе: пустая запись в хранилище — это обещание вернуть работу там, где
     работы не было. */
  useEffect(() => {
    try {
      if (hudProjectIsDefault(project)) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, serializeHudProject(project));
    } catch {
      /* приватный режим или переполненное хранилище работе не мешают */
    }
  }, [project]);

  useHistoryKeys(history);

  const selectWidget = useCallback((id) => {
    setSelected(id);
    setTab("element");
  }, []);

  /* Протяжка по кадру — та же правка, что два ползунка сдвига, и с той же
     меткой склейки: одно движение руки — один шаг «отменить». */
  const moveWidget = useCallback(
    (id, values) => patchWidget(id, values, "move"),
    [patchWidget],
  );

  /*
   * Стрелки двигают выделенный элемент на шаг ползунка, с Shift — на десять.
   *
   * Протяжка ставит элемент «примерно сюда», а последний миллиметр удобнее
   * дожимать клавишами — иначе точная подгонка возвращает человека к
   * ползункам, ради ухода от которых протяжка и появилась. Правка идёт через
   * `commit(current => …)`: текущее положение берётся из самой истории, и
   * зажатая стрелка не работает по устаревшему замыканию.
   */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.key.startsWith("Arrow")) return;
      const tag = event.target?.tagName;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
      const fast = event.shiftKey;
      event.preventDefault();
      commit((current) => {
        const widget = current.widgets[selected];
        const moved = hudNudgeOffsets(widget, event.key, fast);
        if (!moved) return current;
        return {
          ...current,
          widgets: {
            ...current.widgets,
            [selected]: { ...widget, ...moved },
          },
        };
      }, `${selected}:nudge`);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit, selected]);

  function openProject(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    file
      .text()
      .then((raw) => {
        history.reset(parseHudProject(raw));
        onNotice?.(tr("Проект HUD загружен"));
      })
      .catch((error) => onNotice?.(String(error?.message || error), "error"));
  }

  function saveProject() {
    downloadBlob(
      new Blob([serializeHudProject(project)], { type: "application/json" }),
      `${slugify(project.name)}.astral-hud.json`,
    );
    onNotice?.(tr("Проект HUD сохранён"));
  }

  const outside = hudOutsideSafe(rects[selected], safe);

  return (
    <EditorShell
      className="hud-studio"
      onBack={onExit}
      kicker={tr("Мастерская")}
      title="HUD"
      status={describeHudProject(project, language)}
      tabs={
        <PageTabs
          className="hud-tabs"
          label={tr("Разделы HUD")}
          role="tablist"
          value={tab}
          options={hudTabs()}
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
              /* Как у соседей: файл с нулём правок — не работа, а мусор в
                 загрузках, по которому потом судят, что сохранение сломано. */
              disabled: hudProjectIsDefault(project),
            },
          ]}
          onMore={(action) =>
            action === "open" ? projectInput.current?.click() : saveProject()
          }
          onCancel={onExit}
        />
      }
      rail={
        <div className="hud-rail" role="group" aria-label={tr("Элементы HUD")}>
          <span className="hud-rail-title">{tr("Элементы")}</span>
          {HUD_WIDGETS.map((item) => {
            const Icon = RAIL_ICONS[item.id];
            const widget = project.widgets[item.id];
            return (
              <div
                key={item.id}
                className={`hud-rail-row${item.id === selected ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="hud-rail-pick"
                  aria-pressed={item.id === selected}
                  onClick={() => selectWidget(item.id)}
                >
                  <Icon />
                  <span>
                    <b>{tr(item.label)}</b>
                    <small>{tr(item.hint)}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="hud-rail-eye"
                  aria-pressed={widget.visible}
                  aria-label={`${widget.visible ? tr("Скрыть") : tr("Показать")}: ${tr(item.label)}`}
                  title={widget.visible ? tr("Скрыть") : tr("Показать")}
                  onClick={() =>
                    patchWidget(
                      item.id,
                      { visible: !widget.visible },
                      "visible",
                    )
                  }
                >
                  {widget.visible ? <Eye /> : <EyeSlash />}
                </button>
              </div>
            );
          })}
        </div>
      }
      inspector={
        <HudInspector
          tab={tab}
          project={project}
          selected={selected}
          rect={rects[selected]}
          safe={safe}
          outside={outside}
          demo={demo}
          onPatchWidget={patchWidget}
          onResetWidget={resetWidget}
          onView={setView}
          onSafeInset={setSafeInset}
          onDemo={patchDemo}
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

      {/* Экран стоит над кадром: он про то, как смотреть, а не про то, что
          правят. Правки экрана в мод не уезжают и в счёт правок не идут. */}
      <div className="hud-view-bar">
        <span className="hud-view-label">{tr("Экран игры")}</span>
        <SegmentedControl
          className="hud-aspects"
          label={tr("Соотношение сторон")}
          size="sm"
          value={screen.aspect}
          options={HUD_ASPECTS.map((aspect) => ({
            value: aspect,
            label: aspect,
          }))}
          onChange={(aspect) => {
            /* Разрешение переезжает вместе с формой экрана: 3440×1440 на 16:9
               — экран, которого не бывает. */
            const next = HUD_SCREENS.find((item) => item.aspect === aspect);
            if (next) setView({ screen: next.id });
          }}
        />
        <select
          className="hud-select"
          value={screen.id}
          aria-label={tr("Разрешение")}
          onChange={(event) => setView({ screen: event.target.value })}
        >
          {HUD_SCREENS.filter((item) => item.aspect === screen.aspect).map(
            (item) => (
              <option key={item.id} value={item.id}>
                {item.width} × {item.height}
              </option>
            ),
          )}
        </select>
        {field ? (
          <span className="hud-view-field" title={field.reason || undefined}>
            {field.label}
          </span>
        ) : null}
      </div>

      <HudPreviewWindow
        className="hud-studio-preview"
        design={design}
        safeInset={project.safeZone.inset}
        showSafe={project.view.showSafe}
        frameId={project.view.frameId || null}
        onFrameChange={(frameId) => setView({ frameId })}
        onError={(error) =>
          onNotice?.(`${tr("Кадр игры не загрузился")}: ${error?.message || error}`)
        }
      >
        <HudLayer
          design={design}
          project={project}
          rects={rects}
          safe={safe}
          demo={demo}
          selected={selected}
          onSelect={selectWidget}
          onMove={moveWidget}
          field={field?.url || ""}
        />
      </HudPreviewWindow>

      {/*
        Плашка не «применения нет», а «применение живёт у соседа».

        Прежняя формулировка была категоричной и успела устареть наполовину:
        положение и размер мини-карты уезжают в игру через frontend.xml, а
        цвета полос HP и брони — через minimap.gfx, но обе двери стоят в
        редакторе мини-карты, и вторая дверь отсюда спорила бы с первой.
        Остальные элементы — hud.gfx и текстуры, маршрута для них в реестре
        целей нет, и кнопка «Применить» на весь HUD обманывала бы.
      */}
      <EditorNoInstall
        what={tr("Этот редактор правит проект: установки всего HUD в игру нет.")}
        reason={tr("Остальные элементы лежат в hud.gfx и текстурах scaleform_generic.rpf — маршрута для них в реестре целей пока нет, и кнопка «Применить» на весь HUD обманывала бы.")}
        instead={tr("Что уже умеет ехать в игру, ставится из редактора мини-карты: положение и размер самой карты (frontend.xml) и цвета полос HP и брони (minimap.gfx).")}
      />
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
  String(value || "hud")
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "hud";

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return parseHudProject(stored);
  } catch {
    /* повреждённый снимок не должен мешать открыть редактор */
  }
  return createHudProject();
}
