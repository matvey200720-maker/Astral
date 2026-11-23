/*
 * Самопочинка регистрации DLC одежды (13.11.2026, «одежда на GTA 5 RP не меняется»).
 *
 * Одежда Astral лежит в `astral_clothing/dlc.rpf`, а игра монтирует этот DLC, только пока он записан в `common/data/dlclist.xml` внутри `update/update.rpf`. Если update.rpf
 * вернули снаружи (лаунчер Rockstar «проверил файлы», Steam, ручная подмена), регистрация пропадает молча: вещи лежат на месте, а в игре их нет, и человек этого не видит.
 * Установка с 13.11 (`updateKeepsRegistration`) возвращает регистрацию при следующей покраске, но человек, у которого одежда уже стоит, может и не ставить ничего нового.
 *
 * Здесь Astral сам сверяет это и чинит — тем же путём, что установка: `provisionClothingInfrastructure({ activate: true })` (регистрация в update.rpf, слой и точка отката в транзакции):
 *  — при старте приложения, когда игра найдена и не запущена, и когда нет другой записи в игру;
 *  — при возврате окна в фокус (человек вышел из игры или из лаунчера сервера, который мог вернуть update.rpf);
 *  — перед запуском игры из самого Astral (`LAUNCH_GAME`): игра стартует уже с зарегистрированным DLC. Запуск через лаунчер сервера перехватить нельзя — для него фокус и старт.
 * Пока игра запущена, ничего не пишется (install-safety), проверка откладывается на выход.
 *
 * Решение — по состоянию установок и отпечатку update.rpf (стоит ли в игре тот файл, что собрал Astral; без чтения двух гигабайт), а когда файл другой — по настоящему
 * `dlclist.xml` из него: регистрация цела — файл не трогаем, пересборка двух гигабайт без причины ни к чему.
 */

import { getClothingRegistrationStatus } from "@modovik/install-engine";
import { liveClothingRegistration } from "./clothing-registration-check.js";
import { assertInstallRuntimeSafe } from "./install-safety.js";

/** Причина сбоя одним кодом: окну по нему подбираются слова на языке человека, а сырой текст остаётся в журнале. */
export function failureCode(error) {
  const code = String(error?.code || "");
  const text = String(error?.message || error || "");
  if (code === "ASTRAL_GAME_RUNNING") return "running";
  if (code === "ASTRAL_GAME_UPDATE_RUNNING") return "launcher-busy";
  if (
    code === "ASTRAL_INSUFFICIENT_SPACE" ||
    code === "ENOSPC" ||
    /недостаточно места|ENOSPC/i.test(text)
  )
    return "space";
  if (
    ["EBUSY", "EPERM", "EACCES", "EMFILE"].includes(code) ||
    /EBUSY|EPERM|EACCES|занят|being used|используется/i.test(text)
  )
    return "locked";
  return "other";
}

const firstLine = (error) =>
  String(error?.message || error || "неизвестная ошибка")
    .split(/\r?\n/)[0]
    .slice(0, 200);

/**
 * Одна игра: сверить и, если нужно, вернуть регистрацию.
 * `outcome`: `none` (одежды Astral в игре нет) | `intact` (регистрация на месте) | `restored` (вернули) | `skipped` (игра запущена; сеанс без модов; игра удерживается) | `failed` (не вышло) | `unsupported`.
 */
export async function healClothingRegistration({
  game,
  stateDir,
  status = getClothingRegistrationStatus,
  liveCheck = liveClothingRegistration,
  /* Подготовка DLC тяжёлая — грузится по вызову, не на старте (main-startup-imports.test.js). */
  provision = async (options) =>
    (
      await import("./clothing-dlc-provisioner.js")
    ).provisionClothingInfrastructure(options),
  gameRunning = async () => false,
  assertRuntimeSafety = assertInstallRuntimeSafe,
}) {
  if (game?.edition !== "Legacy") return { outcome: "unsupported" };
  const found = await status({ targetId: game.id, stateDir });
  if (!found?.inUse) return { outcome: "none" };
  /* Сеанс игры без модов или удержание «игра возвращена к исходной»: регистрации нет намеренно, чинить нельзя (движок и сам откажет). */
  if (found.paused) return { outcome: "skipped", why: found.paused, found };
  const hostThere = found.host === "present";
  if (hostThere && found.update === "same")
    return { outcome: "intact", via: "fingerprint", found };

  const live = hostThere ? await liveCheck(game.path) : null;
  if (hostThere && live?.checked && live.registered)
    return { outcome: "intact", via: "dlclist", found, live };

  /* Что именно пропало — для журнала. Не удалось прочитать dlclist.xml, а файл другой, — считаем, что регистрации нет: проверить нечем, а вернуть безопасно. */
  const cause = !hostThere
    ? "host-missing"
    : live?.checked
      ? "update-replaced"
      : "update-unreadable";
  if (await gameRunning(game))
    return { outcome: "skipped", why: "game-running", cause, found, live };
  try {
    await provision({
      gameRoot: game.path,
      targetId: game.id,
      edition: "Legacy",
      stateDir,
      assertRuntimeSafety: () => assertRuntimeSafety(game),
      activate: true,
    });
  } catch (error) {
    return {
      outcome: "failed",
      cause,
      code: failureCode(error),
      reason: firstLine(error),
      found,
      live,
    };
  }
  const after = await liveCheck(game.path);
  if (after?.checked && after.registered)
    return { outcome: "restored", cause, found, live: after };
  return {
    outcome: "failed",
    cause,
    code: "other",
    reason: after?.checked
      ? "после починки astral_clothing всё ещё нет в dlclist.xml"
      : `после починки dlclist.xml не прочитан (${after?.reason || "нет причины"})`,
    found,
    live: after,
  };
}

const CAUSE_WORDS = {
  "host-missing":
    "файла DLC одежды (astral_clothing/dlc.rpf) в игре не оказалось",
  "update-replaced":
    "update.rpf заменили снаружи (лаунчер Rockstar, Steam, ручная подмена), регистрации в нём не было",
  "update-unreadable":
    "update.rpf сменился снаружи, а dlclist.xml из него прочитать не вышло",
};
const where = (live) =>
  live?.checked && live.registered
    ? ` (${live.position + 1}-й из ${live.packs})`
    : "";

/** Строка журнала раздела install по итогу одной игры: «регистрация на месте / вернули / не удалось (причина)». */
export function healLogEntry(result, label = "") {
  const prefix = `Одежда${label ? ` ${label}` : ""}: `;
  switch (result?.outcome) {
    case "none":
      return {
        level: "info",
        message: `${prefix}Astral-одежды в игре нет, регистрацию не проверяю`,
      };
    case "intact":
      return {
        level: "info",
        message:
          result.via === "fingerprint"
            ? `${prefix}регистрация на месте (update.rpf тот же, что после записи Astral)`
            : `${prefix}регистрация на месте (update.rpf менялся снаружи, но astral_clothing стоит в dlclist.xml${where(result.live)})`,
      };
    case "restored":
      return {
        level: "warn",
        message: `${prefix}регистрацию вернули — ${CAUSE_WORDS[result.cause] || result.cause}; astral_clothing снова в dlclist.xml${where(result.live)}`,
      };
    case "skipped":
      return {
        level: "info",
        message:
          result.why === "vanilla"
            ? `${prefix}идёт сеанс игры без модов — регистрацию не трогаю, её вернёт конец сеанса`
            : result.why === "stock-hold"
              ? `${prefix}игра возвращена к исходной и удерживается — регистрацию не трогаю`
              : `${prefix}игра запущена — проверку регистрации отложили до выхода из игры (${CAUSE_WORDS[result.cause] || result.cause})`,
      };
    case "failed":
      return {
        level: "warn",
        message: `${prefix}регистрацию вернуть не удалось (${result.reason}; ${CAUSE_WORDS[result.cause] || result.cause})`,
      };
    default:
      return null;
  }
}

/**
 * Страж регистрации: одна проверка за раз, для всех найденных игр. Зависимости — данные главного процесса (`clothing-registration-boot.js`):
 * `discoverGames()`, `stateDir()`, `busy()` (идёт установка или работа мастерской), `gameRunning(game)`, `record(entry)` (журнал), `report(result)` (окну — только `restored` и `failed`).
 */
export function createClothingRegistrationKeeper({
  discoverGames,
  stateDir,
  busy = () => false,
  gameRunning = async () => false,
  record = () => {},
  report = () => {},
  heal = healClothingRegistration,
  /* Паки игры с заменёнками «на месте» (`clothing-pack-heal.js`, 14.11.2026): вернули снаружи — Astral ставит записи обратно. Тяжёлый модуль грузится по первому вызову. */
  healPacks = async (options) =>
    (await import("./clothing-pack-heal.js")).healClothingPacks(options),
  packLog = async (result, label) =>
    (await import("./clothing-pack-heal.js")).packHealLogEntry(result, label),
  now = Date.now,
  focusGapMs = 30_000,
}) {
  let inflight = null;
  let lastRunAt = -Infinity;
  const lastLogged = new Map();
  const lastPackLogged = new Map();

  async function run(trigger, only) {
    if (busy()) {
      if (trigger === "start")
        record({
          source: "install",
          level: "info",
          message:
            "Одежда: идёт другая установка — проверку регистрации отложили",
        });
      return { deferred: "busy", results: [] };
    }
    const found = (
      only ? [only] : await discoverGames().catch(() => [])
    ).filter((game) => game?.id && game?.path);
    const folder = await stateDir();
    const results = [];
    let deferred = null;
    for (const game of found) {
      const label = found.length > 1 ? `[${game.id}]` : "";
      let result;
      try {
        result = await heal({ game, stateDir: folder, gameRunning });
      } catch (error) {
        result = {
          outcome: "failed",
          cause: "update-unreadable",
          code: failureCode(error),
          reason: firstLine(error),
        };
      }
      results.push({ gameId: game.id, ...result });
      if (result.outcome === "skipped") deferred = "game-running";
      const entry = healLogEntry(result, label);
      /* При возврате фокуса одну и ту же «на месте» не пишем каждый раз: журнал не засоряется. */
      const signature = `${result.outcome}:${result.via || result.why || ""}:${result.code || ""}`;
      const repeat =
        trigger === "focus" &&
        !["restored", "failed"].includes(result.outcome) &&
        lastLogged.get(game.id) === signature;
      lastLogged.set(game.id, signature);
      if (entry && !repeat && result.outcome !== "unsupported")
        record({ source: "install", ...entry });
      if (result.outcome === "restored" || result.outcome === "failed") {
        report({
          outcome: result.outcome,
          code: result.code || "",
          cause: result.cause || "",
          gameId: game.id,
          at: new Date().toISOString(),
        });
      }
      /* Игра не запущена и пишем в неё можно (регистрация цела, возвращена или Astral-одежды нет): теперь паки с заменёнками на месте. */
      if (["none", "intact", "restored"].includes(result.outcome)) {
        let packed;
        try {
          /* Между стражем регистрации и паками могла начаться установка или работа мастерской: пак не трогаем, пока `busy()`; `installBusy` страж паков проверяет ещё раз перед записью (ревью, №21). */
          packed = busy()
            ? { outcome: "skipped", why: "busy" }
            : await healPacks({
                game,
                stateDir: folder,
                gameRunning,
                installBusy: busy,
              });
        } catch (error) {
          packed = {
            outcome: "failed",
            cause: "packs-returned",
            code: failureCode(error),
            reason: firstLine(error),
            packs: [],
          };
        }
        results.push({ gameId: game.id, part: "packs", ...packed });
        if (
          packed.outcome === "skipped" &&
          ["game-running", "launcher-busy", "launcher-running"].includes(
            packed.why,
          )
        )
          deferred = deferred || "game-running";
        /* Идёт установка: проверку повторит окно через минуту (`deferred: "busy"`). */
        if (packed.outcome === "skipped" && packed.why === "busy")
          deferred = "busy";
        const packEntry = await packLog(packed, label).catch(() => null);
        /* Подпись итога: «не трогаю» на фокусе повторять в журнал и окну не нужно, пока ничего не изменилось; «вернули» и «не вышло» говорятся каждый раз. `quiet` — страж уже сказал то же самое
           раньше (в прошлый запуск тоже: подпись лежит рядом с его записью, ревью №22). */
        const packSignature = `${packed.outcome}:${packed.why || ""}:${(packed.packs || []).map((pack) => `${pack.name}${pack.kind || ""}${pack.mods}`).join("+")}`;
        const packRepeat =
          Boolean(packed.quiet) ||
          (!["restored", "failed"].includes(packed.outcome) &&
            lastPackLogged.get(game.id) === packSignature);
        lastPackLogged.set(game.id, packSignature);
        if (packEntry && !packRepeat)
          record({ source: "install", ...packEntry });
        /* «Писать нельзя сейчас» (игра, лаунчер сервера) — одно слово человеку за запуск, а не тишина: пак вернули, заменёнок в игре нет, и они вернутся, когда процессы закроются (ревью, №9). */
        const waiting =
          packed.outcome === "skipped" &&
          ["game-running", "launcher-busy", "launcher-running"].includes(
            packed.why,
          ) &&
          packed.packs?.length;
        if (
          (["restored", "failed", "held"].includes(packed.outcome) ||
            waiting) &&
          !packRepeat
        )
          report({
            outcome: waiting ? "waiting" : packed.outcome,
            code: packed.code || "",
            cause: packed.cause || "packs-returned",
            why: packed.why || "",
            packs: (packed.packs || []).map(({ name, mods }) => ({
              name,
              mods,
            })),
            ...(packed.parked ? { parked: packed.parked } : {}),
            gameId: game.id,
            at: new Date().toISOString(),
          });
      }
    }
    return { deferred, results };
  }

  /** `trigger`: `start` | `focus` | `launch`; `only` — одна игра (запуск из Astral). */
  function check(trigger = "start", only = null) {
    if (inflight) return inflight;
    if (trigger === "focus" && now() - lastRunAt < focusGapMs)
      return Promise.resolve({ deferred: "recent", results: [] });
    inflight = run(trigger, only)
      .catch((error) => ({
        deferred: "error",
        results: [],
        error: firstLine(error),
      }))
      .finally(() => {
        lastRunAt = now();
        inflight = null;
      });
    return inflight;
  }

  return { check };
}

/* Страж один на процесс: запуск игры из окна (`vanilla-guard-ipc.js`) спрашивает его, не зная, как он устроен. */
let keeper = null;
export const setClothingRegistrationKeeper = (value) => {
  keeper = value;
};

/** Перед запуском игры из Astral: вернуть регистрацию, чтобы игра стартовала с одеждой. Сбой запуск не останавливает. */
export async function healBeforeLaunch(game) {
  try {
    return await keeper?.check("launch", game);
  } catch {
    return null;
  }
}
