/*
 * Схема щита в облике работы — плитки шаблонов и обложка «Билбордов».
 *
 * Это схема, а не кадр из игры: щит на опорах, на полотне — облик (своя
 * картинка, цвет, градиент). Реклама Rockstar на схеме — нейтральные
 * полосы: листов игры в поставке нет. Свечение ночью — ореол вокруг
 * полотна, яркость — светлее или темнее.
 */

import { useId } from "react";
import { billboardLookIsStock } from "@modovik/climb-contract/recolor/billboards";

const FACE = Object.freeze({ x: 18, y: 12, width: 124, height: 52 });
const FIT_ASPECT = Object.freeze({ cover: "xMidYMid slice", contain: "xMidYMid meet", stretch: "none" });

export default function BillboardArt({ look, imageUrl = "", label = "Билборд" }) {
  const id = useId().replace(/:/g, "");
  const stock = billboardLookIsStock(look);
  const glow = look.glow ?? 100;
  const tone = (look.brightness ?? 100) - 100;
  return (
    <svg className="billboards-art" viewBox="0 0 160 100" width="100%" height="100%" display="block" role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2={look.direction === "down" ? "0" : "1"} y2={look.direction === "down" ? "1" : "0"}>
          <stop offset="0" stopColor={look.colour} />
          <stop offset="1" stopColor={look.colour2} />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} />
        </clipPath>
        <filter id={`${id}-h`} x="-30%" y="-40%" width="160%" height="180%">
          <feGaussianBlur stdDeviation={Math.min(9, 2 + glow / 40)} />
        </filter>
      </defs>
      <rect width="160" height="100" rx="6" fill="#15171c" />
      {/* Опоры и мостик. */}
      <rect x="48" y="64" width="6" height="36" fill="#3b3f47" />
      <rect x="106" y="64" width="6" height="36" fill="#3b3f47" />
      <rect x={FACE.x - 2} y={FACE.y + FACE.height + 2} width={FACE.width + 4} height="3" fill="#4a4f58" />
      {/* Свечение ночью — ореол. */}
      {glow > 100 && !stock && look.mode !== "standard" && (
        <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} fill={look.mode === "gradient" ? `url(#${id}-g)` : look.mode === "colour" ? look.colour : "#ffffff"} opacity={Math.min(0.7, (glow - 100) / 300)} filter={`url(#${id}-h)`} />
      )}
      <rect x={FACE.x - 3} y={FACE.y - 3} width={FACE.width + 6} height={FACE.height + 6} fill="#2c3038" />
      <g clipPath={`url(#${id}-c)`}>
        {look.mode === "image" && imageUrl ? (
          <>
            <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} fill={look.fit === "contain" ? look.background : "#222"} />
            <image href={imageUrl} x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} preserveAspectRatio={FIT_ASPECT[look.fit] || FIT_ASPECT.cover} />
          </>
        ) : look.mode === "image" ? (
          <>
            <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} fill={look.fit === "contain" ? look.background : "#30343c"} />
            <rect x="62" y="26" width="36" height="24" rx="3" fill="none" stroke="#9aa3b2" strokeWidth="2" strokeDasharray="4 3" />
            <circle cx="72" cy="34" r="3" fill="#9aa3b2" />
            <path d="M64 48 L74 39 L80 44 L88 36 L96 48 Z" fill="#9aa3b2" />
          </>
        ) : look.mode === "colour" ? (
          <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} fill={look.colour} />
        ) : look.mode === "gradient" ? (
          <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} fill={`url(#${id}-g)`} />
        ) : (
          /* Реклама игры — нейтральными полосами: листов Rockstar на схеме нет. */
          <>
            <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} fill="#c8c3b8" />
            <path d={`M${FACE.x} ${FACE.y + 40} L${FACE.x + 60} ${FACE.y} L${FACE.x + 92} ${FACE.y} L${FACE.x + 32} ${FACE.y + 52} L${FACE.x} ${FACE.y + 52} Z`} fill="#8f6f5b" />
            <path d={`M${FACE.x + 70} ${FACE.y + 52} L${FACE.x + 124} ${FACE.y + 14} L${FACE.x + 124} ${FACE.y + 52} Z`} fill="#5d7488" />
            <rect x={FACE.x + 74} y={FACE.y + 10} width="40" height="6" fill="#ece8df" />
            <rect x={FACE.x + 74} y={FACE.y + 20} width="28" height="4" fill="#ece8df" />
          </>
        )}
        {tone !== 0 && <rect x={FACE.x} y={FACE.y} width={FACE.width} height={FACE.height} fill={tone < 0 ? "#000000" : "#ffffff"} opacity={Math.min(0.6, Math.abs(tone) / 100)} />}
      </g>
    </svg>
  );
}
