import { memoByIdentity } from "./assortment-cache.js";
import { isTattooPack } from "./clothing-catalog.js";
import { listServerClothing } from "../../api.js";
import { decorationKey } from "@modovik/clothing/decorations";
import { assortmentItem } from "@modovik/clothing/assortment";
import { useEffect, useMemo, useState } from "react";

const VOID_LIST = Object.freeze([]);
const tattooView = (tattoos, apply) => ({ tattoos, apply });
const VOID_VIEW = Object.freeze(tattooView(VOID_LIST, false));

// ---------- общий запрос к Desktop ----------

class Desk {
  #reply = null;

  ask() {
    if (this.#reply === null) {
      this.#reply = listServerClothing().catch(() => {
        this.forget();
        return null;
      });
    }
    return this.#reply;
  }

  forget() {
    this.#reply = null;
  }
}

const desk = new Desk();

export function forgetServerClothing() {
  desk.forget();
}

// ---------- разбор ответа ----------

// Записи серверов; всё, что не список, даёт TypeError (как у метода массива).
function* serversOf(result) {
  const list = result?.servers ?? [];
  if (!Array.isArray(list)) throw new TypeError("servers must be an array");
  yield* list;
}

// Записи вещей с сервером своей записи; записи без сервера пропущены целиком.
function* fileRecords(result) {
  for (const { server, items } of serversOf(result)) {
    if (!server) continue;
    for (const record of items ?? []) yield { ...record, server };
  }
}

export function serverFileItems(result) {
  return Array.from(fileRecords(result), (record) => assortmentItem(record, "files")).filter(Boolean);
}

export function serverTattooItems(result) {
  const found = [];
  for (const { server, directory, tattoos } of serversOf(result)) {
    for (const tattoo of tattoos ?? []) {
      found.push({ ...tattoo, key: decorationKey(tattoo), server: server ?? null, directory });
    }
  }
  return found;
}

// Разбор вещей запоминается по самому ответу: все хуки видят один массив.
const filesOf = memoByIdentity(serverFileItems);

// ---------- хуки ----------

// Ответ Desktop для хука; без разрешения окно ничего не спрашивает.
function useDesktopAnswer(enabled) {
  const [answer, setAnswer] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const gate = new AbortController();
    desk.ask().then((reply) => {
      if (!gate.signal.aborted) setAnswer(reply);
    });
    return () => gate.abort();
  }, [enabled]);
  return answer;
}

export function useServerClothing() {
  const answer = useDesktopAnswer(true);
  return answer ? filesOf(answer) : VOID_LIST;
}

export function useServerTattoos({ enabled = true } = {}) {
  const answer = useDesktopAnswer(enabled);
  const usable = enabled && answer;
  return useMemo(
    () => (usable ? tattooView(serverTattooItems(usable), Boolean(usable.tattooApply)) : VOID_VIEW),
    [usable],
  );
}

export function useTattooPackAllowed(mod) {
  const gated = isTattooPack(mod);
  const { apply } = useServerTattoos({ enabled: gated });
  return gated ? apply : true;
}

export async function warmServerClothing() {
  const answer = await desk.ask();
  if (answer !== null) filesOf(answer);
  return !!answer;
}
