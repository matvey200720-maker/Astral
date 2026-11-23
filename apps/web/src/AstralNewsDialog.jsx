import { openLink } from "./components/desktop/settings/open-link.js";
import { useState } from "react";
import Dialog from "./components/ui/Dialog.jsx";
import { ArrowLeft as Back, ArrowRight as Forward, ArrowSquareOut as Out } from "./components/ui/icons.jsx";
import Button from "./components/ui/Button.jsx";

// Подписи окна по языкам; порядок: закрыть, «Что изменилось», «Подробнее», назад, вперёд, плашка.
// Языка нет в таблице — английские (сторож шести языков требует fr рядом с pl).
const WORDS = {
  ru: ["Закрыть новость", "Что изменилось", "Подробнее", "Предыдущая", "Следующая", "Новости Astral"],
  uk: ["Закрити новину", "Що змінилося", "Детальніше", "Попередня", "Наступна", "Новини Astral"],
  en: ["Close news", "What changed", "Learn more", "Previous", "Next", "Astral news"],
  de: ["Neuigkeit schließen", "Was sich geändert hat", "Mehr erfahren", "Vorherige", "Nächste", "Astral-Neuigkeiten"],
  pl: ["Zamknij aktualność", "Co się zmieniło", "Więcej", "Poprzednia", "Następna", "Aktualności Astral"],
  fr: ["Fermer l’actualité", "Ce qui a changé", "Détails", "Précédente", "Suivante", "Actualités Astral"],
};

// Картинку новости грузим только со своего адреса и только по SHA-256 (ТЗ 05.10, задача 12).
const HASH = /^[\da-f]{64}$/;

// Статья одной новости в общем Dialog (рамка, Esc, фокус и крестик — его, d3e6d56d). Лишнюю надпись над заголовком
// и список-заглушку при пустом «Что изменилось» убрали умышленно (редизайн 17.10.2026).
export default function AstralNewsDialog(props) {
  const { details = [], image = "" } = props;
  const { language = "ru", link = "", linkLabel = "" } = props;
  const { onNext = null, onPrevious = null } = props;
  const [closeText, changedText, moreText, previousText, nextText, brandText] = WORDS[language] || WORDS.en;
  // Сбой картинки не сбрасывается до размонтирования (умышленно, как было).
  const [broken, setBroken] = useState(false);

  const lines = details.length > 0 && details.map((line) => <li key={line}>{line}</li>);
  const cover =
    !broken && HASH.test(image) ? (
      <figure className="news-picture">
        <img onError={() => setBroken(true)} src={`/api/news/media/${image}`} alt="" decoding="async" />
      </figure>
    ) : (
      <div aria-hidden="true" className="news-article-banner">
        <img alt="" src="/brand/astral-mark.png" />
        <span>{brandText}</span>
      </div>
    );

  const dialog = {
    backdropClassName: "editorial-news-dialog-backdrop",
    className: "editorial-news-dialog news-article",
    titleId: "editorial-news-dialog-title",
    closeLabel: closeText,
    description: props.summary,
    kicker: props.date,
    onClose: props.onClose,
    title: props.title,
    status:
      onPrevious || onNext ? (
        <span className="news-article-pager">
          {[
            ["icon", <Back />, onPrevious, previousText],
            ["trailing", <Forward />, onNext, nextText],
          ].map(([side, glyph, step, text]) => (
            <Button {...{ [side]: glyph, children: text, disabled: !step, onClick: step, size: "sm", variant: "ghost" }} key={side} />
          ))}
        </span>
      ) : null,
    actions: link ? (
      <Button {...{ children: linkLabel || moreText, icon: <Out />, onClick: () => openLink(link), title: link, variant: "primary" }} />
    ) : null,
  };

  return (
    <Dialog {...dialog}>
      {cover}
      {lines && (
        <section className="news-changes">
          <h3>{changedText}</h3>
          <ul>{lines}</ul>
        </section>
      )}
    </Dialog>
  );
}
