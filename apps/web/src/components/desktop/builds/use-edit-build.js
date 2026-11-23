import { useRememberedState } from "../../../section-memory.js";
import { encodePortableBuild } from "../../../features/builds/portable-code.js";
import { pruneChoices } from "../../../features/builds/build-choices.js";
import { rememberBuildChoices } from "../../../features/builds/build-choices-store.js";
import { findById } from "./build-lists.js";

/*
 * «Изменить» у открытой сборки (дизайн 15.11.2026, макет builds-B-open): та же страница, что «Новая сборка», но с составом этой сборки — название и
 * флажки модов. Предлагаются моды сборки и моды библиотеки (`libraryIds`): убрать лишнее и добавить своё. Моды, которых каталог не знает (`blockOf`),
 * остаются в сборке как были — снять их флажком нельзя, как и в «Новой сборке». Работы мастерской сборки не меняются.
 *
 * Сохраняется в список сборок этого ПК (`setProfiles`; список лежит в `modovik-builds`), код пересчитывается, «обновлена» — сегодня. Облачные сборки не
 * правятся: у моста окна нет вызова изменения, кнопка для них не показывается (`canEdit`).
 */

const newSet = () => new Set();

// Состав сборки без повторов: сначала её моды в прежнем порядке, потом остальные из библиотеки.
const unique = (lists) => [...new Set(lists.flat())];

export function canEdit(profile, cloudMode) {
  return Boolean(profile) && !cloudMode && !profile.cloud;
}

export function useEditBuild({
  shown,
  entriesOf,
  blockOf,
  libraryIds,
  setProfiles,
}) {
  const [editingId, setEditingId] = useRememberedState("builds:editing", "");
  const [name, setName] = useRememberedState("builds:edit-name", "");
  const [ticked, setTicked] = useRememberedState("builds:edit-ticked", newSet);
  const profile = editingId ? findById(shown, editingId) || null : null;
  const ids = profile ? unique([profile.modIds || [], libraryIds]) : [];
  const choosable = ids.filter((id) => !blockOf(id));
  const enabledIds = new Set(choosable.filter((id) => ticked.has(id)));
  const toggle = (id) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selection = {
    enabledIds,
    onToggle: toggle,
    onSetAll: (on) => setTicked(new Set(on ? choosable : [])),
  };

  function start(build) {
    setName(build.name || "");
    setTicked(new Set(build.modIds || []));
    setEditingId(build.id);
  }

  function stop() {
    setEditingId("");
  }

  /* Новая запись сборки; не сохранилась ли — решает вызывающий (`null` — нечего сохранять). */
  function save() {
    if (!profile) return null;
    const kept = new Set(enabledIds);
    const preserved = (profile.modIds || []).filter((id) => blockOf(id));
    const modIds = [...ids.filter((id) => kept.has(id)), ...preserved];
    /* Мод, которого в сборке больше нет, не оставляет места, на которое ставил (`build-choices.js`). */
    const next = pruneChoices({
      ...profile,
      name: name.trim() || profile.name,
      modIds,
      updatedAt: new Date().toISOString(),
    });
    if (profile.choices) rememberBuildChoices(profile.id, next.choices);
    try {
      next.code = encodePortableBuild(next);
    } catch {
      next.code = profile.code;
    }
    setProfiles((list) =>
      list.map((item) => (item.id === profile.id ? next : item)),
    );
    setEditingId("");
    return next;
  }

  return {
    profile,
    name,
    setName,
    mods: entriesOf(ids),
    enabledIds,
    selection,
    start,
    stop,
    save,
  };
}
