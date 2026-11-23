import { pendingWithoutPhoto } from "../../../features/builds/cover-tiles.js";
import { buildIsInstalled } from "../../../features/builds/build-state.js";
import BuildInstallStatus, { hasBuildInstallStatus } from "./BuildInstallStatus.jsx";
import BuildCoverCollage from "./BuildCoverCollage.jsx";
import MenuButton from "../../ui/MenuButton.jsx";
import MediaCard from "../../ui/MediaCard.jsx";
import { Trash, MinusCircle, DotsThree, Copy, Check } from "../../ui/icons.jsx";

const JOINER = " · ";

// Пункт меню → имя свойства-обработчика у карточки.
export const REACTIONS = { copy: "onCopy", "remove-works": "onRemoveWorks", delete: "onDelete" };

const isResolved = (mod) => Boolean(mod) && !mod.pending && !mod.missing;

// Сумма размеров, если он известен у каждого мода списка, иначе null.
// Размер спрашивается у каждого найденного, даже когда итог уже не покажется.
function knownTotal(mods, availableMods, getModSize) {
  let total = 0;
  let complete = true;
  for (const mod of mods) {
    if (!isResolved(mod)) {
      complete = false;
      continue;
    }
    const size = getModSize(mod, availableMods);
    if (!(size > 0)) complete = false;
    total += size;
  }
  return complete ? total : null;
}

/** Состав сборки словами: «4 мода · 414 МБ · 2 работы» (общее у карточки и «афиши»). */
export function describeBuild(props, workTotal) {
  const { mods, copy, worksCopy, sizeOf } = props;
  let modsText = null;
  if (mods.length > 0) {
    const total = knownTotal(mods, props.availableMods, props.getModSize);
    modsText = total === null ? copy.mods(mods.length) : copy.mods(mods.length) + JOINER + sizeOf(total);
  }
  const worksText = workTotal > 0 ? worksCopy.works(workTotal) : null;
  if (modsText === null && worksText === null) return copy.emptyBuild;
  return [modsText, worksText].filter((text) => text !== null).join(JOINER);
}

export function menuOptions(copy, worksCopy, { copied, hasWorks }) {
  const captions = {
    copy: copy.copyCode,
    "remove-works": worksCopy.removeWorks ?? copy.removeWorks,
    delete: copy.deleteBuild,
  };
  const glyphs = { copy: copied ? Check : Copy, "remove-works": MinusCircle, delete: Trash };
  const options = [];
  for (const value of Object.keys(REACTIONS)) {
    if (value === "remove-works" && !hasWorks) continue;
    if (value === "delete") options.push({ separator: true });
    const Glyph = glyphs[value];
    const option = { value, label: captions[value], icon: <Glyph aria-hidden="true" /> };
    options.push(value === "delete" ? { ...option, danger: true } : option);
  }
  return options;
}

const BuildCard = (props) => {
  const { profile, mods, copy, worksCopy, onOpen } = props;
  const { queue = [], items = [] } = props;
  const { language = "ru", workCards = null } = props;

  // даже пустой workCards — набор работ, profile.works ему не уступает
  const works = workCards ?? profile.works ?? [];
  const installed = buildIsInstalled(profile, props.installedIds);
  const copied = props.copiedBuildId === profile.id;

  const statusProps = { profile, queue, installed, installedLabel: copy.installed, language };
  const cardProps = {
    className: "builds-card is-store",
    media: <BuildCoverCollage mods={mods} works={works} items={items} pending={pendingWithoutPhoto(mods)} />,
    title: profile.name,
    description: describeBuild(props, works.length + items.length),
    trailing: hasBuildInstallStatus(profile, queue, installed) ? <BuildInstallStatus {...statusProps} /> : null,
    onClick: () => onOpen(profile),
  };
  const menuProps = {
    className: copied ? "builds-card-menu is-copied" : "builds-card-menu",
    variant: "ghost",
    size: "sm",
    icon: <DotsThree weight="bold" aria-hidden="true" />,
    trailing: null,
    ariaLabel: copy.actionsFor(profile.name),
    align: "end",
    options: menuOptions(copy, worksCopy, { copied, hasWorks: works.length > 0 }),
    onSelect: (value) => {
      const handler = props[REACTIONS[value]];
      handler?.(profile);
    },
  };

  return (
    <div className="builds-card-wrap">
      <MediaCard {...cardProps} />
      <MenuButton {...menuProps} />
    </div>
  );
};

export default BuildCard;
