import "./mod-components.css";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { variantOf } from "@modovik/publishing";
import { PencilSimpleLine, SlidersHorizontal } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import Skeleton, { skeletonDelay } from "../../../ui/Skeleton.jsx";
import { packContentsCopy } from "../../../../features/catalog/pack-contents-copy.js";
import { useComponentChoice } from "../../../../features/catalog/bundles/component-actions.js";
import { reduxEffectsOf } from "../../../../features/catalog/redux-effects.js";
import { standardZoneEntries } from "../../../../features/catalog/standard-zones.js";
import { tr, useTr } from "../../../../locales/ui.js";
import ComponentsSplit from "./ComponentsSplit.jsx";
import ModelWindow from "./ModelWindow.jsx";
import { usePickReturn } from "./use-pick-return.js";

/*
 * «Компоненты» — окно со всем, что входит в пак или редукс (владелец, 24.10.2026 ночью: «Что внутри» со страницы убрать,
 * вместо него кнопка «Компоненты» справа от «Установить»).
 *
 * Кнопка стоит в одной строке с «Установить» (`ModCardActions`) квадратным значком без слова (владелец, 12.11.2026; слово — подсказкой и для чтения с экрана) и несёт знак «ползунки» — тот, что стоял на фильтре
 * проекта в каталоге: владелец разрешил перенести его сюда, а фильтру достался земной шар (`ProjectFilter`). Нажатие
 * открывает окно в виде «Просмотр» (владелец выбрал его из трёх 29.10.2026, `ComponentsSplit`): список компонентов слева, справа большой кадр
 * выбранного, «Установить» (поставить только его), «Изменить в мастерской» и «Смотреть в 3D» (если модель есть). Всё это — те же действия, что были на
 * плитках «Что внутри» (`PartActions`), без потерь: версии части, эффекты автора, быстрый просмотр оптимизации, куски
 * маппинга и звуки пака — в том же окне (`ModContents`). Откуда кадр («рендер модели из пака», «мини-карта нарисована Astral») — только подсказкой у большого
 * кадра (`hint` записи), плашек и подписей под списком нет (CLAUDE.md, 29.10.2026).
 *
 * Название редукса стоит один раз — в шапке окна (над словом «Компоненты», с подписью версии), а заголовок каждой строки — вид компонента («Таймцикл», «Арена»,
 * «Интерьер 7»; ТЗ ведущей 10.11.2026, этап 2). В окне «Заменить компонент» строки остаются названиями сборок: там это и есть различие.
 *
 * Высота окна — по окну приложения (`mod-components.css`): шапка, строка «N частей» и блок «Просмотр», который заполняет остаток; окно целиком не листается.
 *
 * Содержимое едет по нужде (`lazy`): страница мода открывается без него, а серые плиты на месте сетки — скелет, пока оно
 * приезжает. Щелчок по обложке компонента открывает страницу части; окно при этом закрывается, и «назад» вернёт на
 * страницу мода.
 */

const ModContents = lazy(() => import("./ModContents.jsx"));

/** Есть ли у мода компоненты: части сборки, стволы пака, куски маппинга, звуки, эффекты автора или виды зон карточки «Зоны». */
export const hasComponents = (view) =>
  Boolean((view.contents || []).length || reduxEffectsOf(view.mod) || standardZoneEntries(view).length);

function ComponentsLoading() {
  return (
    <div className="mod-components-loading" aria-hidden="true">
      <div className="mod-components-loading-list">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            className="mod-components-plate"
            delay={skeletonDelay(index)}
          />
        ))}
      </div>
      <Skeleton className="mod-components-loading-stage" delay={skeletonDelay(0)} />
    </div>
  );
}

export default function ModComponents({ view, size = "lg", reopen = true, pencil = false }) {
  useTr();
  const [open, setOpen] = useState(false);
  /* Слот компонента, на котором окно открывается после выбора из каталога («Взять из другого редукса», `use-pick-return.js`). */
  const [focusSlot, setFocusSlot] = useState(view.pickedSlot || "");
  /* Страница забрала возврат из каталога, пока окно уже открывали: слот приходит позже первой отрисовки. */
  useEffect(() => {
    if (view.pickedSlot) setFocusSlot(view.pickedSlot);
  }, [view.pickedSlot]);
  /* Модель, которую смотрят: окно «3D» стоит поверх окна «Компонентов». */
  const [model, setModel] = useState(null);
  /* Выбор компонентов сборки живёт на карточке, а не в окне: закрытое окно не должно терять слежение за ходом очереди. */
  const choice = useComponentChoice({ bundle: view.mod, catalog: view.rails?.allMods || [], parts: view.parts });
  usePickReturn({
    view,
    choice,
    onReturn: (slot) => {
      setFocusSlot(slot);
      /* Карточка «Пульт» (`reopen: false`): выбор из каталога виден в строке части, окно само не открывается. */
      if (reopen) setOpen(true);
    },
  });
  const closeDialog = () => {
    setOpen(false);
    setFocusSlot("");
  };
  /* Страница части открывается из окна — окно закрывается вместе с уходом со страницы. */
  const inner = useMemo(
    () => ({
      ...view,
      choice,
      focusSlot,
      parts: {
        ...view.parts,
        open: view.parts?.open
          ? (part) => {
              setOpen(false);
              view.parts.open(part);
            }
          : undefined,
      },
    }),
    [view, choice, focusSlot],
  );
  if (!hasComponents(view)) return null;
  const copy = packContentsCopy(view.language);
  /* Карточка «Зоны» (круг 6б): внутри пять видов зон — кадр и слова каждого; ставится вся карточка, поэтому у записей действий нет. */
  const zones = standardZoneEntries(view);
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        className={pencil ? "mod-card-components xw-icon xw-tool" : "mod-card-components"}
        icon={pencil ? <PencilSimpleLine /> : <SlidersHorizontal />}
        ariaLabel={copy.title}
        title={copy.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />
      {open && (
        <Dialog
          open
          onClose={closeDialog}
          title={copy.title}
          kicker={zones.length ? undefined : <span data-no-translate="">{[view.mod.name, variantOf(view.mod)?.label].filter(Boolean).join(" · ")}</span>}
          size="wide"
          className="mod-components-dialog"
          bodyClassName="mod-components-body"
          closeLabel={tr("Закрыть")}
        >
          {/* `mod-card` — чтобы правила плиток и разделов страницы мода (они привязаны к нему) работали и в окне. */}
          <div className="mod-card mod-components">
            {zones.length ? (
              <ComponentsSplit entries={zones} />
            ) : (
              <Suspense fallback={<ComponentsLoading />}>
                <ModContents view={inner} onView3D={setModel} />
              </Suspense>
            )}
          </div>
        </Dialog>
      )}
      {model && (
        <ModelWindow
          model={model.model}
          preview={model.preview}
          name={model.name}
          kind={model.kind}
          language={view.language}
          onClose={() => setModel(null)}
        />
      )}
    </>
  );
}
