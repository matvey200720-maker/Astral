/*
 * Плашка при самой первой установке (13.11.2026, решение владельца): предлагает включить «Быструю установку».
 *
 * Показывается один раз — когда человек впервые что-то ставит, откуда угодно: главный процесс сам знает, что установка
 * началась и что на плашку ещё не отвечали (`{ kind: "offer" }`). Установку плашка не держит: «Применить» снимает
 * тормоз уже идущей установке. «Продолжить без ускорения», крестик и Esc — ответ «нет»; после любого ответа плашки
 * больше не будет (отметка — в настройках главного процесса, не в `localStorage`).
 */
import { useEffect, useId } from "react";
import DesktopOverlayPortal from "../../components/desktop/overlays/DesktopOverlayPortal.jsx";
import Button from "../../components/ui/Button.jsx";
import { WarningCircle, X } from "../../components/ui/icons.jsx";
import { useTr } from "../../locales/ui.js";
import { answerFastInstallOffer, useFastInstall } from "./fast-install.js";

export default function FastInstallOffer() {
  const tr = useTr();
  const { offer } = useFastInstall();
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    if (!offer) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") answerFastInstallOffer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offer]);

  if (!offer) return null;
  return (
    <DesktopOverlayPortal>
      <section
        className="fast-install-offer astral-glass-surface"
        data-glass="panel"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={textId}
      >
        <span className="fast-install-offer-mark" aria-hidden="true">
          <WarningCircle weight="fill" />
        </span>
        <div className="fast-install-offer-body">
          <h2 id={titleId}>{tr("Быстрая установка")}</h2>
          <p id={textId}>
            {tr("Моды будут ставиться заметно быстрее. На это время диск сильно нагружен, и компьютер может работать медленнее.")}
          </p>
          <p className="fast-install-offer-guide">
            {tr("Чтобы выключить, зайдите в «Загрузки» и выключите «Быструю установку» кнопкой.")}
          </p>
          <div className="fast-install-offer-actions">
            <Button variant="primary" size="sm" onClick={() => answerFastInstallOffer(true)}>
              {tr("Применить")}
            </Button>
            <Button variant="link" size="sm" onClick={() => answerFastInstallOffer(false)}>
              {tr("Продолжить без ускорения")}
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<X />}
          className="fast-install-offer-close"
          aria-label={tr("Закрыть")}
          title={tr("Закрыть")}
          onClick={() => answerFastInstallOffer(false)}
        />
      </section>
    </DesktopOverlayPortal>
  );
}
