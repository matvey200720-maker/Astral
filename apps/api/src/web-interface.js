// Подключение веб-части окна к приложению Express: папка и/или набор файлов в памяти.
import express from "express";
import { createMemoryWeb } from "./memory-web.js";
import { join } from "node:path";

const DAY_MS = 86400000;

// Расширение → не кэшировать (поверх общего Cache-Control статики). Регистр важен.
const UNCACHED_SUFFIXES = [".glb", ".html"];

const staticOptions = (production) => ({
  dotfiles: "deny",
  index: false,
  redirect: false,
  maxAge: production ? DAY_MS : 0,
  setHeaders(response, file) {
    if (UNCACHED_SUFFIXES.some((suffix) => file.endsWith(suffix))) response.setHeader("Cache-Control", "no-store");
  },
});

// Запрос — переход по ссылке: GET вне /api/ с Accept, где есть text/html.
const isPageVisit = (request) =>
  request.method === "GET" &&
  !request.path.startsWith("/api/") &&
  String(request.headers.accept ?? "").includes("text/html");

const pageOfFolder = (webRoot) => {
  const page = join(webRoot, "index.html");
  return (request, response, next) => (isPageVisit(request) ? response.sendFile(page) : next());
};

// Шаги монтажа в порядке цепочки; шаги папки пропускаются, если её нет.
const MOUNT_STEPS = [
  (app, { memory }) => app.use(memory.middleware),
  (app, { webRoot, production }) => webRoot && app.use(express.static(webRoot, staticOptions(production))),
  (app, { webRoot }) => webRoot && app.use(pageOfFolder(webRoot)),
  (app, { memory }) => app.use(memory.spaFallback),
];

export function mountWebInterface(app, options = {}) {
  const { webRoot = null, production = false } = options;
  const memory = createMemoryWeb();
  const plan = { memory, webRoot, production };
  for (const mount of MOUNT_STEPS) mount(app, plan);
  return memory.use;
}
