import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import hpp from "hpp";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalog } from "@modovik/catalog";
import { ApiContractError, validateApiRequest } from "@modovik/contracts/api";
import {
  applyPromo,
  authenticate,
  createUser,
  getUserById,
  listUsers,
  updateUser,
} from "@modovik/auth-store";
import {
  closeTicket,
  createCode,
  deleteTicket,
  getAnalytics,
  getRatingSummaries,
  listCodes,
  listTickets,
  rateMod,
  redeemCode,
  replyTicket,
} from "@modovik/admin-store";
import { createSessionToken, verifySessionToken } from "./session-token.js";
import { createTracerPublisher } from "./tracer-publisher.js";
import { createPreparedPublisher } from "./prepared-publisher.js";
import { createPtfxCoreRelease } from "./ptfx-core-release.js";
import { createModelikSupabaseRouter } from "./modelik-supabase.js";
import { createModelikModCatalog } from "./modelik-mod-catalog.js";
import { createStarterMods } from "./trusted-catalog.js";
import { isAdminUser } from "./access-control.js";
import { createAnalyticsRouter } from "./routes/analytics.js";
import { createBillingRouter } from "./routes/billing.js";
import { createBuildsRouter } from "./routes/builds.js";
import { createWorkshopProjectsRouter } from "./routes/workshop-projects.js";
import { runtimeRouter } from "./routes/system.js";
import { createTicketsRouter } from "./routes/tickets.js";
import { createModsRouter } from "./routes/mods.js";
import { createAdminPublishingRouter } from "./routes/admin-publishing.js";
import "./catalog-domains.js";
import { desktopSecurityMiddleware } from "./security-middleware.js";
import { apiRateLimit } from "./rate-limit.js";
import { cloudClipFromEnv } from "./cloud-clip.js";
import { cloudMediaFromEnv, newsMediaFromEnv } from "./cloud-media.js";
import { fxScenesFromEnv } from "./fx-scenes.js";
import { mountWebInterface } from "./web-interface.js";

export const app = express();
const production = process.env.NODE_ENV === "production";
const localDesktop = process.env.MODOVIK_LOCAL_DESKTOP === "1";
const secureCookies = production && !localDesktop;
const runtimeRoot = process.env.MODOVIK_RUNTIME_ROOT
  ? path.resolve(process.env.MODOVIK_RUNTIME_ROOT)
  : fileURLToPath(new URL("../../../runtime/", import.meta.url));
await mkdir(runtimeRoot, { recursive: true });
const { router: modelikSupabaseRouter, config: modelikSupabaseConfig } =
  createModelikSupabaseRouter({
    cacheDir: path.join(runtimeRoot, "modelik-supabase-cache"),
  });
const sessions = new Map();
const revokedSessions = new Map();
const activeClients = new Map();
const publishedModsFile = path.join(runtimeRoot, "published-mods.json");
const packagesRoot = path.join(runtimeRoot, "packages");
const mediaRoot = path.join(runtimeRoot, "media");
const catalogPublicKeyFile = path.join(runtimeRoot, "catalog-public.pem");
let publishedMods = [];
try {
  publishedMods = JSON.parse(await readFile(publishedModsFile, "utf8"));
} catch {
  publishedMods = [];
}
let catalogPublicKey = "";
try {
  catalogPublicKey = await readFile(catalogPublicKeyFile, "utf8");
} catch {}
/* Ядро эффектов: трассеры и слои текстур публикуются только поверх ядра,
   которое собрано, подписано и проверено человеком в сюжетном режиме. */
const coreRelease = createPtfxCoreRelease({ runtimeRoot });
const tracerPublisher = createTracerPublisher({
  runtimeRoot,
  catalogPublicKey,
  coreReleaseProvider: coreRelease.provider,
});
/* Публикация из папки черновика: пакет подписывается здесь же, тем же
   ключом, что и трассеры, — окну остаётся только карточка. */
const preparedPublisher = createPreparedPublisher({
  runtimeRoot,
  catalogPublicKey,
  coreReleaseProvider: coreRelease.provider,
});
const modelikModCatalog = createModelikModCatalog({
  config: modelikSupabaseConfig,
  publicKey: catalogPublicKey,
});
const baseCatalog = () => ({
  ...catalog,
  mods: [...publishedMods, ...catalog.mods],
});
const mirrorRoots = {
  eu: String(process.env.MODOVIK_EU_CDN_URL || "").replace(/\/+$/, ""),
  ru: String(process.env.MODOVIK_RU_CDN_URL || "").replace(/\/+$/, ""),
};
const withDeliveryMirrors = (mod) => {
  if (!mod?.manifest || !mod?.packageBaseUrl) return mod;
  const version = mod.manifest.version || mod.version || "1.0.0";
  const configured = Object.fromEntries(
    Object.entries(mirrorRoots)
      .filter(([, root]) => root)
      .map(([region, root]) => [region, `${root}/${mod.id}/${version}/`]),
  );
  return Object.keys(configured).length
    ? { ...mod, mirrors: { ...(mod.mirrors || {}), ...configured } }
    : mod;
};
/* Стартовые моды глазами игрока (trusted-catalog.js); админка берёт `catalog`. */
const starter = createStarterMods({ catalog, runtimeRoot, catalogPublicKey });
const playerBaseCatalog = () => ({
  ...catalog,
  mods: [...publishedMods, ...starter.shown()],
});
const liveCatalog = async () => {
  let modelikMods = [];
  if (modelikModCatalog.configured) {
    try {
      modelikMods = await modelikModCatalog.list();
    } catch {}
  }
  const base = baseCatalog();
  const seen = new Set();
  const current = {
    ...base,
    mods: [...publishedMods, ...modelikMods, ...(await starter.live())].filter(
      (mod) => {
        if (seen.has(mod.id)) return false;
        seen.add(mod.id);
        return true;
      },
    ),
  };
  const rated = await getRatingSummaries(
    current.mods.filter((mod) => !mod.internal),
  );
  return { ...current, mods: rated.map(withDeliveryMirrors) };
};
const SESSION_TTL = 1000 * 60 * 60 * 24 * 14;
const sessionSecretFile = path.join(os.homedir(), ".modovik", "session-secret");
async function loadSessionSecret() {
  const configured = String(process.env.MODOVIK_SESSION_SECRET || "");
  if (Buffer.byteLength(configured) >= 32) return configured;
  try {
    return await readFile(sessionSecretFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(path.dirname(sessionSecretFile), { recursive: true });
    const generated = randomBytes(48).toString("base64url");
    try {
      await writeFile(sessionSecretFile, generated, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return generated;
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      return readFile(sessionSecretFile, "utf8");
    }
  }
}
const sessionSecret = await loadSessionSecret();
if (production) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(desktopSecurityMiddleware);
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:4174",
    ],
    credentials: true,
    methods: ["GET", "POST", "DELETE", "PATCH"],
  }),
);
app.use(cookieParser());
app.use(hpp());
app.use(apiRateLimit());
// The migrated Supabase gateway owns a larger, route-scoped JSON parser for
// legacy avatar payloads. All native Modovik endpoints keep the stricter 96 KB
// ceiling below.
app.use(modelikSupabaseRouter);
app.use(express.json({ limit: "96kb", strict: true }));
app.use((req, res, next) => {
  try {
    validateApiRequest({ method: req.method, path: req.path, body: req.body });
    next();
  } catch (error) {
    if (error instanceof ApiContractError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    return next(error);
  }
});
app.use(
  "/api/packages",
  express.static(packagesRoot, {
    dotfiles: "deny",
    index: false,
    redirect: false,
    maxAge: "1h",
    immutable: true,
    setHeaders(response) {
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Disposition", "attachment");
      response.setHeader("X-Content-Type-Options", "nosniff");
    },
  }),
);
// Облачный каталог v2 по хэшу (cloud-media.js) — раньше статики /api/media.
app.get("/api/media/cloud/:sha256", cloudMediaFromEnv(runtimeRoot));
// Ролики со звуком (media.clip, до 256 МиБ) — свой маршрут: поток на диск, а не в память (cloud-clip.js).
app.get("/api/media/clip/:sha256", cloudClipFromEnv(runtimeRoot));
// Картинки новостей из бота Telegram (ТЗ 05.10, задача 12) — тем же путём.
app.get("/api/news/media/:sha256", newsMediaFromEnv(runtimeRoot));
// Кадры GTA V с глубиной для предпросмотра эффектов (docs/fx-scenes.md): с CDN, по манифесту и хэшу (fx-scenes.js).
const fxScenes = fxScenesFromEnv(runtimeRoot);
app.get("/api/fx-scenes/manifest", fxScenes.manifest);
app.get("/api/fx-scenes/file/:mode/:weaponClass/:id/:name", fxScenes.file);
app.use(
  "/api/media",
  express.static(mediaRoot, {
    dotfiles: "deny",
    index: false,
    redirect: false,
    maxAge: "1h",
    immutable: true,
    setHeaders(response) {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    },
  }),
);
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте через 15 минут." },
});

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}
function csrf(req, res) {
  let token = req.cookies.modovik_csrf;
  if (!token || token.length < 32) {
    token = randomBytes(24).toString("hex");
    res.cookie("modovik_csrf", token, {
      httpOnly: false,
      sameSite: "strict",
      secure: secureCookies,
      maxAge: SESSION_TTL,
      path: "/",
    });
  }
  return token;
}
function requireCsrf(req, res, next) {
  if (!safeEqual(req.get("x-csrf-token"), req.cookies.modovik_csrf))
    return res
      .status(403)
      .json({ error: "Проверка безопасности запроса не пройдена." });
  next();
}
function setSession(res, userId) {
  const token = createSessionToken({
    userId,
    secret: sessionSecret,
    ttlMs: SESSION_TTL,
  });
  const session = verifySessionToken(token, sessionSecret);
  sessions.set(session.sessionId, session);
  res.cookie("modovik_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookies,
    maxAge: SESSION_TTL,
    path: "/",
  });
}
async function resolveUser(req) {
  const session = verifySessionToken(
    req.cookies.modovik_session,
    sessionSecret,
  );
  if (!session || revokedSessions.has(session.sessionId)) return null;
  sessions.set(session.sessionId, session);
  return getUserById(session.userId);
}
async function requireUser(req, res, next) {
  const user = await resolveUser(req);
  if (!user)
    return res.status(401).json({ error: "Сначала войдите в аккаунт." });
  req.user = user;
  next();
}
function localQaAdmin(req) {
  if (production || req.get("x-astral-local-qa") !== "first-run-admin") {
    return null;
  }
  const remote = String(req.socket?.remoteAddress || "").toLowerCase();
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
  const origin = String(req.get("origin") || "");
  const referer = String(req.get("referer") || "");
  const devRenderer = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}(?:\/|$)/; // dev-серверы сессий
  const localRenderer = devRenderer.test(origin) || devRenderer.test(referer);
  if (!loopback || !localRenderer) return null;
  return {
    id: "019febfb-0000-7000-8000-000000000001",
    name: "Astral Local Admin",
    displayName: "Astral Local Admin",
    email: "admin@astral.local",
    role: "admin",
  };
}
async function requireAdmin(req, res, next) {
  const user = localQaAdmin(req) || (await resolveUser(req));
  if (!isAdminUser(user))
    return res.status(403).json({ error: "Недостаточно прав." });
  req.user = user;
  next();
}
app.use("/api", runtimeRouter(liveCatalog, playerBaseCatalog, runtimeRoot));
app.use("/api/builds", createBuildsRouter({ requireCsrf, requireUser }));
app.use(
  "/api/workshop/projects",
  createWorkshopProjectsRouter({ requireCsrf, requireUser }),
);
app.use("/api/mods", createModsRouter({ modCatalog: modelikModCatalog }));

app.get("/api/auth/session", async (req, res) =>
  res.json({ user: await resolveUser(req), csrfToken: csrf(req, res) }),
);
app.post(
  "/api/auth/register",
  authLimit,
  requireCsrf,
  async (req, res, next) => {
    try {
      const user = await createUser(req.body);
      setSession(res, user.id);
      res.status(201).json({ user, csrfToken: csrf(req, res) });
    } catch (error) {
      if (["VALIDATION", "DUPLICATE"].includes(error.code))
        return res.status(400).json({ error: error.message });
      next(error);
    }
  },
);
app.post("/api/auth/login", authLimit, requireCsrf, async (req, res, next) => {
  try {
    const user = await authenticate(req.body.email, req.body.password);
    if (!user)
      return res.status(401).json({ error: "Неверный email или пароль." });
    setSession(res, user.id);
    res.json({ user, csrfToken: csrf(req, res) });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/logout", requireCsrf, async (req, res) => {
  const session = verifySessionToken(
    req.cookies.modovik_session,
    sessionSecret,
  );
  if (session) {
    sessions.delete(session.sessionId);
    revokedSessions.set(session.sessionId, session.expiresAt);
  }
  res.clearCookie("modovik_session", { path: "/" });
  res.json({ ok: true, csrfToken: csrf(req, res) });
});
app.post("/api/account/promo", requireCsrf, requireUser, async (req, res) => {
  try {
    const normalized = String(req.body.code || "")
      .trim()
      .toUpperCase();
    if (req.user.promoCodes?.includes(normalized))
      throw new Error("Этот промокод уже активирован.");
    const benefit = await redeemCode(normalized);
    res.json({ user: await applyPromo(req.user.id, normalized, benefit) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.patch("/api/account", requireCsrf, requireUser, async (req, res) => {
  try {
    res.json({ user: await updateUser(req.user.id, req.body) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(
  "/api/analytics",
  createAnalyticsRouter({ activeClients, requireCsrf, resolveUser }),
);
app.use("/api/tickets", createTicketsRouter({ requireCsrf, requireUser }));
app.use("/api/billing", createBillingRouter({ requireCsrf, requireUser }));

app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
  const users = await listUsers();
  const analytics = await getAnalytics();
  const now = Date.now();
  const cutoff = Date.now() - 90_000;
  for (const [id, item] of sessions)
    if (item.expiresAt <= now) sessions.delete(id);
  for (const [id, expiresAt] of revokedSessions)
    if (expiresAt <= now) revokedSessions.delete(id);
  for (const [id, item] of activeClients)
    if (item.seenAt < cutoff) activeClients.delete(id);
  res.json({
    users: users.length,
    admins: users.filter((user) => user.role === "admin").length,
    mods: baseCatalog().mods.length,
    activeSessions: sessions.size,
    activeVisitors: [...activeClients.values()].filter(
      (item) => item.type === "web",
    ).length,
    activeAppUsers: [...activeClients.values()].filter(
      (item) => item.type === "desktop",
    ).length,
    ...analytics,
  });
});
app.use(
  "/api/admin",
  createAdminPublishingRouter({
    baseCatalog,
    catalog,
    catalogPublicKey,
    getPublishedMods: () => publishedMods,
    packagesRoot,
    publishedModsFile,
    requireAdmin,
    requireCsrf,
    setPublishedMods: (mods) => {
      publishedMods = mods;
    },
    tracerPublisher,
    preparedPublisher,
    coreRelease,
  }),
);

app.get("/api/admin/users", requireAdmin, async (_req, res) =>
  res.json({ users: await listUsers() }),
);
app.get("/api/admin/codes", requireAdmin, async (_req, res) =>
  res.json({ codes: await listCodes() }),
);
app.post("/api/admin/codes", requireCsrf, requireAdmin, async (req, res) => {
  try {
    res.status(201).json({ code: await createCode(req.body, req.user.id) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.get("/api/admin/tickets", requireAdmin, async (_req, res) =>
  res.json({ tickets: await listTickets() }),
);
app.post(
  "/api/admin/tickets/:id/reply",
  requireCsrf,
  requireAdmin,
  async (req, res) => {
    try {
      res.json({
        ticket: await replyTicket(req.params.id, req.body, {
          author: "admin",
          actorId: req.user.id,
        }),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);
app.post(
  "/api/admin/tickets/:id/close",
  requireCsrf,
  requireAdmin,
  async (req, res) => {
    try {
      res.json({
        ticket: await closeTicket(req.params.id, {
          isAdmin: true,
          actorId: req.user.id,
        }),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);
app.delete(
  "/api/admin/tickets/:id",
  requireCsrf,
  requireAdmin,
  async (req, res) => {
    try {
      res.json({ ticket: await deleteTicket(req.params.id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);
app.get("/api/admin/referrals", requireAdmin, async (_req, res) => {
  const users = await listUsers();
  const referrals = users
    .map((owner) => ({
      userId: owner.id,
      name: owner.name,
      email: owner.email,
      code: owner.referralCode,
      registrations: users.filter(
        (item) => item.referredBy === owner.referralCode,
      ).length,
    }))
    .sort((a, b) => b.registrations - a.registrations);
  res.json({ referrals });
});
app.get("/api/admin/analytics", requireAdmin, async (_req, res) =>
  res.json(await getAnalytics()),
);

app.post("/api/mods/:id/rating", requireCsrf, requireUser, async (req, res) => {
  try {
    const current = baseCatalog();
    const mod = current.mods.find((item) => item.id === req.params.id);
    if (!mod) return res.status(404).json({ error: "Мод не найден" });
    await rateMod(mod.id, req.user.id, req.body.value);
    const [summary] = await getRatingSummaries([mod]);
    res.json({ mod: summary });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Интерфейс окна — из папки или (бета-сборка) из памяти: web-interface.js.
export const serveWebFromMemory = mountWebInterface(app, {
  webRoot: process.env.MODOVIK_WEB_ROOT
    ? path.resolve(process.env.MODOVIK_WEB_ROOT)
    : null,
  production,
});

app.use((_req, res) => res.status(404).json({ error: "Маршрут не найден." }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Внутренняя ошибка сервиса." });
});
export function startServer({
  port = Number(process.env.PORT || 4174),
  host = "127.0.0.1",
} = {}) {
  const server = app.listen(port, host);
  const serverReady = new Promise((resolve, reject) => {
    if (server.listening) return resolve(server);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
  return { server, serverReady };
}
