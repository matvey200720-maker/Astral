/*
 * Чтение игры окном-съёмщиком для кадра моря (ТЗ 27.10.2026, карточка воды в каталоге).
 *
 * Кадр моря (`water-editor/water-sea-capture.js`) читает игру теми же вызовами моста приложения, что и редактор «Вода»: небо игрока,
 * облачные шапки с листами, секция карты у Венис-Бич. У окна-съёмщика моста нет (`part-shooter-preload.cjs`) — эти пять чтений
 * отдаёт хозяин окна по своему адресу `/sea-kit/<вызов>` (`scripts/part-shots-electron.js`, `apps/desktop/src/sea-cover-kit.js`), а здесь они
 * ложатся под `window.modovik` — столько, сколько кадру нужно. Бинарные ответы хозяин шлёт base64.
 */

const bytesOf = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0)).buffer;

async function ask(method, input) {
  const response = await fetch(`/sea-kit/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {}),
  });
  if (!response.ok) throw new Error((await response.text().catch(() => "")) || `Кадр моря: ${method} не отдан.`);
  return response.json();
}

/** Мост окна-съёмщика к чтению игры: вызовы, которые зовёт кадр моря. */
export function seaKitBridge() {
  return {
    readSkyBases: (input) => ask("readSkyBases", input),
    readCloudHats: (input) => ask("readCloudHats", input),
    readCloudHatTexture: async (input) => bytesOf((await ask("readCloudHatTexture", input)).png),
    loadMegaMallSection: (input) => ask("loadMegaMallSection", input),
    loadMegaMallSectionBundle: async (input) => {
      const answer = await ask("loadMegaMallSectionBundle", input);
      return { ...answer, glb: answer.glb ? bytesOf(answer.glb) : null };
    },
  };
}

/** Поставить мост под `window.modovik`, если приложения под окном нет; вернуть, поставлен ли он. */
export function installSeaKit(target = globalThis.window) {
  if (!target || target.modovik) return Boolean(target?.modovik?.loadMegaMallSection);
  target.modovik = seaKitBridge();
  return true;
}
