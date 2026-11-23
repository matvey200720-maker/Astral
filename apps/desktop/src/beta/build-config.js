import fs from "node:fs";
import path from "node:path";

export const BETA_BUILD_FILE = "beta-build.json";
export const BETA_PRODUCT_NAME = "Astral Beta";

const KEY_SIZE = 32;
const KEY_TEXT_MIN = 43;
const KEY_TEXT_MAX = 64;
const BODY_CHARS = /^[A-Za-z0-9+/_-]*$/;

// Единственный объект «защита выключена»: одинаковый при каждом вызове.
const GATE_OFF = Object.freeze({ gate: false });

// Отделяет не более двух знаков «=» в конце; остальной текст обязан состоять из знаков обеих азбук.
function bodyOf(text) {
  let end = text.length;
  while (end > 0 && text.length - end < 2 && text[end - 1] === "=") {
    end -= 1;
  }
  const body = text.slice(0, end);
  return BODY_CHARS.test(body) ? body : null;
}

export function decodeLicensePublicKey(value) {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length < KEY_TEXT_MIN || value.length > KEY_TEXT_MAX) {
    return null;
  }
  const body = bodyOf(value);
  if (body === null) {
    return null;
  }
  const standard = body.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Buffer.from(standard + value.slice(body.length), "base64");
  return bytes.length === KEY_SIZE ? bytes : null;
}

function parseBuildFile(app, fsImpl) {
  try {
    const file = path.join(app.getAppPath(), "dist", BETA_BUILD_FILE);
    return JSON.parse(fsImpl.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function readBetaBuildConfig({ app, fsImpl = fs } = {}) {
  if (!app) {
    return GATE_OFF;
  }
  if (app.isPackaged !== true) {
    return GATE_OFF;
  }
  const raw = parseBuildFile(app, fsImpl);
  if (raw?.gate !== true) {
    return GATE_OFF;
  }
  return Object.freeze({ gate: true, licensePublicKey: decodeLicensePublicKey(raw.licensePublicKey) });
}
