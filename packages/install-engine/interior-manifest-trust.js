// Внутренний символ доверия, как у арены: интерьер пишет в настоящий
// update.rpf, а право на корень игры без подписи даёт только сам движок —
// вместе с повторной строгой проверкой формы манифеста ниже.
export const LOCAL_INTERIOR_TRUST = Symbol("local-interior-package");

export function isLocalInteriorManifest(manifest, edition) {
  const locationId = String(manifest?.interior?.locationId || "");
  const safeLocation = /^[a-z0-9][a-z0-9-]{2,79}$/.test(locationId);
  const entryName = safeLocation
    ? `astral_int_${locationId.replace(/-/g, "_")}.ymap`
    : "";
  const capabilities = Array.isArray(manifest?.capabilities)
    ? manifest.capabilities
    : [];
  const file = manifest?.files?.[0];
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    safeLocation &&
    manifest?.id === `local-legacy-interior-${locationId}` &&
    /^1\.0\.0-[a-f0-9]{12}$/.test(manifest?.version || "") &&
    // Прямая схема слоя Astral: настоящий update.rpf, без загрузчика.
    manifest?.scope === "game-root" &&
    manifest?.adapter === "rpf-entry" &&
    manifest?.requiresLoader === false &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(capabilities) ===
      JSON.stringify([
        "rpf-container-entry-v1",
        "astral-content-rpf-v1",
        "direct-update-rpf-v1",
        "direct-update-entries-v1",
      ]) &&
    Array.isArray(manifest?.editions) &&
    manifest.editions.length === 1 &&
    manifest.editions[0] === "Legacy" &&
    Array.isArray(manifest?.slots) &&
    manifest.slots.length === 1 &&
    manifest.slots[0] === `interior-location-${locationId}` &&
    manifest?.interior?.schemaVersion === 1 &&
    /^sha256:[a-f0-9]{64}$/.test(manifest.interior.designHash || "") &&
    /^sha256:[a-f0-9]{64}$/.test(manifest.interior.artifactHash || "") &&
    Array.isArray(manifest?.files) &&
    manifest.files.length === 1 &&
    file?.source === `payload/${entryName}` &&
    file?.target === "update/update.rpf" &&
    file?.action === "import" &&
    file?.entry === `x64/astral/astral_maps.rpf/${entryName}` &&
    file?.merge?.strategy === "rpf-resource-layer-v1" &&
    Number.isInteger(file?.size) &&
    file.size > 0 &&
    file.size <= 1024 * 1024 &&
    /^[a-f0-9]{64}$/.test(file?.sha256 || "") &&
    `sha256:${file.sha256}` === manifest.interior.artifactHash,
  );
}
