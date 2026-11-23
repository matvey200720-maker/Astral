/*
 * Общее у редакторов перекраски: «Запретные зоны», «Завод», «Ангар»,
 * «Маппинг».
 *
 * Выросло из «Прострелов» (`WallbangStudio.jsx`): работа с отменой и
 * черновиком, «Мои работы» и код, подключение GTA V, «Применить» очередью
 * мастерской и «Откатить» записью установки. У каждого редактора свои кадр
 * и колонка правок, а это — одно на всех, чтобы четыре редактора не
 * разошлись в мелочах (один сохраняет черновик на выходе, другой нет).
 *
 * `contract` — договор набора из `@modovik/climb-contract/recolor`:
 * `{ create, parse, normalize, serialize, signature, isMod }`.
 *
 * У набора без файлов мода (вода) исходный облик — игра, а не мод:
 * `resetLabel` и `stockLabel` называют его («Как в игре»), а
 * `stockMeansRemoval` превращает «Применить» исходного облика в снятие
 * своей установки — ставить «как в игре» нечего. У набора с файлами мода и
 * «Стандартом» (арена) исходный облик — мод, а снимает установку
 * «Стандарт»: договор называет его `isStock`, а `reset` — что вернуть по
 * «⋯ → Как в игре» (у арены — только выбранный сервер). По умолчанию обе
 * подписи — «Как в игре»: так человек называет то, что видит в игре, даже
 * если основа — мод (п. 15, 30.10.2026).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Trash } from "../../../components/ui/icons.jsx";
import {
  chooseGameInstallation,
  detectInstallations,
  hasDesktopBridge,
  recolorSupported,
  sanitizeDesktopErrorMessage,
} from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { useInstallRecord } from "../useInstallRecord.js";
import {
  REPLACING_INSTALL_STEPS,
  applyWorkshopWork,
  useWorkshopApplyButton,
  workSignature,
} from "../install-queue/index.js";
import {
  RECOLOR_INSTALL_KEYS,
  installRecolor,
} from "../install-queue/tasks/recolor.js";
import {
  linkedEditorWork,
  saveEditorWorkToWorks,
  unlinkEditorWork,
} from "../works/workshop-works.js";
import { recolorCode } from "../works/work-transfer.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import { cameraGuide } from "./stage-camera.js";
import { tr } from "../../../locales/ui.js";

/* GTA V Legacy, которую нашёл поиск Astral, или кнопка «Подключить». */
function useLegacyGame() {
  const [gameRoot, setGameRoot] = useState("");
  const [failure, setFailure] = useState("");
  useEffect(() => {
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find(
          (item) =>
            item?.path &&
            String(item.edition || "Legacy").toLowerCase() === "legacy",
        );
        if (legacy) setGameRoot(legacy.path);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const connect = useMemo(() => {
    if (gameRoot || !hasDesktopBridge()) return null;
    return async () => {
      try {
        const chosen = await chooseGameInstallation();
        const picked = chosen?.path || chosen?.gameRoot || "";
        if (picked) setGameRoot(picked);
      } catch (error) {
        setFailure(sanitizeDesktopErrorMessage(error));
      }
    };
  }, [gameRoot]);
  return { gameRoot, failure, connect };
}

export function useRecolorEditor({
  set,
  kind = set,
  contract,
  storageKey,
  title,
  coverSlotId,
  onNotice,
  resetNotice,
  savedText,
  doneText,
  rolledBackText,
  /* Картинки работы для главного процесса (эмблема ангара) — обещание. */
  images = null,
  /*
   * Исходное у редакторов на моде (завод, маппинг, ангар, мегамолл) — облик мода, а не игры: откат возвращает его, и
   * подпись «Как в игре» была бы неправдой. Слово одно — «Облик мода» (`design-qa.md`, п. 15; «Как в моде» не употребляем);
   * свой облик редактор называет сам («Серый мода» у завода).
   */
  resetLabel = "Облик мода",
  stockLabel = "Облик мода",
  stockMeansRemoval = false,
  /* Подпись «Применить», когда она снимает установку (своя у арены). */
  removalTitle = "",
  /* Своя подпись кнопки и подсказка к ней («Установить» у «Интерьеров проектов», где ставятся файлы игрока). */
  applyLabel = "",
  installTitle = "",
  /* Подпись той же кнопки, когда она снимает установку («Снять из игры» вместо «Установить»). */
  removeLabel = "",
}) {
  const restore = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? contract.parse(stored) : contract.create();
    } catch {
      return contract.create();
    }
  }, [contract, storageKey]);
  const history = useSkyHistory(restore);
  const project = history.state;
  const installKey = RECOLOR_INSTALL_KEYS[set];
  const installRecord = useInstallRecord(installKey);

  const commit = useCallback(
    (update, label = null) =>
      history.commit((current) => contract.normalize(update(current)), label),
    [contract, history],
  );

  /* Достройка работы тем, что редактор выводит сам (картинка надписи): не шаг истории. */
  const amend = useCallback((update) => history.amend((current) => contract.normalize(update(current))), [contract, history]);

  /* --- Черновик и отмена --- */

  const projectRef = useRef(project);
  projectRef.current = project;
  const saveDraft = useCallback(() => {
    try {
      window.localStorage.setItem(
        storageKey,
        contract.serialize(projectRef.current),
      );
    } catch {
      /* приватный режим браузера — сохранять некуда, редактор работает дальше */
    }
  }, [contract, storageKey]);

  useEffect(() => {
    const timer = window.setTimeout(saveDraft, 500);
    return () => window.clearTimeout(timer);
  }, [project, saveDraft]);

  useEffect(() => {
    window.addEventListener("beforeunload", saveDraft);
    return () => {
      window.removeEventListener("beforeunload", saveDraft);
      saveDraft();
    };
  }, [saveDraft]);

  useHistoryKeys(history);

  /* --- Мои работы --- */

  const sourceName = useRef("");
  const works = useWorkActions({
    kind,
    onNotice,
    linkedName: () => linkedEditorWork(kind)?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      const { work, created } = saveEditorWorkToWorks(
        kind,
        contract.serialize(project),
        { name, asNew },
      );
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () =>
      recolorCode(kind, project, {
        name: linkedEditorWork(kind)?.name || sourceName.current,
      }),
    /* Код ложится шагом истории: «Отменить» возвращает свою работу. */
    onOpen: (result) => {
      const template = result.templates[0];
      history.commit(() => contract.parse(template.state), null);
      sourceName.current = template.name;
      unlinkEditorWork(kind);
    },
  });

  /** Готовый вид или сброс: шаг истории, работа больше не «та самая». */
  const replace = useCallback(
    (update, notice = "") => {
      commit(update, null);
      sourceName.current = "";
      unlinkEditorWork(kind);
      if (notice) onNotice?.(notice);
    },
    [commit, kind, onNotice],
  );

  const resetToMod = useCallback(
    () =>
      replace(
        (current) => (contract.reset ? contract.reset(current) : { ...contract.create(), name: current.name }),
        resetNotice,
      ),
    [contract, replace, resetNotice],
  );

  /* --- Игра и «Применить» --- */

  const game = useLegacyGame();
  const installSignature = useMemo(
    () => workSignature({ [set]: contract.signature(project) }),
    [contract, project, set],
  );
  const applyButton = useWorkshopApplyButton(installKey, installSignature);
  const busy = applyButton.pending;
  const installable = recolorSupported();

  /* `onDone` — свой отклик на успех (мастерская арены гасит строку «собрана старой версией»); кнопка передаёт сюда событие — оно не в счёт. */
  async function rollback({ onDone = null } = {}) {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      if (typeof onDone === "function") onDone();
      onNotice?.(rolledBackText);
    } catch (error) {
      onNotice?.(sanitizeDesktopErrorMessage(error), "error");
    }
  }

  function install({ onDone = null } = {}) {
    if (!game.gameRoot) return;
    const state = contract.serialize(project);
    const snapshot = contract.normalize(project);
    void applyWorkshopWork({
      key: installKey,
      signature: installSignature,
      title: project.name || title,
      editor: title,
      coverSlotId,
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText,
      run: async ({ report }) =>
        installRecolor({
          set,
          project: snapshot,
          state,
          images: images ? await images(snapshot) : null,
          report,
        }),
      doneText: ({ result }) => {
        if (typeof onDone === "function") onDone();
        return doneText(result);
      },
    });
  }

  const applyTitle = !installable
    ? tr("{0}: ставятся только в Astral Desktop").replace("{0}", () => tr(title))
    : !game.gameRoot
      ? game.failure || tr("GTA V Legacy пока не подключена")
      : applyButton.hint || installTitle || tr("Поставить «{0}» в GTA V Legacy").replace("{0}", () => tr(title));

  /*
   * Полоса действий редактора: отмена и возврат, «⋯» и «Применить».
   * Редактор ставит `EditorActions` сам — с `apply={editor.apply}` на виду:
   * кнопка в игру должна читаться в файле редактора, а не прятаться в общем
   * хуке. `more` — свои пункты «⋯» перед «Как в моде».
   *
   * В «⋯» (владелец, 03.10.2026): мои работы, код, чужая работа по коду,
   * сброс и «Снять из игры» — прежнее «Откатить», которое стояло отдельной
   * кнопкой в полосе. «Отмены» больше нет: она закрывала редактор, ничего не
   * отменяя.
   */
  function actionProps({ more = [], onMore = null, compare = false } = {}) {
    return {
      /* «Как в игре» по удержанию — только у редактора, чей кадр рисует `shown(…)`. */
      compare: compare ? { active: comparing, onChange: setComparing } : null,
      onUndo: history.undo,
      canUndo: history.canUndo,
      onRedo: history.redo,
      canRedo: history.canRedo,
      /* Группы чертой (ТЗ 29.10.2026, шапка): работы и коды, свои пункты редактора, сброс и снятие из игры. */
      more: [
        ...works.items,
        ...(more.length && works.items.length ? [{ separator: true }] : []),
        ...more,
        ...(works.items.length || more.length ? [{ separator: true }] : []),
        {
          value: "reset",
          label: tr(resetLabel),
          icon: <ArrowCounterClockwise />,
        },
        ...(installRecord.record
          ? [
              {
                value: "rollback",
                label: installRecord.rollingBack ? tr("Снимаем из игры…") : tr("Снять из игры"),
                icon: <Trash />,
                danger: true,
                disabled: busy || installRecord.rollingBack,
              },
            ]
          : []),
      ],
      onMore: (action) => {
        if (works.handle(action)) return;
        if (action === "reset") resetToMod();
        else if (action === "rollback") void rollback();
        else onMore?.(action);
      },
    };
  }

  /* Исходный облик набора без мода (или «Стандарт» арены): «Применить»
     снимает свою установку. */
  const stock = stockMeansRemoval && (contract.isStock || contract.isMod)(project);
  const apply = hasDesktopBridge()
    ? {
        label: (stock && installRecord.record && removeLabel) || applyLabel || tr("Применить"),
        title: stock
          ? installRecord.record
            ? removalTitle || tr("Снять «{0}» Astral — в игре станет {1}").replace("{0}", () => tr(title)).replace("{1}", () => tr(stockLabel).toLowerCase())
            : tr("{0} — ставить нечего").replace("{0}", () => (contract.isStock ? tr("Как в игре") : tr(stockLabel)))
          : applyTitle,
        disabled: !game.gameRoot || !installable || (stock && !installRecord.record),
        busy: applyButton.busy || (stock && installRecord.rollingBack),
        meter: applyButton.meter,
        onClick: stock ? rollback : install,
      }
    : null;

  /* Игра не найдена — «Подключить GTA V» стоит на виду: без неё
     «Применить» серое, и прятать причину в меню нельзя. */
  const gameButtons = game.connect ? (
    <Button variant="ghost" size="sm" onClick={game.connect}>
      {tr("Подключить GTA V")}
    </Button>
  ) : null;

  /*
   * Камера кадра — общая на всю мастерскую (`stage-camera.js`); её режим
   * нужен строке подсказок внизу кадра: в полёте — WASD, с эмблемой в руке —
   * её управление.
   */
  const [cameraMode, setCameraMode] = useState("orbit");

  /*
   * «Как в игре» по удержанию (ТЗ владельца 22.10.2026, часть 1, п. 4): пока
   * держат кнопку в полосе или «\», кадр рисует исходный облик набора — его
   * «Стандарт», а где его нет, чистую работу. Работа, панель и история не
   * меняются: `shown` подменяет только то, что редактор отдаёт кадру.
   */
  const [comparing, setComparing] = useState(false);
  const shown = useCallback(
    (value) => (comparing ? (contract.standard ? contract.standard(value) : contract.create()) : value),
    [comparing, contract],
  );
  const onCamera = useCallback((mode) => setCameraMode(mode), []);
  const guide = useCallback(
    (placing = false, extra = {}) => cameraGuide(cameraMode, { placing, ...extra }),
    [cameraMode],
  );

  const status = `${project.name || title} · ${
    /* Исходный облик — «Как в игре» во всех редакторах (`design-qa.md`, п. 15), не «Стандарт». */
    contract.isStock?.(project) ? tr("Как в игре") : contract.isMod(project) ? tr(stockLabel) : tr("Есть изменения")
  }`;

  return {
    project,
    history,
    commit,
    amend,
    replace,
    resetToMod,
    works,
    status,
    actionProps,
    apply,
    install,
    rollback,
    gameButtons,
    installRecord,
    cameraMode,
    onCamera,
    guide,
    comparing,
    shown,
  };
}
