import {
  GAME_SAFE_INSET_DEFAULT,
  GAME_SCREEN_FORMS_BY_RATIO,
  GAME_STRETCH_BEHAVIOUR,
  canvasForAspect,
  nearestScreenForm,
  screenFormByName,
  screenStretch,
  stretchContentScale,
} from "@modovik/minimap-contract";

/*
 * Экран игрока для предпросмотра — одно место на все редакторы, которые рисуют HUD на сцене
 * (мини-карта, значки и GPS, прицел, счётчики патронов и урона; ТЗ H1, 14.11.2026).
 *
 * `describeGameScreen` (контракт) говорит, какой экран у игрока. Здесь решается, в какой форме и с каким
 * растяжением его показать: форма — ручная («изменить»), иначе ближайшая форма таблицы к экрану игры, иначе 16:9.
 * Растяжение берётся из ОДНОГО переключаемого места контракта (`stretchContentScale`, `GAME_STRETCH_BEHAVIOUR`) и зависит от
 * ПОВЕРХНОСТИ: мини-карта и радар (рамка frontend.xml, `surface: "frontend"`) — «растягивается всё», измерено: кадр монитора с холстом
 * внутри, растянутым по ширине; фильмы HUD (прицел, патроны, урон, `surface: "hud"`) — «только раскладка», измерено замером H2 14.11.2026:
 * круглое остаётся круглым, кадр — холст формы игры без растяжения.
 */

/** Форма по умолчанию, пока экран игры неизвестен. */
export const DEFAULT_SCREEN_FORM = screenFormByName("16:9");

/** Формы для выбора: по возрастанию соотношения сторон, как их показывает меню. */
export const SCREEN_FORM_CHOICES = GAME_SCREEN_FORMS_BY_RATIO;

/** Ближайшая форма таблицы к экрану игры — или `null`, если экран неизвестен. */
export function gameScreenForm(info) {
  return info?.known ? nearestScreenForm(info.aspect)?.form || null : null;
}

/**
 * Ширина кадра окна в пикселях игры — мерка зума «в размер игры» (`useGameZoom`): во сколько раз экран игры больше кадра.
 * Кадр монитора (режим «растягивается всё») — вся ширина экрана игры. Кадр формы БЕЗ растяжения на растянутом экране
 * (режим «только раскладка») — высота игры × форма кадра: игра рисует его на высоте экрана, а края монитора остаются за
 * кадром (от ширины монитора зум вышел бы в `k` раз крупнее). `frameAspect` — пропорция кадра, если она не `monitorAspect` вида
 * (у сцены прицела — видимая часть сцены).
 */
export function frameGameWidth(view, frameAspect = view?.monitorAspect) {
  const height = Number(view?.gameHeight);
  if (view?.stretched && view.stretch === 1 && height > 0 && frameAspect > 0)
    return Math.round(height * frameAspect);
  return view?.gameWidth ?? null;
}

/**
 * Как показать экран игрока.
 *
 * @param {{ info?: object, chosen?: string|null, behaviour?: { mode?: string, frontend?: string }, surface?: "hud"|"frontend" }} input
 *   `info` — `describeGameScreen(...)`; `chosen` — имя формы, выбранной вручную (`"4:3"`), или `null`; `surface` — для чего кадр:
 *   `"hud"` (по умолчанию: прицел, патроны, урон) или `"frontend"` (мини-карта, значки и GPS); `behaviour` — что растягивается
 *   (по умолчанию `GAME_STRETCH_BEHAVIOUR`; параметр — для тестов обоих режимов каждого поля).
 * @returns {{
 *   form: { name: string, ratio: number, width: number, height: number },
 *   name: string, aspect: number, canvas: { width: number, height: number },
 *   source: "chosen"|"game"|"default", matchesGame: boolean, game: object|null,
 *   stretch: number, stretched: boolean, surface: string, monitorAspect: number, inset: number,
 *   gameWidth: number|null, gameHeight: number|null,
 * }}
 */
export function resolveScreenView({
  info = null,
  chosen = null,
  behaviour = GAME_STRETCH_BEHAVIOUR,
  surface = "hud",
} = {}) {
  const manual = chosen ? screenFormByName(chosen) : null;
  const game = gameScreenForm(info);
  const form = manual || game || DEFAULT_SCREEN_FORM;
  const canvas = canvasForAspect(form.ratio);
  /* Растяжение — у того, что показано как экран игры: чужую форму игра не растягивает. */
  const matchesGame = Boolean(game) && game.name === form.name;
  const screenOfGame = matchesGame
    ? { aspect: info.aspect, width: info.width, height: info.height }
    : null;
  /* `stretched` — монитор другой формы, чем игра (метка «(растянут)»); `stretch` — во сколько раз растянуто СОДЕРЖИМОЕ этой
     поверхности: в режиме «только раскладка» это 1, хотя экран растянут. */
  const stretched = screenOfGame
    ? screenStretch(screenOfGame).stretched
    : false;
  const stretch = screenOfGame
    ? stretchContentScale(screenOfGame, behaviour, surface)
    : 1;
  return {
    form,
    name: form.name,
    aspect: form.ratio,
    canvas: { width: canvas.width, height: canvas.height },
    source: manual ? "chosen" : game ? "game" : "default",
    matchesGame,
    game,
    stretch,
    stretched,
    surface,
    /* Пропорция кадра в окне: холст формы игры, растянутый по ширине на монитор (1 — без растяжения: кадр формы игры). */
    monitorAspect: (canvas.width / canvas.height) * stretch,
    inset: info?.inset ?? GAME_SAFE_INSET_DEFAULT,
    gameWidth: info?.width ?? null,
    gameHeight: info?.height ?? null,
  };
}
