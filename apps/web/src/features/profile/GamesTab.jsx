import { tr } from "../../locales/ui.js";
import Button from "../../components/ui/Button.jsx";
import ModName from "../../components/desktop/catalog/ModName.jsx";
import { modCardKickerParts } from "../../catalog-utils.js";
import { GAME_GROUPS, sizeText } from "./profile-facts.js";
import ProfileIcon from "./profile-icons.jsx";
import { word } from "./profile-words.js";

const GROUP_TITLES = {
  gunpacks: "Ганпаки",
  redux: "Редуксы",
  clothing: "Одежда",
  other: "Другое",
};
const KIND_WORDS = { gunpacks: "Ганпак", redux: "Редукс", clothing: "Одежда" };

/* Подпись плитки: вид и, если известен, размер. У мода из «Другого» вид — раздел каталога, у работы — вид работы. */
function caption(tile, language) {
  const kind = KIND_WORDS[tile.kind]
    ? tr(KIND_WORDS[tile.kind])
    : tile.kind === "work"
      ? tile.workTitle
      : modCardKickerParts(tile.mod, word("mod"), language).text;
  const size = sizeText(tile.bytes, language);
  return size ? `${kind} · ${size}` : kind;
}

function Tile({ tile, language, onSelect }) {
  const inner = (
    <>
      {tile.picture ? (
        <img
          className="pf-tile-bg"
          src={tile.picture}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className="pf-tile-blank" aria-hidden="true">
          <ProfileIcon name="layers" size={22} />
        </span>
      )}
      <span className="pf-tile-t">
        <h4>
          <ModName name={tile.name} />
        </h4>
        <p>{caption(tile, language)}</p>
      </span>
    </>
  );
  const cls = `pf-tile${tile.group === "clothing" ? " pf-tile-cl" : ""}`;
  if (!tile.mod) return <div className={cls}>{inner}</div>;
  return (
    <button type="button" className={cls} onClick={() => onSelect?.(tile.mod)}>
      {inner}
    </button>
  );
}

export default function GamesTab({ tiles, language, onSelect, onNavigate }) {
  if (!tiles.length) {
    return (
      <div className="pf-empty">
        <b>{tr("В игре пока ничего нет")}</b>
        <p>{tr("Моды, которые встанут в игру, появятся здесь по разделам.")}</p>
        <Button className="pf-btn" onClick={() => onNavigate?.("catalog")}>
          {tr("Открыть каталог")}
        </Button>
      </div>
    );
  }
  return (
    <>
      <div className="pf-sync">
        <span className="pf-note">
          {tr("Моды, которые стоят в игре сейчас.")}
        </span>
      </div>
      {GAME_GROUPS.map((group) => {
        const items = tiles.filter((tile) => tile.group === group);
        if (!items.length) return null;
        return (
          <section className="pf-sec" key={group} data-group={group}>
            <div className="pf-sec-h">
              <h2>{tr(GROUP_TITLES[group])}</h2>
              <span className="pf-count">{items.length}</span>
            </div>
            <div className="pf-tiles">
              {items.map((tile) => (
                <Tile
                  tile={tile}
                  key={tile.key}
                  language={language}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
