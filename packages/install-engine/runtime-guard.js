function abortReason(signal) {
  if (!signal?.aborted) return null;
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("Установка отменена пользователем.", "AbortError");
}

export function throwIfAborted(signal) {
  const reason = abortReason(signal);
  if (reason) throw reason;
}

export async function assertRuntimeSafe(assertRuntimeSafety, signal, phase) {
  throwIfAborted(signal);
  if (typeof assertRuntimeSafety === "function") {
    await assertRuntimeSafety({ phase });
  }
  throwIfAborted(signal);
}
