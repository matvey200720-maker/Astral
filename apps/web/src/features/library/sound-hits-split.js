import { HIT_SOUND_PART_IDS } from "@modovik/sound-studio";
import { desktopHost, detectInstallations, hasDesktopBridge } from "../../api.js";
import { SOUND_INSTALL_STEPS } from "../../components/desktop/workshop/sound/sound-apply.js";
import {
  SOUND_KIT_HITS_KEY,
  installHitSounds,
  removeHitSounds,
} from "../../components/desktop/workshop/sound/sound-kit-apply.js";
import { locateLegacyTarget } from "../workshop/install-queue/game-root.js";
import { enqueueWorkshopInstall } from "../workshop/install-queue/index.js";
import {
  SOUND_HIT_SLOTS,
  readSoundKitInstalls,
} from "../workshop/sound-kit-record.js";

/*
 * Часть звуков попадания — из игры, по отметке в библиотеке.
 *
 * Голова и тело стоят в игре одним модом (правка метаданных звука и слой
 * банка collision ставятся вместе), поэтому снять голову — значит поставить
 * звук заново с одним телом. Звук тела берётся из снимка замысла в записи
 * установки: тот же источник и те же ручки, что человек применил в студии, —
 * и рендерится тем же кодом, что в студии. Путь — очередь применения, строкой
 * «Удаление» на экране «В процессе».
 *
 * Модуль грузится лениво, из окна подтверждения: он тянет за собой обработку
 * звука студии, а библиотека живёт в стартовом куске приложения.
 */

/**
 * Можно ли снять части `parts` — до кнопки «Удалить», а не отказом после.
 *
 * @returns {Promise<{ status: string, keep: string[] }>} `ready` — можно;
 *   `gone` — звуков попадания в игре уже нет; `empty` — остального нет, и
 *   мод уйдёт целиком; `design` — у оставшейся части нет снимка замысла
 *   (поставлена прежней версией Astral); `no-desktop` — нет приложения
 */
export async function planSoundHitsSplit({ parts }) {
  if (!hasDesktopBridge()) return { status: "no-desktop", keep: [] };
  const record = readSoundKitInstalls().hits;
  if (!record?.modId) return { status: "gone", keep: [] };
  const keep = HIT_SOUND_PART_IDS.filter(
    (part) => record.parts?.includes(part) && !parts.includes(part),
  );
  if (!keep.length) return { status: "empty", keep };
  if (keep.some((part) => !record.designs?.[part]))
    return { status: "design", keep };
  return { status: "ready", keep };
}

/* Игра — та, что выбрана в оболочке: её библиотека показывает, её и правит. */
async function gameFor(targetId) {
  if (targetId) {
    const installations = await detectInstallations().catch(() => []);
    const found = (Array.isArray(installations) ? installations : []).find(
      (item) => item?.id === targetId && item.path,
    );
    if (found) return { path: found.path, id: found.id };
  }
  return locateLegacyTarget();
}

let sequence = 0;

/**
 * Снять части `parts`. Обещание ждёт конца работы в очереди: окно
 * подтверждения закрывается, когда звук в игре уже другой.
 *
 * @param {{ parts: string[], targetId?: string, title: string, editor: string,
 *   explain: (status: string) => string }} input
 */
export function removeSoundHitsParts({
  parts,
  targetId = "",
  title,
  editor,
  explain,
}) {
  sequence += 1;
  return new Promise((resolve, reject) => {
    enqueueWorkshopInstall({
      /* Ключ свой у каждого удаления: общий ключ заменил бы ждущее удаление
         новым молча, и обещание первого не кончилось бы никогда. */
      key: `${SOUND_KIT_HITS_KEY}:library:${sequence}`,
      title,
      editor,
      operation: "remove",
      coverSlotId: SOUND_HIT_SLOTS[parts[0]] || "",
      steps: SOUND_INSTALL_STEPS,
      run: async ({ report }) => {
        /* Запись — на момент записи в игру, а не нажатия: пока удаление
           ждало очереди, студия могла поставить звуки заново. */
        const record = readSoundKitInstalls().hits;
        if (!record?.modId) return {};
        const host = desktopHost();
        const game = await gameFor(targetId);
        const keep = HIT_SOUND_PART_IDS.filter(
          (part) => record.parts?.includes(part) && !parts.includes(part),
        );
        if (!keep.length) return removeHitSounds({ host, report, game });
        if (keep.some((part) => !record.designs?.[part]))
          throw new Error(explain("design"));
        const hits = Object.fromEntries(
          HIT_SOUND_PART_IDS.map((part) => [
            part,
            keep.includes(part) ? record.designs[part] : null,
          ]),
        );
        return installHitSounds({ host, hits, report, game });
      },
      onDone: resolve,
      onFailed: (message) => reject(new Error(message)),
      onCancelled: () => reject(new Error(explain("cancelled"))),
    });
  });
}
