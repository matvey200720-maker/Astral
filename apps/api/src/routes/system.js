import { Router } from "express";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverGames } from "@modovik/game-discovery";
import { getProfile } from "@modovik/install-engine";

async function readInstallerMetadata() {
  const candidates = [
    process.env.MODOVIK_INSTALLER_METADATA_PATH,
    fileURLToPath(new URL("../../../../release/latest.json", import.meta.url)),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(await readFile(path.resolve(candidate), "utf8"));
      if (
        typeof value.version === "string" &&
        typeof value.fileName === "string" &&
        Number.isSafeInteger(value.bytes) &&
        /^[a-f0-9]{64}$/i.test(String(value.sha256 || ""))
      ) {
        return {
          product: "Astral",
          version: value.version,
          fileName: path.basename(value.fileName),
          bytes: value.bytes,
          sha256: value.sha256.toUpperCase(),
          generatedAt: value.generatedAt || null,
        };
      }
    } catch {}
  }
  return null;
}

export function createLocalTestCatalog(baseCatalog, loadGeneratedMods = null) {
  return async () => {
    const base = baseCatalog();
    const generated =
      typeof loadGeneratedMods === "function"
        ? await loadGeneratedMods().catch(() => [])
        : [];
    const generatedById = new Map(
      (Array.isArray(generated) ? generated : []).map((mod) => [mod.id, mod]),
    );
    const merged = [
      ...base.mods.map((mod) => generatedById.get(mod.id) || mod),
      ...(Array.isArray(generated)
        ? generated.filter(
            (mod) => !base.mods.some((existing) => existing.id === mod.id),
          )
        : []),
    ];
    return {
      ...base,
      mods: merged.map((mod) =>
        mod.internal
          ? {
              ...mod,
              internal: true,
              catalogCategory: "other",
              catalogSubcategory: "Локальная диагностика",
              categoryLabel: "ЛОКАЛЬНЫЙ ТЕСТ",
            }
          : { ...mod, internal: false },
      ),
    };
  };
}

export async function loadGeneratedMods(file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  return Array.isArray(value) ? value : value.mods || [];
}

export function runtimeRouter(liveCatalog, baseCatalog, runtimeRoot) {
  const enabled =
    process.env.MODOVIK_LOCAL_DESKTOP === "1" ||
    process.env.NODE_ENV !== "production";
  const localTestCatalog = enabled
    ? createLocalTestCatalog(baseCatalog, () =>
        loadGeneratedMods(path.join(runtimeRoot, "local-test-mods.json")),
      )
    : null;
  return createSystemRouter({ liveCatalog, localTestCatalog });
}

export function createSystemRouter({ liveCatalog, localTestCatalog }) {
  const router = Router();

  router.get("/health", (_req, res) =>
    res.json({ ok: true, service: "astral-api", version: "1.0.0" }),
  );
  router.get("/download/desktop/metadata", async (_req, res) => {
    const metadata = await readInstallerMetadata();
    if (!metadata) {
      return res
        .status(503)
        .json({ error: "Метаданные установщика ещё не готовы." });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json(metadata);
  });
  router.get("/download/desktop", async (_req, res) => {
    const remoteInstaller = String(
      process.env.MODOVIK_INSTALLER_URL || "",
    ).trim();
    if (remoteInstaller) {
      try {
        const target = new URL(remoteInstaller);
        if (target.protocol === "https:")
          return res.redirect(302, target.toString());
      } catch {}
    }

    const candidates = [
      process.env.MODOVIK_INSTALLER_PATH,
      fileURLToPath(
        new URL("../../../../release/Astral-1.0.0-Setup.exe", import.meta.url),
      ),
      fileURLToPath(
        new URL("../../../../release/Modovik-1.0.0-Setup.exe", import.meta.url),
      ),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const installer = path.resolve(candidate);
      try {
        await access(installer);
        const metadata = await readInstallerMetadata();
        if (metadata?.sha256)
          res.setHeader("X-Checksum-SHA256", metadata.sha256);
        return res.download(installer, "Astral-1.0.0-Setup.exe");
      } catch {}
    }
    return res.status(503).json({
      error: "Windows-инсталлятор ещё не опубликован на сервере загрузок.",
    });
  });
  router.get("/catalog", async (_req, res) => res.json(await liveCatalog()));
  router.get("/local-test-catalog", async (_req, res) => {
    if (!localTestCatalog) return res.status(404).json({ error: "Not found" });
    res.setHeader("Cache-Control", "no-store");
    return res.json(await localTestCatalog());
  });
  router.get("/profile", async (_req, res) => res.json(await getProfile()));
  router.get("/system/installations", async (_req, res) =>
    res.json(await discoverGames()),
  );

  return router;
}
