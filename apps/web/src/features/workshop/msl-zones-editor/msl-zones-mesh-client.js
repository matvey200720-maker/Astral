import { mslZonesMesh } from "@modovik/climb-contract/recolor/msl-zones";

const ERROR_FALLBACK = "msl-zones-mesh-worker";
const MESH_FIELDS = ["positions", "uvs", "indices"];
const RESOLVE = 0;
const REJECT = 1;

// Журнал заказов: номер → пара [выполнить, отклонить].
class Ledger {
  #slots = new Map();
  #serial = 0;

  enter(deliver) {
    const id = ++this.#serial;
    return new Promise((...pair) => {
      this.#slots.set(id, pair);
      deliver(id);
    });
  }

  // Чужие и повторные номера не находят пары и пропадают.
  close(id, outcome, value) {
    const pair = this.#slots.get(id);
    if (pair && this.#slots.delete(id)) pair[outcome](value);
  }

  rejectAll(makeError) {
    for (const [, reject] of this.#slots.values()) reject(makeError());
    this.#slots.clear();
  }
}

const ledger = new Ledger();
let worker; // undefined: ещё не создавали, null: потока нет

const meshOf = (reply) => Object.fromEntries(MESH_FIELDS.map((field) => [field, reply[field]]));

function onReply(event) {
  const reply = event.data || {};
  if (reply.error) ledger.close(reply.id, REJECT, new Error(reply.error));
  else ledger.close(reply.id, RESOLVE, meshOf(reply));
}

// Сбой потока его не отключает: следующий вызов снова идёт в тот же поток.
function spawn() {
  if (typeof Worker !== "function") return null;
  try {
    return Object.assign(new Worker(new URL("./msl-zones-mesh-worker.js", import.meta.url), { type: "module" }), {
      onmessage: onReply,
      onerror: (event) => ledger.rejectAll(() => new Error(event.message || ERROR_FALLBACK)),
    });
  } catch {
    return null;
  }
}

async function viaWorker(target, source, project) {
  try {
    return await ledger.enter((id) => target.postMessage({ id, source, project }));
  } catch {
    return mslZonesMesh(source, project);
  }
}

export function mslZonesMeshAsync(source, project) {
  if (worker === undefined) worker = spawn();
  return worker ? viaWorker(worker, source, project) : Promise.resolve(mslZonesMesh(source, project));
}
