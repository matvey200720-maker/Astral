/*
 * Проверки «увидит ли игра то, что мы записали» для журнала установки одежды (13.11.2026, «ничего не меняется» на GTA 5 RP).
 *
 * Две причины, по которым «готово» в журнале не значит «видно в игре», и обе до сих пор были в журнале не видны:
 *   • DLC одежды не зарегистрирован в `common/data/dlclist.xml` внутри живого update.rpf (его вернули снаружи — лаунчер Rockstar, Steam, ручная подмена): игра DLC не монтирует;
 *   • RAGE Multiplayer (GTA 5 RP) запускает игру из другой папки, чем пишет Astral (`HKCU\Software\RAGE-MP`, `game_v_path`; WER 13.11: процесс RAGE MP — `GTA5.exe 1.1.0.0`, а в папке
 *     Astral — `GTA5.exe 1.0.3889.0`): записи в папку Astral RAGE MP не читает вовсе.
 *
 * Чтение — только чтение: запись `dlclist.xml` выгружается во временный файл, реестр читается `reg query`. Строки — для журнала поддержки (по-русски), в окне не показываются.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { extractRpfEntry } from "./rpf-composer.js";
import { majesticGamePath, rageGamePath } from "./launcher-game-paths.js";

const DLC_NAME = "astral_clothing";

/** `dlclist.xml` из живого update.rpf → `{ checked, registered, position, packs }` или `{ checked: false, reason }`. */
export async function liveClothingRegistration(
  gameRoot,
  { extract = extractRpfEntry, tempDir = os.tmpdir() } = {},
) {
  const output = path.join(tempDir, `astral-dlclist-${randomUUID()}.xml`);
  try {
    await extract({
      archivePath: path.join(gameRoot, "update", "update.rpf"),
      entry: "common/data/dlclist.xml",
      output,
      gameRoot,
      edition: "Legacy",
    });
    const text = await fs.readFile(output, "utf8");
    const packs = [...text.matchAll(/dlcpacks:\/([^/]+)\//g)].map(
      (match) => match[1],
    );
    const position = packs.indexOf(DLC_NAME);
    return {
      checked: true,
      registered: position >= 0,
      position,
      packs: packs.length,
    };
  } catch (error) {
    return {
      checked: false,
      reason: String(error?.message || error).slice(0, 160),
    };
  } finally {
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

/** Строки журнала по проверке регистрации. */
export function registrationNotes(result) {
  if (!result?.checked)
    return [
      {
        level: "info",
        message: `Регистрация DLC одежды: проверить не удалось${result?.reason ? ` (${result.reason})` : ""}`,
      },
    ];
  if (result.registered)
    return [
      {
        level: "info",
        message: `Регистрация DLC одежды: astral_clothing стоит в dlclist.xml внутри update.rpf (${result.position + 1}-й из ${result.packs})`,
      },
    ];
  return [
    {
      level: "warn",
      message:
        "Регистрация DLC одежды: astral_clothing НЕТ в dlclist.xml внутри update.rpf — игра этот DLC не смонтирует, вещь в игре не появится (update.rpf могли вернуть снаружи: лаунчер Rockstar, Steam)",
    },
  ];
}

const same = (left, right) =>
  Boolean(left && right) &&
  path.win32.resolve(String(left)).toLowerCase() ===
    path.win32.resolve(String(right)).toLowerCase();

/** Строка про папку игры у RAGE MP: совпала ли с той, куда пишет Astral; `null` — RAGE MP на машине нет (путь не найден). */
export function ragePathNote(ragePath, gameRoot) {
  if (!ragePath) return null;
  if (same(ragePath, gameRoot))
    return {
      level: "info",
      message: `RAGE MP (GTA 5 RP): game_v_path совпадает с папкой, куда пишет Astral (${gameRoot})`,
    };
  return {
    level: "warn",
    message: `RAGE MP (GTA 5 RP): game_v_path = ${ragePath}, а Astral пишет в ${gameRoot} — RAGE MP запускает игру из другой папки, записи Astral он не прочтёт`,
  };
}

/** Строка про папку игры у Majestic (`prefs.latest.json`): совпала ли с той, куда пишет Astral; `null` — путь Majestic не найден. */
export function majesticPathNote(majesticPath, gameRoot) {
  if (!majesticPath) return null;
  if (same(majesticPath, gameRoot))
    return {
      level: "info",
      message: `Majestic: папка игры совпадает с той, куда пишет Astral (${gameRoot})`,
    };
  return {
    level: "warn",
    message: `Majestic: папка игры = ${majesticPath}, а Astral пишет в ${gameRoot} — Majestic запускает игру из другой папки, записи Astral он не прочтёт`,
  };
}

/**
 * Факты после установки: регистрация DLC в `update.rpf` и папки игры у RAGE MP и Majestic — для журнала и для слов в окне (`clothing-install-visibility.js`).
 * Сбой любого чтения не роняет установку: поле остаётся пустым.
 */
export async function clothingVisibilityFacts(
  gameRoot,
  {
    checkRegistration = liveClothingRegistration,
    readRage = rageGamePath,
    readMajestic = majesticGamePath,
    registration = true,
  } = {},
) {
  const facts = {
    gameRoot,
    registration: null,
    ragePath: null,
    majesticPath: null,
  };
  if (registration)
    try {
      facts.registration = await checkRegistration(gameRoot);
    } catch (error) {
      facts.registration = {
        checked: false,
        reason: String(error?.message || error).slice(0, 120),
      };
    }
  try {
    facts.ragePath = (await readRage()) || null;
  } catch {
    /* реестра нет или нет доступа */
  }
  try {
    facts.majesticPath = (await readMajestic())?.persisted?.path || null;
  } catch {
    /* Majestic не стоит */
  }
  return facts;
}

/** Всё вместе для вызова после установки; сбой проверки установку не роняет. */
export async function clothingVisibilityNotes(
  gameRoot,
  {
    checkRegistration = liveClothingRegistration,
    readRage = rageGamePath,
    readMajestic = null,
    forGta5rp = true,
    facts = null,
  } = {},
) {
  const notes = [];
  const known =
    facts ||
    (await clothingVisibilityFacts(gameRoot, {
      checkRegistration,
      readRage: forGta5rp ? readRage : async () => null,
      ...(readMajestic ? { readMajestic } : { readMajestic: async () => null }),
    }));
  /* Регистрацию DLC проверяют, только когда что-то записано в Astral Clothing DLC: без записи в него `registration` пусто. */
  if (known.registration) notes.push(...registrationNotes(known.registration));
  if (forGta5rp) {
    const note = ragePathNote(known.ragePath, gameRoot);
    if (note) notes.push(note);
  }
  const majestic = majesticPathNote(known.majesticPath, gameRoot);
  if (majestic) notes.push(majestic);
  return notes;
}
