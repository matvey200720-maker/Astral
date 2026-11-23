import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MUZZLE_QUIET_ALL,
  createProject,
  muzzleQuietAll,
  muzzleQuietOf,
  serializeProject,
  withMuzzleQuiet,
} from "@modovik/ptfx-studio";
import { findStudioTracerWeapon } from "@modovik/tracer-contract";
import { chooseGameInstallation, hasDesktopBridge } from "../../../../api.js";
import {
  EFFECTS_INSTALL_KEY,
  composeEffectsInstall,
  installEffectsSet,
  installedEffects,
} from "../effects-install-state.js";
import { ptfxGameRoot } from "../ptfx/ptfx-base-store.js";
import { readEffectsDraft } from "../gunpack/gunpack-tracers.js";
import {
  REPLACING_INSTALL_STEPS,
  applyWorkshopWork,
  useWorkshopApplyButton,
  workSignature,
} from "../../../../features/workshop/install-queue/index.js";
import {
  readInstallRecord,
  useInstallRecord,
} from "../../../../features/workshop/useInstallRecord.js";
import { WORK_KINDS } from "../../../../features/workshop/works/work-kinds.js";
import { tr } from "../../../../locales/ui.js";

/*
 * «Без вспышки и дыма» у ствола (задача 6 ТЗ 17.10.2026, из задачи 2:
 * «чтобы можно было отключать когда стреляешь частица от выстрелов»).
 *
 * Вспышка и дым у дула живут в файле оружия игры (`weapons.meta` и копии
 * стволов дополнений в `dlc_patch`) — в том же, что правят трассеры и
 * вспышки выстрела. Слоем оптимизации поверх их не поставить: установщик
 * эффектов переписывает этот файл своим журналом, и два хозяина одного файла
 * затирали бы друг друга. Поэтому галка живёт в наборе эффектов
 * (`muzzle.quiet`) и ставится его же установкой — частью «выстрел стволов»
 * (`composeEffectsInstall`, часть `muzzle`): трассеры, попадания и огонь
 * едут такими, какими стоят в игре, недоделанная правка трассера не уезжает.
 */

const DRAFT_KEY = "astral.ptfx.project.v1";
const QUEUE_KEY = `${EFFECTS_INSTALL_KEY}:muzzle`;

function writeDraft(project, storage = globalThis.localStorage) {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(project));
  } catch {
    /* приватный режим: галка живёт до конца сеанса окна */
  }
}

const quietState = (project, weapon) => ({
  one: Boolean(project && muzzleQuietOf(project, weapon)),
  all: Boolean(project && muzzleQuietAll(project)),
});

/**
 * Галки ствола `weapon` (`WEAPON_…`): `null`, если ствол не из таблицы
 * стволов мастерской (холодное, метательное — вспышки у них нет).
 */
export function useMuzzleQuiet(weapon, { onNotice } = {}) {
  const known = Boolean(weapon && findStudioTracerWeapon(weapon));
  const [draft, setDraft] = useState(() => (known ? readEffectsDraft() : null));
  useEffect(() => {
    setDraft(known ? readEffectsDraft() : null);
  }, [known, weapon]);
  const { record } = useInstallRecord(EFFECTS_INSTALL_KEY);
  const installed = useMemo(() => installedEffects(record), [record]);
  const inGame = quietState(installed.project, weapon);
  const wanted = quietState(draft, weapon);
  const set = useMemo(
    () =>
      draft
        ? composeEffectsInstall({ draft, installed, part: "muzzle" })
        : null,
    [draft, installed],
  );
  const signature = useMemo(() => (set ? workSignature(set) : null), [set]);
  const applyButton = useWorkshopApplyButton(QUEUE_KEY, signature, tr);
  const changed = wanted.one !== inGame.one || wanted.all !== inGame.all;

  const toggle = useCallback(
    (scope, on) => {
      const base = readEffectsDraft() || serializeProject(createProject());
      const next = withMuzzleQuiet(base, scope === "all" ? MUZZLE_QUIET_ALL : weapon, on);
      writeDraft(next);
      setDraft(next);
    },
    [weapon],
  );

  const apply = useCallback(() => {
    if (!set) return;
    if (!hasDesktopBridge()) {
      onNotice?.(tr("Установка эффектов доступна только в приложении Astral на Windows"), "error");
      return;
    }
    const chosen = set;
    void applyWorkshopWork({
      key: QUEUE_KEY,
      signature,
      title: tr("Вспышка и дым у дула"),
      editor: tr("Вспышка и дым у дула"),
      coverSlotId: WORK_KINDS.tracer.slotId,
      /* На кадре — ствол студии оружия, а не трейсер: снимком трейсеров он не становится. */
      frame: false,
      coverState: JSON.stringify(chosen),
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: tr("Ставим вспышку и дым у дула в игру"),
      run: async ({ report }) => {
        let gameRoot = await ptfxGameRoot();
        if (!gameRoot) {
          const picked = await chooseGameInstallation();
          gameRoot = picked?.game?.path || picked?.path;
        }
        if (!gameRoot) throw new Error(tr("Выберите папку GTA V Legacy."));
        /* Остальное — из записи на момент установки, а не нажатия (как у
           «Применить» эффектов): соседний редактор мог поставить своё. */
        const latest = readInstallRecord(EFFECTS_INSTALL_KEY);
        return installEffectsSet({
          set: composeEffectsInstall({
            draft: chosen,
            installed: installedEffects(latest),
            part: "muzzle",
          }),
          record: latest,
          gameRoot,
          report,
        });
      },
      doneText: () => tr("Вспышка и дым у дула — в игре"),
    });
  }, [set, signature, onNotice]);

  if (!known) return null;
  return {
    weapon,
    one: wanted.one,
    all: wanted.all,
    inGame,
    changed,
    unknown: !installed.known,
    busy: applyButton.busy || "",
    onOne: (on) => toggle("one", on),
    onAll: (on) => toggle("all", on),
    onApply: apply,
  };
}
