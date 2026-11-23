/*
 * Снимок кадра 3D-сцены для постобработки (задача 4А, 18.10.2026).
 *
 * Килл-эффект — это слои поверх кадра: экспозиция, размытие, свечение, кайма,
 * рамка, плёнка. Рисует их `kill-effect-painter.js` по холсту-картинке; здесь
 * эта картинка — последний кадр сцены боя. Снимок делается сразу после
 * рисования сцены (`onDraw`), пока холст WebGL ещё хранит картинку: позже
 * браузер её уже забрал на экран.
 *
 * Источник — маленькое хранилище, как положение килла (`createPlayhead`):
 * экран эффекта подписан на него и перерисовывается на каждый новый кадр сцены,
 * а не через дерево React.
 */

export function createSceneSource() {
  let copy = null;
  let context = null;
  let ready = false;
  let version = 0;
  const listeners = new Set();

  return {
    /** Холст со снимком; пуст, пока `ready()` ложно. */
    get canvas() {
      return copy;
    },
    ready: () => ready,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Снять кадр с холста сцены. Холст без размера (ещё не измерен) пропускается. */
    capture(source) {
      if (!source?.width || !source?.height || typeof document === "undefined") return;
      if (!copy) {
        copy = document.createElement("canvas");
        context = copy.getContext("2d");
      }
      if (!context) return;
      if (copy.width !== source.width || copy.height !== source.height) {
        copy.width = source.width;
        copy.height = source.height;
      }
      context.drawImage(source, 0, 0);
      ready = true;
      version += 1;
      for (const listener of [...listeners]) listener();
    },
    dispose() {
      listeners.clear();
      copy = null;
      context = null;
      ready = false;
    },
  };
}
