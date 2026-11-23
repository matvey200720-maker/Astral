/*
 * Поток названия видеочипа (опыт `gpu-probe`, 18.11.2026): `OffscreenCanvas`, контекст `webgl2` или `webgl`, `WEBGL_debug_renderer_info`, `loseContext` — те же вызовы и в том же порядке, что у синхронного
 * пути `quality-profile.js: detectGpuLevel`, только не на главном потоке (`gpu-probe.js`). Ответ — название строкой или `null` (нет `OffscreenCanvas`, нет контекста, ошибка): тогда уровень не меняется.
 */

/** Название видеочипа или `null`. `makeCanvas` подставляет тест. */
export function readRendererName(makeCanvas = () => new OffscreenCanvas(1, 1)) {
  try {
    const canvas = makeCanvas();
    const gl = canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl"));
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name === undefined || name === null ? null : String(name);
  } catch {
    return null;
  }
}

/* Настоящий поток: на любое сообщение отвечает названием. */
const scope = globalThis.WorkerGlobalScope;
if (typeof scope === "function" && typeof self !== "undefined" && self instanceof scope) {
  self.onmessage = () => {
    self.postMessage({ name: typeof OffscreenCanvas === "function" ? readRendererName() : null });
  };
}
