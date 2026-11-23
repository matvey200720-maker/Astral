import React from "react";
import { SpeakerHigh } from "../../../components/ui/icons.jsx";

/*
 * Обложка звуков — динамик.
 *
 * У звука нет кадра: дорожки игры не имеют даже имён, одни хеши, и любая
 * картинка на плитке была бы чужой — ночной байкер не рассказывает ни про
 * выстрел, ни про сирену. Знак динамика говорит ровно то, что за плиткой:
 * здесь правят звук. Стоит ли свой звук в игре, отвечает галочка статуса.
 * Тот же знак — у карточек звука в библиотеке: звуки оружия, попадание в
 * голову и в тело различает подпись.
 *
 * Карточка сохранённой работы (`state` — её снимок) рисует саму работу:
 * ствол или мишень (`SoundWorkCover.jsx`).
 */

const SoundWorkCover = React.lazy(() => import("./SoundWorkCover.jsx"));

export default function SoundCover({ state = null }) {
  if (state) return <SoundWorkCover state={state} />;
  return (
    <span className="workshop-cover-glyph">
      <SpeakerHigh weight="fill" />
    </span>
  );
}
