import { Router } from "express";
import { recordDownload, recordVisit } from "@modovik/admin-store";

export function createAnalyticsRouter({
  activeClients,
  requireCsrf,
  resolveUser,
}) {
  const router = Router();

  router.post("/visit", async (req, res) => {
    await recordVisit(req.body.visitorId, req.body.page);
    res.status(204).end();
  });
  router.post("/heartbeat", async (req, res) => {
    const id = String(req.body.clientId || "").slice(0, 80);
    if (id) {
      activeClients.set(id, {
        type: req.body.type === "desktop" ? "desktop" : "web",
        seenAt: Date.now(),
      });
    }
    res.status(204).end();
  });
  router.post("/download", requireCsrf, async (req, res) => {
    const user = await resolveUser(req);
    await recordDownload(req.body.modId, user?.id || null);
    res.status(204).end();
  });

  return router;
}
