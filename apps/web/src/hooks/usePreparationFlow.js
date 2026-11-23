import { useCallback, useEffect, useRef, useState } from "react";
import {
  auditLocalTarget,
  detectInstallations,
  getLocalInstallProfile,
  prepareGameInstallation,
} from "../api.js";
import {
  describeAstralLayer,
  describeRockstarCopy,
  preparationCopyFor,
} from "./preparation-copy.js";
import { writeWindowLog } from "../features/app-errors/report.js";

/*
 * Подготовка игры к установке модов: пять шагов от поиска установки до
 * синхронизации каталога, с состоянием, которое показывает PreparationDock.
 *
 * Жила внутри DesktopApp вместе со всей остальной оболочкой. Вынесена потому,
 * что это самостоятельный автомат со своим состоянием и своими текстами
 * (preparation-copy.js, пять языков): единственное, что связывает его с
 * оболочкой, — найденные установки, они уходят наружу через `setGames`.
 *
 * Каталог подготовка не качает (Т-100). Им владеет загрузчик окна — старт,
 * догрузка страниц и переподключение (`useCloudSession`, `acceptCatalog` с
 * номером ревизии). Свой `getCloudCatalog` на шаге «каталог» был вторым
 * потоком тех же запросов: после первой загрузки главный процесс отвечал на
 * него полной фоновой перезагрузкой всех страниц, а офлайн — ронял готовую
 * игру в «ошибку» подготовки из-за каталога, которого игра не ждёт.
 */

function preparationSteps(language) {
  const rows = preparationCopyFor(language).steps;
  return ["game", "build", "profile", "loader", "catalog"].map((id, index) => ({
    id,
    label: rows[index][0],
    detail: rows[index][1],
    status: "waiting",
  }));
}

/* Отказ подготовки чинится сам, как только его причина ушла: игру закрыли, Steam докачал, сеть вернулась. */
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000];

export function usePreparationFlow({
  account,
  bootstrapped,
  demoMode,
  game,
  language,
  localFirstRunQaMode,
  onboardingComplete,
  setGames,
  /* Вторая папка игры из Rockstar Games Launcher стала целью — выбрать её. */
  onSwitchGame = null,
  /* Поставленные работы, которые надо применить заново: `[{ set, modId }]`. */
  onSharedFarPlates = null,
  /* Работы с раздутой оболочкой зала (сборка до 10.11.2026): `[{ set, modId, name, graphicsMb }]`. */
  onHeavyShells = null,
  /* Работы «Арена» с моделью зала не со штатным строением (сборка до 20.11.2026, Majestic её не принимает): `[{ set, modId, names }]`. */
  onRebuiltShells = null,
}) {
  const preparationRun = useRef("");
  const retryRef = useRef({ timer: null, failures: 0 });
  const prepareRef = useRef(null);
  const sharedFarPlatesRef = useRef(onSharedFarPlates);
  sharedFarPlatesRef.current = onSharedFarPlates;
  const heavyShellsRef = useRef(onHeavyShells);
  heavyShellsRef.current = onHeavyShells;
  const rebuiltShellsRef = useRef(onRebuiltShells);
  rebuiltShellsRef.current = onRebuiltShells;
  const [preparation, setPreparation] = useState({
    status: "idle",
    progress: 0,
    message: "",
    steps: [],
  });
  const prepareGame = useCallback(
    async (target = game, { force = false, releaseStockHold = false } = {}) => {
      if (!target) return;
      if (!force && preparationRun.current === target.id) return;
      preparationRun.current = target.id;
      window.clearTimeout(retryRef.current.timer);
      const retrying = retryRef.current.failures > 0;
      const scheduleRetry = () => {
        const delay = RETRY_DELAYS_MS[Math.min(retryRef.current.failures, RETRY_DELAYS_MS.length - 1)];
        retryRef.current.failures += 1;
        retryRef.current.timer = window.setTimeout(() => void prepareRef.current?.(target, { force: true, releaseStockHold }), delay);
      };
      if (demoMode) {
        setPreparation({
          status: "ready",
          progress: 100,
          message: preparationCopyFor(language).demoReady,
          steps: preparationSteps(language).map((step) => ({
            ...step,
            status: "done",
          })),
        });
        return;
      }
      const prepMessages = preparationCopyFor(language).messages;
      let steps = preparationSteps(language);
      const update = (index, progress, status, message, detail = null) => {
        steps = steps.map((step, stepIndex) => ({
          ...step,
          status:
            stepIndex < index
              ? "done"
              : stepIndex === index
                ? status
                : "waiting",
          ...(stepIndex === index && detail ? { detail } : {}),
        }));
        setPreparation({ status: "running", progress, message, steps });
      };
      const revealQaStep = () =>
        localFirstRunQaMode
          ? new Promise((resolve) => window.setTimeout(resolve, 650))
          : Promise.resolve();
      try {
        update(0, 6, "active", prepMessages[0]);
        await revealQaStep();
        const found = await detectInstallations();
        let actual = found.find((item) => item.id === target.id) || target;
        setGames(found);
        update(
          1,
          24,
          "active",
          prepMessages[1],
          /* Копия из Rockstar Games Launcher откатывает update.rpf (Т-98). */
          [
            actual.store,
            actual.edition,
            actual.rockstarLauncher && preparationCopyFor(language).rockstar,
          ]
            .filter(Boolean)
            .join(" · "),
        );
        await revealQaStep();
        update(2, 43, "active", prepMessages[2]);
        await getLocalInstallProfile();
        /* Сверка файлов игры — на первой попытке: повтор раз в минуту дисков не гоняет. */
        if (!retrying) await auditLocalTarget({ targetId: actual.id }).catch(() => null);
        await revealQaStep();
        update(3, 66, "active", prepMessages[3]);
        /* После «Вернуть GTA V без модов» игра штатная до установки
           (Т-87): подготовка в неё не пишет. Снимает это сам игрок —
           «Установить», загрузчики в настройках (`releaseStockHold`). */
        actual = await prepareGameInstallation({
          targetId: actual.id,
          ...(releaseStockHold ? { releaseStockHold: true } : {}),
        });
        const stockHold = Boolean(actual.stockHold);
        /* Игра из Rockstar Games Launcher (задача 2 ТЗ 07.10.2026): моды —
           во второй папке, она и цель. Окно переходит на неё и не готовит
           её второй раз. */
        const copyDetail = describeRockstarCopy(actual.rockstarCopy, language);
        if (copyDetail)
          steps = steps.map((step) =>
            step.id === "game" ? { ...step, detail: copyDetail } : step,
          );
        if (actual.id && actual.id !== target.id && actual.rockstarCopy?.copy?.id) {
          preparationRun.current = actual.id;
          setGames(await detectInstallations().catch(() => found));
          onSwitchGame?.(actual.id);
        }
        /* Места мастерской переехали в пакет мест (фикс 1 ТЗ 06.10.2026):
           записи установок — на новые id. */
        if (actual?.placesMigration?.migrated?.length)
          await import("../features/workshop/places-records.js")
            .then((module) => module.rewriteMigratedPlaces(actual.placesMigration.migrated))
            .catch(() => 0);
        /* Работы со старой дальней копией плашки роняют Majestic (падение 30.10.2026): лечит только «Применить». */
        if (actual?.placesMigration?.sharedFarPlates?.length)
          sharedFarPlatesRef.current?.(actual.placesMigration.sharedFarPlates);
        /* Оболочка зала раздута нулевым хвостом страниц и роняет Majestic: лечит только «Применить» (разбор 10.11.2026). */
        /* Пересобранные модели зала Majestic (20.11.2026) — надмножество раздутых: один разговор с человеком, с кнопками в мастерской арены. */
        if (actual?.placesMigration?.rebuiltShells?.length) rebuiltShellsRef.current?.(actual.placesMigration.rebuiltShells);
        else if (actual?.placesMigration?.heavyShells?.length)
          heavyShellsRef.current?.(actual.placesMigration.heavyShells);
        setGames((current) =>
          current.map((item) => (item.id === actual.id ? actual : item)),
        );
        /* Слой Astral готовится вместе с игрой: резервная копия update.rpf
           и исходные реестры. Его состояние — строка под шагом профиля, а
           чужой слой без резервной копии — действие для человека, не
           молчаливый провал следующей установки. */
        const astralLayer = stockHold
          ? { status: "stock" }
          : actual.astralLayer || null;
        const layerDetail = describeAstralLayer(astralLayer, language);
        if (layerDetail) {
          steps = steps.map((step) =>
            step.id === "profile" ? { ...step, detail: layerDetail } : step,
          );
        }
        await revealQaStep();
        update(4, 84, "active", prepMessages[4]);
        steps = steps.map((step) => ({ ...step, status: "done" }));
        if (
          astralLayer?.status === "foreign-layer" ||
          astralLayer?.status === "shadowed"
        ) {
          scheduleRetry();
          setPreparation({
            status: "needs-action",
            progress: 86,
            message: astralLayer.message,
            steps: steps.map((step) =>
              step.id === "profile"
                ? { ...step, status: "action", detail: layerDetail }
                : step,
            ),
          });
          return;
        }
        if (!stockHold && actual.installReadiness !== "ready") {
          scheduleRetry();
          setPreparation({
            status: "needs-action",
            progress: 86,
            message: prepMessages[5],
            steps: steps.map((step) =>
              step.id === "loader"
                ? {
                    ...step,
                    status: "action",
                    detail: actual.requiredLoader || step.detail,
                  }
                : step,
            ),
          });
          return;
        }
        retryRef.current.failures = 0;
        setPreparation({
          status: "ready",
          progress: 100,
          message: prepMessages[6],
          steps,
          stockHold,
        });
      } catch (error) {
        preparationRun.current = "";
        scheduleRetry();
        /* Исходная причина — в журнал окна (док человеку говорит общее «Astral повторит сам»): первая строка. */
        writeWindowLog({ level: "warn", source: "preparation", message: `Подготовка GTA V не удалась: ${String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 300)}` });
        setPreparation({
          status: "error",
          progress: 0,
          message: error.message,
          steps,
        });
      }
    },
    [demoMode, game, language, localFirstRunQaMode, setGames, onSwitchGame],
  );
  prepareRef.current = prepareGame;
  useEffect(() => () => window.clearTimeout(retryRef.current.timer), []);
  useEffect(() => {
    if (!bootstrapped || !onboardingComplete || !account || !game) return;
    prepareGame(game);
  }, [account, bootstrapped, game, onboardingComplete, prepareGame]);

  return { preparation, prepareGame };
}
