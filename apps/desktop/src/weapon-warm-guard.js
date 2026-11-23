/*
 * Когда прогрев ствола не начинают (04.11.2026): пока запущена игра или клиент сервера, диск и процессор нужны им, а не фоновой сборке модели.
 * Прогрев (`readGameWeaponModel` с `warm`) спрашивает снимок процессов один раз на просьбу; нашлось — отвечает «пропущено» и ничего не читает.
 * Не удалось получить список процессов — тоже «пропущено»: не знаем, идёт ли игра, значит, и не греем.
 *
 * Имена: GTA V (Legacy, Enhanced, BattlEye), FiveM (лаунчер и процесс игры), alt:V, RAGE MP.
 */
import { runningProcessesMatching } from "./game-processes.js";

export const WARM_BLOCKERS = /^(gta5(_enhanced)?(_be)?|playgtav|fivem(_b\d+)?(_gtaprocess)?|altv(_?client)?|ragemp(_v)?|rage[-_ ]?multiplayer)\.exe$/i;

/** Имя мешающего процесса (`GTA5.exe`), пустая строка — прогревать можно, `"tasklist"` — список процессов получить не удалось. */
export async function warmBlockedBy({ list = runningProcessesMatching } = {}) {
  try {
    const found = await list(WARM_BLOCKERS);
    return found[0]?.name || "";
  } catch {
    return "tasklist";
  }
}
