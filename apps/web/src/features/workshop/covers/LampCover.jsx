import { useEffect, useMemo, useRef, useState } from "react";
import { createLampProject, parseLampProject, vanillaLampProject } from "@modovik/street-light-contract/lamps";
import { hasDesktopBridge } from "../../../api.js";
import { ptfxGameRoot } from "../../../components/desktop/workshop/ptfx/ptfx-base-store.js";
import { useCoverPending } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";
import { readCoverFrame, writeCoverFrame } from "./cover-frames.js";

/*
 * Обложка фонарей (доделка к задаче 19 ТЗ 18.10.2026, поздний вечер; Хелпер 19, 27.10.2026 — кадр как на снимке владельца
 * `ref/7`) — кадр ночью из того же куска карты игрока, что в редакторе: улица Davis со столбом, на руке которого горит лампа
 * работы (цвет, сила, дальность, мягкость края — те же числа, что уедут в игру). Вид — `STREET_VIEWS.cover`
 * (`lamps-editor/lamp-street-views.js`); тот же вид снят в штатную плитку полки (`scripts/stock-covers-live`). Снимается один
 * раз (`lamps-editor/lamp-cover-frame.js`) и хранится между запусками (`cover-frames.js`) под ключом из отпечатка работы. Пока
 * человек ничего не ставил — лампы как в игре: натрий и блики Rockstar. Читается из файлов игры, поэтому печь снимает её не
 * при запуске (`GAME_READING_COVERS`), а когда человек открыл мастерскую.
 *
 * Без Astral Desktop, без игры или если кадр собрать не вышло (нет столбов, видеокарта без буфера с плавающей точкой) обложка
 * пустая: нарисованного столба вместо кадра игры нет (решение владельца 27.10.2026; CLAUDE.md, «Что показывать нельзя»), а печь,
 * ничего не дождавшись, обложку не запекает.
 */

/* Версия съёмки: поменялись кадр, час или рамка — старый кадр не найдётся. «3» — вид «cover»: столб справа, лампа слева (27.10.2026). */
const LAMP_COVER_STAMP = "lamp-cover-3";
const frames = new Map();
const capturing = new Map();

const idle = () =>
  new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 1500 });
    else window.setTimeout(resolve, 200);
  });

function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function captureLamps(key, project) {
  if (frames.has(key)) return Promise.resolve(frames.get(key));
  if (capturing.has(key)) return capturing.get(key);
  const job = (async () => {
    const stored = `lamps:${key}:${LAMP_COVER_STAMP}`;
    const kept = await readCoverFrame(stored);
    if (kept) return kept;
    const gameRoot = await ptfxGameRoot();
    if (!gameRoot) return "";
    await idle();
    /* Кадр — отдельным куском: сцена квартала и компоновщик нужны только ему. */
    const { captureLampCoverFrame } = await import("../lamps-editor/lamp-cover-frame.js");
    const result = await captureLampCoverFrame({ gameRoot, project });
    if (!result.url) throw new Error(result.reason || "unavailable");
    void writeCoverFrame(stored, result.url);
    return result.url;
  })()
    .then((url) => {
      if (url) frames.set(key, url);
      return url;
    })
    .finally(() => capturing.delete(key));
  capturing.set(key, job);
  return job;
}

export default function LampCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return (stored ? parseLampProject(stored) : vanillaLampProject()) || createLampProject();
  }, [state]);

  /* Кадр из игры — только в Astral Desktop; ключ — отпечаток работы. */
  const key = hasDesktopBridge() ? fingerprint(JSON.stringify(project)) : "";
  const [frame, setFrame] = useState(() => (key && frames.get(key)) || "");
  /* Печь ждёт кадр, пока он снимается; не снялся — ждать нечего, обложка пустая. */
  const [gaveUp, setGaveUp] = useState("");
  useCoverPending(Boolean(key) && !frame && gaveUp !== key);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!key) return undefined;
    if (frames.has(key)) {
      setFrame(frames.get(key));
      return undefined;
    }
    captureLamps(key, project)
      .then((url) => mounted.current && (url ? setFrame(url) : setGaveUp(key)))
      .catch(() => {
        /* Игры нет, столбов нет, WebGL не завёлся — кадра нет, и рисовать его вместо игры не из чего. */
        if (mounted.current) setGaveUp(key);
      });
    return () => {
      mounted.current = false;
    };
    // Ключ — отпечаток работы: она к нему привязана.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!frame) return null;
  return (
    <img
      className="workshop-cover-image"
      src={frame}
      alt=""
      draggable="false"
    />
  );
}
