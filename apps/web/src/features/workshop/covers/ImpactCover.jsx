import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultImpactLayer,
  defaultImpactZone,
  layerNeedsUpload,
} from "@modovik/ptfx-studio";
import { restorePictures } from "../../../components/desktop/workshop/effects-stamp.js";
import { FIGURE_VIEW } from "../../../components/desktop/workshop/impact-figure.js";
import {
  drawImpactBurst,
  impactZoneSprites,
} from "../../../components/desktop/workshop/impact-sim.js";
import { usePtfxBase } from "../../../components/desktop/workshop/ptfx/ptfx-base-store.js";
import { useTr } from "../../../locales/ui.js";
import { useCoverPending, useCoverProvisional } from "./cover-bake-context.js";
import { parseEffectsState } from "./cover-data.js";
import { readCoverFrame, writeCoverFrame } from "./cover-frames.js";

/*
 * Обложка эффектов попадания (задача 18 ТЗ 18.10.2026, поздний вечер; кадр —
 * 43А-2, 20.10.2026) — тот же кадр, что в редакторе по умолчанию: из-за плеча
 * стрелка, цель впереди на сетке и настоящий выброс из игры в тот миг, когда он
 * разлетается от тела: стандартная кровь, пока своего эффекта нет, и эффект
 * человека (кровь своего цвета, искры и кружки, купюры, своя картинка), когда
 * он его поставил. Снимает его та же сцена, что играет выстрелы в редакторе
 * (`impact-cover-frame.js`), один раз; кадр хранится между запусками
 * (`cover-frames.js`) под ключом из отпечатка базы и правки. Бегущей сцены на
 * плитке нет: это картинка, и полка не тратит кадры.
 *
 * Пока кадра нет (браузер, игра не найдена, база ещё читается) плитка — тёмная
 * плашка без рисунка: нарисованных обложек у этого редактора быть не должно
 * (владелец, 20.10.2026), а выдуманный человек с брызгами выдавал бы себя за кадр
 * игры. В Astral Desktop плашка «временная» и не запекается: игру ещё подключат.
 *
 * Рисователь ниже (`paintImpactCover`) — не для плитки редактора: им пользуется
 * съёмщик обложек частей каталога (`part-covers/shooter-service.js`) для редукса
 * с кровью мода. Он рисует человека и попадание в корпус плоской симуляцией:
 *
 * Только тело и только на теле (владелец, 25.09.2026). Прежде на плитке
 * стояли оба выброса — в голову и в корпус — в миг, когда частицы уже
 * разлетелись: купюры усыпали плитку, огонь и свечения заливали её пятнами,
 * и вместо человека с попаданием выходила клякса. Теперь выброс один — в
 * грудь, в первые доли секунды, и лежит он по силуэту: всё, что за контуром
 * тела, обрезано. Голова чистая — её эффект видно в редакторе.
 *
 * Фигура в рост в горизонтальной плитке была бы спичкой, поэтому в кадре она
 * по пояс.
 */

/* Рендер персонажа (`impact-figure.js`); в кадре — от макушки до пояса. */
const FIGURE = Object.freeze({ ...FIGURE_VIEW, cropBottom: 0.5 });
const FIGURE_METRES = 1.85;
/* Куда прилетает пуля — доли кадра персонажа: грудь чуть в стороне от
   середины, как ложится попадание в корпус. `time` — миг выброса: самое
   начало, пока всё ещё у раны. */
const BODY_HIT = Object.freeze({ x: 0.55, y: 0.3, time: 0.1 });
/* Корпус — от ворота вниз, доля высоты рендера: выше начинается голова, и
   брызги, взлетевшие от груди, на неё не ложатся. */
const TORSO_TOP = 0.16;
/* Выброс на обложке мельче, чем в бою, и гаснет в круге у раны (радиус —
   доля высоты рендера): плитка — это знак работы, и метровое облако искр
   или веер купюр на корпусе шириной в полметра читались бы пятном во всю
   грудь, а не попаданием. */
const COVER_SCALE = 0.75;
const WOUND_RADIUS = 0.13;


/**
 * Настройки корпуса для обложки. Свой эффект — если зона включена (включённая
 * пустая так и остаётся пустой: в игре тело без эффекта). Иначе в игре
 * стандартная кровь, и обложка рисует её одним слоем: новая зона пуста
 * (`defaultImpactZone`), и без явного слоя стандартная обложка выходила
 * человеком без попадания вовсе.
 */
export function coverBodyZone(state) {
  const impact = parseEffectsState(state)?.impact;
  /* «Убрать совсем»: на обложке тело без эффекта, как и в игре. */
  const own = impact?.enabled
    ? impact.removeAll === true
      ? { enabled: true, layers: [] }
      : impact.zones?.body
    : null;
  return own?.enabled
    ? { ...defaultImpactZone("body"), ...own }
    : {
        ...defaultImpactZone("body"),
        enabled: true,
        layers: [defaultImpactLayer("body")],
      };
}

/**
 * Рисует `draw` на отдельном слое и оставляет от него только то, что легло на
 * корпус у раны: прозрачность рендера персонажа — маска силуэта, выше ворота
 * слой срезан, чтобы на голове ничего не оставалось, а от раны к краю круга
 * эффект мягко гаснет.
 */
function paintOnTorso(context, figure, rect, wound, draw) {
  const target = context.canvas;
  if (typeof document === "undefined" || !target) return;
  const layer = document.createElement("canvas");
  layer.width = target.width;
  layer.height = target.height;
  const paint = layer.getContext("2d");
  if (!paint) return;
  paint.setTransform(context.getTransform());
  draw(paint);
  paint.globalCompositeOperation = "destination-in";
  paint.drawImage(figure, rect.left, rect.top, rect.width, rect.height);
  const reach = paint.createRadialGradient(
    wound.x,
    wound.y,
    wound.radius * 0.55,
    wound.x,
    wound.y,
    wound.radius,
  );
  reach.addColorStop(0, "#000");
  reach.addColorStop(1, "rgba(0, 0, 0, 0)");
  paint.fillStyle = reach;
  paint.fillRect(
    wound.x - wound.radius,
    wound.y - wound.radius,
    wound.radius * 2,
    wound.radius * 2,
  );
  /* `destination-in` оставляет только то, что под последней заливкой: всё
     за пределами круга уже стёрто, остаётся срезать голову. */
  paint.globalCompositeOperation = "destination-out";
  paint.fillRect(rect.left, 0, rect.width, rect.top + rect.height * TORSO_TOP);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(layer, 0, 0);
  context.restore();
}

/**
 * Кадр обложки на холсте `width × height` (CSS-пиксели): фигура по пояс и
 * выброс зоны `zone` в корпус. Его же рисует окно-съёмщик для части редукса
 * с кровью мода (`part-covers/shooter-service.js`).
 */
export function paintImpactCover(
  context,
  { width, height, figure, zone, pictures = null },
) {
  if (!figure) return;
  /* Фигура по пояс, по центру плитки, с небольшим запасом над макушкой. */
  const top = height * 0.05;
  const scale = (height - top) / (FIGURE.height * FIGURE.cropBottom);
  const rect = {
    left: (width - FIGURE.width * scale) / 2,
    top,
    width: FIGURE.width * scale,
    height: FIGURE.height * scale,
  };
  context.drawImage(figure, rect.left, rect.top, rect.width, rect.height);
  const wound = {
    x: rect.left + rect.width * BODY_HIT.x,
    y: rect.top + rect.height * BODY_HIT.y,
    radius: rect.height * WOUND_RADIUS,
  };
  paintOnTorso(context, figure, rect, wound, (paint) =>
    drawImpactBurst(paint, {
      x: wound.x,
      y: wound.y,
      unit: (rect.height / FIGURE_METRES) * COVER_SCALE,
      time: BODY_HIT.time,
      zone,
      zoneId: "body",
      sprites: impactZoneSprites("body", zone, pictures),
      seed: "cover:body",
    }),
  );
}

/* Версия съёмки: поменялись сцена или рамка — старый кадр не найдётся. */
const IMPACT_COVER_STAMP = "impact-shoulder-2"; // 2 — ракурс редактора «Стреляешь ты», сетка, лысая жертва (20.10.2026)
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

function captureImpact(key, spec) {
  if (frames.has(key)) return Promise.resolve(frames.get(key));
  if (capturing.has(key)) return capturing.get(key);
  const job = (async () => {
    const stored = `impact:${key}:${IMPACT_COVER_STAMP}`;
    const kept = await readCoverFrame(stored);
    if (kept) return kept;
    await idle();
    /* Кадр выброса — отдельным куском: сцена частиц нужна только ему. */
    const { renderImpactCoverFrame } = await import("./impact-cover-frame.js");
    const url = await renderImpactCoverFrame(spec);
    void writeCoverFrame(stored, url);
    return url;
  })()
    .then((url) => {
      frames.set(key, url);
      return url;
    })
    .finally(() => capturing.delete(key));
  capturing.set(key, job);
  return job;
}

export default function ImpactCover({ state = null }) {
  useTr();
  const zone = useMemo(() => coverBodyZone(state), [state]);

  /* Картинка человека лежит в хранилище браузера рядом с проектом. */
  const needsUpload = (zone.layers || []).some(layerNeedsUpload);
  const [pictures, setPictures] = useState(null);
  useEffect(() => {
    if (!needsUpload) return undefined;
    let active = true;
    void restorePictures().then((restored) => active && setPictures(restored));
    return () => {
      active = false;
    };
  }, [needsUpload]);

  /* Базу эффектов обложка не просит сама (как у огня, бета 16.10.2026): её читают полка мастерской и редактор; есть она — обложка снимает выброс игры, нет — плитка остаётся тёмной плашкой. */
  const ptfx = usePtfxBase();
  const base = ptfx.base?.impact?.model?.core ? ptfx.base : null;
  const key = base ? `${ptfx.fingerprint}:${fingerprint(JSON.stringify(zone))}` : "";
  const [frame, setFrame] = useState(() => (key && frames.get(key)) || "");
  const mounted = useRef(true);
  /* Печь обложек ждёт базу, свои картинки и кадр выброса; кадр не снялся (игры нет, WebGL не завёлся) — ждать нечего. */
  const [gaveUp, setGaveUp] = useState("");
  const waitingPictures = needsUpload && pictures === null;
  useCoverPending(ptfx.loading || waitingPictures || (Boolean(key) && !frame && gaveUp !== key));
  /* Плашка без кадра — заглушка: базу ещё могут подключить, и запечённая на трое суток пустая плашка осталась бы вместо кадра игры. */
  const markProvisional = useCoverProvisional();
  const empty = !frame;
  useEffect(() => {
    markProvisional(empty);
  }, [markProvisional, empty]);
  useEffect(() => {
    mounted.current = true;
    if (!key || waitingPictures) return undefined;
    if (frames.has(key)) {
      setFrame(frames.get(key));
      return undefined;
    }
    captureImpact(key, { base, zone, pictures, gameRoot: base.gameRoot || "" })
      .then((url) => mounted.current && (url ? setFrame(url) : setGaveUp(key)))
      .catch(() => {
        /* WebGL не завёлся или клон не собрался — остаётся тёмная плашка. */
        if (mounted.current) setGaveUp(key);
      });
    return () => {
      mounted.current = false;
    };
    // Ключ — отпечаток базы и правки: база и зона к нему привязаны.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, waitingPictures]);

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
