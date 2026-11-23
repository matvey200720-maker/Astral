import { lazy, Suspense, useState } from "react";
import Button from "../../../ui/Button.jsx";
import ContextMenu from "../../../ui/ContextMenu.jsx";
import { PencilSimple } from "../../../ui/icons.jsx";
import { hasStandardEditor, modEditor } from "../../../../features/catalog/mod-editor.js";
import { cardMembers } from "../../../../features/catalog/bundles/component-candidates.js";
import { slotsOf } from "../../../../features/catalog/bundles/component-choices.js";
import { startComponentPick } from "../../../../features/catalog/bundles/component-pick.js";
import { REDUX_BASE_SLOT } from "../../../../features/catalog/bundles/component-groups.js";
import { placeOfSlot } from "../../../../features/catalog/bundles/component-places.js";
import { REDUX_EDITORS } from "../../../../features/catalog/redux-editors.js";
import { RowPen, RowRestore } from "./wide/WideRowButtons.jsx";
import { ownWorkCandidates, workshopSlotOf } from "../../../../features/catalog/bundles/component-works.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Что человек делает с компонентом сборки в панели справа («Компоненты», ТЗ владельца 10.11.2026): отключить или включить, заменить частью другого редукса или своей
 * работой, сделать в мастерской, вернуть родные пакеты. Компонент — слот: действия идут над всеми его пакетами сразу. Само состояние и ход очереди — `useComponentChoice`
 * (`features/catalog/bundles/component-actions.js`); здесь только кнопки. Окно выбора замены грузится по нужде.
 *
 * «Взять из другого редукса» (владелец, 12.11.2026): у слота, части которого лежат на полке каталога (`component-places.js`), кнопка не открывает окно, а запоминает запрос
 * (`component-pick.js`) и уводит в каталог на эту полку; щелчок по карточке подставляет её и возвращает на страницу мода (`use-pick-return.js`). У слота без полки (или там, где
 * страница не умеет ходить по разделам) остаётся прежнее окно «Заменить компонент» с вкладками «Из другой сборки» и «Моя работа». Своя работа мастерской у слота с полкой —
 * тихая кнопка «Моя работа» (окно только с работами), когда у человека есть свои работы этого вида.
 */

const ComponentReplace = lazy(() => import("./ComponentReplace.jsx"));

/* «Название» в кавычках языка окна: у французского ёлочки с неразрывными пробелами внутри. */
const NBSP = String.fromCharCode(160);
const quoted = (text, language) => (language === "fr" ? `«${NBSP}${text}${NBSP}»` : `«${text}»`);

// Откуда «лететь» установке из панели: первая картинка панели части, а нет её — вся страница.
const flightSource = () => document.querySelector("[data-part-root] img") || document.body;

/**
 * @param {{ view: object, picked: object, bundle: object, packages: object[], also?: string[], original: object, name: string, off: boolean, swapped: boolean, sourceId?: string, workKey?: string, ownWorks?: object[] | null }} props
 * `packages` — пакеты, что стоят на месте компонента сейчас (родные или замена), `also` — другие слоты сборки, закрытые тем же общим архивом (зоны),
 * `original` — первый родной пакет слота, `name` — ключ слота, `sourceId` — сборка, чьим слотом заменён компонент, `ownWorks` — сохранённые работы мастерской (`null`, пока не прочитаны).
 */
export default function ComponentChoiceActions({ view, picked, bundle, packages, also = [], original, name, off, swapped, sourceId = "", workKey = "", ownWorks = null, menu = false }) {
  useTr();
  const [replacing, setReplacing] = useState(false);
  const [failure, setFailure] = useState("");
  const [menuAt, setMenuAt] = useState(null);
  const [trayOpen, setTrayOpen] = useState(false);
  /* У вещи без слота (одежда, ствол) заменять нечем: «такого же компонента» в других сборках не бывает. «Основа редукса» (`redux-base`) тоже не заменяется: её файлы лежат
     только в своём редуксе, чужую основу подставлять нельзя, а редактора мастерской под них нет — остаётся только галочка «Отключить / Включить». */
  const isBase = name === REDUX_BASE_SLOT;
  const slotted = !name.startsWith("part:") && !isBase;
  /* Полка каталога у слота и страница, что умеет туда вести (`parts.pickPlace`): тогда «Взять из другого редукса» — переход, а не окно. */
  const place = slotted && view.parts.pickPlace ? placeOfSlot(name) : null;
  const mine = place && ownWorks ? ownWorkCandidates(original, ownWorks) : [];
  const pick = (candidate) => {
    setReplacing(false);
    picked.swap(name, candidate, flightSource());
  };
  /* Слоты, на которые встаёт одна работа этого вида (три слота «Запретных зон»): работа ложится на все сразу. */
  const covers = workshopSlotOf(original)?.covers || [name];
  const pickWork = (work) => {
    setReplacing(false);
    picked.pickWork(name, work, covers);
  };
  /* «Сделать в мастерской»: редактор этого вида от стандартной основы; нет редактора или не открылся — слово у кнопки, без заглушек. */
  const canStart = !isBase && Boolean(view.parts.startWork) && hasStandardEditor(original);
  const start = async () => {
    setFailure("");
    setReplacing(false);
    const opened = await Promise.resolve(view.parts.startWork(original)).catch(() => false);
    if (opened === false) setFailure(tr("Редактор этого вида не открылся"));
  };
  /* Запрос выбора: чья карточка, какой слот, чьи части выбирать нельзя; потом каталог на полке слота. */
  const takeFromOther = () => {
    if (!place) {
      setReplacing(true);
      return;
    }
    startComponentPick({
      group: picked.group,
      slot: name,
      bundleId: bundle.id,
      bundleName: bundle.name,
      nativeId: original.id,
      slots: slotsOf(original),
      exclude: [...cardMembers(bundle, view.rails.allMods)],
      top: document.querySelector(".desktop-main")?.scrollTop ?? 0,
    });
    view.parts.pickPlace(place);
  };
  /* Карандаш в строке карточки «Пульт» (чистовой набор 2, 15.11.2026): у части, у которой есть раздел каталога, он ведёт прямо в каталог на этот раздел — в режиме «через карандаш»
     (только «← Назад», «Создать свой в мастерской» первой плиткой и части других сборок); подсказка называет раздел. Нет раздела — прежнее меню «Из мастерской / Из каталога /
     Вернуть родную часть». Заменённая часть несёт рядом ещё и «Вернуть родную часть». Нечем заменять (основа редукса, вещь без слота) — карандаша нет. */
  /* Панель «Состав» страницы-галереи (21.11.2026, макет владельца; слово кнопки — «Изменить», 22.11.2026): в строке кнопка «Изменить», под ней при нажатии — «Из каталога», «Из мастерской», «В редактор». Кнопка
     стоит, только если за ней есть работающий путь: нечем заменять (основа редукса, вещь без слота) — один путь, «Изменить» открывает редактор сразу, а у части без редактора кнопки нет. */
  if (menu === "tray") {
    const editable = Boolean(view.parts.edit) && Boolean(modEditor(original));
    const edit = async () => {
      setFailure("");
      const opened = await Promise.resolve(view.parts.edit(original)).catch(() => false);
      if (opened === false) setFailure(tr("Редактор этого вида не открылся"));
    };
    const toEditor = (
      <Button variant="secondary" size="sm" className="xw-comp-btn" onClick={edit}>
        {tr("Изменить")}
      </Button>
    );
    if (!slotted) return editable ? toEditor : null;
    const hasMine = mine.length > 0;
    const restorable = swapped || Boolean(workKey);
    return (
      <>
        <Button variant="secondary" size="sm" className={`xw-comp-btn${trayOpen ? " is-active" : ""}`} aria-expanded={trayOpen} onClick={() => setTrayOpen((open) => !open)}>
          {tr("Изменить")}
        </Button>
        {trayOpen && (
          <div className="xw-comp-tray" role="group" aria-label={tr("Заменить компонент")}>
            <Button variant="secondary" size="sm" onClick={takeFromOther}>
              {tr("Из каталога")}
            </Button>
            {(hasMine || canStart) && (
              <Button variant="secondary" size="sm" onClick={() => (hasMine ? setReplacing(true) : start())}>
                {tr("Из мастерской")}
              </Button>
            )}
            {editable && (
              <Button variant="secondary" size="sm" onClick={edit}>
                {tr("В редактор")}
              </Button>
            )}
            {restorable && (
              <Button variant="ghost" size="sm" className="xw-comp-restore" onClick={() => picked.restore(name, flightSource())}>
                {tr("Вернуть родную часть")}
              </Button>
            )}
            {failure && (
              <small className="xw-comp-failure" role="alert">
                {failure}
              </small>
            )}
          </div>
        )}
        {replacing && (
          <Suspense fallback={null}>
            <ComponentReplace
              view={view}
              bundle={bundle}
              part={original}
              name={name}
              covers={covers}
              current={{ source: swapped ? sourceId : "", work: workKey }}
              worksOnly={Boolean(place)}
              onPick={pick}
              onPickWork={pickWork}
              onStart={canStart ? start : null}
              onClose={() => setReplacing(false)}
            />
          </Suspense>
        )}
      </>
    );
  }
  if (menu) {
    if (!slotted) return null;
    const hasMine = mine.length > 0;
    const restorable = swapped || Boolean(workKey);
    const section = place ? REDUX_EDITORS.find((editor) => editor.id === place.editor)?.label || "" : "";
    const replaceWindow = replacing && (
      <Suspense fallback={null}>
        <ComponentReplace
          view={view}
          bundle={bundle}
          part={original}
          name={name}
          covers={covers}
          current={{ source: swapped ? sourceId : "", work: workKey }}
          worksOnly={Boolean(place)}
          onPick={pick}
          onPickWork={pickWork}
          onStart={canStart ? start : null}
          onClose={() => setReplacing(false)}
        />
      </Suspense>
    );
    /* Кнопка под кадром («Выбрать другой в каталоге») — у слотов с разделом; остальным нечего открывать. */
    if (menu === "bar") {
      if (!place) return null;
      return (
        <Button variant="secondary" size="md" className="xw-bar-button" icon={<PencilSimple />} onClick={takeFromOther}>
          {tr("Выбрать другой в каталоге")}
        </Button>
      );
    }
    if (place) {
      return (
        <>
          {restorable && <RowRestore label={tr("Вернуть родную часть")} onClick={() => picked.restore(name, flightSource())} />}
          <RowPen
            tip={[tr("Выбрать другой в каталоге"), section ? `${tr("Откроется раздел")} ${quoted(tr(section), view.language)}` : ""]}
            label={tr("Выбрать другой в каталоге")}
            onClick={takeFromOther}
          />
          {replaceWindow}
        </>
      );
    }
    const options = [
      { value: "work", label: tr("Из мастерской"), disabled: !hasMine && !canStart },
      { value: "catalog", label: tr("Из каталога") },
      ...(restorable ? [{ separator: true }, { value: "restore", label: tr("Вернуть родную часть") }] : []),
    ];
    const choose = (value) => {
      if (value === "catalog") takeFromOther();
      else if (value === "work") {
        if (hasMine) setReplacing(true);
        else start();
      } else picked.restore(name, flightSource());
    };
    return (
      <>
        <button
          type="button"
          className="xw-pen-button"
          aria-haspopup="menu"
          aria-label={tr("Заменить компонент")}
          title={failure || tr("Заменить компонент")}
          onClick={(event) => {
            event.stopPropagation();
            const box = event.currentTarget.getBoundingClientRect();
            setMenuAt({ x: box.left, y: box.bottom + 4 });
          }}
        >
          <PencilSimple aria-hidden="true" />
        </button>
        {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} title={tr("Заменить компонент")} options={options} onSelect={choose} onClose={() => setMenuAt(null)} />}
        {replaceWindow}
      </>
    );
  }
  return (
    <span className="mod-part-actions is-panel mod-component-choice">
      <Button
        variant="secondary"
        size="md"
        className="mod-part-action is-choice-toggle"
        aria-pressed={!off}
        onClick={() => picked.toggle(packages, name, off, flightSource(), also)}
      >
        {off ? tr("Включить компонент") : tr("Отключить компонент")}
      </Button>
      {slotted && (
        <Button variant="secondary" size="md" className="mod-part-action is-choice-replace" aria-haspopup={place ? undefined : "dialog"} onClick={takeFromOther}>
          {tr("Взять из другого редукса")}
        </Button>
      )}
      {mine.length > 0 && (
        <Button variant="ghost" size="md" className="mod-part-action is-choice-works" aria-haspopup="dialog" onClick={() => setReplacing(true)}>
          {tr("Моя работа")}
        </Button>
      )}
      {canStart && (
        <Button variant="secondary" size="md" className="mod-part-action is-choice-start" title={failure || undefined} onClick={start}>
          {tr("Сделать в мастерской")}
        </Button>
      )}
      {failure && (
        <small className="mod-components-note" role="alert">
          {failure}
        </small>
      )}
      {(swapped || workKey) && (
        <Button variant="ghost" size="md" className="mod-part-action is-choice-restore" onClick={() => picked.restore(name, flightSource())}>
          {tr("Вернуть родную часть")}
        </Button>
      )}
      {replacing && (
        <Suspense fallback={null}>
          <ComponentReplace
            view={view}
            bundle={bundle}
            part={original}
            name={name}
            covers={covers}
            current={{ source: swapped ? sourceId : "", work: workKey }}
            worksOnly={Boolean(place)}
            onPick={pick}
            onPickWork={pickWork}
            onStart={canStart ? start : null}
            onClose={() => setReplacing(false)}
          />
        </Suspense>
      )}
    </span>
  );
}
