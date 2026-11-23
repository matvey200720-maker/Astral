/*
 * Персонаж первым (15.11.2026, W3, мастерская одежды): список тату игры и картинки его плиток — сотни объектов на главном потоке окна (оглавление в 1,4 МБ через мост, разбор строк, 48 плиток, до полусотни
 * картинок), и они шли, пока сцена ещё разбирала и заливала в видеочип самого персонажа (замер в Electron при ×4: список и плитки — 0,1–0,2 с на пути «щелчок → персонаж на экране»). Сцена студии держит кадр,
 * пока грузит модель (`holdPersonaFrame`), и всё, что для показа персонажа не нужно, ждёт его готовности (`whenPersonaFramePainted`). Держит до готовой модели, отказа или ухода со страницы, не дольше `FRAME_HOLD_MAX_MS`:
 * плитки не должны остаться без картинок, если загрузка так и не закончилась. Модуль без зависимостей: им пользуются и студия (`gun/GunStudio.jsx`), и плитки тату (`features/clothing`, `components/desktop/clothing`).
 */

const FRAME_HOLD_MAX_MS = 30_000;
let frameHolds = 0;
let frameWaiting = [];

/** Сцена начала грузить модель: фоновые плитки подождут. Вернёт «отпустить» (можно звать много раз). */
export function holdPersonaFrame() {
  frameHolds += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    frameHolds -= 1;
    if (frameHolds) return;
    const wake = frameWaiting;
    frameWaiting = [];
    for (const resume of wake) resume();
  };
  const timer = setTimeout(release, FRAME_HOLD_MAX_MS);
  return release;
}

/**
 * Дождаться, пока сцена не грузит модель; кадр свободен — готово сразу (в одно «микрозадание»). Студия берёт кадр в `useLayoutEffect`, то есть раньше любых `useEffect` плиток того же коммита React:
 * плитка, что встала вместе со студией, видит кадр занятым.
 */
export const whenPersonaFramePainted = () => (frameHolds ? new Promise((wake) => frameWaiting.push(wake)) : Promise.resolve());

/** Для тестов: сколько удержаний открыто. */
export const personaFrameHolds = () => frameHolds;
