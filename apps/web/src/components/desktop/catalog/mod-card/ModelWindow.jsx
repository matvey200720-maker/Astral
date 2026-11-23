import React from "react";
import { X } from "../../../ui/icons.jsx";
import ModWait from "../../../ui/light/ModWait.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { useOnModel } from "../../../../features/catalog/clothing-on-model.js";
import { useColourCaption, useColourModel } from "../../../../features/clothing/colour-model.js";
import { firstColourLetter } from "../../../../features/clothing/colour-mapping.js";

const WeaponModelViewer = React.lazy(
  () => import("../../../../WeaponModelViewer.jsx"),
);

/*
 * Окно «3D» модели мода (ТЗ 24.10.2026, вечер, п. E): модальное, без шапки — только модель и аккуратный крестик в правом
 * верхнем углу; имя окну даёт `ariaLabel`, закрывает Esc или крестик. Одно на сцену страницы (`ModStage`: «3D» в углу фото
 * и на кадрах стволов) и на «глаз» в «Компонентах» (`ModComponents`): модель можно крутить и приближать, фото на месте.
 *
 * `model` — адрес модели, `preview` — её картинка, пока модель едет, `kind` — `weapon` или `clothing`. У одежды (`mod`) окно показывает вещь на персонаже
 * (28.10.2026): персонажа собирает Desktop из игры человека, пока он едет — сама вещь, потом он подменяет её; нет игры — остаётся вещь.
 */
/** Сама модель: вьюер, слова «Загружаем модель» и «Собираем персонажа…». Окно «3D» кладёт её в диалог, карточка одежды — прямо в рамку сцены («На человеке · 3D»). */
export function ModelView({
  model,
  preview = "",
  name,
  kind = "weapon",
  language,
  mod = null,
  colour = "",
}) {
  useTr();
  const clothing = kind === "clothing" && Boolean(model);
  /* Выбранный цвет мода (28.10.2026, владелец: «выбрал фиолетовые штаны — 3D открывает белые»): модель витрины нарисована первым цветом; у другого цвета до
     готового персонажа окно показывает саму вещь этого цвета (Desktop собирает её за доли секунды), а не белую. */
  const picked = clothing && colour && colour !== firstColourLetter(mod) ? colour : "";
  const tinted = useColourModel(mod, picked, Boolean(picked));
  const onModel = useOnModel(mod, clothing, picked);
  /* Подпись про цвет: собирается — «Меняю цвет…»; не собрался или пустой — «Показана модель без выбранного цвета» (персонаж собран — на экране выбранный цвет, подписи нет). */
  const shown = onModel.url || tinted.url || model;
  const caption = useColourCaption({ tinted, picked, character: onModel.url, settled: onModel.status !== "building", shown });
  if (!model) return null;
  /* «Сначала просто 3D-моделька» (слово владельца 22.11.2026, бронежилет в 1.0.0: окно на втором кадре ждало цветную сборку и без неё не рисовало ничего): модель витрины идёт сразу, цвет и персонаж
     подменяют её по готовности, отказ или вечная сборка оставляют витрину. Пока цвет едет — подпись «Меняю цвет…», витрина не выдаёт себя за выбранный цвет. */
  const note = caption.text || (onModel.status === "building" ? tr("Собираем персонажа из вашей игры…") : "");
  return (
    <>
      {shown ? (
        <React.Suspense
          fallback={
            <ModWait what={clothing ? "clothing" : "gun"} />
          }
        >
          <WeaponModelViewer
            key={shown}
            embedded
            modelUrl={shown}
            /* Подменённая модель (персонаж, цвет) пустая или не открылась — остаётся вещь витрины, а не пустой экран. */
            fallbackModelUrl={shown !== model ? model : undefined}
            onShown={caption.shownBy(shown)}
            previewUrl={preview}
            title={name}
            language={language}
            kind={kind}
          />
        </React.Suspense>
      ) : (
        <ModWait what={clothing ? "clothing" : "gun"} />
      )}
      {note && (
        <p className="mod-model-note" role="status">
          {note}
        </p>
      )}
    </>
  );
}

export default function ModelWindow({
  model,
  preview = "",
  name,
  kind = "weapon",
  language,
  mod = null,
  colour = "",
  onClose,
}) {
  useTr();
  if (!model) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      ariaLabel={name}
      showClose={false}
      size="wide"
      className="mod-model-dialog"
      bodyClassName="mod-model-dialog-body"
    >
      <div className="mod-model-stage">
        <button
          type="button"
          className="mod-model-close"
          aria-label={tr("Закрыть")}
          title={tr("Закрыть")}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        <ModelView
          model={model}
          preview={preview}
          name={name}
          kind={kind}
          language={language}
          mod={mod}
          colour={colour}
        />
      </div>
    </Dialog>
  );
}
