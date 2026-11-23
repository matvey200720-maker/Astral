/*
 * «Как с ним играть» (ТЗ 23.10.2026, п. G): четыре шага от установки до первого пресета и клавиши в игре. Клавиша меню
 * в шагах и в списке — та, что выбрана человеком (по умолчанию Insert), а не вписанная в текст.
 */

import { reshadeMenuKeyByVk } from "@modovik/optimizer/reshade.js";

import Kbd from "../../components/ui/Kbd.jsx";
import { useUiLanguage } from "../../locales/ui.js";
import { reshadePageCopyFor } from "./reshade-page-copy.js";

export default function ReshadeHowTo({ menuKey }) {
  const copy = reshadePageCopyFor(useUiLanguage());
  const key = reshadeMenuKeyByVk(menuKey).label;
  return (
    <section className="reshade-how" aria-label={copy.howAria}>
      <div className="reshade-how-steps">
        <h2>{copy.howTitle}</h2>
        <ol>
          {copy.howSteps(key).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <div className="reshade-how-keys">
        <h3>{copy.keysTitle}</h3>
        <dl>
          {copy.keys(key).map(([name, text]) => (
            <div key={name}>
              <dt>
                <Kbd>{name}</Kbd>
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
