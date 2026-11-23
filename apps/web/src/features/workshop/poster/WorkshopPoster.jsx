import { useEffect, useMemo, useState } from "react";
import {
  Airplane,
  Buildings,
  Bus,
  Cat,
  Clock,
  Cloud,
  Crosshair,
  Drop,
  Factory,
  Fire,
  Flag,
  Hexagon,
  Lamp,
  Leaf,
  Lightning,
  MapPin,
  MapTrifold,
  MagnifyingGlass,
  Mountains,
  PencilSimple,
  Presentation,
  ShieldCheck,
  Signpost,
  SpeakerHigh,
  Sparkle,
  Star,
  Storefront,
  Sun,
  TextAa,
  Warehouse,
  Waves,
  Heartbeat,
} from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { groupSummaryText } from "./poster-copy.js";
import {
  POSTER_SINGLES_PER_ROW,
  groupPosterEntries,
  posterChipsOf,
} from "./poster-groups.js";
import "./poster.css";

/*
 * «Афиша редакторов» — первая вкладка мастерской (дизайн 15.11.2026, вариант A).
 *
 * Шапка с последним редактором, ниже — группы плиток. Данные настоящие: плитки, обложки и «стоит в игре» приходят от страницы
 * мастерской (`CatalogPages.jsx`, `renderWorkshopSlotCard`), здесь только вид. Обложки — те же штатные кадры редакторов, что были на
 * полке; редактор без своего кадра рисуется знаком. В группе новый редактор переносится на следующий ряд: листания вбок нет.
 */

const GLYPHS = {
  minimap: MapTrifold,
  "large-map": MapTrifold,
  crosshair: Crosshair,
  "target-hp": Heartbeat,
  "group-markers": MapPin,
  fonts: TextAa,
  "hit-effects": Drop,
  tracers: Lightning,
  "kill-effects": Lightning,
  "fire-explosions": Fire,
  "wheel-smoke": Cloud,
  timecycle: Sun,
  lights: Lamp,
  water: Waves,
  vegetation: Leaf,
  roads: Signpost,
  animals: Cat,
  arenas: Hexagon,
  "mega-mall": Buildings,
  ashan: Buildings,
  shops: Storefront,
  "project-interiors": Storefront,
  "majestic-interiors": Storefront,
  factory: Factory,
  hangar: Warehouse,
  mapping: MapPin,
  vinewood: Mountains,
  busstops: Bus,
  billboards: Presentation,
  banners: Presentation,
  schedule: Clock,
  flags: Flag,
  atms: Storefront,
  "float-logo": Star,
  airships: Airplane,
  climbing: Mountains,
  wallbang: ShieldCheck,
  "forbidden-zones": Hexagon,
  "capt-zones": Hexagon,
  "msl-zones": Hexagon,
  sounds: SpeakerHigh,
};

const glyphOf = (slotId) => GLYPHS[slotId] || Sparkle;

/* Экскурсии редакторов — данные на несколько килобайт: приезжают отдельным куском, когда полка уже стоит; плитка без них просто без строки «что можно менять». */
function useEditorTours() {
  const [tours, setTours] = useState(null);
  useEffect(() => {
    let alive = true;
    import("../../../components/ui/editor-tours.js")
      .then((module) => alive && setTours(module.EDITOR_TOURS))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return tours;
}

function Chips({ slotId, tours, limit }) {
  const titles = posterChipsOf(slotId, tours, limit);
  if (titles.length === 0) return null;
  return (
    <span className="wsp-chips">
      {titles.map((title) => (
        <i key={title}>{tr(title)}</i>
      ))}
    </span>
  );
}

/* Описание редактора — подсказкой при наведении, а не строкой под названием (владелец, 16.11.2026): плитка в покое — только кадр и название.
   Подсказка стоит над плиткой в обёртке: у самой плитки `overflow: hidden`, и подсказка внутри обрезалась бы. */
function Tip({ id, description, installed }) {
  if (!description && !installed) return null;
  return (
    <span className="wsp-tip" role="tooltip" id={id}>
      {description ? <span>{description}</span> : null}
      {installed ? <em>{tr("Стоит в игре")}</em> : null}
    </span>
  );
}

const tipIdOf = (slotId) => `wsp-tip-${slotId}`;
const hasTip = ({ description, installed }) =>
  Boolean(description || installed);

function Tile({ entry, tours }) {
  const { slot, title, cover, installed, open, warm } = entry;
  const Glyph = glyphOf(slot.id);
  return (
    <div className="wsp-cell">
      <button
        type="button"
        className={`wsp-tile${cover ? "" : " is-plain"}`}
        data-slot={slot.id}
        data-installed={installed || undefined}
        aria-describedby={hasTip(entry) ? tipIdOf(slot.id) : undefined}
        onClick={open}
        onPointerEnter={warm}
        onFocus={warm}
      >
        {cover ? (
          <span className="wsp-art">{cover}</span>
        ) : (
          <>
            <span className="wsp-glyph" aria-hidden="true">
              <Glyph size={26} />
            </span>
            <span className="wsp-mark" aria-hidden="true">
              <Glyph size={150} />
            </span>
          </>
        )}
        <span className="wsp-pen" aria-hidden="true">
          <PencilSimple />
        </span>
        <span className="wsp-copy">
          <b>{title}</b>
          <Chips slotId={slot.id} tours={tours} limit={3} />
        </span>
      </button>
      <Tip
        id={tipIdOf(slot.id)}
        description={entry.description}
        installed={installed}
      />
    </div>
  );
}

/**
 * Афиша: `entries` — плитки полки (`{ slot, title, description, cover, installed, open, warm }`), `query` — что набрано в поиске.
 * Большой шапки с последним редактором нет (владелец, 16.11.2026): раздел начинается сразу с групп плиток.
 */
export default function WorkshopPoster({ entries, query = "" }) {
  useTr();
  const tours = useEditorTours();
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? entries.filter((entry) =>
            `${entry.title} ${entry.description}`
              .toLocaleLowerCase()
              .includes(needle),
          )
        : entries,
    [entries, needle],
  );
  const groups = useMemo(() => groupPosterEntries(shown), [shown]);

  /* Группа с одним редактором — обычная плитка в одну колонку, такие группы встают рядом, каждая со своим заголовком (владелец, 16.11.2026:
     «чтобы везде были превьюшки», «пустое пространство не оставлять»): полосы на весь ряд со знаком и пустотой справа больше нет. */
  const blocks = [];
  for (const group of groups) {
    const last = blocks.at(-1);
    if (group.entries.length !== 1) blocks.push({ group });
    else if (last?.singles && last.singles.length < POSTER_SINGLES_PER_ROW)
      last.singles.push(group);
    else blocks.push({ singles: [group] });
  }
  const groupSection = (group) => {
    const single = group.entries.length === 1;
    return (
      <section
        className={single ? "wsp-group is-single" : "wsp-group"}
        key={group.id}
        data-group={group.id}
        aria-label={tr(group.label)}
      >
        <header className="wsp-group-head">
          <h2>{tr(group.label)}</h2>
          <span>
            {groupSummaryText(
              group.entries.length,
              group.entries.filter((entry) => entry.installed).length,
            )}
          </span>
        </header>
        <div className="wsp-grid" data-assembly-grid>
          {group.entries.map((entry) => (
            <Tile key={entry.slot.id} entry={entry} tours={tours} />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="wsp" data-workshop-shelf="editors">
      {groups.length === 0 && (
        <p className="wsp-empty">
          <MagnifyingGlass aria-hidden="true" />
          {tr("Такого редактора нет")}
        </p>
      )}
      {blocks.map((block) =>
        block.group ? (
          groupSection(block.group)
        ) : (
          <div className="wsp-singles" key={block.singles[0].id}>
            {block.singles.map(groupSection)}
          </div>
        ),
      )}
    </div>
  );
}
