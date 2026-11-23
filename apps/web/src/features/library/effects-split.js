import { detectInstallations, hasDesktopBridge } from "../../api.js";
import {
  EFFECTS_INSTALL_KEY,
  installEffectsSet,
  planEffectsWithout,
} from "../../components/desktop/workshop/effects-install-state.js";
import { restorePictures } from "../../components/desktop/workshop/effects-stamp.js";
import { locateLegacyGame } from "../workshop/install-queue/game-root.js";
import {
  REPLACING_INSTALL_STEPS,
  enqueueWorkshopInstall,
} from "../workshop/install-queue/index.js";
import { readInstallRecord } from "../workshop/useInstallRecord.js";
import {
  EFFECTS_PART_KINDS,
  WORK_KINDS,
} from "../workshop/works/work-kinds.js";
import { rollBackInstall } from "./retire-previous.js";

/*
 * Часть набора эффектов — из игры, по отметке в библиотеке.
 *
 * Трейсеры, попадания и огонь уезжают в игру одним патчем, поэтому снять
 * одну часть — значит поставить набор заново без неё: такой, какой он стоит
 * в игре, но с пустой частью. Это ровно то, что сделало бы «Применить» в
 * редакторе этой части, выключи человек в нём всё, — и путь тот же: очередь
 * применения, журналы прошлой установки (стволы получают штатный след,
 * bloodfx.dat — штатную кровь), замена прежней точки отката новой.
 *
 * Модуль грузится лениво, из окна подтверждения: библиотека живёт в
 * стартовом куске приложения, а разбор набора тянет за собой весь
 * `@modovik/ptfx-studio`.
 */

/**
 * Можно ли снять части `parts` — до кнопки «Удалить», а не отказом после.
 *
 * @returns {Promise<{ status: string, keep: string[], missing?: string[] }>}
 *   `status` — из `planEffectsWithout` или `no-desktop`: без приложения
 *   архива игры нет и пересобирать нечего
 */
export async function planEffectsSplit({ parts }) {
  if (!hasDesktopBridge()) return { status: "no-desktop", keep: [] };
  const record = readInstallRecord(EFFECTS_INSTALL_KEY);
  const pictures = await restorePictures();
  const { status, keep, missing } = planEffectsWithout({
    record,
    parts,
    pictures,
  });
  return { status, keep, ...(missing ? { missing } : {}) };
}

/* Папка игры — та, что выбрана в оболочке: её библиотека показывает, её и
   правит. Не нашлась — обычный поиск Legacy. */
async function gameRootFor(targetId) {
  if (targetId) {
    const installations = await detectInstallations().catch(() => []);
    const found = (Array.isArray(installations) ? installations : []).find(
      (item) => item?.id === targetId && item.path,
    );
    if (found) return found.path;
  }
  return locateLegacyGame();
}

let sequence = 0;

/**
 * Снять части `parts`. Работа встаёт в очередь применения строкой
 * «Удаление» — за тем, что уже пишет в игру, — и обещание ждёт её конца:
 * окно подтверждения закрывается, когда набор в игре уже другой.
 *
 * @param {{
 *   parts: string[],
 *   targetId?: string,
 *   title: string,
 *   editor: string,
 *   explain: (status: string) => string,
 * }} input `explain` — что сказать, если за время ожидания набор снять по
 *   частям стало нельзя (статус `planEffectsWithout`) или удаление убрали из
 *   очереди (`cancelled`)
 * @returns {Promise<object>} итог работы очереди
 */
export function removeEffectsParts({
  parts,
  targetId = "",
  title,
  editor,
  explain,
}) {
  const record = readInstallRecord(EFFECTS_INSTALL_KEY);
  sequence += 1;
  return new Promise((resolve, reject) => {
    enqueueWorkshopInstall({
      /* Ключ свой у каждого удаления: у очереди одна ждущая версия на ключ, и
         общий ключ заменил бы ждущее удаление новым молча — обещание первого
         не кончилось бы никогда. */
      key: `${EFFECTS_INSTALL_KEY}:library:${sequence}`,
      title,
      editor,
      operation: "remove",
      /* Обложка строки — то, что уходит, каким оно стоит в игре. */
      coverSlotId: WORK_KINDS[EFFECTS_PART_KINDS[parts[0]]]?.slotId || "",
      coverState: record?.installedProject
        ? JSON.stringify(record.installedProject)
        : null,
      steps: REPLACING_INSTALL_STEPS,
      run: async ({ report }) => {
        /* Набор и журналы — из записи на момент записи в игру, а не нажатия:
           пока удаление ждало очереди, соседний редактор мог поставить свою
           часть, и собранное при нажатии увезло бы её прежней. */
        const current = readInstallRecord(EFFECTS_INSTALL_KEY);
        const pictures = await restorePictures();
        const plan = planEffectsWithout({ record: current, parts, pictures });
        if (plan.status === "gone") return {};
        /* Остальные части успели уйти — снимать нечего, кроме точки целиком. */
        if (plan.status === "empty") {
          await rollBackInstall({ install: current });
          return {};
        }
        if (plan.status !== "ready") throw new Error(explain(plan.status));
        return installEffectsSet({
          set: plan.set,
          record: current,
          pictures,
          gameRoot: await gameRootFor(targetId),
          report,
        });
      },
      onDone: resolve,
      onFailed: (message) => reject(new Error(message)),
      /* Строку убрали из очереди на экране «В процессе», пока она ждала. */
      onCancelled: () => reject(new Error(explain("cancelled"))),
    });
  });
}
