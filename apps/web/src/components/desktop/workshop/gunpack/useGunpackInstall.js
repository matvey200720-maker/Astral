import * as bridge from "./gunpack-bridge.js";
import { locateLegacyTarget } from "../../../../features/workshop/install-queue/game-root.js";
import * as queue from "../../../../features/workshop/install-queue/index.js";
import { sanitizeDesktopErrorMessage } from "../../../../api.js";
import * as checks from "./gunpack-check-copy.js";
import { tr } from "../../../../locales/ui.js";
import * as copy from "../gun/gun-copy.js";
import * as React from "react";

/* ---------- чистые функции для панели ---------- */

export const installBlocker = (weapon) => {
  const stopper = weapon.checks?.find(({ severity }) => severity === "block");
  const assets = stopper ? [] : weapon.files.filter(isGameAsset);
  const heavy = assets.find(({ size }) => size > MAX_ASSET_BYTES);

  switch (true) {
    case Boolean(stopper):
      return checks.checkMessage(stopper.message);
    case assets.length === 0:
      return tr("В паке нет ни модели, ни текстур этого ствола.");
    case Boolean(heavy): {
      const { name } = heavy;
      return copy.fill(tr("«{name}» больше 64 МБ — игра на таком падает."), { name });
    }
    default:
      return "";
  }
};

export const installMatches = (installed, variantKey, models, attachments) => {
  const sameShape =
    Boolean(installed) && installed.variantKey === variantKey && installed.attachments === attachments;
  return sameShape && sameList(installed.requested || installed.models || [], models);
};

const sorted = (list) => [...list].sort();

// Списки равны, если после сортировки по строковому виду совпадают поэлементно (повторы считаются).
function sameList(left, right) {
  return left.length === right.length && sameOrder(sorted(left), sorted(right));
}

const sameOrder = (first, second) => first.every((entry, at) => entry === second[at]);

const isGameAsset = ({ name }) => /\.(ydr|ytd)$/i.test(name);

/* ---------- хук вкладки «В игру» ---------- */

export const useGunpackInstall = ({ pack, variant, onInstalled, onNotice }) => {
  const installed = pack?.installed || null;
  const handlers = { onInstalled, onNotice };
  const { view, plan } = useInstallChoice(pack, variant);
  const queued = useQueuedInstall(pack, { view, plan }, handlers);
  const removal = useRemoval(pack, installed, handlers);
  const matches = installMatches(installed, plan.request.variantKey, plan.request.models, view.attachments);

  const facts = { empty: view.models.length === 0, matches, installed };
  const action = pack && {
    label: firstRule(LABEL_RULES, facts),
    onClick: queued.apply,
    disabled: facts.empty || matches,
    busy: queued.button.busy,
    meter: queued.button.meter,
    title: queued.button.hint || firstRule(HINT_RULES, facts),
  };

  return {
    action: action || null,
    installed,
    ...view,
    matches,
    button: queued.button,
    removing: removal.removing,
    apply: queued.apply,
    remove: removal.remove,
  };
};

/* ---------- выбор стволов ---------- */

function useInstallChoice(pack, variant) {
  const [picked, setPicked] = React.useState([]);
  const installable = React.useMemo(() => installableModels(variant), [variant]);
  const [withParts, setWithParts] = React.useState(true);
  useDefaultChoice(pack, variant, installable, { setPicked, setWithParts });

  const packId = pack?.id;
  const variantKey = variant?.key;
  const plan = React.useMemo(
    () => planInstall(packId, variantKey, { models: picked, attachments: withParts }),
    [packId, variantKey, picked, withParts],
  );

  const view = {
    installable,
    models: picked,
    attachments: withParts,
    setAttachments: setWithParts,
    toggle: (model) => setPicked((current) => flip(current, model)),
    selectAll: () => setPicked(installable),
    selectNone: () => setPicked([]),
  };
  return { view, plan };
}

// Убирает модель (все вхождения), а если её не было, добавляет в конец.
function flip(list, model) {
  const rest = list.filter((entry) => entry !== model);
  return rest.length === list.length ? [...list, model] : rest;
}

// Выбор по умолчанию пересчитывается только при смене пака, ключа варианта или списка годных.
function useDefaultChoice(pack, variant, installable, { setPicked, setWithParts }) {
  const record = pack?.installed;
  const packId = pack?.id;
  const variantKey = variant?.key;

  React.useEffect(() => {
    const resumed = Boolean(record) && record.variantKey === variantKey;
    setPicked(resumed ? recordedModels(record, installable) : installable);
    setWithParts(resumed ? record.attachments !== false : true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, variantKey, installable]);
}

function recordedModels(record, installable) {
  const allowed = new Set(installable);
  return (record.requested || record.models || []).filter((model) => allowed.has(model));
}

function installableModels(variant) {
  const found = [];
  for (const weapon of variant?.weapons ?? []) {
    if (installBlocker(weapon) === "") found.push(weapon.model);
  }
  return found;
}

function planInstall(packId, variantKey, { models, attachments }) {
  const request = {
    packId: packId || "",
    variantKey: variantKey ?? "",
    models: sorted(models),
    attachments,
  };
  return { request, signature: queue.workSignature(request) };
}

function firstRule(rules, facts) {
  for (const [applies, text] of rules) {
    if (applies(facts)) return text();
  }
  return "";
}

/* ---------- установка через общую очередь ---------- */

function useQueuedInstall(pack, { view, plan }, handlers) {
  const workKey = pack ? WORK_KEY_PREFIX + pack.id : "";
  const button = queue.useWorkshopApplyButton(workKey, plan.signature, tr);

  function apply() {
    if (!(pack && view.models.length)) return;
    const job = new InstallJob(pack, plan.request, view.models.length, handlers.onInstalled);
    queue.applyWorkshopWork({
      key: workKey,
      signature: plan.signature,
      title: copy.fill(tr("Ганпак «{name}»"), job.names),
      editor: tr("Ганпаки"),
      notify: handlers.onNotice,
      run: job.run,
      doneText: job.doneText,
    });
  }

  return { button, apply };
}

class InstallJob {
  constructor(pack, request, picked, onInstalled) {
    this.pack = pack;
    this.request = request;
    this.picked = picked;
    this.onInstalled = onInstalled;
    this.names = { name: pack.name };
  }

  run = async (context) => {
    const { report } = context ?? {};
    const game = await locateLegacyTarget();
    announce(report, "prepare");
    const record = await this.install(game);
    return refreshTextures(report).then(() => ({ record }));
  };

  async install(game) {
    const record = await bridge.installPack({ ...this.request, gameRoot: game.path, targetId: game.id });
    this.onInstalled?.(this.pack.id, record);
    return record;
  }

  doneText = (outcome = {}) => {
    const { record } = outcome;
    return record?.skipped?.length ? this.partial(record) : this.complete();
  };

  complete() {
    return copy.fill(tr("Ганпак «{name}» в игре — запустите GTA V"), this.names);
  }

  partial(record) {
    return copy.fill(tr("Ганпак «{name}» в игре: {placed} из {count}. Не встали: {list}"), {
      ...this.names,
      placed: record.models?.length ?? this.picked,
      count: this.picked,
      list: record.skipped.map(describeSkipped).join("; "),
    });
  }
}

const announce = (report, step) => report?.({ step });

const describeSkipped = (item) => `${item.name} — ${tr(item.reason)}`;

/* ---------- снятие из игры ---------- */

function useRemoval(pack, installed, handlers) {
  const [removing, setRemoving] = React.useState(false);
  const names = { name: pack?.name };

  async function remove() {
    if (!installed) return;
    setRemoving(true);
    await pullFromGame(pack, installed, handlers.onInstalled)
      .then(() => handlers.onNotice?.(copy.fill(tr("Ганпак «{name}» снят — в игре штатные стволы"), names)))
      .catch((error) => handlers.onNotice?.(sanitizeDesktopErrorMessage(error), "error"))
      .finally(() => setRemoving(false));
  }

  return { removing, remove };
}

async function pullFromGame(pack, installed, onInstalled) {
  const game = await locateLegacyTarget();
  await bridge.uninstallPack(uninstallInput(pack, installed, game));
  onInstalled?.(pack.id, null);
  await refreshTextures();
}

const uninstallInput = (pack, installed, game) => ({
  packId: pack.id,
  gameRoot: game.path,
  targetId: installed.targetId || game.id,
});

// Ступень текстур тянет за собой оптимизатор, поэтому подключается только при первом вызове.
async function refreshTextures(report) {
  const stage = await import("../../../../features/workshop/install-queue/tasks/textures.js");
  return stage.refreshTexturesAfterWeaponWork(report);
}

const MAX_ASSET_BYTES = 64 * 2 ** 20;
const WORK_KEY_PREFIX = "astral.gunpack.install:";

const LABEL_RULES = [
  [({ matches }) => matches, () => tr("Уже в игре")],
  [({ installed }) => installed, () => tr("Обновить в игре")],
  [() => true, () => tr("Поставить в игру")],
];

const HINT_RULES = [
  [({ empty }) => empty, () => tr("Отметьте хотя бы один ствол в «В игру»")],
  [({ matches }) => matches, () => tr("Этот выбор уже стоит в игре")],
  [() => true, () => tr("Отмеченные стволы встанут отдельным DLC Astral")],
];
