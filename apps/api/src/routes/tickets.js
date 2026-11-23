import { Router } from "express";
import {
  closeTicket,
  createTicket,
  listTickets,
  replyTicket,
} from "@modovik/admin-store";

export function createTicketsRouter({ requireCsrf, requireUser }) {
  const router = Router();

  router.get("/", requireUser, async (req, res) =>
    res.json({ tickets: await listTickets(req.user.id) }),
  );
  router.post("/", requireCsrf, requireUser, async (req, res) => {
    try {
      res.status(201).json({ ticket: await createTicket(req.user, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post("/:id/reply", requireCsrf, requireUser, async (req, res) => {
    try {
      res.json({
        ticket: await replyTicket(req.params.id, req.body, {
          author: "user",
          actorId: req.user.id,
          userId: req.user.id,
        }),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post("/:id/close", requireCsrf, requireUser, async (req, res) => {
    try {
      res.json({
        ticket: await closeTicket(req.params.id, {
          userId: req.user.id,
          actorId: req.user.id,
        }),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
