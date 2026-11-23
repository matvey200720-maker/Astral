/*
 * Мини-карта и экран игры (ТЗ 02.11.2026: «в Астрале ровно, в игре сдвинута и очень большая»; ТЗ H1 14.11.2026).
 *
 * Числа frontend.xml игра умножает на форму своего экрана и отсчитывает от края безопасной зоны, поэтому они верны только для
 * экрана, под который карта поставлена. Сменил формат или безопасную зону в игре после установки — карта уехала, хотя в окне
 * всё по-прежнему. Поэтому окно помнит метку экрана последней установки (форма, безопасная зона и версия формулы расчёта
 * места — `minimapScreenMark`) и при запуске, если любая из трёх теперь другая, ставит работу заново. Метки ещё нет — работа
 * поставлена прежними версиями, которые не держали размер: один раз ставим и её. Игра запущена — установка откажет, и
 * следующий запуск попробует снова. Перестановка пишет запись сверки с игрой (`trigger: "remap"`).
 */

import {
  isStockMinimapPlacement,
  minimapGameScreen,
  minimapScreenHpActive,
  normalizeMinimapPlacement,
} from "@modovik/minimap-contract";
import { readWorkshopProjects } from "../../../../components/desktop/workshop/workshop-project.js";
import { workshopGameRunning } from "../../../../api.js";
import { tr } from "../../../../locales/ui.js";
import {
  dismissWorkshopFailure,
  enqueueWorkshopInstall,
  REPLACING_INSTALL_STEPS,
} from "../queue.js";
import {
  currentMinimapScreenMark,
  installMinimap,
  minimapScreenMarkChange,
  readMinimapScreenMark,
  writeMinimapScreenMark,
} from "./minimap.js";
import { minimapWorkInGame } from "./minimap-film-repair.js";

const JOB_KEY = "minimap-screen-apply";

/*
 * Метка прежнего вида (одна форма экрана, до 14.11.2026) с той же формой, что сейчас, и работа, собранная под эту же
 * форму: пересчёта «из формы окна в форму игры» у такой установки нет, а версия формулы `hud-screen-1` поменяла только
 * его пределы — файл вышел бы тем же байт в байт (перебор по сетке: 0 отличий). Переставлять нечего: метка просто
 * дописывается до полного вида, и обновление Astral не переписывает update.rpf каждому, у кого карта сдвинута.
 * Безопасную зону прежняя метка не знала — её смену до обновления не ловил и прежний код.
 */
function legacyMarkSameResult(mark, current, configuration) {
  const stored = String(mark || "");
  if (!stored || stored.includes("|")) return false;
  const form = String(current || "").split("|")[0];
  if (stored !== form) return false;
  const windowForm = minimapGameScreen({
    aspect: configuration.targetViewport?.aspect,
  }).aspect.toFixed(3);
  return windowForm === form;
}

/**
 * Что делать при запуске: `{ project, changed }` — ставить работу заново; `null` — нечего.
 * `aspect` — нынешняя метка экрана (`currentMinimapScreenMark`), `mark` — метка последней установки.
 * `changed` — сменился формат экрана (что именно сменилось, говорит `minimapScreenMarkChange`); иначе это безопасная
 * зона, версия формулы или первая установка после обновления Astral.
 *
 * Работу, у которой от экрана ничего не зависит, не трогаем: карта на штатном месте со штатным развёрнутым радаром, без
 * «HP отдельно». Но «По центру» (`expanded`) и «HP отдельно» (`vitalsDetached`) считаются от экрана и при штатной карте,
 * поэтому такие работы переставляются.
 */
export function minimapScreenDecision({ projects, gameRoot, aspect, mark }) {
  if (!aspect || mark === aspect) return null;
  const project = minimapWorkInGame(projects, gameRoot);
  const configuration = project?.modules?.minimap;
  if (!configuration) return null;
  const map = normalizeMinimapPlacement(configuration.layout?.map);
  const dependsOnScreen =
    !isStockMinimapPlacement(map) ||
    map.expanded === "center" ||
    minimapScreenHpActive(configuration.layout);
  if (!dependsOnScreen) return null;
  /* «В игре у меня как здесь»: настройки игры ей не указ. */
  if (configuration.targetViewport?.gameAspect === "screen") return null;
  if (legacyMarkSameResult(mark, aspect, configuration)) return null;
  return {
    project,
    changed: Boolean(mark) && minimapScreenMarkChange(mark, aspect).form,
  };
}

export async function checkMinimapScreen({ gameRoot, notify }) {
  const aspect = await currentMinimapScreenMark();
  const decision = minimapScreenDecision({
    projects: readWorkshopProjects(),
    gameRoot,
    aspect,
    mark: readMinimapScreenMark(),
  });
  if (!decision) {
    if (aspect) writeMinimapScreenMark(aspect);
    return null;
  }
  /* Игра запущена — в архив писать нельзя: метка не тронута, спросим при следующем запуске. */
  if (await workshopGameRunning()) return null;
  const { project, changed } = decision;
  const change = minimapScreenMarkChange(readMinimapScreenMark(), aspect);
  const editor = tr("Мини-карта");
  return enqueueWorkshopInstall({
    key: JOB_KEY,
    title: editor,
    editor,
    coverSlotId: "minimap",
    steps: REPLACING_INSTALL_STEPS,
    run: ({ report }) =>
      installMinimap({
        project: { ...project, gamePath: gameRoot },
        configuration: project.modules.minimap,
        report,
        trigger: "remap",
      }),
    onDone: () => {
      notify?.(
        changed
          ? tr(
              "Формат экрана в игре сменился — Astral переставил мини-карту. Перезапустите GTA V",
            )
          : change.safeZone
            ? tr(
                "Безопасная зона в игре сменилась — Astral переставил мини-карту. Перезапустите GTA V",
              )
            : tr(
                "Astral поставил мини-карту заново: теперь в игре она там же, где в окне. Перезапустите GTA V",
              ),
        "success",
      );
    },
    /* Человек этой установки не просил: без строки с «Повторить», следующий запуск попробует сам. */
    onFailed: () => dismissWorkshopFailure(JOB_KEY),
  });
}
