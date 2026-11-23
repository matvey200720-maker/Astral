/*
 * Страж паков игры с заменёнками «на месте» (14.11.2026, TASK-targets-4, «второй ПК»).
 *
 * Заменёнка на штатную вещь вписана прямо в пак игры (`update/x64/dlcpacks/<пак>/dlc.rpf`). Если пак вернули снаружи (Steam «проверил файлы», лаунчер Rockstar, лаунчер сервера),
 * вещь в игре снова штатная, а «Библиотека» по-прежнему пишет «установлено»: движок видел расхождение (`auditTarget`), но только когда человек сам открывал «Настройки → Игра».
 *
 * Страж ходит теми же дорогами, что страж регистрации (`clothing-registration-heal.js`: старт, возврат окна, запуск игры) и, когда это безопасно, ставит заменёнки обратно: пак, вернувшийся к
 * штатному, движок по своему правилу относит к «снятым проверкой файлов» (`parkRevertedMods` — тот же шаг, что подготовка игры при запуске), а «Установить снова» (`restoreParkedMods`) кладёт
 * их слои поверх нынешнего пака. `repairTarget` («Вернуть как было») для этого не годится: на штатном архиве он мод только снимает, а не возвращает (сценарий «второй ПК», песочница 14.11.2026).
 * Он пишет в файлы игры, поэтому правила жёсткие:
 *
 *  1. Человек видит всё, что он сделал или отказался сделать: «N заменёнок вернулись в пак X — его вернули к штатному снаружи» (`restored`), «не трогаю, решай сам» (`held`), «не вышло» (`failed`).
 *     Молча страж не пишет ничего, кроме случая «писать нельзя сейчас» (игра, лаунчер — отложено до выхода, слова придут потом).
 *  2. Качели: пак вернули к штатному снова вскоре после починки (лаунчер сервера делает это на каждом запуске) — страж больше не ставит, а говорит, что заменёнка на этом клиенте не удержится.
 *     Не больше одной автопочинки пака за запуск приложения и не чаще раза в `HOLD_MS` (по записи `clothing-pack-guard.json` рядом с состоянием движка — она переживает перезапуск).
 *  3. Никогда при запущенной игре или лаунчере сервера, при удержании «игра возвращена к исходной» и никогда поверх пака, который стал не штатным, а другим (обновление игры, чужой мод): там только слова, чинит человек в «Настройки → Игра».
 *
 * «Вернули к штатному» от «пак обновился» страж отличает по отпечатку: движок хранит sha256 файла, каким он был до первой записи Astral (`baselineHash`, основа `resource.original`), и sha256, какой Astral
 * записал (`expectedHash`). Живой файл равен основе — это штатный пак, его вернули. Не равен ни основе, ни записанному — файл стал третьим (обновление игры, другой мод), движок его так и опишет:
 * `modified`, но `actualHash` не равен `baselineHash`. Файла нет совсем (`missing`) — тоже не «к штатному». Нет отпечатка основы — не доказано, считаем «изменился».
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  auditTarget,
  inspectProfile,
  parkedModsInArchives,
  parkRevertedMods,
  restoreParkedMods,
} from "@modovik/install-engine";
import { runningProcessesMatching } from "./game-processes.js";
import { assertInstallRuntimeSafe } from "./install-safety.js";
import { failureCode } from "./clothing-registration-heal.js";
import { wireEngineHistory } from "./native-restore-chain.js";

/** Пак игры или DLC Astral: `update/x64/dlcpacks/<пак>/dlc.rpf` (путь от папки игры, любым регистром и слэшем). */
const PACK_FILE = /^update\/x64\/dlcpacks\/([^/]+)\/dlc\.rpf$/i;
const normal = (relativePath) => String(relativePath || "").replace(/\\/g, "/");

/** Имя пака из пути ресурса; не пак — пустая строка. */
export const packOf = (relativePath) =>
  PACK_FILE.exec(normal(relativePath))?.[1] || "";

/** Не чаще одной автопочинки пака за это время (между перезапусками тоже): лаунчер сервера, возвращающий пак на каждом запуске, иначе гонял бы страж вечно. */
export const HOLD_MS = 6 * 60 * 60 * 1000;
export const GUARD_FILE = "clothing-pack-guard.json";

/**
 * Процессы лаунчеров серверов: пока они идут, пак может быть в середине проверки или обновления, и писать в него нельзя. Majestic Launcher — по коду Astral (`launcher-game-paths.js`);
 * RAGE MP (`ragemp*`) и лаунчеры GTA 5 RP (`gta5rp*`, `gta 5 rp*`), alt:V (`altv*`) — по именам, на живой системе не сверено.
 */
export const SERVER_LAUNCHERS =
  /^(majestic launcher|ragemp[^.]*|gta ?5 ?rp[^.]*|altv[^.]*)\.exe$/i;

/** Одна починка пака за запуск приложения: память процесса (пара «игра/пак»). Тесты подставляют свою. */
const repairedThisRun = new Set();

const firstLine = (error) =>
  String(error?.message || error || "неизвестная ошибка")
    .split(/\r?\n/)[0]
    .slice(0, 200);

const keyOf = (game, pack) => `${game.id}/${String(pack).toLowerCase()}`;

async function readGuard(stateDir) {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(stateDir, GUARD_FILE), "utf8"),
    );
    return parsed &&
      typeof parsed === "object" &&
      parsed.packs &&
      typeof parsed.packs === "object"
      ? parsed
      : { packs: {} };
  } catch {
    return { packs: {} };
  }
}

async function writeGuard(stateDir, data) {
  const file = path.join(stateDir, GUARD_FILE);
  const staged = `${file}.${process.pid}.tmp`;
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(staged, `${JSON.stringify(data, null, 1)}\n`);
  await fs.rename(staged, file);
}

/** Что страж знает о каждом дрейфующем паке: имя, сколько установок в нём, и чем он стал (`stock` — вернули к штатному, `changed` — стал другим, `missing` — файла нет). */
export function describePacks(items) {
  return items.map((item) => {
    const stock =
      item.reason === "modified" &&
      /^[a-f0-9]{64}$/i.test(String(item.baselineHash || "")) &&
      String(item.actualHash || "").toLowerCase() ===
        String(item.baselineHash).toLowerCase();
    return {
      name: packOf(item.relativePath),
      archive: normal(item.relativePath),
      mods: Math.max(0, Number(item.mods) || 0),
      kind: stock ? "stock" : item.reason === "missing" ? "missing" : "changed",
    };
  });
}

/** Игра или лаунчер сервера идут: что именно — для журнала. Пусто — можно писать. */
async function busyReason({
  game,
  gameRunning,
  launchersRunning,
  assertRuntimeSafety,
}) {
  if (await gameRunning(game)) return "game-running";
  try {
    await assertRuntimeSafety(game);
  } catch (error) {
    if (error?.code === "ASTRAL_GAME_UPDATE_RUNNING") return "launcher-busy";
    if (error?.code === "ASTRAL_GAME_RUNNING") return "game-running";
    throw error;
  }
  if ((await launchersRunning(game)).length) return "launcher-running";
  return "";
}

/**
 * Одна игра: сверить файлы и, если безопасно, вернуть паки.
 * `outcome`: `none` | `intact` | `skipped` (`why`: `suspended` | `stock-hold` | `game-running` | `launcher-busy` | `launcher-running`: писать нельзя сейчас, слов нет) |
 * `held` (`why`: `other-drift` | `changed` | `repeat`: страж не трогает, слова окну) | `restored` (паки возвращены) | `failed`.
 * `packs` — `[{ name, mods, kind }]`.
 */
async function healPacksOnce({
  game,
  stateDir,
  audit = auditTarget,
  park = parkRevertedMods,
  restore = restoreParkedMods,
  parkedIn = parkedModsInArchives,
  profile = inspectProfile,
  /* Пересборка архивов тяжёлая — грузится по вызову, не на старте (main-startup-imports.test.js). */
  tools = async () => {
    const composer = await import("./rpf-composer.js");
    const { ENTRY_MATERIALIZERS } = await import("./entry-materializers.js");
    return {
      rpfComposer: composer.composeRpfArchive,
      contentXmlProvider: composer.provideUpdateContentXml,
      dlcListProvider: composer.provideLegacyDlcList,
      ...ENTRY_MATERIALIZERS,
    };
  },
  gameRunning = async () => false,
  launchersRunning = async () =>
    (await runningProcessesMatching(SERVER_LAUNCHERS)).map((row) => row.name),
  assertRuntimeSafety = assertInstallRuntimeSafe,
  installBusy = () => false,
  /* История точек отката движку: по ней проверка файлов узнаёт нашу нативную правку `update.rpf` (работа мастерской), а не принимает её за чужую. */
  nativeHistory = wireEngineHistory,
  memory = repairedThisRun,
  now = Date.now,
  holdMs = HOLD_MS,
}) {
  if (game?.edition !== "Legacy") return { outcome: "none" };
  /* Идёт установка или работа мастерской: страж ждёт (окно повторит проверку), а не встречается с ней на файле игры (ревью, №21). */
  if (installBusy()) return { outcome: "skipped", why: "busy" };
  /* Страж живёт с первых секунд, а установка, которая подключает историю точек, может ещё не загрузиться: без неё работа мастерской, записанная в прошлый запуск, выглядела бы чужой правкой. */
  try {
    await nativeHistory();
  } catch {
    // без истории проверка работает, как до 17.11.2026: нативная правка видна как расхождение
  }
  const report = await audit({ targetId: game.id, stateDir });
  /* Сверка идёт секунды (отпечаток двухгигабайтного update.rpf): работа мастерской или установка, начавшаяся за это время, могла сменить файл и запись под сверкой. Слов про расхождение, которое видно
     только потому, что страж читал посреди чужой записи, нет: он подождёт и проверит ещё раз. */
  if (installBusy()) return { outcome: "skipped", why: "busy" };
  if (!report || report.status === "not-configured") return { outcome: "none" };
  if (report.status === "suspended")
    return { outcome: "skipped", why: "suspended" };
  if (report.status !== "drift" || !report.drift?.length)
    return { outcome: "intact", checked: report.checked ?? 0 };

  const packItems = report.drift.filter((item) => packOf(item.relativePath));
  const others = report.drift
    .filter((item) => !packOf(item.relativePath))
    .map((item) => normal(item.relativePath));
  const saved = await readGuard(stateDir);
  /* Страж бережёт заменёнки. Пак без единой из них (`mods` 0: свой DLC Astral под текстуры или дороги, чужой пак без наших записей) ему не принадлежит: чинить в нём нечего, а «заменёнки (0) в нём не видны»
     было красной строкой окну про одежду, которой там нет (журнал alpha beta.106, 15.11 23:37:07, astral_textures и astral_textures_b). Расхождение таких паков показывает «Настройки → Игра».
     Исключение — пак с отметкой `pending`: страж сам снял с него моды (у вернувшегося пака `mods` после этого 0), и довести возврат — его работа (ревью, №4). */
  const packs = describePacks(packItems).filter(
    (pack) => pack.mods > 0 || (saved.packs[keyOf(game, pack.name)]?.pending || []).length > 0,
  );
  /* Ни одного пака стража в расхождении нет — ему тут нечего беречь, что бы ещё ни разошлось: `update/update.rpf` (подмена снаружи, чужой редукс), `x64v.rpf` и прочее показывает «Настройки → Игра»,
     а подменённый update.rpf подхватывает подготовка игры при запуске. Журнал beta.106, 16.11 08:20:31 UTC: расходился один update.rpf, и окну уходила красная плашка про одежду, которой там нет, а в журнале
     была строка с пустыми скобками «паки игры () разошлись…». Поэтому итог — «на месте», и до проверки «игра или лаунчер идёт»: слов про пустой список паков быть не должно. */
  if (!packs.length) return { outcome: "intact", checked: report.checked ?? 0 };

  /* Игра запущена или лаунчер сервера идёт — не пишем и не говорим: пак может быть в середине проверки, слова придут, когда всё закроется. */
  let busy;
  try {
    busy = await busyReason({
      game,
      gameRunning,
      launchersRunning,
      assertRuntimeSafety,
    });
  } catch (error) {
    return {
      outcome: "failed",
      cause: "packs-returned",
      code: failureCode(error),
      reason: firstLine(error),
      packs,
    };
  }
  if (busy) return { outcome: "skipped", why: busy, packs };

  /* Рядом с паком стража расходится ещё и другой файл (update.rpf, файл вне слоёв) — поверх такого не пишем. Один update.rpf без паков сюда не доходит: выше он `intact`. */
  if (others.length)
    return {
      outcome: "held",
      why: "other-drift",
      packs,
      others: others.slice(0, 6),
    };
  /* Пак стал не штатным (обновление игры, чужой мод) или пропал — ставить записи поверх чужого нельзя. */
  if (packs.some((pack) => pack.kind !== "stock"))
    return { outcome: "held", why: "changed", packs };
  /* Игра возвращена к исходной и удерживается («Вернуть GTA V без модов»): моды сняты нарочно, ставить их обратно нельзя. */
  const current = await profile({ stateDir }).catch(() => null);
  if (current?.targets?.[game.id]?.stockHold)
    return { outcome: "skipped", why: "stock-hold", packs };
  /* Между проверкой в начале и записью проходит аудит (секунды, на больших паках — дольше): установка, начавшаяся за это время, не должна встретиться со стражем (ревью, №21). */
  if (installBusy()) return { outcome: "skipped", why: "busy", packs };

  const stamp = now();
  const touched = packs.map((pack) => keyOf(game, pack.name));
  const archives = packs.map((pack) => pack.archive);

  /* Недоделанный возврат самого стража: он снял моды (отметка `pending`) и не вернул (упал, приложение закрыли, файл был занят). Это не качели, а продолжение прежней попытки: довести. Снятые человеком моды сюда
     не попадают — у них нет отметки (ревью, №4). Один раз за запуск приложения, чтобы упрямая ошибка не крутилась. */
  const pending = [
    ...new Set(touched.flatMap((key) => saved.packs[key]?.pending || [])),
  ];
  if (pending.length) {
    const stuck = await parkedIn({
      targetId: game.id,
      stateDir,
      modIds: pending,
      archives,
    }).catch(() => []);
    const resumeKey = `resume/${touched.join("+")}`;
    if (stuck.length && !memory.has(resumeKey)) {
      memory.add(resumeKey);
      return finish({ stuck, packs, resumed: true });
    }
    if (!stuck.length)
      /* Отметка устарела (моды вернул человек или переустановил): снять её. */
      for (const key of touched) delete saved.packs[key]?.pending;
    if (stuck.length)
      return {
        outcome: "held",
        why: "resume-failed",
        packs,
        parked: stuck.length,
      };
  }

  /* Качели: этот пак уже чинили в этом запуске приложения или недавно (запись рядом с состоянием движка). */
  const again = packs.filter((pack) => {
    const key = keyOf(game, pack.name);
    const at = Number(saved.packs[key]?.repairedAt) || 0;
    return memory.has(key) || (at > 0 && stamp - at < holdMs);
  });
  if (again.length) return { outcome: "held", why: "repeat", packs };

  /* Запись о попытке — до самой починки: упавшая или оборванная починка тоже считается, цикл невозможен. */
  for (const pack of packs) {
    memory.add(keyOf(game, pack.name));
    saved.packs[keyOf(game, pack.name)] = {
      repairedAt: stamp,
      mods: pack.mods,
    };
  }
  await writeGuard(stateDir, saved).catch(() => {});

  /* Пак штатный — моды в «снятые», потом те же моды обратно: слои ложатся поверх нынешнего пака. Между двумя шагами отметка `pending`: оборванный возврат дойдёт до конца на следующем запуске. */
  let parked;
  try {
    ({ parked } = await park({ targetId: game.id, stateDir }));
  } catch (error) {
    return {
      outcome: "failed",
      cause: "packs-returned",
      code: failureCode(error),
      reason: firstLine(error),
      packs,
    };
  }
  if (!parked?.length)
    return {
      outcome: "failed",
      cause: "packs-returned",
      code: "other",
      reason:
        "движок не отнёс вернувшиеся паки к снятым модам, ставить обратно нечего",
      packs,
    };
  for (const pack of packs)
    saved.packs[keyOf(game, pack.name)].pending = [...parked];
  await writeGuard(stateDir, saved).catch(() => {});
  return finish({ stuck: parked, packs, resumed: false });

  /** Вернуть снятые моды обратно и проверить, что паки больше не расходятся; при успехе отметка `pending` снимается. */
  async function finish({ stuck, packs: items, resumed }) {
    try {
      const restored = await restore({
        targetId: game.id,
        stateDir,
        modIds: stuck,
        ...(await tools()),
        assertRuntimeSafety: () => assertRuntimeSafety(game),
      });
      if (restored?.lost?.length)
        return {
          outcome: "failed",
          cause: "packs-returned",
          code: "other",
          reason: `не вернулись: ${restored.lost
            .map((item) => item?.modId || item)
            .slice(0, 3)
            .join(", ")}`,
          packs: items,
          parked: stuck.length,
          resumed,
        };
      const after = await audit({ targetId: game.id, stateDir });
      const left = after?.drift || [];
      if (!left.length && after?.status !== "drift") {
        const record = await readGuard(stateDir);
        for (const pack of items)
          delete record.packs[keyOf(game, pack.name)]?.pending;
        await writeGuard(stateDir, record).catch(() => {});
        return {
          outcome: "restored",
          cause: "packs-returned",
          packs: items,
          resumed,
        };
      }
      return {
        outcome: "failed",
        cause: "packs-returned",
        code: "other",
        reason: `после возврата паки всё ещё расходятся (${
          left
            .map((item) => normal(item.relativePath))
            .slice(0, 3)
            .join(", ") || "причина не названа"
        })`,
        packs: items,
        parked: stuck.length,
        resumed,
      };
    } catch (error) {
      return {
        outcome: "failed",
        cause: "packs-returned",
        code: failureCode(error),
        reason: firstLine(error),
        packs: items,
        parked: stuck.length,
        resumed,
      };
    }
  }
}

/** Подпись «не трогаю»: что и про какие паки уже сказано человеку. */
const heldSignature = (result) =>
  `${result.why || ""}:${(result.packs || []).map((pack) => `${pack.name}${pack.kind || ""}${pack.mods}`).join("+")}`;

/**
 * Одна игра: сверить файлы и, если безопасно, вернуть паки (`healPacksOnce`), а итог «не трогаю» не повторять человеку на каждом запуске: подпись последнего сказанного лежит рядом с записью стража
 * (`reported`, переживает перезапуск), и тот же итог приходит с `quiet: true` — слов и всплывашки нет, пока что-то не изменилось (ревью, №22). «Вернули» и «не вышло» говорятся каждый раз.
 */
export async function healClothingPacks(options) {
  const result = await healPacksOnce(options);
  const { game, stateDir } = options;
  if (!game?.id || !stateDir) return result;
  try {
    const saved = await readGuard(stateDir);
    const mark = saved.reported?.[game.id] || "";
    if (result.outcome === "held") {
      const signature = heldSignature(result);
      if (mark === signature) return { ...result, quiet: true };
      saved.reported = { ...saved.reported, [game.id]: signature };
      await writeGuard(stateDir, saved);
    } else if (
      mark &&
      ["intact", "restored", "failed", "none"].includes(result.outcome)
    ) {
      /* Ситуация закончилась (пак цел или возвращён): если она вернётся, человек должен услышать снова. */
      delete saved.reported[game.id];
      await writeGuard(stateDir, saved);
    }
  } catch {
    // запись стража необязательна: без неё итог просто скажется ещё раз
  }
  return result;
}

const list = (packs) => {
  const names = packs.map((pack) => pack.name);
  return (
    names.slice(0, 4).join(", ") +
    (names.length > 4 ? ` и ещё ${names.length - 4}` : "")
  );
};
const total = (packs) => packs.reduce((sum, pack) => sum + pack.mods, 0);

/** Строка журнала раздела install по итогу. Спокойное «на месте» и «писать нельзя сейчас» не пишутся (`null`), кроме одной строки про отложенную починку. */
export function packHealLogEntry(result, label = "") {
  const prefix = `Одежда${label ? ` ${label}` : ""}: `;
  const packs = result?.packs || [];
  switch (result?.outcome) {
    case "restored":
      return {
        level: "warn",
        message: `${prefix}${total(packs)} заменёнок вернулись в паки игры (${list(packs)}) — их вернули к штатному снаружи (проверка файлов Steam, лаунчер, ручная подмена), Astral поставил заменёнки на место`,
      };
    case "failed":
      /* Без списка паков (страж упал ещё на сверке файлов, `clothing-registration-heal.js`) скобки остались бы пустыми: говорим, что не вышла сама проверка. */
      return {
        level: "warn",
        message: `${prefix}${packs.length ? `паки игры (${list(packs)}) разошлись с записью Astral, вернуть не удалось` : "паки игры не удалось проверить"} (${result.reason})${result.parked ? `; заменёнки (${result.parked}) сняты и лежат в «Библиотеке» как «снятые проверкой файлов» — «Установить снова» вернёт их, страж доведёт возврат при следующем запуске` : ""}`,
      };
    case "held":
      if (result.why === "repeat")
        return {
          level: "warn",
          message: `${prefix}пак (${list(packs)}) снова вернули к штатному вскоре после починки (лаунчер сервера или проверка файлов делает это на каждом запуске) — заменёнка (${total(packs)}) на этом клиенте не удержится, страж больше не ставит. Вернуть её на время можно двумя шагами: «Настройки → Игра → Вернуть как было» переложит её в «Библиотеку» как «снятую проверкой файлов», «Установить снова» там поставит её на место`,
        };
      if (result.why === "changed")
        return {
          level: "warn",
          message: `${prefix}пак (${list(packs)}) стал не штатным, а другим (обновление игры или чужой мод) или пропал — заменёнки (${total(packs)}) в нём не видны, страж поверх чужого не пишет; решает человек: «Настройки → Игра → Вернуть как было»`,
        };
      if (result.why === "resume-failed")
        return {
          level: "warn",
          message: `${prefix}заменёнки пака (${list(packs)}) страж уже снял и не смог вернуть (${result.parked || 0}) — они в «Библиотеке» как «снятые проверкой файлов», «Установить снова» вернёт их; страж доведёт возврат при следующем запуске`,
        };
      /* Паки не расходятся вовсе (разошёлся один update.rpf) — слова «не только в паках» были бы неправдой (17.11.2026). */
      if (!packs.length)
        return {
          level: "warn",
          message: `${prefix}файлы игры изменены не через Astral (${(result.others || []).join(", ")}), паки с заменёнками не расходятся — страж ничего не трогает; «Настройки → Игра» покажет расхождения`,
        };
      return {
        level: "warn",
        message: `${prefix}файлы игры разошлись с записью Astral не только в паках (${(result.others || []).join(", ")}) — страж ничего не трогает; «Настройки → Игра» покажет расхождения, а заменёнки вернувшихся к штатному паков возвращаются через «Библиотеку → Установить снова»`,
      };
    case "skipped":
      /* «Отложили» и «не возвращаю» говорятся про паки: без них (список пуст) сказать нечего, а скобки `()` человеку ничего не значат. */
      if (!packs.length && result.why !== "busy") return null;
      if (result.why === "busy")
        return {
          level: "info",
          message: `${prefix}идёт другая установка — страж паков подождёт, проверит ещё раз`,
        };
      if (
        result.why === "game-running" ||
        result.why === "launcher-busy" ||
        result.why === "launcher-running"
      )
        return {
          level: "info",
          message: `${prefix}паки игры (${list(packs)}) разошлись с записью Astral, ${result.why === "game-running" ? "игра запущена" : "идёт лаунчер"} — починку отложили до выхода`,
        };
      if (result.why === "stock-hold")
        return {
          level: "info",
          message: `${prefix}паки игры (${list(packs)}) разошлись с записью Astral, но игра возвращена к исходной и удерживается — моды не возвращаю`,
        };
      return null;
    default:
      return null;
  }
}
