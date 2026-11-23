import { useMemo } from "react";
import {
  defaultTracerProfile,
  tracerProfileActive,
} from "@modovik/ptfx-studio";
import {
  tracerPreviewCanvas,
  tracerTextureKey,
} from "../../../components/desktop/workshop/effects-preview.js";
import { parseEffectsState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка трейсеров — сами следы пуль.
 *
 * Текстуры рисует тот же генератор, что и редактор, и что уедет в игру:
 * стандартный след, пока своего нет, и следы человека, когда он их поставил.
 *
 * Один ряд — один трассер, и это тот, что человек поставил последним
 * (владелец, 20.10.2026: «прежняя обложка, но один трассер — последний»;
 * до того на плитке стояло до трёх рядов, первые из списка). Длина и толщина
 * следа — как у любого ряда обложки (владелец, 25.09.2026): длина в игре —
 * ползунок трассера, а не его вид, и обложка её не сравнивает. По ней работа
 * узнаётся в «Моих работах» и в библиотеке, не открывая её.
 *
 * Нарисованной сцены с подписью здесь нет и быть не должно: обложка — сам
 * след из того же генератора, что в редакторе и в игре.
 */

/* Трассеров на обложке — один, последний из работы. */
export const COVER_TRACERS = 1;

/* Ряд — доли кадра: где начинается след и какой он длины. Одинаковые у всех
   рядов: длина следа в игре — ползунок трассера, а не его вид, и обложка её
   не сравнивает. */
const STREAK_LEFT = 0.11;
const STREAK_LENGTH = 0.78;

/**
 * Ряды обложки: по одному на трассер, сверху вниз в порядке списка, с равным
 * шагом по высоте. Толщина — от шага, но не толще трети кадра: одинокий след
 * не должен разливаться на всю плитку.
 */
export function tracerCoverRows(count, width, height) {
  const rows = Math.max(1, Math.min(COVER_TRACERS, count));
  const pitch = height / (rows + 1);
  const thickness = Math.max(6, Math.min(pitch * 0.8, height * 0.3));
  return Array.from({ length: rows }, (_, index) => ({
    x: width * STREAK_LEFT,
    y: pitch * (index + 1),
    length: width * STREAK_LENGTH,
    thickness,
  }));
}

/**
 * Трассеры обложки по снимку работы: последний из тех, что рисуют след.
 * «Без трассера»: след выключен — ряд рисуется только у тех, кто след
 * рисует; если таких нет, обложка — приглушённый стандартный след.
 */
export function tracerCoverProfiles(state) {
  const project = parseEffectsState(state);
  const active = (project?.tracer?.profiles || []).filter(tracerProfileActive);
  const drawn = active.filter((profile) => profile.off !== true);
  if (drawn.length) return { profiles: drawn.slice(-COVER_TRACERS), silent: false };
  return { profiles: [defaultTracerProfile(0)], silent: active.length > 0 };
}

export default function TracerCover({ state = null }) {
  const { profiles, silent } = useMemo(() => tracerCoverProfiles(state), [state]);
  const texturesKey = profiles.map(tracerTextureKey).join("~");
  const textures = useMemo(
    () => profiles.map((profile) => tracerPreviewCanvas(profile)),
    // Пиксели следа зависят только от вида, цветов и свечения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texturesKey],
  );

  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      /* След аддитивный и в игре: на тёмном он светится, а не лежит плёнкой. */
      context.globalCompositeOperation = "lighter";
      /* След убран совсем: полоса — тень прежней, не такая яркая, как у настоящего трассера. */
      if (silent) context.globalAlpha = 0.22;
      const rows = tracerCoverRows(textures.length, width, height);
      rows.forEach((row, index) => {
        const texture = textures[index];
        if (!texture) return;
        context.save();
        /* Текстура вертикальная (голова сверху): кладём её набок, головой
           вправо — пуля летит слева направо. */
        context.translate(row.x + row.length, row.y - row.thickness / 2);
        context.rotate(Math.PI / 2);
        context.drawImage(texture, 0, 0, row.thickness, row.length);
        context.restore();
      });
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
    },
    [textures, silent],
  );

  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
