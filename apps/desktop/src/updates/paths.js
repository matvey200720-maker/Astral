import path from "node:path";

// Что лежит под корнем установки: [ключ результата, от какого ключа считается, имя].
const LAYOUT = [
  ["appDir", "root", "app"],
  ["betaDir", "root", "beta"],
  ["updateDir", "root", "update"],
  ["manifest", "betaDir", "manifest.json"],
  ["signature", "betaDir", "manifest.sig"],
  ["pak", "betaDir", "astral-web.pak"],
  ["bootOk", "updateDir", "boot-ok"],
  ["failed", "updateDir", "failed.json"],
  ["bad", "updateDir", "bad.json"],
  ["attempts", "updateDir", "attempts.json"],
  ["helper", "root", "AstralBetaSetup.exe"],
];

export function installRootFor(executablePath) {
  const directory = path.dirname(executablePath);
  return path.resolve(directory, "..");
}

export function updatePaths(root) {
  const placed = LAYOUT.reduce((paths, [key, parent, name]) => Object.assign(paths, { [key]: path.join(paths[parent], name) }), { root });
  return Object.freeze(placed);
}

export function stagingDirectory(paths, channel, sequence) {
  const parent = paths.updateDir;
  return path.join(parent, `${channel}-${sequence}`);
}
