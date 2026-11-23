export const LOCAL_MEGA_MALL_OVERLAY_TRUST = Symbol(
  "local-mega-mall-overlay-trust",
);

export function isLocalMegaMallOverlayManifest(manifest, edition) {
  const overlay = manifest?.megaMall;
  const projectId = String(manifest?.id || "").replace(/^local-mega-mall-/, "");
  const file = manifest?.files?.[0];
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    /^[a-z0-9][a-z0-9._-]{0,63}$/.test(projectId) &&
    manifest?.id === `local-mega-mall-${projectId}` &&
    manifest?.scope === "newmods-vfs" &&
    manifest?.adapter === "managed-addon-dlc" &&
    manifest?.dlcName === "astral_davis_megamall" &&
    manifest?.requiresLoader === true &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(manifest?.capabilities) ===
      JSON.stringify(["astral-mega-mall-overlay-v1"]) &&
    JSON.stringify(manifest?.editions) === JSON.stringify(["Legacy"]) &&
    JSON.stringify(manifest?.slots) ===
      JSON.stringify(["world:davis-mega-mall"]) &&
    overlay?.schemaVersion === 2 &&
    overlay?.profileId === "davis-mega-mall.overlay.legacy-24129523.v2" &&
    /^sha256:[a-f0-9]{64}$/.test(overlay?.designHash || "") &&
    overlay?.assetName === "astral_davis_megamall_overlay" &&
    overlay?.independentSurfaces === 5 &&
    Array.isArray(manifest?.files) &&
    manifest.files.length === 1 &&
    file?.source === "payload/newmods/dlcpacks/astral_davis_megamall/dlc.rpf" &&
    file?.target === "newmods/dlcpacks/astral_davis_megamall/dlc.rpf" &&
    file?.action === "replace" &&
    Number.isInteger(file?.size) &&
    file.size > 0 &&
    file.size <= 64 * 1024 * 1024 &&
    /^[a-f0-9]{64}$/.test(file?.sha256 || ""),
  );
}
