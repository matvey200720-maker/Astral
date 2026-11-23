import { Router } from "express";
import {
  importWorkshopProject,
  listWorkshopProjects,
  upsertWorkshopProject,
} from "@modovik/admin-store";

export function createWorkshopProjectsRouter({ requireCsrf, requireUser }) {
  const router = Router();

  router.get("/", requireUser, async (req, res) => {
    res.json({ projects: await listWorkshopProjects(req.user.id) });
  });

  router.post("/", requireCsrf, requireUser, async (req, res) => {
    try {
      res.status(201).json({ project: await upsertWorkshopProject(req.user.id, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/import", requireCsrf, requireUser, async (req, res) => {
    try {
      res.status(201).json({ project: await importWorkshopProject(req.user.id, req.body?.code) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
