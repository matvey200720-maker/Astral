/*
 * «Что нужно знать про DLSS 5» — тихий ряд под готовыми пресетами: цена в кадрах, что за сборка, про пресеты и их границы. Раньше этот текст лежал
 * в карточке «Что нужно» и растягивал полосу из трёх карточек (соседняя оставалась пустой); в макете «Кино» карточка — четыре строки с отметкой,
 * а честные оговорки (цена, неофициальная сборка, правила проектов, издание Enhanced) не пропали — их место здесь, слова прежние.
 */

import { tr, useUiLanguage } from "../../locales/ui.js";
import { useGameEditions } from "../workshop/edition-support.js";
import { reshadeCopyFor } from "./reshade-copy.js";
import { reshadePageCopyFor } from "./reshade-page-copy.js";

export default function ReshadeFacts() {
  const language = useUiLanguage();
  const copy = reshadePageCopyFor(language);
  const dlssCopy = reshadeCopyFor(language);
  const editions = useGameEditions();
  return (
    <section
      className="reshade-know"
      data-part="facts"
      aria-label={copy.factsTitle}
    >
      <h2>{copy.factsTitle}</h2>
      <div className="reshade-know-grid">
        <article>
          <h3>{dlssCopy.priceTitle}</h3>
          <p>{dlssCopy.priceText}</p>
        </article>
        <article>
          <h3>{dlssCopy.buildTitle}</h3>
          <p>{copy.buildText}</p>
        </article>
        <article>
          <h3>{tr("Пресеты")}</h3>
          <p>{copy.notes}</p>
        </article>
      </div>
      {editions.enhanced ? (
        <p className="reshade-know-note" role="note">
          {copy.editionNote}
        </p>
      ) : null}
    </section>
  );
}
