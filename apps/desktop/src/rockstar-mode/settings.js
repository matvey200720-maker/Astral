/*
 * Настройки режима Rockstar по играм (05.11.2026): `rockstar-delivery.json`
 * рядом с состоянием движка. Ключ — папка игры (id копий у описи бывают
 * одинаковыми). Читают и окно (`rockstar-delivery.js`), и фоновый агент:
 * агент находит файл по `agent-config.json` (там путь к папке состояния —
 * окно переписывает его при каждом включении и старте).
 *
 *   { version: 1, targets: { "<папка игры, нижним регистром>": {
 *       mode: "swap", gameRoot, method, since, platform, needed } } }
 *
 * `platform` и `needed` (14.11.2026) окно записывает при включении режима:
 * агент описи игр не видит, а от них зависит пауза перед возвратом файлов и
 * то, какие процессы считаются стартом игры. У записей прежних версий их нет —
 * тогда платформа выводится по папке игры (`platform.js`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeMethod, needsAgent } from "@modovik/install-engine/rockstar-mode/plan.js";
import { platformOfFolder, PLATFORMS } from "@modovik/install-engine/rockstar-mode/platform.js";

export const SETTINGS_FILE = "rockstar-delivery.json";
export const rootKey = (gameRoot) => path.resolve(String(gameRoot || "")).toLowerCase();

const empty = () => ({ version: 1, targets: {} });

export async function readDeliverySettings(stateDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(stateDir, SETTINGS_FILE), "utf8"));
    return data && typeof data === "object" && data.targets && typeof data.targets === "object" ? data : empty();
  } catch {
    return empty();
  }
}

export async function writeDeliverySettings(stateDir, data) {
  const file = path.join(stateDir, SETTINGS_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stage = `${file}.${process.pid}.stage`;
  await fs.writeFile(stage, JSON.stringify({ version: 1, ...data }, null, 2));
  await fs.rename(stage, file);
}

/**
 * Игры с включённым режимом: `[{ gameRoot, method, since, platform, needed }]`.
 * `needed` — лаунчер копии сам возвращает свои файлы (копия из Rockstar Games
 * Launcher).
 */
export function enabledRoots(settings) {
  return Object.values(settings?.targets || {})
    .filter((item) => item?.mode === "swap" && item.gameRoot)
    .map((item) => {
      const known = typeof item.needed === "boolean" && PLATFORMS.includes(item.platform);
      const found = known ? null : platformOfFolder(item.gameRoot);
      return {
        gameRoot: item.gameRoot,
        method: normalizeMethod(item.method),
        since: item.since || null,
        platform: known ? item.platform : found.platform,
        needed: known ? item.needed : found.needed,
      };
    });
}

/** Игры, чей способ требует фонового агента (ручной способ его не заводит). */
export const agentRoots = (roots) => roots.filter((item) => needsAgent(item.method));
