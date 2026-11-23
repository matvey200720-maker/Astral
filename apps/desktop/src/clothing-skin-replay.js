// Переигрывание покраски одежды из мастерской: запись для состояния установки и проверка пакета.
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256File } from "@modovik/install-engine";
import { clothingSkinSourceDigest } from "@modovik/install-engine/clothing-skin-manifest-trust.js";

const SKIN_PACKAGES = ["clothing-skins", "packages"];

const refusalText = (title, tail) => `Работа «${title}»: ${tail}`;
const TAILS = {
  broken: "запись переигрывания испорчена — поставьте покраску заново из мастерской.",
  gone: "пакет для переигрывания удалён — переустановите покраску из мастерской.",
  changed: "пакет для переигрывания изменён — переустановите покраску из мастерской.",
};

const pickFileFields = ({ source, target, entry, size, sha256 }) => ({ source, target, entry, size, sha256 });

export function clothingSkinReplayRecord(built) {
  const { id, version, clothingSkin, files } = built.manifest;
  return {
    module: "clothing-skin",
    workId: id,
    version,
    sourceDigest: clothingSkin.sourceDigest,
    multi: true,
    order: { files: files.map(pickFileFields) },
  };
}

// Отпечаток записи: «sha256:» и ровно 64 строчных шестнадцатеричных знака.
function hasDigestShape(text) {
  const [prefix, hex, ...extra] = text.split(":");
  if (prefix !== "sha256" || extra.length > 0 || hex === undefined || hex.length !== 64) return false;
  return [...hex].every((char) => (char >= "0" && char <= "9") || (char >= "a" && char <= "f"));
}

// Разбирает запись: название работы, отпечаток и список файлов; негодная запись — отказ «broken».
function readClaim(replay) {
  const title = String(replay?.workId || "покраска одежды");
  const fail = (reason) => new Error(refusalText(title, TAILS[reason]));
  const digest = String(replay?.sourceDigest || "");
  const listed = replay?.order?.files;
  const items = Array.isArray(listed) ? listed : [];
  if (!hasDigestShape(digest) || !items.length) throw fail("broken");
  return { digest, items, fail };
}

function examineFile(root, item, fail) {
  const relative = item?.source;
  if (!relative) return Promise.reject(fail("gone"));
  const path = join(root, String(relative));
  return Promise.resolve()
    .then(() => stat(path))
    .then((info) => (info.isFile() ? info.size : null), () => null)
    .then((size) => {
      if (size === null) throw fail("gone");
      return sha256File(path).then((hash) => {
        if (hash !== String(item.sha256 || "") || size !== item.size) throw fail("changed");
        return { entry: String(item.entry || ""), sha256: hash };
      });
    });
}

export function clothingSkinReplayPackage(stateDir, replay) {
  return Promise.resolve()
    .then(() => readClaim(replay))
    .then(({ digest, items, fail }) => {
      const root = join(resolve(String(stateDir || "")), ...SKIN_PACKAGES, digest.slice(7, 19));
      const walked = items.reduce(
        (chain, item) => chain.then((done) => examineFile(root, item, fail).then((row) => [...done, row])),
        Promise.resolve([]),
      );
      return walked.then((files) => {
        if (`sha256:${clothingSkinSourceDigest(files)}` !== digest) throw fail("changed");
        return { packageRoot: root, files };
      });
    });
}
