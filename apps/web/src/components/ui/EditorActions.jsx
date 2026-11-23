import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  Check,
  DotsThree,
  Warning,
  X,
} from "./icons.jsx";
import Button from "./Button.jsx";
import CompareHold from "./CompareHold.jsx";
import MenuButton from "./MenuButton.jsx";
import { requestDownloadsPanel } from "../../features/downloads/open-requests.js";
import { currentUiLanguage, tr, useTr } from "../../locales/ui.js";
import { dataLangOf } from "../desktop/catalog/data-lang.js";

/*
 * Правый край полосы редактора.
 *
 * Каркас (`EditorShell`) отвечает за то, что действия стоят в конце полосы;
 * что именно там стоит и в каком порядке — за это отвечает эта строка. До неё
 * каждый редактор собирал хвост сам, и собрал двадцатью способами: у мини-карты
 * «Отмена» и «Применить», у залазов главной кнопкой стояло «Скачать DDS» —
 * выгрузка файла на месте установки в игру, — у интерьеров «Проверить макет»,
 * у Мегамолла две главные кнопки подряд, а у неба, арены, дорог, воды,
 * растительности, значков, HUD и оружия главной кнопки не было вовсе:
 * «Применить в игру» лежало где-то в инспекторе, у каждого в своём месте.
 *
 * Порядок здесь один и он читается справа налево, как рука к нему тянется:
 *
 *   [↶] [↷]   [⋯ ещё]   [✓ Применить]
 *
 * «Отмены» здесь больше нет (владелец, 03.10.2026). Она делала ровно то же,
 * что стрелка «назад» слева, — закрывала редактор, сохранив черновик, — и
 * ничего не отменяла: человек жал её, ожидая отката правок, и не получал его.
 * Откат — стрелки истории, выход — стрелка назад; третьей кнопки с тем же
 * действием и обманчивым именем полосе не нужно. `onCancel` и `cancelLabel`
 * принимаются и молча пропускаются, чтобы редактор, ещё не снявший их, не
 * ронял сборку.
 *
 * ПОЧЕМУ «ЕЩЁ» — МЕНЮ
 *
 * В полосе помещается пять-шесть кнопок. Редкие действия — сбросить, открыть,
 * выгрузить, поделиться кодом — их обычно четыре, и выложенные в ряд они
 * занимают место «Отмены» и «Применить». Без последних двух редактор нельзя
 * закончить, а без «Скачать DDS» — можно; поэтому редкое уходит под одну
 * кнопку, а не главное уступает место редкому.
 *
 * ЧТО СЧИТАЕТСЯ ГЛАВНЫМ
 *
 * Главная кнопка — та, ради которой открыли редактор: «Применить» ставит
 * работу в игру. Не «Сохранить» (проект и так сохраняется), не «Скачать» (это
 * выгрузка для тех, кто правит файлы руками), не «Проверить» (это шаг внутри
 * применения, и человеку незачем знать, что их два).
 */

/*
 * «ПРИМЕНИТЬ» ВО ВРЕМЯ ЗАПИСИ
 *
 * Запись в игру идёт сорок пять секунд, и всё это время кнопка — единственное
 * место в редакторе, которое о ней знает (сам кадр улетел в угол,
 * `features/downloads/work-crumple.js`, а «Загрузки» сами не открываются).
 * Владелец (ТЗ 08.10, вечер): статус — прямо на кнопке, одним словом:
 *
 *   [✓ Применить]  →  [⇣ Идёт установка… ▓▓▓░░░]  →  [✓ Установлено]  →  [✓ Применить]
 *                                                  ↘  [⚠ Не удалось] + причина под кнопкой
 *
 * Заливка слева — настоящая доля записи, если редактор передал `meter`
 * (`useWorkshopApplyButton`); без неё или пока работа ждёт своей очереди по
 * кнопке бежит полоса — «идёт, но сколько осталось, неизвестно». Стрелка в
 * лотке опускается, пока идёт запись. Нажатие на занятую кнопку открывает
 * «Загрузки» с подробностями: в редакторе рейки не видно, и иначе до них не
 * добраться. «Установлено» держится, пока очередь держит строку готовой
 * работы, и нажать его нельзя: та же версия только что встала в игру.
 *
 * Отказ — на том же месте: «Не удалось» и причина словами человека под
 * кнопкой, пока её не закроют или не нажмут «Применить» снова. Всплывашка
 * гасла через семь секунд, а кнопка возвращалась к «Применить», будто ничего
 * не было.
 */
const noMeter = {
  subscribe: () => () => {},
  read: () => null,
  readFailure: () => "",
  readFailureDetail: () => "",
};

function useApplyShare(meter) {
  const source = meter || noMeter;
  return useSyncExternalStore(source.subscribe, source.read, source.read);
}

function useApplyFailure(meter) {
  const source = meter?.readFailure ? meter : noMeter;
  return useSyncExternalStore(
    source.subscribe,
    source.readFailure,
    source.readFailure,
  );
}

/* Текст движка за отказом: по нему узнаётся отказ-вопрос (строка отказа
   зависит от языка, текст движка один). */
function useApplyFailureDetail(meter) {
  const source = meter?.readFailureDetail ? meter : noMeter;
  return useSyncExternalStore(
    source.subscribe,
    source.readFailureDetail,
    source.readFailureDetail,
  );
}

/* Значок «Загрузок» набора Astral (`GlyphDownload`, 18.10.2026) со стрелкой
   отдельно от лотка: стрелка опускается в лоток, пока идёт запись. */
function LoadingGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.75 15.75 V19.5 A 1.5 1.5 0 0 0 5.25 21 H18.75 A 1.5 1.5 0 0 0 20.25 19.5 V15.75" />
      <g className="editor-apply-arrow">
        <path d="M12 3.75 V10.5" />
        <polygon points="7.5,9.75 16.5,9.75 12,15" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

/*
 * Нажатие отвечает сразу (19.10.2026, владелец: «нажал применить, а реакция
 * была только через 3 секунды»). До очереди работа сохраняется — у студии
 * ствола это слои и обложка, — и кнопка всё это время стояла как
 * ненажатая. Теперь «Сохраняем…» встаёт в DOM синхронно (`flushSync`) до
 * начала сохранения и видна с первого же кадра, который оно отдаст.
 */
function useImmediateApply(onClick) {
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const press = (event) => {
    if (!onClick || saving) return;
    flushSync(() => setSaving(true));
    let result;
    try {
      result = onClick(event);
    } catch (error) {
      setSaving(false);
      throw error;
    }
    /* Без обещания нажатие закончилось сразу — кнопка тут же своя. */
    if (!result || typeof result.then !== "function") {
      setSaving(false);
      return;
    }
    const done = () => {
      if (alive.current) setSaving(false);
    };
    result.then(done, done);
  };
  return [saving, press];
}

function ApplyButton({ apply }) {
  useTr();
  const share = useApplyShare(apply.meter);
  const failure = useApplyFailure(apply.meter);
  const failureDetail = useApplyFailureDetail(apply.meter);
  const [saving, press] = useImmediateApply(apply.onClick);
  const working =
    saving || Boolean(apply.busy) || (share !== null && share < 100);
  const done = !working && share === 100;
  const failed = !working && !done && Boolean(failure);
  const state = working
    ? "working"
    : done
      ? "done"
      : failed
        ? "failed"
        : "idle";
  /* Ждёт своей очереди: доли ещё нет — бежит полоса. */
  const queued = working && share === -1;
  const measured =
    working && !saving && typeof share === "number" && share >= 0;
  const label = saving
    ? tr("Сохраняем…")
    : working
    ? apply.busy || apply.meter?.busy || tr("Идёт установка…")
    : done
      ? apply.meter?.done || tr("Установлено")
      : failed
        ? apply.meter?.failedLabel || tr("Не удалось")
        : apply.label || tr("Применить");
  const title = working
    ? queued
      ? apply.meter?.queuedHint || undefined
      : apply.meter?.detailsHint || undefined
    : done
      ? undefined
      : failed
        ? failure
        : apply.title || undefined;
  /* Отказ — вопрос, а не поломка («Выбери ниже: оставить своё или заменить»):
     выбор стоит здесь же, а после выбора та же работа ставится сама. */
  const choice = failed
    ? apply.meter?.failureChoice?.({
        detail: failureDetail,
        language: currentUiLanguage(),
        onDecided: () => apply.onClick?.(),
      })
    : null;
  return (
    <span className={`editor-apply-wrap${failed ? " has-failure" : ""}`}>
      <Button
        variant="primary"
        size="sm"
        className={`editor-apply is-${state}${working && !measured ? " is-indeterminate" : ""}`}
        /* Ключ — состояние: новый значок встаёт своим появлением, а не
           подменой посреди чужого. */
        icon={
          <span className="editor-apply-glyph" key={state}>
            {working ? (
              <LoadingGlyph />
            ) : failed ? (
              <Warning weight="bold" />
            ) : (
              <Check weight={done ? "bold" : "regular"} />
            )}
          </span>
        }
        progress={working ? (measured ? share : 0) : null}
        disabled={(apply.disabled && !working) || done}
        /* Занятая кнопка — дверь к подробностям: «Загрузки» сами больше не
           открываются, а в редакторе рейки с ними не видно. */
        onClick={
          saving
            ? undefined
            : working
              ? () => requestDownloadsPanel()
              : press
        }
        title={title}
        /* Подсказка может назвать вещь или тату игры («поставить на «…»») — это данные: язык данных на кнопке, язык окна — на самой надписи, чтобы
           сверка языка по-прежнему видела, если надпись осталась не на своём языке. */
        lang={dataLangOf(title)}
        aria-busy={working || undefined}
      >
        <span className="editor-apply-text" key={label} lang={title ? currentUiLanguage() : undefined}>
          {label}
        </span>
      </Button>
      {failed && (
        <span className="editor-apply-failure" role="alert">
          {/* Блок, а не строка: выбор встаёт под причиной. */}
          <div>
            <span>{failure}</span>
            {choice}
          </div>
          {apply.meter?.dismissFailure && (
            <button
              type="button"
              className="editor-apply-failure-close"
              aria-label={apply.meter?.dismissLabel || tr("Закрыть")}
              title={apply.meter?.dismissLabel || tr("Закрыть")}
              onClick={() => apply.meter.dismissFailure()}
            >
              <X />
            </button>
          )}
        </span>
      )}
    </span>
  );
}

export default function EditorActions({
  onUndo = null,
  canUndo = false,
  onRedo = null,
  canRedo = false,
  /* Редкие действия: [{ value, label, icon, disabled }] и onSelect. */
  more = null,
  onMore = null,
  /* Главная кнопка. `busy` — надпись на время работы; кнопка при ней занята.
     `meter` — ход записи в игру (`useWorkshopApplyButton`), см. выше. */
  apply = null,
  /* Что стоит перед «⋯»: то, что не редкое, но и не главное. */
  children = null,
  /* «Как в игре» по удержанию: `{ active, onChange }` (`useRecolorEditor` → `actionProps({ compare: true })`). */
  compare = null,
}) {
  useTr();
  return (
    <>
      {onUndo && (
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowUUpLeft />}
          disabled={!canUndo}
          onClick={onUndo}
          aria-label={tr("Отменить действие")}
          title={tr("Отменить действие")}
        />
      )}
      {onRedo && (
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowUUpRight />}
          disabled={!canRedo}
          onClick={onRedo}
          aria-label={tr("Повторить действие")}
          title={tr("Повторить действие")}
        />
      )}
      {compare && <CompareHold active={compare.active} onChange={compare.onChange} />}
      {children}
      {more?.length > 0 && (
        /* Кнопка стоит у правого края полосы действий: меню раскрывается
           влево, иначе его правый край уходит под обрез страницы. */
        <MenuButton
          ariaLabel={tr("Ещё")}
          title={tr("Ещё")}
          variant="ghost"
          align="end"
          trailing={null}
          icon={<DotsThree />}
          menuClassName="editor-more-menu"
          options={more}
          onSelect={onMore}
        />
      )}
      {apply && <ApplyButton apply={apply} />}
    </>
  );
}
