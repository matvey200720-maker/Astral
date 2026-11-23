/*
 * Экран загрузки сцены FX (владелец, 24.10 вечером): при входе в предпросмотр не показываем ни прежнюю сцену редактора, ни стрельбище — стоит
 * карточка загрузки, как у арен (`StageLoader`), с настоящим счётом: сколько файлов сцены скачано из скольких (`useFxScene().progress`).
 * Когда сцена скачана и разобрана, карточку заменяет сама сцена и запускается выстрел. Сцены нет совсем (набор не выложен, CDN недоступен,
 * файлы не прошли проверку) — хозяин показывает прежнюю сцену редактора, а не карточку.
 *
 * Карточка появляется, только если загрузка дольше 140 мс: сцена из кэша встаёт без мелькания (`use-stage-load.js`).
 */
import { tr, useTr } from "../../../locales/ui.js";
import StageLoadOverlay from "../stage-loader/StageLoadOverlay.jsx";

/**
 * @param {object} props
 * @param {{ known: boolean, done: number, total: number }} props.progress — `useFxScene().progress`
 */
export default function FxSceneWait({ progress }) {
  useTr();
  return (
    <div className="fx-scene-wait" data-fx-scene-wait="">
      <StageLoadOverlay active kit="scene" dim={false} title={tr("Загружаем кадр игры…")} progress={progress.known && progress.total > 0 ? { done: progress.done, total: progress.total } : null} />
    </div>
  );
}
