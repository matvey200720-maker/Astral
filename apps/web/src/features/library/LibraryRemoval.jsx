import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  Square,
  Trash,
  Warning,
} from "../../components/ui/icons.jsx";
import Button from "../../components/ui/Button.jsx";
import Dialog from "../../components/ui/Dialog.jsx";
import {
  hasDesktopBridge,
  planLibraryRemoval,
  removeFromLibrary,
  rollbackOptimizerProfile,
  rollbackWorkshopResource,
} from "../../api.js";
import {
  APPLIED_OPTIMIZER_RECORD_KEY,
  applyLibraryRemovalResult,
} from "../../workshop-library.js";
import { OPTIMIZATION_TEXTURES_RECORD_KEY } from "@modovik/optimizer/layer-ids.js";

/* Запись поставленной растительности (та же, что у очереди установки). */
const VEGETATION_RECORD_KEY = "astral.vegetation.install.v1";
import { useWorkshopInstalls } from "../workshop/install-queue/index.js";
import {
  modFailureText,
  nativeBlockText,
  removalErrorText,
  removalProblemText,
  replayReasonText,
} from "./removal-words.js";

/*
 * Корзина библиотеки.
 *
 * Человек, у которого в игре стоит лишнее, хочет одного из двух: убрать всё
 * разом или отметить, что именно убрать. Оба пути начинаются с одной кнопки:
 * корзина на полосе разделов переводит полку в режим выбора, и на её месте
 * встаёт красное «Удалить выбранное», а слева от него — «Выбрать всё»
 * (владелец, 24.09.2026). Карточки отмечаются нажатием. Отдельной полосы с
 * «Удалить всё» над полкой больше нет: «всё» — это «Выбрать всё», и
 * спрашивает о нём то же окно.
 *
 * Окно не спрашивает вслепую. До кнопки «Удалить» оно получает план от
 * приложения: что уйдёт из игры, что уже не в игре, что придётся снять и
 * поставить обратно (работы, лежащие поверх удаляемой) и что мешает. Так
 * «Удалить» никогда не оказывается сюрпризом на третьей минуте.
 *
 * Отмечается карточка, а не установка: «Трейсеры» и «Эффекты попадания»
 * стоят в игре одним патчем, но отметка одной карточки больше не отмечает
 * вторую, и удаление уносит только отмеченное — набор эффектов
 * пересобирается без него (`removal-request.js`, `effects-split.js`). Так же
 * снимаются звуки попадания: голова и тело — один мод на двух карточках
 * (`sound-hits-split.js`).
 */

const format = (template, values) =>
  String(template || "").replace(/\{(\w+)\}/g, (_, key) =>
    values[key] === undefined ? "" : String(values[key]),
  );

/* Форма слова по числу: одна, несколько, много — русский и польский её
   различают, английский и немецкий берут вторую для всего, кроме единицы. */
function pluralForm(locale, count, forms) {
  const [one, few, many] = forms;
  if (!["ru", "pl"].includes(locale)) return count === 1 ? one : few;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (locale === "ru" && mod10 === 1 && mod100 !== 11) return one;
  if (locale === "pl" && count === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Режим выбора полки: отмеченные карточки (id). `resetKey` — раздел: уходя в
 * другой раздел, человек уходит и из выбора, иначе отметки невидимо жили бы
 * на чужой полке.
 */
export function useLibrarySelection(resetKey) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    setActive(false);
    setSelected(new Set());
  }, [resetKey]);

  const start = useCallback(() => {
    setSelected(new Set());
    setActive(true);
  }, []);
  const stop = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);
  /* Библиотека v2 (16.11.2026): режима «включить корзину» нет — отметка на плитке стоит всегда, и выбор идёт, пока что-то отмечено. */
  const picking = active || selected.size > 0;
  const toggle = useCallback((id) => {
    if (!id) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const replace = useCallback((ids) => setSelected(new Set(ids)), []);
  const add = useCallback(
    (ids) => setSelected((current) => new Set([...current, ...(ids || [])])),
    [],
  );

  /* Escape выходит из выбора — но не тогда, когда поверх открыто окно: там
     Escape принадлежит окну. */
  useEffect(() => {
    if (!picking) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".ui-dialog-backdrop:not(.is-kept)")) return;
      stop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking, stop]);

  return { active: picking, selected, start, stop, toggle, replace, add };
}

/**
 * Кнопка корзины на полосе разделов. `busy` — удаление уже идёт: корзина
 * ждёт его конца, а не открывает второе поверх.
 */
export function LibraryTrashButton({ copy, onClick, busy = false }) {
  const label = busy ? copy.removing : copy.startLabel;
  return (
    <Button
      className="library-trash-button"
      variant="secondary"
      icon={<Trash />}
      disabled={busy}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {busy ? copy.removing : copy.start}
    </Button>
  );
}

/**
 * Корзина в режиме выбора — там же, где стояла, на полосе разделов.
 *
 * Сама корзина становится красным «Удалить выбранное» со счётом отмеченного,
 * слева от неё — «Выбрать всё» (оно же «Снять выбор», когда отмечено всё), а
 * первой — «Отмена»: выйти из выбора, ничего не удалив. Кнопка удаления серая,
 * пока ничего не отмечено, — нажать её впустую нельзя.
 */
export function LibrarySelectionActions({
  copy,
  entries,
  selection,
  onRemove,
}) {
  const count = entries.filter((entry) =>
    selection.selected.has(entry.id),
  ).length;
  const everything = entries.length > 0 && count === entries.length;

  /*
   * Клавиши — как в проводнике: Ctrl+A отмечает всю полку, Delete — то же,
   * что «Удалить выбранное», то есть окно подтверждения, а не удаление
   * сразу. Пока поверх открыто окно или курсор в поле ввода, клавиши их.
   */
  const keys = useRef({});
  keys.current = { entries, selection, onRemove, count };
  useEffect(() => {
    const onKey = (event) => {
      if (document.querySelector(".ui-dialog-backdrop:not(.is-kept)")) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable]"))
        return;
      const {
        entries: all,
        selection: marks,
        onRemove: remove,
        count: marked,
      } = keys.current;
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyA") {
        event.preventDefault();
        marks.replace(all.map((entry) => entry.id));
      } else if (event.key === "Delete" && marked) {
        event.preventDefault();
        remove();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="library-shelf-actions" role="group" aria-label={copy.pick}>
      <Button
        className="library-selection-cancel"
        variant="ghost"
        onClick={selection.stop}
      >
        {copy.cancel}
      </Button>
      <Button
        className="library-select-all"
        variant="secondary"
        icon={everything ? <Square /> : <CheckSquare />}
        onClick={() =>
          selection.replace(everything ? [] : entries.map((entry) => entry.id))
        }
      >
        {everything ? copy.clearAll : copy.selectAll}
      </Button>
      <Button
        className="library-remove-selected"
        variant="danger"
        icon={<Trash />}
        disabled={!count}
        onClick={onRemove}
        /* Читалка экрана называет кнопку вместе со счётом: знак с числом
           рисунок, и прочитан он не будет. */
        aria-label={
          count
            ? `${copy.removeSelected} · ${format(copy.selected, { count })}`
            : copy.removeSelected
        }
        trailing={
          count ? (
            <span className="library-remove-count" aria-hidden="true">
              {count}
            </span>
          ) : null
        }
      >
        {copy.removeSelected}
      </Button>
    </div>
  );
}

const nativeRequest = (unit) => ({
  restorePointId: unit.restorePointId || "",
  patch: unit.patch || "",
});

/* Установки, которые окно снимает само, после приложения: ресурс FiveM
   своей дорогой, настройка оптимизации — возвратом settings.xml. */
function splitUnits(units) {
  const natives = [];
  const mods = [];
  const resources = [];
  const records = [];
  let optimizer = null;
  const seenNative = new Set();
  const seenMod = new Set();
  for (const unit of units) {
    if (unit.kind === "optimizer") {
      optimizer = unit;
      if (unit.restorePointId && !seenNative.has(unit.restorePointId)) {
        seenNative.add(unit.restorePointId);
        natives.push(nativeRequest(unit));
      }
    } else if (unit.kind === "native") {
      if (seenNative.has(unit.restorePointId)) continue;
      seenNative.add(unit.restorePointId);
      natives.push(nativeRequest(unit));
    } else if (unit.kind === "mod") {
      if (seenMod.has(unit.modId)) continue;
      seenMod.add(unit.modId);
      mods.push(unit.modId);
    } else if (unit.kind === "resource") {
      resources.push(unit);
    } else {
      records.push(unit);
    }
  }
  return { natives, mods, resources, records, optimizer };
}

const samePatch = (left, right) =>
  Boolean(left && right) &&
  String(left).replaceAll("\\", "/").toLowerCase() ===
    String(right).replaceAll("\\", "/").toLowerCase();

const EMPTY_PLAN = Object.freeze({
  status: "ready",
  natives: [],
  mods: [],
  replays: [],
  problems: [],
});

/* Постоянные «пусто» по умолчанию: новый массив на каждую перерисовку
   заново запрашивал бы план — окно спрашивает его по смене списков. */
const NO_SPLITS = Object.freeze([]);
const NO_UNITS = Object.freeze([]);

/*
 * Пересборка без отмеченных частей — у каждого вида установки своя: набор
 * эффектов собирается в главном процессе, звуки попадания — рендером звука
 * в окне. Модули ленивые: без частей в выделенном их не грузят вовсе.
 */
const SPLIT_MODULES = Object.freeze({
  effects: () =>
    import("./effects-split.js").then((module) => ({
      plan: module.planEffectsSplit,
      remove: module.removeEffectsParts,
    })),
  "sound-hits": () =>
    import("./sound-hits-split.js").then((module) => ({
      plan: module.planSoundHitsSplit,
      remove: module.removeSoundHitsParts,
    })),
});

const splitModule = (split) =>
  (SPLIT_MODULES[split.kind] || SPLIT_MODULES.effects)();

/* Можно ли снять части — по плану на каждую установку. */
async function planSplits(splits, targetId) {
  if (!splits.length) return {};
  const plans = await Promise.all(
    splits.map(async (split) =>
      (await splitModule(split)).plan({ parts: split.parts, targetId }),
    ),
  );
  return Object.fromEntries(
    splits.map((split, index) => [split.key, plans[index]]),
  );
}

/* Что сейчас пишет в игру — чужая работа очереди, удаление или установка из
   каталога. Пока оно идёт, удаление начинать нельзя: замок на архив игры
   один на всё окно, и второе дело получило бы отказ посреди окна. */
function writingNow(installs) {
  const live = installs.jobs.find(
    (job) => job.status === "running" || job.status === "queued",
  );
  return live?.title || installs.external?.title || installs.held || "";
}

/**
 * Окно подтверждения, выполнения и итога удаления.
 *
 * `entries` — карточки, которые уходят (для списка и названий; `together` —
 * уходят вместе с отмеченной), `units` — установки, которые снимаются
 * целиком, `splits` — наборы эффектов, которые пересобираются без отмеченных
 * частей, `knownUnits` — все установки полки: по ним называются работы,
 * которые придётся поставить обратно.
 */
export function LibraryRemovalDialog({
  copy,
  locale,
  targetId,
  entries,
  units,
  splits = NO_SPLITS,
  knownUnits = NO_UNITS,
  onClose,
  /* Человек нажал «Удалить»: полке пора выйти из выбора и погасить
     уходящие карточки — удаление идёт минутами, и второе нажатие по тем же
     карточкам посреди него было бы тем же удалением ещё раз. */
  onStarted,
  onFinished,
  onInclude,
  onIncludeWhole,
  onQueueRemoval,
  /* «Работы останутся в Моих работах» — правда в библиотеке и неправда там,
     где удаляют саму работу. */
  worksNote = true,
}) {
  const request = useMemo(() => splitUnits(units), [units]);
  const [phase, setPhase] = useState("planning");
  const [plan, setPlan] = useState(null);
  const [splitPlans, setSplitPlans] = useState({});
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState(null);
  const planRequest = useRef(0);
  const writing = writingNow(useWorkshopInstalls());
  /* Обработчики родителя меняются с каждой его перерисовкой, а план должен
     запрашиваться один раз на набор установок, а не на каждый кадр полки. */
  const callbacks = useRef({ onClose, onQueueRemoval });
  callbacks.current = { onClose, onQueueRemoval };

  const nameOf = useCallback(
    (reference) => {
      const unit = knownUnits.find(
        (item) =>
          (reference.restorePointId &&
            item.restorePointId === reference.restorePointId) ||
          samePatch(item.patch, reference.patch),
      );
      return unit?.name || copy.unnamed;
    },
    [knownUnits, copy.unnamed],
  );

  const runPlan = useCallback(async () => {
    const ticket = ++planRequest.current;
    setPhase("planning");
    setError("");
    try {
      const [next, nextSplits] = await Promise.all([
        request.natives.length || request.mods.length
          ? planLibraryRemoval({
              targetId,
              natives: request.natives,
              mods: request.mods,
            })
          : EMPTY_PLAN,
        planSplits(splits, targetId),
      ]);
      if (ticket !== planRequest.current) return;
      setPlan(next);
      setSplitPlans(nextSplits);
      setPhase("confirm");
    } catch (nextError) {
      if (ticket !== planRequest.current) return;
      setError(removalErrorText(nextError, locale));
      setPhase("error");
    }
  }, [locale, request, splits, targetId]);

  useEffect(() => {
    /* Без приложения (демо, браузер без песочницы) снять можно только моды
       каталога — очередью загрузок; работы мастерской живут в архиве игры. */
    const { onClose: close, onQueueRemoval: queue } = callbacks.current;
    if (
      !hasDesktopBridge() &&
      !request.natives.length &&
      !splits.length &&
      request.mods.length &&
      queue
    ) {
      queue(request.mods);
      close();
      return;
    }
    void runPlan();
  }, [runPlan, request, splits.length]);

  const statusOf = (unit) => {
    if (unit.kind === "record")
      return { tone: "blocked", text: copy.cannot, detail: copy.recordOnly };
    if (unit.kind === "native" || unit.kind === "optimizer") {
      const item = plan?.natives?.find(
        (native) =>
          native.restorePointId === unit.restorePointId ||
          samePatch(native.patch, unit.patch),
      );
      if (item?.action === "blocked")
        return {
          tone: "blocked",
          text: copy.cannot,
          detail: nativeBlockText(item, locale),
        };
      if (item?.action === "forget" || item?.action === "missing")
        return { tone: "gone", text: copy.gone };
    }
    if (unit.kind === "mod") {
      const item = plan?.mods?.find((mod) => mod.modId === unit.modId);
      if (item?.action === "missing") return { tone: "gone", text: copy.gone };
    }
    return null;
  };

  /* Слова пересборки — у набора эффектов и у звуков попадания свои. */
  const splitCopy = (split) =>
    (split?.kind === "sound-hits" && copy.soundSplit) || copy.split;
  /* Установка без отмеченных частей: что мешает её пересобрать. */
  const splitProblem = (split) => {
    const status = splitPlans[split.key]?.status;
    if (!status || status === "ready" || status === "gone") return "";
    const words = splitCopy(split);
    return words[status] || words.unknown;
  };
  const splitOf = (unit) =>
    splits.find((split) => split.unit.key === unit.key) || null;

  const blocking = plan?.status === "blocked" ? plan.problems || [] : [];
  const splitBlocking = splits.filter((split) => splitProblem(split));
  const removable =
    plan &&
    plan.status !== "blocked" &&
    !splitBlocking.length &&
    (splits.length > 0 ||
      units.some((unit) => {
        const status = statusOf(unit);
        return !status || status.tone === "gone";
      }));

  const confirm = async () => {
    setPhase("removing");
    setError("");
    onStarted?.();
    try {
      const result =
        request.natives.length || request.mods.length
          ? await removeFromLibrary({
              targetId,
              natives: request.natives,
              mods: request.mods,
            })
          : { natives: [], mods: [], remap: {}, lost: [], failedMods: [] };
      const installIds = [];
      const failures = [];
      /* Что не снялось — по установкам: карточка с такой установкой не входит в «Удалено из игры: N». */
      const failedKeys = new Set();
      for (const unit of request.resources) {
        try {
          await rollbackWorkshopResource({ installId: unit.installId });
          installIds.push(unit.installId);
        } catch (resourceError) {
          failedKeys.add(unit.key);
          failures.push({
            name: unit.name,
            message: removalErrorText(resourceError, locale),
          });
        }
      }
      if (request.optimizer) {
        const previous = request.optimizer.settingsPrevious || {};
        try {
          if (Object.keys(previous).length)
            await rollbackOptimizerProfile({ restorePointId: "", previous });
          globalThis.localStorage?.removeItem(APPLIED_OPTIMIZER_RECORD_KEY);
        } catch (optimizerError) {
          failedKeys.add(request.optimizer.key);
          failures.push({
            name: request.optimizer.name,
            message: removalErrorText(optimizerError, locale),
          });
        }
      }
      applyLibraryRemovalResult(globalThis.localStorage, result, {
        installIds,
      });
      /* Ступень «Ухудшения текстур» (задача 1 ТЗ 05.10.2026) и растительность
         (задача 5 ТЗ 06.10.2026, вечер) собраны поверх файлов снятых работ:
         обе собираются заново без них. */
      if (
        /* Пересобранное главным процессом (задача 3 ТЗ 10.10.2026) — записи
           окна переезжают на новые пакеты и без своих записей. */
        result?.rebuilt ||
        globalThis.localStorage?.getItem(OPTIMIZATION_TEXTURES_RECORD_KEY) ||
        globalThis.localStorage?.getItem(VEGETATION_RECORD_KEY)
      ) {
        try {
          const { refreshAfterRemoval } =
            await import("../workshop/install-queue/tasks/recolor.js");
          await refreshAfterRemoval(result);
        } catch (refreshError) {
          failures.push({
            name: copy.rebuildName,
            message: removalErrorText(refreshError, locale),
          });
        }
      }
      for (const item of result.failedMods || []) {
        failedKeys.add(`mod:${item.modId}`);
        failures.push({
          name:
            units.find((unit) => unit.modId === item.modId)?.name ||
            copy.failedMod,
          message: modFailureText(item.message, locale),
        });
      }
      for (const item of result.lost || [])
        failures.push({ name: nameOf(item), message: copy.lostWork });
      /* Моды сняты, а слои каталога поверх работ не встали (чаще всего — нет места на диске): раньше поле главный процесс отдавал, а окно его не читало
         и показывало «Удалено», хотя часть модов в игре пропала до следующей подготовки. Причина — теми же словами, что у отказа установки. */
      if (result.engineRecomposeFailed)
        failures.push({
          name: copy.kinds.mod,
          message: removalErrorText(result.engineRecomposeFailed, locale),
        });
      /*
       * Части наборов эффектов — после удаления: пересборка ложится поверх
       * того, что осталось, и читает запись набора такой, какой её оставило
       * удаление (точку, переставленную на место, — под новым именем). Идёт
       * она очередью применения, строкой «Удаление» на экране «В процессе».
       */
      const failedSplits = new Set();
      if (splits.length) {
        for (const split of splits) {
          const title = split.titles.join(", ");
          const words = splitCopy(split);
          try {
            const { remove } = await splitModule(split);
            await remove({
              parts: split.parts,
              targetId,
              title,
              editor: words.editor,
              explain: (status) => words[status] || words.unknown,
            });
          } catch (splitError) {
            failedSplits.add(split.key);
            failures.push({
              name: title,
              message: removalErrorText(splitError, locale),
            });
          }
        }
      }
      const blocked = units.filter(
        (unit) => statusOf(unit)?.tone === "blocked",
      );
      const removedCount = entries.filter((entry) =>
        entry.units.every((unit) => {
          if (statusOf(unit)?.tone === "blocked") return false;
          if (failedKeys.has(unit.key)) return false;
          const split = splitOf(unit);
          return !split || !failedSplits.has(split.key);
        }),
      ).length;
      onFinished?.({ result, removedCount });
      if (failures.length || blocked.length) {
        setOutcome({ failures, blocked, removedCount });
        setPhase("result");
        return;
      }
      onClose();
    } catch (removalError) {
      setError(removalErrorText(removalError, locale));
      setPhase("error");
    }
  };

  const busy = phase === "removing";
  const title =
    phase === "error"
      ? copy.errorTitle
      : phase === "result"
        ? copy.partialTitle
        : format(copy.titleSelected, {
            count: entries.length,
            items: pluralForm(locale, entries.length, copy.items),
          });
  const replays = plan?.replays || [];
  const replayNames = [...new Set(replays.map(nameOf))];
  const touchesArchive =
    plan &&
    (plan.rewind ||
      replays.length ||
      splits.length ||
      (plan.mods || []).some((item) => item.action === "remove"));
  const quiet = !blocking.length && !splitBlocking.length;

  /* Широкое окно (ТЗ 05.10, задача 16): слева — что происходит и что
     мешает, справа — что уйдёт из игры, сеткой строк. */
  const planned = (phase === "confirm" || phase === "removing") && plan;
  const aside = planned ? (
    <>
      <p className="library-removal-lead" id="library-removal-lead">
        {copy.lead}
      </p>
      {/* Причина, по которой «Удалить» не нажимается, стоит сразу под
              вводной строкой, а не в конце длинного списка (Т-136). */}
      {writing && phase === "confirm" && (
        <p className="library-removal-note" role="status">
          {format(copy.busy, { name: writing })}
        </p>
      )}
      {blocking.map((problem, index) => {
        const include =
          problem.code === "replay-unavailable"
            ? knownUnits.find(
                (unit) =>
                  unit.restorePointId === problem.restorePointId ||
                  samePatch(unit.patch, problem.patch),
              )
            : null;
        return (
          <div
            className="library-removal-problem"
            role="alert"
            key={`${problem.code}-${index}`}
          >
            <Warning weight="fill" aria-hidden="true" />
            <span>
              {include && problem.reason
                ? format(copy.replayBlocked, {
                    name: include.name || copy.unnamed,
                    reason: replayReasonText(problem, locale),
                  })
                : removalProblemText(problem, locale)}
            </span>
            {include && onInclude && (
              <Button variant="secondary" onClick={() => onInclude(include)}>
                {format(copy.includeToo, {
                  name: include.name || copy.unnamed,
                })}
              </Button>
            )}
          </div>
        );
      })}
      {splitBlocking.map((split) => (
        <div className="library-removal-problem" role="alert" key={split.key}>
          <Warning weight="fill" aria-hidden="true" />
          <span>{splitProblem(split)}</span>
          {onIncludeWhole && (
            <Button variant="secondary" onClick={() => onIncludeWhole(split)}>
              {splitCopy(split).whole}
            </Button>
          )}
        </div>
      ))}
      {quiet &&
        splits.map((split) => (
          <p className="library-removal-note" key={split.key}>
            {format(splitCopy(split).keep, {
              names: (split.kept.length
                ? split.kept.map((item) => item.title)
                : split.keep.map((part) => splitCopy(split).parts[part])
              ).join(", "),
            })}
          </p>
        ))}
      {replayNames.length > 0 && quiet && (
        <p className="library-removal-note">
          {format(copy.replays, { names: replayNames.join(", ") })}
        </p>
      )}
      {touchesArchive && quiet && (
        <p className="library-removal-note">{copy.slow}</p>
      )}
      {worksNote &&
        (request.natives.length > 0 || splits.length > 0) &&
        quiet && <p className="library-removal-note">{copy.works}</p>}
    </>
  ) : null;

  return (
    <Dialog
      /* Пока идёт удаление, рассказывает о нём строка на экране «В процессе»;
         вопрос, на который уже ответили, под ней не висит. */
      open={!busy}
      className="library-removal-dialog"
      size={planned ? "wide" : "md"}
      aside={aside}
      asideLabel={copy.asideLabel}
      role="alertdialog"
      title={title}
      titleId="library-removal-title"
      descriptionId="library-removal-lead"
      closeLabel={copy.cancel}
      dismissible={!busy}
      onClose={onClose}
      actions={
        phase === "result" || phase === "error" ? (
          <>
            {phase === "error" && (
              <Button variant="secondary" onClick={() => void runPlan()}>
                {copy.retry}
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              {copy.close}
            </Button>
          </>
        ) : (
          <>
            <Button
              autoFocus
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              {copy.cancel}
            </Button>
            <Button
              variant="danger"
              icon={<Trash />}
              disabled={phase !== "confirm" || !removable || Boolean(writing)}
              onClick={confirm}
            >
              {busy ? copy.removing : copy.confirm}
            </Button>
          </>
        )
      }
    >
      {phase === "planning" && (
        <p
          className="library-removal-lead"
          id="library-removal-lead"
          aria-live="polite"
        >
          {copy.checking}
        </p>
      )}

      {phase === "error" && (
        <p
          className="library-removal-problem"
          id="library-removal-lead"
          role="alert"
        >
          <Warning weight="fill" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {phase === "result" && outcome && (
        <div className="library-removal-outcome" id="library-removal-lead">
          <p className="library-removal-lead">
            {format(copy.done, { count: outcome.removedCount })}
          </p>
          <ul className="library-removal-list">
            {[...outcome.failures, ...outcome.blocked].map((item, index) => (
              <li key={`${item.name}-${index}`} data-tone="blocked">
                <span>
                  <b>{item.name || copy.unnamed}</b>
                  <small>{item.message || statusOf(item)?.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {planned && (
        <section aria-label={copy.listLabel}>
          <ul className="library-removal-list">
            {entries.map((entry) => {
              const statuses = entry.units.map(statusOf).filter(Boolean);
              const blocked = statuses.find(
                (status) => status.tone === "blocked",
              );
              const gone =
                statuses.length === entry.units.length &&
                statuses.every((status) => status.tone === "gone");
              const shown =
                blocked ||
                (gone
                  ? statuses[0]
                  : entry.together
                    ? { tone: "together", text: copy.together }
                    : null);
              return (
                <li key={entry.id} data-tone={shown?.tone || "remove"}>
                  <span>
                    <b>{entry.title}</b>
                    <small>
                      {blocked?.detail ||
                        (entry.together
                          ? copy.togetherHint
                          : [
                              ...new Set(
                                entry.units.flatMap((unit) => [
                                  splitOf(unit)
                                    ? splitCopy(splitOf(unit)).kind
                                    : /* Мод, собранный мастерской (звук
                                         ствола, большая карта), — работа, а
                                         не мод из каталога. */
                                      unit.origin
                                      ? copy.kinds.record
                                      : copy.kinds[unit.kind],
                                  unit.name,
                                ]),
                              ),
                            ]
                              .filter(Boolean)
                              .join(" · "))}
                    </small>
                  </span>
                  {shown && <em>{shown.text}</em>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
