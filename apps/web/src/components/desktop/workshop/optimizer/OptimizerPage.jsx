import { useCallback, useMemo, useState } from "react";
import { localizedText } from "@modovik/optimizer";
import {
  OPTIMIZATION_CARDS,
  optimizationCardParts,
  optimizationCardState,
} from "@modovik/optimizer/cards.js";
import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import {
  hasDesktopBridge,
  optimizationLayersSupported,
} from "../../../../api.js";
import useHistoryKeys from "../../../../hooks/useHistoryKeys.js";
import { retryWorkshopInstall, useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { canRestoreScatter, restoreScatterTarget } from "../../../../features/downloads/ForeignScatterChoice.jsx";
import { useInstallRecords } from "../../../../features/workshop/useInstallRecord.js";
import { failureWords } from "../../../../utils/installFailure.js";
import { useRememberedState } from "../../../../section-memory.js";
import OptimizationHero from "./OptimizationHero.jsx";
import { OptimizationHow, OptimizationParts } from "./OptimizationPanels.jsx";
import OptimizationPartsDialog from "./OptimizationPartsDialog.jsx";
import OptimizerFrame from "./OptimizerFrame.jsx";
import { optimizationCardView } from "./optimization-view.js";
import { fillCopy as fillText } from "./optimizer-copy.js";
import TextureDowngrade from "./TextureDowngrade.jsx";
import TextureRebuildNote from "./TextureRebuildNote.jsx";
import DrawDistance from "./DrawDistance.jsx";
import GrayWorld from "./GrayWorld.jsx";
import WorldStyle from "./WorldStyle.jsx";
import { tr as trText, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { drawDistanceCopyFor } from "./draw-distance-copy.js";
import { textureCopyFor } from "./texture-copy.js";
import { fillCopy, optimizerCopyFor } from "./optimizer-copy.js";
import { readAppliedOptimizer } from "./optimizer-storage.js";
import { takeOptimizerFocus } from "../../../../features/workshop/optimizer-focus.js";
import {
  layerTarget,
  optimizationCardJobKey,
  profileTarget,
  toggleOptimizationParts,
} from "./optimizer-sync.js";

/*
 * Студия оптимизации: инструменты слева, кадр в сцене, настройки справа (ТЗ владельца 22.10.2026, п. F) — как у
 * мастерских оружия и одежды.
 *
 * Пять инструментов: «Убрать лишнее» (прежние семь карточек: улицы, транспорт, прохожие, растительность, тени, погода,
 * эффекты), «Ухудшение текстур», «Дальность прорисовки», «ЧБ-мир» и «Стиль мира» (рисованный кадр через ReShade; в
 * студии настройка проще: на виду выбор стиля и одна строка состояния, остальное — раскрывашкой).
 *
 * Логика прежняя, переехала только раскладка. «Убрать лишнее»: включил карточку — её состав встаёт в очередь установки
 * и уходит в игру, выключил — снимается тем же путём, что корзиной «Библиотеки»; стрелки истории отменяют
 * переключение. Остальные три — свои вкладки прежнего раздела: каждая сама держит выбор, очередь и «Установить», а в
 * студию кладёт два куска — кадр в сцену и панель в инспектор (`OptimizerSlots`, порталом в гнёзда ниже): состояние
 * вкладки остаётся в одном компоненте.
 *
 * Состояние карточки — не память окна, а то, что стоит в игре: снимок профиля переключателей и записи установки слоёв.
 * Пока работа карточки в очереди, карточка показывает то, к чему очередь придёт. Отказ последней работы (игра запущена,
 * файл занят) остаётся на строке, пока его строка висит в очереди: повторили и прошло — отказ пропадает сам.
 */


/* Работа карточки в очереди: ставится, снимается или ждёт. */
function cardPending(card, jobs) {
  const job = jobs.find(
    (item) =>
      item.key === optimizationCardJobKey(card.id) &&
      (item.status === "running" || item.status === "queued"),
  );
  if (!job) return "";
  if (job.status === "queued") return "queued";
  return job.saved?.on === false ? "removing" : "installing";
}

/* Отказ словами очереди; «игра запущена» — словами карточки: переключить снова. */
function failureText(message, copy) {
  const running = failureWords({ kind: "game-running" }, "ru").reason;
  return String(message || "").startsWith(running)
    ? copy.gameRunning
    : String(message || "");
}

/* Отказ последней работы карточки, пока его строка висит в очереди. */
function cardFailure(card, jobs, copy) {
  const failed = jobs.find(
    (item) =>
      item.key === optimizationCardJobKey(card.id) && item.status === "failed",
  );
  return failed ? failureText(failed.error, copy) : "";
}

/* «Вернуть россыпь штатной» прямо на карточке (бета 15.10, whyl0tta: текст
   отказа звал к кнопке, а она была только в «Загрузках»). */
function cardRestore(card, jobs) {
  const failed = jobs.find(
    (item) =>
      item.key === optimizationCardJobKey(card.id) && item.status === "failed",
  );
  return canRestoreScatter(failed)
    ? () => retryWorkshopInstall(failed.id, { saved: restoreScatterTarget(failed) })
    : null;
}

/*
 * Какие части меняет переключение: у всей карточки — основной состав, что
 * ещё не стоит (включение), или всё, что стоит, вместе с отдельными частями
 * (выключение); у части — она сама. Шаг истории помнит именно их: отмена
 * возвращает ровно то, что было, а не «всю карточку».
 */
function changedParts(card, on, parts, partOn) {
  if (parts) return parts.filter((part) => partOn(part) !== on);
  return optimizationCardParts(card).filter((part) =>
    on ? !part.optional && !partOn(part) : partOn(part),
  );
}

const HISTORY_LIMIT = 50;

const TOOL_IDS = ["cut", "textures", "distance", "gray", "style"];

export default function OptimizerPage({
  locale: pageLocale = "ru",
  onNotice,
  onBack = null,
  /* Реестр редакторов зовёт выход `onExit`; `onBack` — прежнее имя. */
  onExit = null,
  /* Под шапкой мастерской (вкладка «Оптимизация»): своего заголовка со стрелкой «назад» нет. */
  embedded = false,
}) {
  const tr = useTr();
  /* Подписи раздела — на пяти языках, а мастерская отдаёт украинскому окну
     английский (`CatalogPages`: её общие подписи украинского не знают):
     украинское окно читает раздел по-украински (ТЗ 17.10.2026). */
  const language = useUiLanguage();
  const locale = language === "uk" ? "uk" : pageLocale;
  const copy = optimizerCopyFor(locale);
  /* «Редактировать» с оптимизации мода: окно «Что входит» первой карточки
     с её слоями — сразу открыто (`optimizer-focus.js`). */
  const [focus] = useState(takeOptimizerFocus);
  const textureCopy = textureCopyFor(locale);
  const drawCopy = drawDistanceCopyFor(locale);
  const supported = hasDesktopBridge() && optimizationLayersSupported();
  const [rememberedTool, setTool] = useRememberedState("optimizer:tool", "cut");
  /* С оптимизации мода открываются на карточках, где его слои, — что бы ни было запомнено. */
  const tool = focus ? "cut" : TOOL_IDS.includes(rememberedTool) ? rememberedTool : "cut";
  const queue = useWorkshopInstalls();
  /* Записи слоёв — подписка: снятие из «Библиотеки» видно сразу. */
  const records = useInstallRecords(OPTIMIZATION_RECORD_KEYS);
  /* Шаги истории — переключения, что дошли до игры: `{ id, on, parts }`. */
  const [history, setHistory] = useState({ past: [], future: [] });
  const cards = useMemo(() => {
    /* Снимок профиля переписывает работа очереди — перечитывается с ней. */
    const applied = readAppliedOptimizer();
    const target = new Set(profileTarget(queue, applied).enabled);
    const isOn = {
      tweak: (id) => target.has(id),
      layer: (id) => layerTarget(queue, id),
    };
    return OPTIMIZATION_CARDS.map((card) => ({
      card,
      state: optimizationCardState(card, isOn),
      partOn: (part) =>
        part.kind === "tweak" ? isOn.tweak(part.id) : isOn.layer(part.id),
      pending: cardPending(card, queue.jobs),
      failure: cardFailure(card, queue.jobs, copy),
      restore: cardRestore(card, queue.jobs),
    }));
    // `records` — сигнал: записи слоёв читаются из хранилища внутри.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, records, copy]);

  /* `from` — откуда переключение: правка, отмена или возврат. Шаг истории
     пишется, когда работа дошла до игры: отказ ничего не поменял. */
  const toggle = useCallback(
    (card, on, parts = null, from = "edit") => {
      if (!supported) return;
      const title = localizedText(card.title, locale);
      const entry = cards.find((item) => item.card.id === card.id);
      const changed = entry ? changedParts(card, on, parts, entry.partOn) : [];
      const outcome = toggleOptimizationParts({
        card,
        on,
        parts,
        snapshot: queue,
        applied: readAppliedOptimizer(),
        title,
        editor: copy.editor,
        locale,
      });
      void outcome?.then((result) => {
        if (result.cancelled) return;
        if (!result.ok) {
          onNotice?.(
            fillCopy(copy.failed, {
              title,
              reason: failureText(result.message, copy),
            }),
            "error",
          );
          return;
        }
        onNotice?.(
          fillCopy(on ? copy.doneOn : copy.doneOff, { title }),
          "success",
        );
        setHistory((current) => {
          if (from === "undo")
            return {
              past: current.past.slice(0, -1),
              future: [...current.future, { id: card.id, on: !on, parts }],
            };
          if (from === "redo")
            return {
              past: [...current.past, { id: card.id, on, parts }],
              future: current.future.slice(0, -1),
            };
          if (!changed.length) return current;
          return {
            past: [
              ...current.past.slice(1 - HISTORY_LIMIT),
              { id: card.id, on, parts: changed },
            ],
            future: [],
          };
        });
      });
    },
    [cards, copy, locale, onNotice, queue, supported],
  );

  /* Пока карточка в очереди, истории ждать: два переключения одной карточки
     подряд спорили бы за её работу. */
  const busy = cards.some((item) => item.pending);
  const lastPast = history.past.at(-1);
  const lastFuture = history.future.at(-1);
  const cardById = (id) => OPTIMIZATION_CARDS.find((item) => item.id === id);
  const undo = () => {
    if (!supported || busy || !lastPast) return;
    toggle(cardById(lastPast.id), !lastPast.on, lastPast.parts, "undo");
  };
  const redo = () => {
    if (!supported || busy || !lastFuture) return;
    toggle(cardById(lastFuture.id), lastFuture.on, lastFuture.parts, "redo");
  };
  useHistoryKeys({ undo, redo }, { enabled: supported && tool === "cut" });

  /* «Выключить всё» — каждая карточка, где что-то стоит, снимается своей
     работой: так её и видно на экране «В процессе». */
  const active = cards.filter((item) => item.state.count > 0);
  const offAll = () => active.forEach((item) => toggle(item.card, false));

  const total = cards.length;
  const inGame = cards.filter((item) => item.state.on).length;
  const status = supported
    ? fillCopy(copy.status, { count: inGame, total })
    : copy.desktopOnly;

  const focusCard = focus
    ? cards.find(({ card }) =>
        optimizationCardParts(card).some((part) =>
          focus.layers.includes(part.id),
        ),
      )?.card.id
    : "";
  /* Какая карточка показана в кадре: с оптимизации мода — та, где его слои; иначе — первая или выбранная. */
  const [pickedCard, setPickedCard] = useState(focusCard || OPTIMIZATION_CARDS[0].id);
  const picked = cardById(pickedCard) || OPTIMIZATION_CARDS[0];

  /* Гнёзда студии: кадр — в сцену, панель — в инспектор, полоса — под ними. Вкладки кладут туда свои куски порталом. */
  const [stageHost, setStageHost] = useState(null);
  const [panelHost, setPanelHost] = useState(null);
  const [stripHost, setStripHost] = useState(null);
  const slots = stageHost && panelHost && stripHost ? { stage: stageHost, panel: panelHost, strip: stripHost } : null;

  const tools = [
    { id: "cut", label: trText("Карточки"), hint: copy.cards },
    { id: "textures", label: textureCopy.tabTextures, hint: textureCopy.lead },
    { id: "distance", label: drawCopy.tab, hint: drawCopy.lead },
    {
      id: "gray",
      label: tr("ЧБ-мир"),
      hint: tr("Текстуры мира становятся серыми: здания, дороги, растения, машины и оружие."),
    },
    {
      id: "style",
      label: tr("Стиль мира"),
      hint: tr("Весь кадр игры — рисованным, комиксом, мультяшным, акварелью или ретро."),
    },
  ];

  const common = { locale, supported, editor: copy.editor, gameRunning: copy.gameRunning, onNotice, slots };
  /* «Что входит» выбранной карточки — прежнее большое окно с кадрами частей; с оптимизации мода оно открыто сразу (`focus`). */
  const [partsOpen, setPartsOpen] = useState(Boolean(focusCard));
  const pickedEntry = cards.find((item) => item.card.id === picked.id) || cards[0];
  const focusFor = (card) =>
    focus && optimizationCardParts(card).some((part) => focus.layers.includes(part.id))
      ? { ...focus, open: card.id === focusCard }
      : null;
  const pickedView = optimizationCardView({
    card: pickedEntry.card,
    locale,
    copy,
    state: pickedEntry.state,
    pending: pickedEntry.pending,
    failure: pickedEntry.failure,
    supported,
  });
  /* Пока гнёзда не встали, вкладке класть некуда: без них она нарисовала бы прежнюю секцию прямо в сцене. */
  const body =
    tool === "cut" ? (
      <>
        <OptimizationHero
          entry={pickedEntry}
          entries={cards}
          index={cards.indexOf(pickedEntry)}
          locale={locale}
          copy={copy}
          supported={supported}
          onToggle={toggle}
          onPick={setPickedCard}
          onMore={() => setPartsOpen(true)}
        />
        <p className="opf-caption">{fillText(copy.shot, { shot: pickedView.shot })}</p>
        <div className="opf-grid">
          <OptimizationParts
            entry={pickedEntry}
            locale={locale}
            copy={copy}
            supported={supported}
            onToggle={toggle}
            focus={focusFor(pickedEntry.card)}
          />
          <OptimizationHow copy={copy} />
        </div>
        {partsOpen && (
          <OptimizationPartsDialog
            card={pickedEntry.card}
            title={pickedView.title}
            locale={locale}
            copy={copy}
            shot={pickedView.shot}
            status={pickedView.status}
            partOn={pickedEntry.partOn}
            busy={pickedView.busy}
            supported={supported}
            onToggle={toggle}
            readOnly={false}
            focus={focusFor(pickedEntry.card)}
            onClose={() => setPartsOpen(false)}
          />
        )}
      </>
    ) : !slots ? null : tool === "textures" ? (
      <TextureDowngrade {...common} />
    ) : tool === "distance" ? (
      <DrawDistance {...common} />
    ) : tool === "gray" ? (
      <GrayWorld {...common} />
    ) : (
      <WorldStyle {...common} />
    );

  return (
    <OptimizerFrame
      embedded={embedded}
      title={copy.title}
      onBack={onExit || onBack}
      backLabel={copy.back}
      tools={tools}
      tool={tool}
      onTool={setTool}
      counts={{ cut: total }}
      summary={status}
      summaryOn={supported && inGame > 0}
      history={
        tool === "cut"
          ? {
              canUndo: supported && !busy && Boolean(lastPast),
              canRedo: supported && !busy && Boolean(lastFuture),
              onUndo: undo,
              onRedo: redo,
            }
          : null
      }
      onOffAll={tool === "cut" ? offAll : null}
      offAllLabel={copy.offAll}
      offAllDisabled={!supported || busy || !active.length}
      stageRef={setStageHost}
      panelRef={setPanelHost}
      stripRef={setStripHost}
      rebuildNote={
        /* Пакет текстур прежней сборки моделей (ТЗ 19.10.2026): над вкладками одного пакета. */
        tool === "textures" || tool === "gray" || tool === "style" ? (
          <TextureRebuildNote locale={locale} supported={supported} editor={copy.editor} gameRunning={copy.gameRunning} onNotice={onNotice} />
        ) : null
      }
    >
      {body}
    </OptimizerFrame>
  );
}
