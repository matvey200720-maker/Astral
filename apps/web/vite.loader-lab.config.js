/*
 * Сборка одной лаборатории карточки загрузки (`loader-lab.html`), без остального приложения: настоящий код карточки и общего темпа,
 * те же плагины и настройки, что у основной сборки (`vite.config.js`), но один вход. `LAB_OUT` — куда складывать.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import base from "./vite.config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export default async (env) => {
  const config = typeof base === "function" ? await base(env) : base;
  return {
    ...config,
    build: {
      ...config.build,
      outDir: process.env.LAB_OUT || path.join(here, "dist-loader-lab"),
      emptyOutDir: true,
      rollupOptions: {
        ...config.build?.rollupOptions,
        input: { "loader-lab": path.join(here, "loader-lab.html") },
      },
    },
  };
};
