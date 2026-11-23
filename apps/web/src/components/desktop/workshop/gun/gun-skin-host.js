import { createRoot as mountRoot } from "react-dom/client";
import { createElement as h } from "react";
import { tr } from "../../../../locales/ui.js";

// Вне экрана, но с размером: у холста без размера сцена не собирается.
const OFFSCREEN_STYLE = Object.fromEntries([
  ["position", "fixed"],
  ["left", "-10000px"],
  ["top", "0"],
  ["width", "1280px"],
  ["height", "800px"],
  ["opacity", "0"],
  ["pointerEvents", "none"],
  ["overflow", "hidden"],
]);

const HOST_ATTRS = [
  ["aria-hidden", "true"],
  ["inert", ""],
];

// Умолчания действуют только для undefined, как у деструктуризации.
const FALLBACKS = {
  name: "",
  targets: null,
  replace: null,
  catalogItems: null,
  asIs: false,
  parts: null,
  notify: () => undefined,
  timeoutMs: 90000,
  mount: null,
};

const gated = (cond, pairs) => (cond ? pairs : []);
const failed = (reason) => ({ status: "failed", reason });

const withFallbacks = (request) =>
  Object.fromEntries(
    Object.entries(FALLBACKS).map(([key, fallback]) => [
      key,
      request[key] === undefined ? fallback : request[key],
    ]),
  );

function claimHost(mount, kind) {
  const host = mount || document.createElement("div");
  Object.assign(host.style, OFFSCREEN_STYLE);
  HOST_ATTRS.forEach(([attr, value]) => host.setAttribute(attr, value));
  host.dataset.gunSkinHost = kind;
  if (host.isConnected) return host;
  document.body.appendChild(host);
  return host;
}

// Заменёнка, замены и «как есть» имеют смысл только вместе с целями.
function seedFrom(project, { name, parts, targets, replace, asIs }) {
  return Object.fromEntries([
    ["project", project],
    ["name", name],
    ...gated(parts?.length, [["parts", parts]]),
    ...gated(targets?.length, [
      ["targets", targets],
      ...gated(replace?.length, [["replace", replace]]),
      ...gated(asIs, [["asIs", true]]),
    ]),
  ]);
}

function studioProps({ kind, slot, seed, cfg, finish }) {
  const { catalogItems, notify } = cfg;
  return Object.fromEntries([
    ["profile", kind],
    ["initialSlot", slot],
    ["seed", seed],
    ...gated(catalogItems?.length, [["catalogItems", catalogItems]]),
    ["onSeedDone", finish],
    ["onNotice", notify],
    ["onExit", () => finish(failed(tr("студия закрылась")))],
  ]);
}

// Ждёт итога студии: первый ответ побеждает, по таймауту итог — отказ.
class OutcomeLatch {
  constructor(timeoutMs) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.settle = (outcome) => {
      window.clearTimeout(this.timer);
      this.resolve(outcome);
    };
    this.timer = window.setTimeout(
      () => this.resolve(failed(tr("студия не ответила вовремя"))),
      timeoutMs,
    );
  }

  run(start) {
    try {
      start(this.settle);
    } catch (err) {
      this.reject(err);
    }
    return this.promise;
  }
}

function retire(root, host) {
  root.unmount();
  host.remove();
}

export async function installGunSkinHeadless(request) {
  const GunStudio = (await import("./GunStudio.jsx")).default;
  const { kind, slot, project } = request;
  const cfg = withFallbacks(request);
  const host = claimHost(cfg.mount, kind);
  const root = mountRoot(host);
  try {
    return await new OutcomeLatch(cfg.timeoutMs).run((finish) => {
      const seed = seedFrom(project, cfg);
      const element = h(GunStudio, studioProps({ kind, slot, seed, cfg, finish }));
      root.render(element);
    });
  } finally {
    retire(root, host);
  }
}
