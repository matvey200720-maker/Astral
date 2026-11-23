/*
 * «Одна запись вместо двух» со стороны приложения (19.11.2026, `docs/INSTALL-ONE-WRITE-1911.md`).
 *
 * Прежний путь пишет `update.rpf` дважды: сборка в кэш, потом копия в игру. Здесь движок собирает архив из операций сразу
 * рядом с живым файлом и подменяет его сам — в два шага: собрал и удержал (`hold`), приложение перечитало собранное
 * своими проверками, движок подменил (`commit`). Ядро — `@modovik/install-engine` (`transactions.js`, `ops-build.js`).
 *
 * Этот модуль отдаёт установщику описание подмены для работы: чем звать движок, кто решает «движок или помощник», какие
 * ключи движок понимает. Выключатель — `ASTRAL_ENGINE_INSTALL_OPS=<слова модулей>` (`catalog`, `optimization-layers`…);
 * без слова модуля функция отдаёт `null`, и установка идёт прежним путём без единого лишнего шага.
 *
 * Точка движка после установки не остаётся (`opsOnly`): историю и откат, как и раньше, ведут звенья установщика, а в
 * папке игры не остаётся второго имени прежнего архива. Любой отказ движка — та же работа прежним путём и строка в
 * журнале раздела install. Видимых человеку строк здесь нет.
 */

import { OPS_ALL, engineInstallOpsEnabled, setDefaultOpsEngine, setOpsNotice } from "@modovik/install-engine/ops-build.js";
import { appLog } from "./app-log.js";
import { engineInstallKeys } from "./native-engine.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { chooseComposeWriter, installRpfPrebuilt } from "./rpf-composer.js";

setOpsNotice((entry) => appLog.record({ source: "install", ...entry }));

/*
 * Опытный выключатель `ASTRAL_ENGINE_INSTALL_OPS_NESTED=1` (по умолчанию выключен, для стендов): сборку, которой нужен новый
 * вложенный архив (контейнер слоя `x64/astral/*.rpf`), на прежнем пути пишет помощник, и установке из операций она закрыта
 * (`chooseComposeWriter`). С выключателем её пишет движок. Байты такого архива не равны байтам помощника, поэтому до серии
 * запусков игры (сюжет, Majestic, GTA 5 RP) он остаётся выключенным везде.
 */
export const OPS_NESTED_ENV = "ASTRAL_ENGINE_INSTALL_OPS_NESTED";
const nestedByEngine = (env = process.env) => ["1", "on", "true"].includes(String(env[OPS_NESTED_ENV] || "").trim().toLowerCase());

/** Что подмене нужно сверх своих полей, чтобы установщик мог вести установку из операций в два шага. */
export const opsRouteTools = () => ({
  writerFor: (request) => chooseComposeWriter(nestedByEngine() ? { ...request, writer: "engine" } : request),
  installKeys: () => engineInstallKeys(),
});

/**
 * Описание подмены для установки из операций — или `null`, если слово модуля не включено.
 * `module` — слово выключателя, `workId` — id работы (для записи движка), `tools.installPrebuilt` — подмена для тестов и стендов.
 */
export function opsEngineInstall({ module, gameRoot, workId = "", version = 1, tools = {}, env = process.env } = {}) {
  if (!module || !gameRoot || !engineInstallOpsEnabled(module, env)) return null;
  return {
    opsOnly: true,
    install: tools.installPrebuilt ?? installRpfPrebuilt,
    edition: "Legacy",
    gameRoot,
    pointsRoot: nativeRestorePointsRoot(env),
    replay: { module, workId: String(workId || module), version },
    ...opsRouteTools(),
  };
}

/* Подмена по умолчанию: установка и снятие, которым своя подмена не дана, берут её, когда в выключателе стоит слово `all`. */
setDefaultOpsEngine(({ gameRoot, workId }) => opsEngineInstall({ module: OPS_ALL, gameRoot, workId }));
