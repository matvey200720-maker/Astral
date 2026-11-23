import { Router } from "express";

export function createModsRouter({ modCatalog }) {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      res.json({ mods: await modCatalog.list() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const mod = await modCatalog.get(req.params.id);
      if (!mod) return res.status(404).json({ error: "Мод не найден." });
      return res.json({ mod });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:id/versions/:version/manifest", async (req, res, next) => {
    try {
      const mod = await modCatalog.get(req.params.id);
      const release = mod?.versions.find(
        (version) => version.version === req.params.version,
      );
      if (!release)
        return res.status(404).json({ error: "Версия мода не найдена." });
      return res.json({
        modId: mod.id,
        version: release.version,
        manifest: release.manifest,
        packageBaseUrl: release.packageBaseUrl,
        files: release.files,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
