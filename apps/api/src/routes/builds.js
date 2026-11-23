import { Router } from "express";
import {
  createBuild,
  deleteBuild,
  importBuild,
  listBuilds,
  updateBuild,
} from "@modovik/admin-store";

export function createBuildsRouter({ requireCsrf, requireUser }) {
  const router = Router();

  router.get("/", requireUser, async (req, res) =>
    res.json({ builds: await listBuilds(req.user.id) }),
  );
  router.post("/", requireCsrf, requireUser, async (req, res) => {
    try {
      res.status(201).json({ build: await createBuild(req.user.id, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.patch("/:id", requireCsrf, requireUser, async (req, res) => {
    try {
      res.json({
        build: await updateBuild(req.user.id, req.params.id, req.body),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.delete("/:id", requireCsrf, requireUser, async (req, res) => {
    try {
      res.json({ build: await deleteBuild(req.user.id, req.params.id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post("/import", requireCsrf, requireUser, async (req, res) => {
    try {
      res
        .status(201)
        .json({ build: await importBuild(req.user.id, req.body.code) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
