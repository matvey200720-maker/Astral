import React, { useState } from "react";
import EditorSkeleton from "../../../ui/EditorSkeleton.jsx";
import SoundKitStudio from "./SoundKitStudio.jsx";

/*
 * Звук в мастерской: какая из двух студий открывается.
 *
 * Выстрелы и попадания — студия звуков (`SoundKitStudio`): сцена, готовые
 * звуки и свой файл, как у таймциклов. Музыка загрузки, сирены, окружение и
 * полный список дорожек игры — прежняя студия (`SoundStudio`): там звук
 * ищут на слух среди сотен безымянных дорожек, и сцены у этого нет.
 *
 * Плитка раздела открывает свою: «Музыка при загрузке» — прежнюю, «Звуки
 * оружия», «Звуки при попадании» и «Фоновый шум» — новую. Из новой в прежнюю ведёт меню
 * «⋯», и «Назад» оттуда возвращает в новую, а не в мастерскую.
 */

const SoundStudio = React.lazy(() => import("./SoundStudio.jsx"));

/* Разделы прежней студии: у них нет ни сцены, ни готовых звуков. */
const STUDIO_SECTIONS = new Set(["loading-music", "sirens", "ambience", "radio"]);

const KIT_TABS = Object.freeze({
  weapons: "weapons",
  "hit-sounds": "hits",
  "hit-sounds-head": "hits",
  "hit-sounds-body": "hits",
  /* «Фоновый шум» — пульт окружения (ТЗ 17.10.2026, задача 5): громкость
     машин, улиц, природы, погоды и людей по отдельности. Замена дорожек
     окружения осталась в прежней студии, в «⋯». */
  "ambient-noise": "mix",
});
const KIT_PARTS = Object.freeze({
  "hit-sounds-head": "head",
  "hit-sounds-body": "body",
});

export default function SoundWorkshop({ onExit, onNotice, initialSection = "" }) {
  const direct = STUDIO_SECTIONS.has(initialSection) ? initialSection : "";
  const [studio, setStudio] = useState(direct);

  if (studio)
    return (
      <React.Suspense fallback={<EditorSkeleton />}>
        <SoundStudio
          initialSection={studio}
          onExit={direct ? onExit : () => setStudio("")}
        />
      </React.Suspense>
    );

  return (
    <SoundKitStudio
      onExit={onExit}
      onNotice={onNotice}
      initialTab={KIT_TABS[initialSection] || ""}
      initialPart={KIT_PARTS[initialSection] || ""}
      onOpenLegacy={() => setStudio("loading-music")}
    />
  );
}
