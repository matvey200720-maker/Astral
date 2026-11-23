import { useMemo } from "react";
import { tr } from "../../locales/ui.js";
import Button from "../../components/ui/Button.jsx";
import ModName from "../../components/desktop/catalog/ModName.jsx";
import { formatSize } from "../../catalog-utils.js";
import { remember } from "../../section-memory.js";
import { buildsCopyFor } from "../builds/builds-copy.js";
import { buildWorksCopyFor } from "../builds/build-works-copy.js";
import { coverTiles, pendingWithoutPhoto } from "../builds/cover-tiles.js";
import { modPhoto } from "../builds/mod-faces.js";
import { copyFlow } from "../../components/desktop/builds/build-flows.js";
import ProfileIcon from "./profile-icons.jsx";

const JOINER = " · ";
const NAMES_SHOWN = 4;

/* Сумма размеров, если он известен у каждого найденного мода сборки (как у карточки на странице «Сборки»). */
function knownBytes(mods, allMods, getModSize) {
  let total = 0;
  for (const mod of mods) {
    if (!mod || mod.pending || mod.missing) return null;
    const size = getModSize(mod, allMods);
    if (!(size > 0)) return null;
    total += size;
  }
  return total;
}

function Mosaic({ view }) {
  const { tiles, more } = coverTiles(
    view.workCards,
    view.mods,
    3,
    pendingWithoutPhoto(view.mods),
    view.items,
  );
  const sources = tiles.map((tile) =>
    tile.kind === "mod" ? modPhoto(tile.mod) : "",
  );
  /* Ни у одной вещи сборки нет кадра: три пустые клетки с крошечными значками выглядели дырой — одна крупная плашка со знаком сборки. */
  if (tiles.length > 0 && sources.every((src) => !src)) {
    return (
      <div className="pf-mos pf-mos-1 pf-mos-plain">
        <div>
          <span className="pf-mos-blank">
            <ProfileIcon name="layers" size={32} />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={`pf-mos pf-mos-${Math.max(1, tiles.length)}`}>
      {tiles.length === 0 && (
        <div>
          <span className="pf-mos-blank">
            <ProfileIcon name="layers" size={22} />
          </span>
        </div>
      )}
      {tiles.map((tile, at) => {
        const src = tile.kind === "mod" ? modPhoto(tile.mod) : "";
        return (
          <div key={at}>
            {src ? (
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ) : (
              <span className="pf-mos-blank">
                <ProfileIcon name="layers" size={22} />
              </span>
            )}
            {more > 0 && at === tiles.length - 1 && (
              <span className="pf-mos-more">+{more}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BuildCard({
  view,
  copy,
  worksCopy,
  language,
  allMods,
  getModSize,
  onOpen,
  onShare,
}) {
  const { profile, mods, workCards, items } = view;
  const total = mods.length ? knownBytes(mods, allMods, getModSize) : null;
  const parts = [
    mods.length
      ? copy.mods(mods.length) +
        (total ? JOINER + formatSize(total, language) : "")
      : "",
    workCards.length + items.length
      ? worksCopy.works(workCards.length + items.length)
      : "",
  ].filter(Boolean);
  const names = mods.filter((mod) => mod.name).slice(0, NAMES_SHOWN);
  return (
    <div className="pf-bl">
      <Mosaic view={view} />
      <h3>{profile.name}</h3>
      <div className="pf-bl-ms">
        {parts.length ? parts.join(JOINER) : copy.emptyBuild}
      </div>
      {names.length > 0 && (
        <div className="pf-bl-nm">
          {names.map((mod, at) => (
            <span key={mod.id || at}>
              {at > 0 ? JOINER : ""}
              <ModName name={mod.name} />
            </span>
          ))}
        </div>
      )}
      <div className="pf-bl-acts">
        <Button size="sm" className="pf-btn" onClick={() => onOpen(profile)}>
          {tr("Открыть")}
        </Button>
        <Button
          size="sm"
          className="pf-btn"
          icon={<ProfileIcon name="link" size={15} weight={1.9} />}
          onClick={() => onShare(profile)}
        >
          {tr("Поделиться")}
        </Button>
      </div>
    </div>
  );
}

export default function BuildsTab({
  views,
  language,
  allMods,
  getModSize,
  onNavigate,
  onNotice,
}) {
  const copy = useMemo(() => buildsCopyFor(language), [language]);
  const worksCopy = useMemo(() => buildWorksCopyFor(language), [language]);
  const sizeOf = getModSize || (() => 0);
  const open = (profile) => {
    remember("builds:opened", profile);
    onNavigate?.("profiles");
  };
  const share = (profile) =>
    copyFlow(
      profile,
      { showCopiedBuild: () => onNotice?.(copy.copied) },
      { copy, onNotice: (text) => onNotice?.(text) },
    ).catch(() => onNotice?.(copy.copyFailed));
  return (
    <>
      {/* Плитки «Новая сборка» здесь больше нет (владелец 18.11.2026: «её быть не должно»): создают сборку на странице «Сборки».
          Сборок нет — сетки нет, остаётся подсказка ниже, пустого места не остаётся. */}
      {views.length > 0 && (
        <div className="pf-bld">
          {views.map((view) => (
            <BuildCard
              key={view.profile.id}
              view={view}
              copy={copy}
              worksCopy={worksCopy}
              language={language}
              allMods={allMods}
              getModSize={sizeOf}
              onOpen={open}
              onShare={share}
            />
          ))}
        </div>
      )}
      <div className="pf-hint">
        <span className="pf-hint-i">
          <ProfileIcon name="link" size={20} weight={1.8} />
        </span>
        <div>
          <b>{tr("Отправь сборку другу по ссылке")}</b>
          <small>
            {tr(
              "Сборки собирает и хранит приложение; друг ставит её одним нажатием.",
            )}
          </small>
        </div>
      </div>
    </>
  );
}
