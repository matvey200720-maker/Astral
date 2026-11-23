import { engineAssetsOrigin, forgetEngineAssetsOrigin } from "../../../engine-assets.js";

// Движок мог выйти по простою и подняться на другом порту, поэтому адрес
// канала ждут, а после сбоя спрашивают заново.
const WAIT = { attempts: 4, pauseMs: 500 };
const OCTETS = "application/octet-stream";
const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

const channelDown = () => Object.assign(new Error("engine channel is not up"), { code: "ENGINE_UNAVAILABLE" });

// Платформенный setTimeout берётся в момент паузы, не при загрузке модуля.
const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Пауза только между попытками: после последней неудачи сразу отказ.
const awaitOrigin = async (attemptsLeft = WAIT.attempts) => {
  const origin = await engineAssetsOrigin();
  if (origin) return origin;
  if (attemptsLeft <= 1) throw channelDown();
  await pause(WAIT.pauseMs);
  return awaitOrigin(attemptsLeft - 1);
};

const dial = async (path, init) => {
  const url = (await awaitOrigin()) + path;
  return fetch(...(init ? [url, init] : [url]));
};

// Любой сбой пары «адрес + fetch» стирает запомненный адрес и даёт одну
// повторную попытку целиком; отменённый запрос не повторяется.
const twice = (attempt, init) =>
  attempt().catch((failure) => {
    if (init?.signal?.aborted) throw failure;
    forgetEngineAssetsOrigin();
    return attempt();
  });

const ensureOk = (response, label) => {
  if (response.ok) return response;
  throw new Error(`engine ${label}: ${response.status}`);
};

const asJson = (response) => response.json();
const asBytes = async (response) => new Uint8Array(await response.arrayBuffer());
const hexDigest = (digest) => Array.from(new Uint8Array(digest), (byte) => HEX[byte]).join("");

// label — как запрос назван в тексте ошибки статуса; parse — как читать тело.
const exchange = async (path, { init, label = path, parse } = {}) => {
  const response = ensureOk(await twice(() => dial(path, init), init), label);
  return parse?.(response);
};

export const awcEngine = {
  putBank: async (bytes) => {
    const sha = hexDigest(await crypto.subtle.digest("SHA-256", bytes));
    await exchange(`/awc/${sha}`, {
      label: "PUT bank",
      init: { method: "PUT", body: bytes, headers: { "Content-Type": OCTETS } },
    });
    return sha;
  },
  overview: async (sha) => exchange(`/awc/${sha}`, { parse: asJson }),
  monoWav: async (sha, id) => exchange(`/awc/${sha}/wav/${id}`, { parse: asBytes }),
  pairWav: async (left, right) =>
    exchange(`/awc/pair/${left.sha}/${left.id}/${right.sha}/${right.id}`, { parse: asBytes }),
};

export const { putBank, overview, monoWav, pairWav } = awcEngine;
