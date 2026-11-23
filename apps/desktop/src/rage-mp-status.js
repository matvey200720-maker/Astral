/*
 * Есть ли на этом ПК клиент RAGE MP (GTA 5 RP) — для слов в окне (18.11.2026).
 *
 * Клиент RAGE MP не подключает пакеты дополнений Astral (`update/x64/dlcpacks/astral_*`): растительность, дороги и замена одежды в
 * `astral_clothing` видны в сюжетном режиме и не видны на сервере GTA 5 RP (владелец и журнал тестера beta.108, 18.11.2026; про
 * остальные пакеты подтверждения нет, окно говорит только о подтверждённых — `rage-pack.js`, `RAGE_CONFIRMED_PACKS`). Окно предупреждает об этом человека до «Применить» и после установки, но только если RAGE MP у него
 * есть: тому, кто на GTA 5 RP не играет, эта строка ни к чему. «Есть» — в реестре найден `game_v_path` клиента
 * (`launcher-game-paths.js`, тот же признак, что у строки журнала «RAGE MP (GTA 5 RP): game_v_path …»).
 *
 * Ответ окну — только «найден или нет»: путь окно не получает. Чтение реестра медленное и редко меняется — ответ держится минуту.
 */

import { rageGamePath } from "./launcher-game-paths.js";
import { rpModeKindsOn } from "./rp-mode-channel.js";

const KEEP_MS = 60_000;

/**
 * @param {{ read?: () => Promise<string|null|undefined>, now?: () => number }} [deps]
 * @returns {{ status: () => Promise<{ found: boolean }> }}
 */
export function createRageMpStatus({
  read = () => rageGamePath(),
  now = Date.now,
  env = process.env,
} = {}) {
  let kept = null;
  /* Режим RP (21.11.2026): какие виды идут контейнером — окну, чтобы не обещать «на GTA 5 RP пока не видна» работе, которая ляжет контейнером. Ключ есть, только если хоть один вид включён: выключен — ответ прежний. */
  const reply = (found) => {
    const rpMode = rpModeKindsOn(env);
    return Object.values(rpMode).some(Boolean) ? { found, rpMode } : { found };
  };
  return {
    async status() {
      if (kept && now() - kept.at < KEEP_MS) return reply(kept.found);
      let found = false;
      try {
        found = Boolean(await read());
      } catch {
        /* реестра нет или нет доступа — RAGE MP считаем не найденным */
      }
      kept = { at: now(), found };
      return reply(found);
    },
  };
}

export function registerRageMpStatusIpc({ IPC, handleIpc, trusted, rage }) {
  handleIpc(IPC.RAGE_MP_STATUS, (event) => trusted(event, () => rage.status()));
}
