// Загрузка ассетов движка с локального канала данных. Адрес канала
// спрашивается у моста окна и хранится обещанием: параллельные вызовы
// ждут один ответ и не дёргают мост лишний раз.

const NAME_LENGTH = 64;
const NOT_HEX = /[^0-9a-f]/;
const ROUNDS = 2;

// Единственное состояние модуля: обещание адреса, которое уже ушло наружу.
let originLedger = null;

// Ошибка модуля: обычный Error с перечислимыми полями в заданном порядке.
function engineError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  for (const [field, value] of Object.entries(extra)) error[field] = value;
  return error;
}

// Что ответил мост -> адрес. Пустой ответ означает, что канала нет, и тогда
// запомненное обещание стирается, чьё бы оно ни было.
function settleOrigin(answer) {
  const origin = answer ? String(answer) : null;
  if (origin === null) originLedger = null;
  return origin;
}

function askBridge(bridge) {
  let reply;
  try {
    reply = bridge.engineAssetsOrigin();
  } catch (error) {
    reply = Promise.reject(error);
  }
  return Promise.resolve(reply).then(settleOrigin, () => settleOrigin(null));
}

export function engineAssetsOrigin() {
  const bridge = globalThis.window?.modovik;
  if (typeof bridge?.engineAssetsOrigin !== "function") {
    return Promise.resolve(null);
  }
  // Запоминаем сразу, до ответа: обработчики askBridge сработают позже.
  return originLedger ?? (originLedger = askBridge(bridge));
}

export function forgetEngineAssetsOrigin() {
  originLedger = null;
}

const assetUrl = (origin, name) => [origin, "a", name].join("/");

function classify(response) {
  if (response.ok) return { kind: "ok" };
  const { status } = response;
  return status === 404 ? { kind: "missing" } : { kind: "refused", status };
}

// Забываем адрес и начинаем следующий круг в том же такте: лишних await
// здесь быть не должно, от них зависит счёт обращений к мосту.
function retry(job, roundsLeft, failure) {
  forgetEngineAssetsOrigin();
  return runRound(job, roundsLeft - 1, failure);
}

// Один запрос со своим try/catch. Сбой разбирается тут же, в том же такте:
// прерванный запрос отдаёт ошибку как есть, остальные начинают новый круг,
// и тогда наружу уходит обещание этого круга ("later"), а не ответ.
async function requestOnce(job, origin, roundsLeft) {
  // fetch зовём как простую функцию, без this
  const { fetchImpl, init, name } = job;
  let response;
  try {
    response = await fetchImpl(assetUrl(origin, name), init);
  } catch (error) {
    if (job.signal?.aborted) throw error;
    return { later: retry(job, roundsLeft, error) };
  }
  return { response };
}

async function judgeAnswer(job, origin, roundsLeft) {
  const sent = await requestOnce(job, origin, roundsLeft);
  if (sent.later) return sent.later;

  const verdict = classify(sent.response);
  if (verdict.kind === "ok") return sent.response.arrayBuffer();
  if (verdict.kind === "missing") {
    throw engineError(
      "ENGINE_ASSET_MISSING",
      `Ассета ${job.name} нет в хранилище движка.`,
    );
  }
  const refused = engineError(
    "ENGINE_ASSETS_REFUSED",
    `Канал данных движка ответил ${verdict.status}.`,
    { status: verdict.status },
  );
  return retry(job, roundsLeft, refused);
}

async function runRound(job, roundsLeft, lastFailure) {
  if (roundsLeft < 1) throw unavailable(lastFailure);
  const origin = await engineAssetsOrigin();
  if (origin) return judgeAnswer(job, origin, roundsLeft);
  throw unavailable(lastFailure);
}

function unavailable(cause) {
  return engineError(
    "ENGINE_ASSETS_UNAVAILABLE",
    "Канал данных движка недоступен.",
    { cause },
  );
}

export async function fetchEngineAsset(
  sha,
  { fetchImpl = globalThis.fetch, range, signal } = {},
) {
  const name = sha ? String(sha) : "";
  if (name.length !== NAME_LENGTH || NOT_HEX.test(name)) {
    throw engineError(
      "ENGINE_ASSET_BAD_NAME",
      `Неверный отпечаток ассета: ${sha}`,
    );
  }

  const init = {
    cache: "force-cache",
    signal,
    ...(range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : null),
  };
  return runRound({ fetchImpl, name, init, signal }, ROUNDS, null);
}
