/*
 * Прогрев стволов у Astral Desktop (03.11.2026, слова владельца: «чтобы оружие появлялось сразу»).
 *
 * Холодное чтение ствола игры — 3–7 с при ×1: первый ствол после установки опись архивов строит заново (~5 с на 32 архива, потом она лежит на диске), а каждый новый ствол собирается
 * в GLB (0,6–1,6 с) и ложится в кэш на диске (повтор — 6 мс). Всё это можно сделать до того, как человек откроет «Ганпак»: пока он смотрит полку мастерской. Просится в простое окна
 * и по одному, Desktop считает такие просьбы фоновыми (`warm`, `weapon-read-watch.js`): настоящая просьба человека их прерывает. Ответ без байтов — модель по IPC не едет.
 *
 * Сперва опись архивов (одна на все стволы), потом стволы пака — те, что не едут в поставке (пистолет и карабин берутся из `/assets`). Игру ищем без вопросов: окно выбора папки в
 * фоне недопустимо, нет игры — нет прогрева.
 *
 * Когда нельзя (слова ведущей 04.11.2026): диск нужен другому. Пока в очереди установок идёт запись (`workshopInstallsWriting`) прогрев не стартует и между шагами останавливается; пока
 * запущена игра или клиент сервера (FiveM, alt:V, RAGE MP) Desktop сам отвечает `warm: false, skipped` (`weapon-warm-guard.js`) — тогда прогрев тоже кончается. Прогрев один на запуск:
 * довёл до конца — второй раз не просится; остановленный прогрев начнётся снова при следующем заходе на полку оружия. Просить его — только когда мастерская оружия открыта
 * (`weaponsOpen` у `useWorkshopEditors`): опись архивов и сборка моделей читают диск, а на других экранах человеку это не нужно.
 */

import { normalizeSlot } from "@modovik/gun-studio";
import { weaponByShelf } from "@modovik/rpf-inspector/weapon-identity";
import { builtinGunModels } from "../gun-models.js";
import { gameWeaponModelsAvailable, readGameWeaponModel } from "../../../../../api.js";
import { detectLegacyGame } from "../../../../../features/workshop/install-queue/game-root.js";
import { workshopInstallsWriting } from "../../../../../features/workshop/install-queue/queue.js";
import { workshopWeaponSlots } from "../../../../../catalog-taxonomy.js";
import { readPackSlots } from "./pack-store.js";

/* Ствол с самым длинным списком архивов: его опись покрывает остальные. */
const INDEX_MODEL = "w_ar_assaultriflemk2";
const GAP_MS = 1200;
const known = (slot) => workshopWeaponSlots.some((item) => item.id === slot);

const warmed = new Set();
let running = null;
/* Довели до конца за этот запуск: больше не просимся. */
let finished = false;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ствол едет в поставке (`/assets/catalog/weapons-3d`): у Desktop его читать нечего. */
const shipped = (slot) => builtinGunModels().some((model) => model.slot === normalizeSlot(slot) && model.url);

/** Стволы пака из игры: `[{ slot, model }]` по порядку пака. */
export function packWarmTargets(slots = readPackSlots(known)) {
  const out = [];
  for (const slot of slots) {
    const model = weaponByShelf(slot)?.model;
    if (model && !shipped(slot)) out.push({ slot, model });
  }
  return out;
}

/** Прогрев остановлен: запись в очереди установок идёт или Desktop сказал, что игре и клиенту сервера диск нужнее. */
class WarmHalt extends Error {}

/**
 * Прогреть опись архивов и стволы пака. Раз за запуск окна и по одному разу на ствол; второй вызов, пока идёт первый, ждёт его же. Нельзя, пока идёт установка из очереди, игра или клиент сервера.
 * Отказ любого шага — конец прогрева, ничего не показывается; остановленный (но не законченный) прогрев можно попросить снова.
 */
export function warmPackWeapons() {
  if (running) return running;
  if (finished || workshopInstallsWriting() || !gameWeaponModelsAvailable()) return Promise.resolve(false);
  running = (async () => {
    const gameRoot = await detectLegacyGame().catch(() => "");
    if (!gameRoot) return false;
    const step = async (model, warm) => {
      const key = `${gameRoot}|${model}|${warm}`;
      if (warmed.has(key)) return;
      /* Пока ждали игру/паузу, могла начаться установка: диск — ей. */
      if (workshopInstallsWriting()) throw new WarmHalt("установка");
      const answer = await readGameWeaponModel({ gameRoot, model, warm });
      if (answer?.warm === false) throw new WarmHalt(String(answer.skipped || "занято"));
      warmed.add(key);
      await pause(GAP_MS);
    };
    try {
      await step(INDEX_MODEL, "index");
      for (const { model } of packWarmTargets()) await step(model, true);
      finished = true;
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
