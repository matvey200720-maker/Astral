import { installRootFor, updatePaths } from "./paths.js";
import fs from "node:fs";

// Формат показываемой версии: три числовые группы через точку, затем необязательно
// дефис и хвост из букв, цифр, точек и дефисов. Регулярка собирается из частей.
const FORMAT = new RegExp(["^", ["\\d+", "\\d+", "\\d+"].join("\\."), "(?:-[A-Za-z0-9.-]+)?", "$"].join(""));

// Версия из манифеста релиза; при любом сбое на пути до неё — запасная.
export const releaseVersionFor = (executablePath, fallback = "", read = fs.readFileSync) => {
  try {
    const { manifest } = updatePaths(installRootFor(executablePath));
    const { version } = JSON.parse(read(manifest, "utf8")) ?? {};
    const shown = `${version || ""}`.trim();
    if (FORMAT.test(shown)) return shown;
  } catch {
    // нет манифеста, он не читается или не разбирается — берём запасную
  }
  return fallback;
};
