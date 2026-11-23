/*
 * Общее состояние страницы ReShade (ТЗ 17.10, задача 8; с ТЗ 23.10, п. G, —
 * одна страница вместо двух вкладок): что стоит в играх, выбор DLSS 5, клавиша
 * меню и применение. ReShade, пресет и DLSS 5 ставят одно и то же — ReShade в
 * найденные проекты, — поэтому читают и пишут через одного владельца: что
 * стоит на самом деле, берётся из ответа главного процесса, а не из памяти
 * окна. Окно помнит только то, чего в играх нет: числа нейросети и клавишу
 * меню, выбранную до установки.
 */

import { useCallback, useEffect, useState } from "react";
import { normalizeReshadeProject } from "@modovik/optimizer/reshade.js";

import {
  applyReshade,
  detectInstallations,
  readReshade,
  sanitizeDesktopErrorMessage,
} from "../../api.js";

const PROJECT_KEY = "astral.reshade.project.v1";

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(PROJECT_KEY);
    return normalizeReshadeProject(stored ? JSON.parse(stored) : {});
  } catch {
    return normalizeReshadeProject({});
  }
}

/*
 * Что стоит в месте установки. Записи установок до пресетов (и ответ без
 * поля `project`) — это DLSS 5 без пресета: так они и ставились.
 */
export function placeProject(status) {
  if (!status?.installed) return null;
  if (status.project) return normalizeReshadeProject(status.project);
  return normalizeReshadeProject({ dlss: { enabled: true } });
}

export function useReshade(onNotice) {
  const [project, setProject] = useState(restoreProject);
  const [gameRoot, setGameRoot] = useState("");
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    try {
      window.localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    } catch {
      /* приватный режим — выбор живёт до закрытия вкладки */
    }
  }, [project]);

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

  const refresh = useCallback(async () => {
    try {
      setState(await readReshade({ gameRoot }));
    } catch (error) {
      onNotice?.(sanitizeDesktopErrorMessage(error), "error");
    }
  }, [gameRoot, onNotice]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const change = useCallback(
    (update) =>
      setProject((current) => normalizeReshadeProject(update(current))),
    [],
  );

  /* Что стоит сейчас: по первому месту, где ReShade есть (в обоих — одно и то же). */
  const installedTargets = (state?.targets || []).filter(
    (item) => item.installed,
  );
  const installedProject = installedTargets.length
    ? placeProject(installedTargets[0])
    : null;
  const dlssOn = Boolean(installedProject?.dlss.enabled);
  const presetOn = installedProject?.preset || "";
  /* Клавиша меню: у поставленного ReShade — та, что записана в нём; до установки — выбранная в окне. */
  const menuKey = installedProject
    ? installedProject.overlayKey
    : project.overlayKey;

  /**
   * Проект для записи в игры: как стоит сейчас (пресет, DLSS 5 и клавиша — из игр, не из памяти окна), с поправкой.
   * Всё, что делают с этой страницы, оставляет ReShade стоять (`reshade: true`), кроме «Удалить».
   */
  const projectFor = useCallback(
    ({
      reshade = true,
      preset = presetOn,
      dlss = dlssOn,
      overlayKey = menuKey,
    } = {}) =>
      normalizeReshadeProject({
        ...project,
        reshade,
        overlayKey,
        preset,
        dlss: { ...project.dlss, enabled: dlss },
      }),
    [project, presetOn, dlssOn, menuKey],
  );

  /**
   * Записать проект в игры. `next` собирает вкладка; возвращает ответ
   * главного процесса или `null` при отказе (отказ уже показан уведомлением).
   */
  const run = useCallback(
    async (kind, next, extra = {}) => {
      setBusy(kind);
      try {
        const result = await applyReshade({
          gameRoot,
          project: next,
          ...extra,
        });
        setProject(next);
        await refresh();
        return result;
      } catch (error) {
        onNotice?.(sanitizeDesktopErrorMessage(error), "error");
        return null;
      } finally {
        setBusy("");
      }
    },
    [gameRoot, onNotice, refresh],
  );

  return {
    project,
    change,
    gameRoot,
    state,
    busy,
    refresh,
    run,
    installedTargets,
    installedProject,
    installed: installedTargets.length > 0,
    dlssOn,
    presetOn,
    menuKey,
    projectFor,
    compatibility: state?.compatibility || null,
    /* DLSS 5 нужен весь пакет; пресетам — только сам ReShade. */
    packMissing: Boolean(state) && (!state.pack?.found || !state.pack.dlss),
    reshadeMissing: Boolean(state) && !state.pack?.found,
  };
}
