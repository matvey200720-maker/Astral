import {
  MINIMAP_PLACEMENT_LIMITS,
  canvasForAspect,
  describeGameScreen,
  minimapInstallPlan,
  normalizeScreenResolution,
  screenFormByName,
} from "@modovik/minimap-contract";
import {
  MINIMAP_FRONTEND_STOCK,
  isStockMinimapPlacement,
  minimapPreviewScreen,
} from "../../../components/desktop/workshop/minimap-layout.js";
import { gameScreenForm } from "./game-screen-view.js";

/*
 * Форма окна предпросмотра мини-карты (`targetViewport`) и экран игры (ТЗ H1, 14.11.2026).
 *
 * Установка считает «из» — форма окна (`targetViewport.aspect`), «в» — экран игры (`minimapPlacementForGame`), поэтому форма
 * окна ОБЯЗАНА быть той, под которой человек двигал рамку. Новая работа и работа, где форму не выбирали, берут её из экрана
 * игры (`source: "detected"`); ручной выбор (`source: "manual"`) остаётся как есть.
 *
 * Смена формы в окне считается ТЕМ ЖЕ расчётом, что установка (`minimapInstallPlan`, пределы ползунков окна): кадр держит
 * ту же долю экрана — место и размер. Поэтому работа, открытая под формой игры и принятая без правок, ставится «из формы
 * игры в форму игры» и даёт ровно тот кадр, что показан.
 */

/**
 * Идёт ли форма окна за экраном игры: форму сам человек не выбирал.
 *
 *  • «В игре у меня как здесь» (`gameAspect: "screen"`) — выбор человека: за игрой не идём.
 *  • `source: "detected"` — форму до этого брали из игры.
 *  • Новая работа: контракт отдаёт ей `source: "manual"` и 16:9 по умолчанию. Пока карта стоит на штатном месте, под этой формой
 *    ничего не двигали — менять форму не страшно. Как только человек сдвинул карту, 16:9 — его явный выбор.
 */
export function viewportFollowsGame(config) {
  const viewport = config?.targetViewport || {};
  if (viewport.gameAspect === "screen") return false;
  if (viewport.source === "detected") return true;
  return (
    viewport.aspect === "16:9" && isStockMinimapPlacement(config?.layout?.map)
  );
}

/**
 * Что даст смена формы окна на `name`: расчёт установки из формы работы в форму `name` с пределами окна.
 * `keeps` — кадр удержал свою долю экрана в пределах ползунков (зажимов нет); нет — число упёрлось в предел, и честно
 * удержать нельзя: работа остаётся под своей формой, а установка пересчитает сама (там пределы шире).
 *
 * @returns {{ form: object, plan: object, keeps: boolean } | null} `null` — формы с таким именем нет.
 */
export function minimapScreenFormPlan(config, name, { inset } = {}) {
  const form = screenFormByName(name);
  if (!form) return null;
  const withInset = { ...config, gameScreen: { inset } };
  const plan = minimapInstallPlan(config.layout.map, {
    from: minimapPreviewScreen(withInset),
    to: minimapPreviewScreen({
      ...withInset,
      targetViewport: { aspect: form.name },
    }),
    stock: MINIMAP_FRONTEND_STOCK,
    limits: MINIMAP_PLACEMENT_LIMITS,
  });
  return { form, plan, keeps: plan.clamps.length === 0 };
}

/** Форма окна `form` в проекте: имя, холст формы и источник. */
function withViewport(config, form, source) {
  const canvas = canvasForAspect(form.ratio);
  return {
    ...config.targetViewport,
    source,
    aspect: form.name,
    renderWidth: canvas.width,
    renderHeight: canvas.height,
  };
}

/**
 * Проект мини-карты, показанный под формой `name`: форма, холст и источник («detected» — из игры, «manual» — выбор человека).
 * Кадр держит свою долю экрана — место и размер — тем же расчётом, что установка (`minimapScreenFormPlan`): те же числа на
 * 4:3 шире и уезжают вправо, а установка пересчитывает их из формы работы в форму игры.
 *
 * `auto: true` — шаг сам, без человека (форма пришла из игры): он не делается, если долю не удержать в пределах окна
 * (проект возвращается как был: работа остаётся под своей формой, установка пересчитает сама). Ручной выбор делается всегда:
 * кадр упрётся в предел на глазах у человека.
 */
export function minimapWithScreenForm(
  config,
  name,
  { inset, source = "manual", auto = false } = {},
) {
  const planned = minimapScreenFormPlan(config, name, { inset });
  if (!planned) return config;
  if (auto && !planned.keeps) return config;
  return {
    ...config,
    targetViewport: withViewport(config, planned.form, source),
    layout: { ...config.layout, map: planned.plan.placement },
  };
}

/**
 * Проект, как его видит окно: работа на штатном месте, форму которой не выбирали, показана под формой игры — но только
 * как вид. В проект и историю форма не пишется (пока человек ничего не правит): «Применить» уже применённой работы
 * не оживает, а то, что человек поправит, сохранится уже под показанной формой. Штатное место от формы не зависит,
 * двигать здесь нечего.
 */
export function minimapShownConfig(config, info) {
  const game = gameScreenForm(info);
  if (
    !game ||
    game.name === config?.targetViewport?.aspect ||
    !viewportFollowsGame(config) ||
    !isStockMinimapPlacement(config?.layout?.map)
  )
    return config;
  return {
    ...config,
    targetViewport: withViewport(config, game, "detected"),
  };
}

/*
 * «Разрешение игры» (22.11.2026, владелец: «чтобы ты мог разрешение своё ставить… любое разрешение плюс формат»).
 *
 * Разрешение монитора, которое человек указал сам, лежит в проекте (`targetViewport.monitor`) и ведёт предпросмотр: растяжение и зум «в размер
 * игры». Формат — это форма окна (`targetViewport.aspect`), одна из девяти таблицы контракта; растянутым экран считается, когда разрешение другой формы
 * (4:3 на 1920×1080). Места на экране считаются в долях формы, и разрешение на них не влияет, поэтому в фильм мини-карты поле не попадает.
 * Явный выбор разрешения или формата ведёт и установку: он пишет `gameAspect: "screen"` («в игре у меня как здесь»), и установка считает положение
 * под выбранный формат, а не под найденный в настройках игры (`frontendPlacement`). «Как в игре» убирает и поле, и признак — читается настоящий экран.
 */

/**
 * Экран игры для окна: указанное человеком разрешение (с форматом проекта), иначе — как прочитала игра.
 * Безопасная зона берётся у игры: разрешение её не меняет.
 */
export function projectScreenInfo(config, info) {
  const monitor = normalizeScreenResolution(config?.targetViewport?.monitor);
  const form = screenFormByName(config?.targetViewport?.aspect);
  if (!monitor || !form) return info;
  return describeGameScreen({
    known: true,
    aspect: form.ratio,
    width: monitor.width,
    height: monitor.height,
    inset: info?.inset,
    safeZoneStep: info?.safeZoneStep,
    sources: { aspect: "project", inset: info?.sources?.inset },
  });
}

/**
 * Проект с указанным разрешением монитора и форматом `formName` (имя формы таблицы; нет — формат остаётся). Смена формата считается тем же расчётом,
 * что и выбор формы в окне (кадр держит свою долю экрана); само разрешение только записывается.
 */
export function minimapWithMonitor(config, monitor, formName, { inset } = {}) {
  const resolution = normalizeScreenResolution(monitor);
  if (!resolution) return config;
  const shaped =
    formName && formName !== config?.targetViewport?.aspect
      ? minimapWithScreenForm(config, formName, { inset, source: "manual" })
      : config;
  /* Человек выбрал разрешение или формат сам — установка считает под выбранный формат, а не под найденный в настройках игры:
     это тот же признак «в игре у меня как здесь» (`gameAspect: "screen"`), который уже читают `frontendPlacement` и `minimapSceneExtentFor`. */
  return {
    ...shaped,
    targetViewport: {
      ...shaped.targetViewport,
      source: "manual",
      gameAspect: "screen",
      monitor: resolution,
    },
  };
}

/** Проект «как в игре»: ни своего разрешения, ни признака «в игре у меня как здесь» — экран снова читается из настроек игры. */
export function minimapWithoutMonitor(config) {
  const {
    monitor: _dropped,
    gameAspect: _droppedAspect,
    ...viewport
  } = config?.targetViewport || {};
  return { ...config, targetViewport: viewport };
}
