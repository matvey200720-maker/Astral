/*
 * Экспресс-установка своего dlc со стороны приложения (16.11.2026, работа «Astral быстрее», этап A).
 *
 * Движок установки (`installPackageBatch({ expressInstall })`, `express-item.js`) откладывает сборку своего пакета
 * дополнения и спрашивает у приложения две вещи:
 *   - `accepts(build)` — берёт ли экспресс-путь эту сборку: включён ли выключатель модуля
 *     (`ASTRAL_ENGINE_EXPRESS_DLC=<модули>`), найден ли движок и умеет ли путь такой состав;
 *   - `build(request)` — построить архив сразу под живым именем: основа раскладывается файлами (`express-base.js`),
 *     состав собирается из основы и операций (`express-packs.js`), движок пишет архив (`express-dlc.js` поверх
 *     `express-engine.js`). Ответ — длина и SHA-256, которые назвал движок.
 *
 * Выключатель пуст (по умолчанию) — `expressInstallFor` отдаёт `null`, и установка идёт прежним путём без единого
 * лишнего шага. Слово модуля — имя пакета без приставки `astral_` и без буквы второго пакета: `astral_vegetation_b` —
 * это модуль `vegetation`, `astral_roads` — `roads`.
 *
 * Видимых человеку строк нет: отказы уходят ошибкой установки со словами движка.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { EXPRESS_DLC_ENV, expressDlcEnabled, installExpressDlc } from "@modovik/install-engine/express-dlc.js";
import { expressEntryPlace, expressPackNameOf, expressPackOf } from "@modovik/install-engine/express-packs.js";
import { appLog } from "./app-log.js";
import { layOutExpressBase } from "./express-base.js";
import { createExpressEngine } from "./express-engine.js";

/** Слово модуля по архиву своего пакета; не свой пакет — `null`. */
export function expressModuleOf(archiveTarget) {
  const name = expressPackNameOf(archiveTarget);
  if (!name?.startsWith("astral_")) return null;
  return name.slice("astral_".length).replace(/_[a-z]$/, "") || null;
}

/** Состав, который путь умеет: каждая запись — в корне пакета или во вложенном архиве корня. */
export function expressCompositionSupported(operations) {
  try {
    for (const operation of operations || []) expressEntryPlace(operation?.entry);
    return true;
  } catch {
    return false;
  }
}

/** Включён ли экспресс-путь хоть для одного модуля. */
export const expressSwitchedOn = (env = process.env) => String(env[EXPRESS_DLC_ENV] || "").trim() !== "";

/**
 * Экспресс-путь для движка установки: `{ accepts, build }`.
 *
 * `locate()` — где движок и что ему нужно: `{ executable, keysDirectory, pointsRoot }` (спрашивается, когда путь
 * впервые понадобился, и помнится на эту установку). `fastInstall` и `writeLimitMbps` — значениями или функциями,
 * `onProgress({ phase, done, total })` — ход записи архива. Остальное — для проверок.
 */
export function createExpressInstall({
  locate,
  env = process.env,
  fastInstall = false,
  writeLimitMbps = null,
  onProgress = null,
  scratchRoot = os.tmpdir(),
  layOut = layOutExpressBase,
  packOf = expressPackOf,
  install = installExpressDlc,
  makeEngine = createExpressEngine,
  log = null,
} = {}) {
  if (typeof locate !== "function") throw new Error("Экспресс-установка: не сказано, где движок.");
  let located = null;
  const place = () => (located ||= Promise.resolve().then(locate));

  return {
    /*
     * Откат на прежний путь (19.11.2026, `express-fallback.js`): сборка своего dlc движком отказала, игра возвращена как была, пакет
     * ставится прежним способом. Человеку ничего не показывается; в журнал — одна строка: какой пакет и почему. Сбой журнала установку
     * не роняет.
     */
    async onFallback({ target = "", reason = "", code = null } = {}) {
      if (typeof log !== "function") return;
      const name = expressPackNameOf(target) || String(target || "свой пакет");
      try {
        await log(`Экспресс-установка: ${name} — откат на прежний путь, пакет ставится прежним способом${code ? ` (${code})` : ""}: ${String(reason).slice(0, 400)}`);
      } catch {
        /* журнал не должен ронять установку */
      }
    },

    async accepts(build) {
      const moduleName = expressModuleOf(build?.archiveTarget);
      if (!moduleName || !expressDlcEnabled(moduleName, env)) return false;
      if (!expressCompositionSupported(build.operations)) return false;
      const { executable } = (await place().catch(() => null)) || {};
      return Boolean(executable);
    },

    async build({ archiveTarget, livePath, gameRoot, baseArchive, baseSha256, operations, signal = null }) {
      const moduleName = expressModuleOf(archiveTarget);
      if (!moduleName) throw new Error("Экспресс-установка: архив не свой пакет дополнения.");
      const { executable, keysDirectory = null, pointsRoot = null } = await place();
      const baseEntries = await layOut({ baseArchive, baseSha256, executable, keysDirectory, signal });
      const pack = await packOf({ archiveTarget, baseEntries, operations });
      /* Запросы движка — в своей временной папке этой сборки: убирается и после отказа. */
      const requestDir = await fs.mkdtemp(path.join(scratchRoot, "astral-express-"));
      try {
        const engine = makeEngine({ executable, moduleName, gameRoot, keysDirectory, pointsRoot, requestDir, fastInstall, writeLimitMbps, env });
        const result = await install({ engine, gameRoot, packs: [pack], moduleName, packsAtOnce: 1, signal, onProgress });
        const built = result?.packs?.[0];
        if (!built || path.resolve(String(built.path)).toLowerCase() !== path.resolve(String(livePath)).toLowerCase())
          throw new Error("Экспресс-установка: движок построил архив не на том месте.");
        return { sha256: built.sha256, bytes: built.bytes, files: pack.files };
      } finally {
        await fs.rm(requestDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

/**
 * Экспресс-путь этой установки или `null`, если выключатель пуст: тогда движок установки идёт прежним путём и сборку
 * своих пакетов не откладывает вовсе.
 */
export function expressInstallFor({ env = process.env, ...options } = {}) {
  return expressSwitchedOn(env) ? createExpressInstall({ env, ...options }) : null;
}

/**
 * Экспресс-путь установки из приложения: движок, ключи и папка точек — как у остальных установок. Выключатель пуст —
 * `null`, и ни один модуль ниже не подключается. `onProgress` — ход установки окна: байты записи архива идут фазой
 * `commit`, как байты подмены у прежнего пути.
 */
export function appExpressInstall({ stateDir, onProgress = null, env = process.env } = {}) {
  if (!expressSwitchedOn(env)) return null;
  let bridge = null;
  return createExpressInstall({
    env,
    /* Откат на прежний путь — в журнал приложения, как остальные записи установки (`install-state-ipc.js`). */
    log: (message) => {
      console.warn(`[astral] ${message}`);
      appLog.record({ level: "warn", source: "install", message });
    },
    locate: async () => {
      const [native, rust, provisioner, chain] = await Promise.all([
        import("./native-engine.js"),
        import("./native-engine-rust.js"),
        import("./loader-provisioner.js"),
        import("./native-restore-chain.js"),
      ]);
      bridge = native;
      return {
        executable: rust.resolveRustExecutable({ ...native.engineLocationDefaults(), ...(native.nativeContextDefaultsOf() || {}) }),
        keysDirectory: (await provisioner.archiveKeysDirectory({ stateDir })) || null,
        pointsRoot: chain.nativeRestorePointsRoot(),
      };
    },
    fastInstall: () => bridge?.nativeFastInstall() === true,
    /* Короткая запись идёт по потолку режима, а не по доле регулятора диска (мод на 9 МБ не ждёт чужой записи). */
    writeLimitMbps: () => bridge?.nativeModeWriteLimit?.() ?? bridge?.nativeWriteLimit() ?? null,
    onProgress: onProgress ? (step) => onProgress({ phase: "commit", percent: 99, cancellable: false, copiedBytes: step.done, totalBytes: step.total }) : null,
  });
}
