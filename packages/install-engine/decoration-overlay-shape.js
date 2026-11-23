/*
 * Форма записей коллекций наложений педа (`decoration-overlay-v1`, место тату
 * мастерской одежды): что за запись, какие имена наложений. Без импортов —
 * им пользуются и проверка манифестов, и сборка записи.
 */
export const DECORATION_OVERLAY_STRATEGY = "decoration-overlay-v1";
export const DECORATION_OVERLAY_CAPABILITY = "decoration-overlay-merge-v1";
export const DECORATION_OVERLAY_ENTRY_PATTERN =
  /^(?:dlc_patch\/[a-z0-9_]{1,48}\/)?common\/data\/effects\/peds\/[a-z0-9_]{1,64}_overlays\.xml$/;
export const DECORATION_NAME_PATTERN = /^[A-Za-z0-9_]{1,96}$/;
