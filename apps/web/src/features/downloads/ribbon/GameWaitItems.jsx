import { X } from "../../../components/ui/icons.jsx";
import { trIn } from "../../../locales/ui.js";
import { coverThumbUrl } from "../../../utils/cover-thumb.js";
import { removeDeferred } from "../deferred-installs.js";
import HungGameClose from "../HungGameClose.jsx";
import { Thumb } from "./CatalogItems.jsx";
import Hero from "./Hero.jsx";

/*
 * Отложенные установки в «Загрузках» (26.11.2026): пока GTA V запущена, мод ждёт здесь — героем, если больше ничего не идёт,
 * и строками очереди. Слова говорят, чего ждём и что будет само; «Не ставить» снимает ожидание. Зависшей игре — кнопка закрытия.
 */
const WAITING = "Ждём, пока закроется GTA V, — поставим сами";
const REMOVE = "Не ставить";
const HERO_WIDTH = 960;

export function GameWaitHero({ entry, copy, language }) {
  const remove = trIn(language, REMOVE);
  const model = {
    mode: "wait",
    title: entry.name,
    cover: coverThumbUrl(entry.picture || "", HERO_WIDTH),
    percent: null,
    pills: [{ text: copy.kicker.waiting, tone: "solid", dot: true }],
    sub: trIn(language, WAITING),
    note: trIn(
      language,
      "Закройте игру и лаунчер сервера. Astral можно закрыть — установка дождётся его следующего запуска.",
    ),
    cancel: {
      label: remove,
      ariaLabel: `${remove}: ${entry.name}`,
      title: remove,
      onPress: () => removeDeferred(entry.id),
    },
    actions: <HungGameClose />,
    rail: null,
  };
  return <Hero model={model} />;
}

export function DeferredRow({ entry, language }) {
  const remove = trIn(language, REMOVE);
  return (
    <article className="dl-row" data-row data-state="deferred">
      <span className="dl-grip-slot" aria-hidden="true" />
      <Thumb
        row={{
          name: entry.name,
          operation: "install",
          coverFallback: entry.picture,
        }}
      />
      <div className="dl-row-name">
        <h3 data-audit-ignore="caps">{entry.name}</h3>
        <small>{trIn(language, WAITING)}</small>
      </div>
      <div className="download-actions">
        <button
          type="button"
          title={remove}
          aria-label={`${remove}: ${entry.name}`}
          onClick={() => removeDeferred(entry.id)}
        >
          <X />
        </button>
      </div>
    </article>
  );
}
