/*
 * Радуга, поставленная прежней версией Astral, — в игру заново тем же
 * замыслом.
 *
 * Радуга — свой пакет слоя, и «Применить» неба её переставляет, только если
 * человек его нажмёт. А прежние версии ставили то, что в игре выглядело
 * плохо: 26.09 днём — две дуги (утренняя над морем, вечерняя над холмами,
 * каждая с побочной сверху), вечером — одну, но с дневной яркостью и ночью
 * (сияние с ореолом над тёмным небом). 27.09 владелец увидел в игре именно
 * их. Поэтому редактор неба, открывшись, спрашивает главный процесс, какой
 * схемой стоит радуга, и прежнюю переставляет сам: часы и яркость — те же,
 * что человек выбрал, меняется только то, как она собрана.
 *
 * Как у звуков (`refreshOutdatedSoundKit`): через очередь применения — её
 * видно на экране «В процессе», она не спорит с другой установкой за архив
 * игры — и раз за жизнь окна на каждую прежнюю радугу: если игра запущена и
 * установка отказала, повтор — «Применить», а не круг за кругом.
 */

import { normalizeLook, parseProject } from "@modovik/timecycle";
import { inspectSkyRainbow, setSkyRainbow } from "../../../../api.js";
import {
  DEFAULT_INSTALL_STEPS,
  applyWorkshopWork,
} from "../../../../features/workshop/install-queue/index.js";
import { tr } from "../../../../locales/ui.js";

/* Своя строка очереди: радуга ставится отдельно от неба, и кнопка
   «Применить» неба на это время не гаснет. */
export const SKY_RAINBOW_REFRESH_KEY = "astral.timecycle.rainbow-refresh.v1";

const lookOf = (serialized) => {
  if (!serialized) return null;
  try {
    const project = parseProject(
      typeof serialized === "string" ? JSON.parse(serialized) : serialized,
    );
    return normalizeLook(project.look);
  } catch {
    return null;
  }
};

/**
 * Какую радугу человек ставил: из неба, которое стоит в игре (запись
 * установки), иначе из черновика редактора, иначе — по умолчанию. Черновик
 * с выключенной радугой её не отменяет: радугу в игре снимает только
 * «Применить» или «Снять из игры» (прежнее «Откатить», пункт «⋯»).
 */
export function rainbowIntent({ installedState = null, project = null } = {}) {
  for (const look of [lookOf(installedState), lookOf(project)])
    if (look?.weather?.rainbow) return look.rainbow;
  return null;
}

const refreshed = new Set();

/**
 * @returns {Promise<boolean>} встала ли перестановка в очередь
 */
export async function refreshOutdatedSkyRainbow({
  gameRoot,
  installedState = null,
  project = null,
  notify = () => {},
  onDone = () => {},
}) {
  if (!gameRoot) return false;
  let status = null;
  try {
    status = await inspectSkyRainbow({ gameRoot });
  } catch {
    /* Опись не прочиталась — переставлять вслепую нельзя; «Применить»
       по-прежнему поставит радугу нынешней схемой. */
    return false;
  }
  const outdated = (status?.installed || []).filter((item) => !item.current);
  if (!outdated.length) return false;
  const version = `${gameRoot}|${outdated
    .map((item) => item.modId)
    .sort()
    .join(",")}`;
  if (refreshed.has(version)) return false;
  refreshed.add(version);
  const rainbow = rainbowIntent({ installedState, project });
  return applyWorkshopWork({
    key: SKY_RAINBOW_REFRESH_KEY,
    signature: JSON.stringify(rainbow),
    title: tr("Радуга"),
    editor: tr("Таймциклы"),
    coverSlotId: "timecycle",
    /* Фоновое обновление: работа та же, снимок её остаётся. */
    frame: false,
    steps: DEFAULT_INSTALL_STEPS,
    notify,
    savedText: tr("Обновляем радугу в игре до новой версии Astral"),
    run: async () => {
      const result = await setSkyRainbow({ gameRoot, enabled: true, rainbow });
      onDone(result);
      return result;
    },
    doneText: () => tr("Радуга в игре обновлена: одна дуга, ночью без сияния"),
  });
}
