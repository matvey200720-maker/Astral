import fs from "node:fs/promises";
import path from "node:path";
import { resolveDesktopCloudOrigin } from "./desktop-auth.js";

/*
 * `betaWeb` — интерфейс бета-лаунчера, расшифрованный из pak в память
 * (beta/guard.js → loadWeb). С ним сервер отдаёт интерфейс из памяти и папку
 * `resources/web` не читает вовсе, даже если она есть или путь к ней задан в
 * окружении: открытого интерфейса на диске у беты быть не должно.
 * `shellToken` — ключ этого запуска: без него в заголовке X-Astral-Shell сервер
 * интерфейс не отдаёт (его проставляет главный процесс окнам).
 */
export async function startPackagedServices(
  app,
  { betaWeb = null, shellToken = "" } = {},
) {
  if (!app.isPackaged) return { server: null, webUrl: "" };
  const runtimeRoot = path.join(app.getPath("userData"), "runtime");
  await fs.mkdir(runtimeRoot, { recursive: true });
  const trustedKey = path.join(runtimeRoot, "catalog-public.pem");
  try {
    await fs.access(trustedKey);
  } catch {
    await fs.copyFile(
      path.join(process.resourcesPath, "catalog-public.pem"),
      trustedKey,
    );
  }
  process.env.NODE_ENV = "production";
  process.env.MODOVIK_LOCAL_DESKTOP = "1";
  process.env.MODOVIK_RUNTIME_ROOT = runtimeRoot;
  if (betaWeb) delete process.env.MODOVIK_WEB_ROOT;
  else process.env.MODOVIK_WEB_ROOT = path.join(process.resourcesPath, "web");
  /* Картинки новостей окно берёт у своего API, а API — у того же облака, что
     отдаёт сами новости (ТЗ 05.10, задача 12). */
  process.env.ASTRAL_NEWS_ORIGIN = resolveDesktopCloudOrigin({ app });
  const localInstaller = path.resolve(
    path.dirname(process.execPath),
    "..",
    `Astral-${app.getVersion()}-Setup.exe`,
  );
  try {
    await fs.access(localInstaller);
    process.env.MODOVIK_INSTALLER_PATH = localInstaller;
    const localMetadata = path.join(
      path.dirname(localInstaller),
      "latest.json",
    );
    try {
      await fs.access(localMetadata);
      process.env.MODOVIK_INSTALLER_METADATA_PATH = localMetadata;
    } catch {}
  } catch {}
  const bundledPackages = path.join(process.resourcesPath, "packages");
  try {
    await fs.access(bundledPackages);
    await fs.cp(bundledPackages, path.join(runtimeRoot, "packages"), {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  } catch {}
  const { startServer, serveWebFromMemory } = await import("@modovik/api/app");
  /* `betaWeb` может быть ещё не готов (проверка pak идёт в потоке, пока импортируется сервер). Не открылся — сервер не поднимаем. */
  const bundle = await betaWeb;
  if (betaWeb && !bundle) return { server: null, webUrl: "" };
  if (bundle) serveWebFromMemory(bundle.files, { accessToken: shellToken });
  let apiRuntime = startServer({ port: 4174 });
  let server;
  try {
    server = await apiRuntime.serverReady;
  } catch (error) {
    if (error?.code !== "EADDRINUSE") throw error;
    apiRuntime = startServer({ port: 0 });
    server = await apiRuntime.serverReady;
  }
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("Astral local service did not expose a TCP port.");
  }
  return { server, webUrl: `http://127.0.0.1:${address.port}` };
}
