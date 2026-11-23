/*
 * Прицел и оптика в игру.
 *
 * У прицела окно установки было самым многоступенчатым из всех: оно
 * открывалось пустым и ждало нажатия «Проверить и подготовить», потом
 * «Создать backup и применить», а если прицел уже стоял — ещё и «Поставить
 * новую версию». Три нажатия после того, как человек уже сказал «Применить»,
 * и два из них ничем друг от друга не отличались на вид.
 *
 * Здесь осталась работа. База прицела — `hud_reticle.gfx` из архива игрока,
 * собирает её главный процесс; окну нечего решать, кроме как в какую игру
 * ставить. Проверка пакета никуда не делась: `install-rpf-patch` зовёт
 * `ValidatePatchAsync` до первой записи в архив.
 */

import { damageCounterForProject } from "@modovik/reticle-contract";
import { applyReticleCustomization } from "../../../../api.js";
import { getProject } from "../../../catalog/catalog-projects.js";
import { locateLegacyGame } from "../game-root.js";
import { recordNativeInstall } from "../native-record.js";
import { journalReconcile } from "../reconcile-journal.js";

export const RETICLE_INSTALL_KIND = "native-reticle";

/**
 * @param {{project: object, report?: Function}} input
 */
export async function installReticle({ project, report }) {
  const gameRoot = await locateLegacyGame(project.gamePath);
  /* Счётчик патронов (задача 12 ТЗ 10.10.2026) лежит в модуле обычного
     прицела, но в игру уходит своим полем: он один на все стволы и ставится
     в hud.gfx тем же пакетом. */
  const damageCounter = project.modules.crosshair?.damageCounter;
  const configuration = {
    ordinary: project.modules.crosshair,
    sniper: project.modules["sniper-scope"],
    ammo: project.modules.crosshair?.ammo ?? null,
    /* Счётчик урона — там же и так же: один на все стволы и обе вкладки. Сервер
       не выбран — тот же, что показывает окно: проект приложения. */
    damage: damageCounter
      ? damageCounterForProject(damageCounter, getProject())
      : null,
    /* Анимация прицела (10.11.2026, `reticle-contract/animation.js`): одна на оба вида, лежит в модуле обычного. Без поля — всё выключено, прицел собирается как раньше. */
    animation: project.modules.crosshair?.animation ?? null,
    /* Индикатор перезарядки (14.11.2026, `reticle-contract/reload.js`): тоже один на оба вида и все стволы; кроме прицела ставит перехват в hud.gfx. */
    reload: project.modules.crosshair?.reloadIndicator ?? null,
  };
  const applied = await applyReticleCustomization({
    gameRoot,
    configuration,
  });
  /* Запись сверки с игрой (прицел, патроны, урон — по записи на то, что поставлено): работа, версия Astral — в запись установки и в журнал приложения. */
  const installed = await journalReconcile({ installed: applied, project });
  const record = await recordNativeInstall({
    projectId: project.id,
    kind: RETICLE_INSTALL_KIND,
    installed,
    gameRoot,
    report,
  });
  return { record, installed };
}
