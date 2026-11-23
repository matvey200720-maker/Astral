import Button from "../../../components/ui/Button.jsx";
import { formatSize } from "../../../catalog-utils.js";
import { roundedRemaining } from "../eta.js";
import Hero from "./Hero.jsx";
import { clockOf } from "./ribbon-model.js";

/*
 * Герой, когда ничего не идёт: «Всё готово» — итог последней сессии (что поставили, сколько, за сколько) и «Ничего не
 * устанавливается» — пустая страница с дорогой в каталог. Картинка героя — обложка последнего поставленного мода, если она есть;
 * нет — тёмный фон без выдуманного кадра.
 */

function totalsOf(batch) {
  const installed = batch.filter(
    (entry) => entry.operation === "install",
  ).length;
  const removed = batch.filter((entry) => entry.operation === "remove").length;
  const bytes = batch.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
  const first = Math.min(...batch.map((entry) => entry.startedAt || entry.at));
  const last = Math.max(...batch.map((entry) => entry.at));
  return { installed, removed, bytes, ms: Math.max(0, last - first) };
}

export function DoneHero({ batch, copy, rc, language, onOpenCatalog }) {
  const totals = totalsOf(batch);
  const pictures = batch.map((entry) => entry.picture).filter(Boolean);
  const time =
    totals.ms >= 1000
      ? rc.inTime(copy.eta.time(roundedRemaining(totals.ms)))
      : "";
  const sub = [
    totals.installed ? rc.installedCount(totals.installed) : "",
    totals.removed ? rc.removedCount(totals.removed) : "",
    totals.bytes > 0 ? formatSize(totals.bytes, language) : "",
    time,
  ]
    .filter(Boolean)
    .join(" · ");
  const actions = onOpenCatalog ? (
    <Button variant="primary" size="lg" onClick={onOpenCatalog}>
      {rc.moreFromCatalog}
    </Button>
  ) : null;
  const model = {
    mode: "done",
    title: rc.allDone,
    cover: pictures[0] || "",
    pills: [
      { text: rc.ready, tone: "solid", dot: true },
      { text: rc.changesAfterLaunch, tone: "plain" },
    ],
    sub,
    actions,
    thumbs: pictures.slice(0, 3),
  };
  return <Hero model={model} />;
}

export function EmptyHero({ last, copy, rc, onOpenCatalog }) {
  const actions = (
    <>
      {onOpenCatalog ? (
        <Button variant="primary" size="lg" onClick={onOpenCatalog}>
          {rc.openCatalog}
        </Button>
      ) : null}
      {last ? (
        <span className="dl-hero-last">
          {rc.lastRun(last.name, clockOf(last.at))}
        </span>
      ) : null}
    </>
  );
  const model = {
    mode: "empty",
    title: rc.nothingRuns,
    cover: last?.picture || "",
    pills: [{ text: rc.quiet, tone: "plain" }],
    sub: copy.panel.emptyText,
    actions,
  };
  return <Hero model={model} />;
}
