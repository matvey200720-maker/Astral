/*
 * Выпуск ядра эффектов Astral: открыта ли публикация трассеров и текстур ядра.
 *
 * С 29.10.2026 «наше ядро» — слоты и клоны Astral в ядре самого игрока
 * (путь установки «ядро игрока», `ASTRAL_PTFX_PLAYER_CORE_*` в
 * `@modovik/tracer-contract`): установщик строит слот следа из штатного
 * донора его же `core.ypt` и кладёт текстуру в его же раскладке. Системный
 * пакет ядра (целый `core.ypt`, файл Rockstar) для каталога больше не нужен,
 * и раздавать его нельзя.
 *
 * Поэтому ворота держит одно условие: человек проверил этот путь установки в
 * сюжетном режиме — поставил трассер и текстуру ядра из каталога в игру,
 * запустил её, увидел эффекты — и отметил это (`storyModeSmokeTested`).
 * Отметка привязана к каналу и версии пути: поменяли путь установки (новая
 * версия в контракте) — публикация снова закрыта, пока его не проверят заново.
 *
 * Отметку ставит администратор руками в окне публикации (владелец поручил
 * ядро ведущей) — сервер её не придумывает, и без явного подтверждения она не
 * пишется. Слои прежнего пути (поверх системного ядра) не публикуются: им
 * нужен пакет, которого нет (`legacyCoreLayer`).
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  ASTRAL_PTFX_PLAYER_CORE_CHANNEL,
  ASTRAL_PTFX_PLAYER_CORE_VERSION,
  isPlayerCoreLayer,
} from "@modovik/tracer-contract";

/** Стратегии, которым нужно ядро: без проверенного пути их не публикуют. */
export const PTFX_CORE_STRATEGIES = Object.freeze([
  "astral-tracer-v1",
  "ypt-texture-layer-v1",
  "ypt-rule-patch-v1",
  "ypt-own-rules-v1",
]);

/** Слой ядра собран не для пути «ядро игрока» — ставить его некуда. */
export const legacyCoreLayer = (merge) =>
  PTFX_CORE_STRATEGIES.includes(merge?.strategy) && !isPlayerCoreLayer(merge);

export function createPtfxCoreRelease({
  runtimeRoot,
  now = () => new Date(),
  channel = ASTRAL_PTFX_PLAYER_CORE_CHANNEL,
  version = ASTRAL_PTFX_PLAYER_CORE_VERSION,
}) {
  const attestationFile = path.join(
    runtimeRoot,
    "ptfx-core",
    "player-core-release.json",
  );
  const base = { channel, version, path: "player-core" };

  async function readAttestation() {
    try {
      return JSON.parse(await readFile(attestationFile, "utf8"));
    } catch {
      return null;
    }
  }

  /** Состояние пути — и словами, почему публикация закрыта. */
  async function status() {
    const attestation = await readAttestation();
    const tested =
      attestation?.storyModeSmokeTested === true &&
      attestation.channel === channel &&
      attestation.version === version;
    return {
      ...base,
      /* Путь установки едет в самом приложении: собирать и раздавать нечего. */
      packaged: true,
      provisionerReady: true,
      storyModeSmokeTested: tested,
      build: version,
      releaseId: tested ? String(attestation.releaseId || "") : "",
      testedBy: tested ? String(attestation.testedBy || "") : "",
      testedAt: tested ? String(attestation.testedAt || "") : "",
      reason: tested
        ? ""
        : attestation?.storyModeSmokeTested === true
          ? `Путь установки ядра эффектов обновлён до ${version} после проверки — проверьте его в сюжетном режиме заново.`
          : `Путь установки ядра эффектов ${version} ещё не проверен в сюжетном режиме.`,
    };
  }

  /**
   * Отметка «проверено в сюжетном режиме» — от человека и только явно.
   */
  async function attest({ user, confirmed, note = "" } = {}) {
    if (confirmed !== true)
      throw new Error(
        "Подтвердите, что путь установки ядра проверен в сюжетном режиме.",
      );
    const record = {
      storyModeSmokeTested: true,
      channel,
      version,
      releaseId: randomUUID(),
      testedBy: String(
        user?.email || user?.name || user?.id || "администратор",
      ).slice(0, 160),
      testedAt: now().toISOString(),
      note: String(note || "")
        .trim()
        .slice(0, 500),
    };
    await mkdir(path.dirname(attestationFile), { recursive: true });
    const stage = `${attestationFile}.${randomUUID()}.stage`;
    await writeFile(stage, JSON.stringify(record, null, 2), "utf8");
    await rename(stage, attestationFile);
    return status();
  }

  return Object.freeze({ status, attest, provider: status });
}
