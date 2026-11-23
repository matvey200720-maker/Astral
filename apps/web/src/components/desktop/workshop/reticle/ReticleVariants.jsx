import { useState } from "react";
import { MAX_WEAPON_RETICLES, normalizeOrdinaryReticle } from "@modovik/reticle-contract";
import { MagnifyingGlass, Plus, Trash } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import LayerList from "../../../ui/LayerList.jsx";
import NavRow from "../../../ui/NavRow.jsx";
import PanelPage from "../../../ui/PanelPage.jsx";
import SelectionMark from "../../../ui/SelectionMark.jsx";
import { FxCheck } from "../effects-controls.jsx";
import { useEffectsCopy } from "../effects-lang.js";
import { weaponGroups } from "../tracer-profiles.js";
import { ReticleThumb } from "./ReticleArt.jsx";
import { SNIPER_GROUP, reticleVariants, reticleWeapon } from "./reticle-weapons.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { atCrosshair, removeCrosshair } from "../reticle-lang.js";

/*
 * Инструмент «Оружие»: варианты прицела, как трассеры (владелец, 31.10.2026).
 *
 * Строка — рисунок прицела и его стволы словами; строка выбирает вариант, который правят остальные инструменты.
 * «Новый прицел» — под списком, как «Новый трассер». У выбранного варианта — те же группы стволов: страница группы,
 * поиск по всем, ствол у одного варианта. Первый вариант стоит у всего остального оружия и не убирается.
 * Что такое вариант и куда идут правки — `reticle-weapons.js`.
 */

/** Подпись варианта в списке: «Прицел 2». */
export const variantTitle = (list, id) => `${tr("Прицел")} ${list.findIndex((item) => item.id === id) + 1}`;

/** Что вариант берёт — одной строкой. */
export function variantSummary(list, variant, copy) {
  if (variant.everything)
    return list.some((item) => item.weapons.length) ? tr("Всё остальное оружие") : tr("Всё оружие");
  if (!variant.weapons.length) return tr("Оружие не выбрано — в игру не едет");
  const names = variant.weapons.map((id) => tr(reticleWeapon(id)?.label || id));
  return names.length <= 2 ? names.join(", ") : copy.andMore(names.slice(0, 2).join(", "), names.length - 2);
}

const ownGroups = (query) => weaponGroups(query).filter((item) => item.group !== SNIPER_GROUP);

function VariantWeapons({ list, variant, page, onPage, onToggle }) {
  useTr();
  const language = useUiLanguage();
  const copy = useEffectsCopy();
  const [query, setQuery] = useState("");
  const held = new Set(variant.weapons);
  const ownerOf = (id) => list.findIndex((item) => item.id !== variant.id && item.weapons.includes(id));
  const groupBlock = ({ group, weapons }) => {
    const ids = weapons.map((weapon) => weapon.id);
    const count = ids.filter((id) => held.has(id)).length;
    const full = count === ids.length;
    return (
      <div className="fx-weapon-group" key={group}>
        <label className="fx-check is-group">
          <FxCheck
            checked={full}
            label={copy.weaponsAll(tr(group), full ? tr("снять все") : tr("отметить все"))}
            onChange={(on) => onToggle(ids, on)}
          />
          <SelectionMark on={full} className={count && !full ? "is-mixed" : ""} />
          <span>
            <b>{tr(group)}</b>
            <small>
              {count}/{ids.length}
            </small>
          </span>
        </label>
        {weapons.map((weapon) => {
          const checked = held.has(weapon.id);
          const owner = ownerOf(weapon.id);
          return (
            <label className="fx-check" key={weapon.id}>
              <FxCheck checked={checked} label={tr(weapon.label)} onChange={(on) => onToggle([weapon.id], on)} />
              <SelectionMark on={checked} />
              <span className="fx-weapon-name">
                {tr(weapon.label)}
                {tr(weapon.label) !== weapon.en && <small>{weapon.en}</small>}
              </span>
              {owner > 0 && <em className="fx-weapon-owner">{atCrosshair(language, owner + 1)}</em>}
            </label>
          );
        })}
      </div>
    );
  };
  const open = page ? ownGroups("").find((item) => item.group === page) : null;
  if (open)
    return (
      <PanelPage
        label={tr(open.group)}
        note={[variantTitle(list, variant.id), held.size ? copy.selectedCount(held.size) : tr("ничего не выбрано")].join(" · ")}
        backLabel={tr("Оружие")}
        onBack={() => onPage("")}
      >
        <section className="ui-panel fx-section" aria-label={tr(open.group)}>
          <div className="fx-weapons is-page" role="group" aria-label={tr("Стволы")}>
            {groupBlock(open)}
          </div>
        </section>
      </PanelPage>
    );
  const groups = ownGroups(query);
  return (
    <section className="ui-panel fx-section" aria-label={tr("Оружие")}>
      <label className="fx-weapon-search">
        <MagnifyingGlass aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={tr("Найти ствол: карабин, мк2, хеви…")}
          aria-label={tr("Найти ствол")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {query.trim() ? (
        <div className="fx-weapons" role="group" aria-label={tr("Стволы")}>
          {groups.length === 0 && <p className="fx-hint">{tr("Ничего не нашлось — попробуйте по-английски: carbine, mk2.")}</p>}
          {groups.map(groupBlock)}
        </div>
      ) : (
        <div className="fx-weapon-pages" role="group" aria-label={tr("Группы стволов")}>
          {groups.map(({ group, weapons }) => {
            const count = weapons.filter((weapon) => held.has(weapon.id)).length;
            return (
              <NavRow
                key={group}
                title={tr(group)}
                caption={
                  count === weapons.length
                    ? tr("Все")
                    : tr("{count} из {total}").replace("{count}", String(count)).replace("{total}", String(weapons.length))
                }
                data-weapon-group={group}
                onOpen={() => onPage(group)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ReticleVariantsPanel({ module, selectedId, onSelect, onAdd, onRemove, onToggle }) {
  useTr();
  const language = useUiLanguage();
  const copy = useEffectsCopy();
  const list = reticleVariants(module);
  const selected = list.find((item) => item.id === selectedId) || list[0];
  /* Страница группы стволов занимает панель целиком, как у трассеров: шестьдесят строк под списком прицелов не поместятся. */
  const [page, setPage] = useState("");
  const open = !selected.everything && page;
  return (
    <>
      {!open && <section className="ui-panel fx-section" aria-label={tr("Прицелы")}>
        <LayerList
          label={tr("Прицелы")}
          items={list.map((variant) => {
            const summary = variantSummary(list, variant, copy);
            return {
              id: variant.id,
              title: variantTitle(list, variant.id),
              meta: summary,
              tooltip: summary,
              thumb: (
                <ReticleThumb
                  kind="ordinary"
                  config={normalizeOrdinaryReticle(variant.config)}
                  className="reticle-variant-thumb"
                />
              ),
            };
          })}
          value={selected.id}
          onSelect={onSelect}
          tools={(item, index) =>
            index > 0
              ? [
                  {
                    id: "remove",
                    label: removeCrosshair(language, item.title),
                    icon: <Trash />,
                    danger: true,
                    onClick: () => onRemove(item.id),
                  },
                ]
              : []
          }
          footer={
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus />}
              disabled={list.length > MAX_WEAPON_RETICLES}
              title={tr("Ещё один прицел — для других стволов")}
              onClick={onAdd}
            >
              {tr("Новый прицел")}
            </Button>
          }
        />
        <p className="fx-hint">
          {list.length > 1
            ? tr("У ствола в игре один прицел: отметили карабин у одного — другой его отдал.")
            : tr("Прицел стоит у всего оружия. Для отдельных стволов создайте новый и отметьте их.")}
        </p>
      </section>}
      {selected.everything ? (
        <section className="ui-panel fx-section" aria-label={tr("Оружие")}>
          <p className="fx-hint">{tr("Этот прицел стоит у всего оружия, кроме отмеченного у других прицелов.")}</p>
          <p className="fx-hint is-open">
            {tr("Видимость и отметка попадания — общие для всех стволов. Оптика снайперок — одна на все: её игра берёт у насадки, а не у ствола.")}
          </p>
        </section>
      ) : (
        <VariantWeapons
          key={selected.id}
          list={list}
          variant={selected}
          page={page}
          onPage={setPage}
          onToggle={(ids, on) => onToggle(selected.id, ids, on)}
        />
      )}
    </>
  );
}
