import React from "react";
import { Cube } from "../../ui/icons.jsx";
import { modModelUrl } from "../catalog/ModModelPreview.jsx";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { colourModelAvailable, useColourCaption, useColourModel } from "../../../features/clothing/colour-model.js";
import { firstColourLetter } from "../../../features/clothing/colour-mapping.js";

const WeaponModelViewer = React.lazy(() => import("../../../WeaponModelViewer.jsx"));

/*
 * Вещь мода в 3D слева в окне «Установить» (владелец, 25.10.2026, образец «Сделать заменёнку»): крутится и приближается прямо здесь.
 * Модель — GLB витрины мода (`mod.model`); нет её — обложка. Просмотрщик тот же, что у карточки (`WeaponModelViewer`), и грузится
 * ленивым куском, когда окно открылось.
 */
export default function ModelPane({ mod, cover = "", colour = "", pad = null }) {
  useTr();
  const language = useUiLanguage();
  const hosted = modModelUrl(mod);
  /* Выбранный цвет мода (28.10.2026): модель витрины нарисована первым цветом, другие цвета Desktop собирает из пакета (`colour-model.js`). Пока цвет едет —
     прежняя модель и тихое «Меняю цвет…», выданной за выбранный она не называется. */
  const picked = colour && colour !== firstColourLetter(mod) && colourModelAvailable(mod, colour) ? colour : "";
  const tinted = useColourModel(mod, picked, Boolean(picked));
  const model = picked ? tinted.url || hosted : hosted;
  const caption = useColourCaption({ tinted, picked, shown: model });
  if (!model)
    return (
      <div className="clothing-model-pane is-flat">
        {cover ? <img src={cover} alt="" /> : <Cube aria-hidden="true" />}
      </div>
    );
  return (
    <div className="clothing-model-pane">
      {caption.text && (
        <p className="clothing-model-note" role="status">
          {caption.text}
        </p>
      )}
      <React.Suspense
        fallback={
          <div className="clothing-model-loading" aria-live="polite">
            <Cube aria-hidden="true" />
            <span>{tr("Загружаем модель")}</span>
          </div>
        }
      >
        <WeaponModelViewer key={model} embedded modelUrl={model} fallbackModelUrl={model !== hosted ? hosted : undefined} onShown={caption.shownBy(model)} previewUrl={cover} title={mod.name} language={language} kind="clothing" pad={pad} />
      </React.Suspense>
    </div>
  );
}
