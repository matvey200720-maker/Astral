export function useDesktopTelemetry() {
  // The standalone Windows release is intentionally local-only. Cloud
  // telemetry must never affect startup or keep retrying an unavailable host.
}

export function recordDesktopCatalogDownload(modId) {
  void modId;
  return Promise.resolve();
}
