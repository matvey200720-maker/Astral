import { editorRoomOpen, editorRoomSession } from "../../components/ui/useEditorRoom.js";

// Камеры живых 3D-кадров мастерской. Ключ сцены — адрес без хоста и хеша: после сна канал данных движка
// поднимается на другом порту, а сцена та же (спячка окна, 21.10.2026).

const views = new Map(); // живые виды: ключ → функция вида
const visits = new Map(); // память камер захода: ключ → { visit, frame, pose }, порядок добавления значим
let poses = []; // живые позы: записи { key, owner, getPose } в порядке появления (первым — кадр редактора)
let seeded = null; // снимок после сна

const noop = () => {};
const isObject = (v) => v !== null && typeof v === "object";
const attempt = (f) => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

export const stageViewKey = (scene) => {
  const text = scene ? String(scene) : "";
  // косая черта или схема URL — разбираем как адрес; остальное (workshop:lamps, lamps, ../a.bin) — имя сцены как есть
  if (!/^(?:\/|[a-z][a-z\d+.-]*:\/\/)/i.test(text)) return text;
  const url = attempt(() => new URL(text, "http://astral.local"));
  return url ? url.pathname + url.search : text;
};

// --- Виды живых кадров и снимок сна -------------------------------------------------------------

export function trackStageView(scene, getView) {
  const key = stageViewKey(scene);
  if (!key) return noop;
  views.set(key, getView);
  return () => {
    if (views.get(key) !== getView) return;
    views.delete(key);
  };
}

export const stageViewsSnapshot = () => {
  const out = {};
  for (const [key, getView] of views) {
    const view = attempt(getView);
    if (isObject(view)) out[key] = { ...view };
  }
  return out;
};

// --- Виды после пробуждения ---------------------------------------------------------------------

export const seedStageViews = (snapshot) => {
  seeded = isObject(snapshot) ? { ...snapshot } : null;
};

// Ложное значение (0, null, "") снимком не считается; ключи из прототипа обычного объекта тоже находятся
export const peekStageView = (scene) => seeded?.[stageViewKey(scene)] || null;

export const takeStageView = (scene) => {
  const found = peekStageView(scene);
  if (found) delete seeded[stageViewKey(scene)];
  return found;
};

// Сцена на OrbitControls: вид — положение камеры и цель; вход перекадрирует модель не один раз,
// поэтому восстанавливаем не дольше 8 с после создания и вид не забираем
export const trackOrbitView = (key, camera, controls) => {
  const born = performance.now();
  return {
    forget: trackStageView(key, () => ({ position: camera.position.toArray(), target: controls.target.toArray() })),
    restore() {
      const saved = performance.now() - born > 8000 ? null : peekStageView(key);
      const pair = [saved?.position, saved?.target];
      if (!pair.every(Array.isArray)) return false;
      camera.position.fromArray(pair[0]);
      controls.target.fromArray(pair[1]);
      controls.update();
      return true;
    },
  };
};

// --- Две живые камеры одной сцены (01.11.2026) ---------------------------------------------------

export const trackLivePose = (scene, owner, getPose) => {
  const key = stageViewKey(scene);
  if (!key) return noop;
  const entry = { key, owner, getPose };
  poses.push(entry);
  return () => {
    poses = poses.filter((other) => other !== entry);
  };
};

// Поза другого кадра этой сцены: свою не берём, бросившие и не-объекты пропускаем
export const livePoseOf = (scene, owner) => {
  const key = stageViewKey(scene);
  for (const entry of poses) {
    const pose = entry.key === key && entry.owner !== owner ? attempt(entry.getPose) : null;
    if (isObject(pose)) return pose;
  }
  return null;
};

// --- Память камеры захода в редактор (П6.3, 22.10.2026) -------------------------------------------

export const rememberStageView = (scene, frameKey, pose) => {
  const session = editorRoomSession();
  const key = stageViewKey(scene);
  if (!key || !isObject(pose) || !editorRoomOpen()) return;

  const stale = [...visits].filter(([, rec]) => rec.visit !== session);
  stale.forEach(([oldKey]) => visits.delete(oldKey));

  visits.delete(key);
  visits.set(key, { frame: String(frameKey ?? ""), pose, visit: session });

  const CAPACITY = 24;
  while (visits.size > CAPACITY) {
    const [oldest] = visits.keys();
    visits.delete(oldest);
  }
};

export const recallStageView = (scene, frameKey) => {
  const rec = visits.get(stageViewKey(scene));
  const fits = rec && editorRoomOpen() && rec.visit === editorRoomSession() && rec.frame === String(frameKey ?? "");
  return fits ? rec.pose : null;
};
