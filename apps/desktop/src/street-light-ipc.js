import { createStreetLightCustomizerService } from "./street-light-customizer.js";

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} должен быть объектом.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  )
    throw new TypeError(`${label}: разрешены только ${fields.join(", ")}.`);
}

export function registerStreetLightIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  desktopStorage,
  listGames,
  gameProcessRunning,
  createService = createStreetLightCustomizerService,
}) {
  let servicePromise;
  const service = async () => {
    if (!servicePromise)
      servicePromise = desktopStorage()
        .installOptions()
        .then(({ stateDir }) =>
          createService({
            stateDir,
            listGames,
            gameProcessRunning,
          }),
        );
    return servicePromise;
  };
  handleIpc(IPC.WORKSHOP_STREET_LIGHT_CAPABILITIES, (event) =>
    trusted(event, async () => (await service()).capabilities()),
  );
  handleIpc(IPC.WORKSHOP_PLAN_STREET_LIGHTS, (event, raw) =>
    trusted(event, async () => {
      const input = safeInput(raw);
      exact(
        input,
        ["projectId", "projectTarget", "module", "replaceInstallId"],
        "planStreetLights",
      );
      if (typeof input.projectId !== "string" || input.projectId.length > 128)
        throw new TypeError("planStreetLights.projectId invalid.");
      if (
        input.replaceInstallId !== null &&
        (typeof input.replaceInstallId !== "string" ||
          input.replaceInstallId.length > 160)
      )
        throw new TypeError("planStreetLights.replaceInstallId invalid.");
      return (await service()).plan(input);
    }),
  );
  handleIpc(IPC.WORKSHOP_APPLY_STREET_LIGHTS, (event, raw) =>
    trusted(event, async () => {
      const input = safeInput(raw);
      exact(input, ["planId"], "applyStreetLights");
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(input.planId || ""),
        )
      )
        throw new TypeError("applyStreetLights.planId invalid.");
      return (await service()).apply(input.planId);
    }),
  );
  handleIpc(IPC.WORKSHOP_REMOVE_STREET_LIGHTS, (event, raw) =>
    trusted(event, async () => {
      const input = safeInput(raw);
      exact(input, ["installId"], "removeStreetLights");
      if (
        !/^street-lights:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(input.installId || ""),
        )
      )
        throw new TypeError("removeStreetLights.installId invalid.");
      return (await service()).remove(input.installId);
    }),
  );
  handleIpc(IPC.WORKSHOP_DISABLE_STREET_LIGHTS, (event, raw) =>
    trusted(event, async () => {
      const input = safeInput(raw);
      exact(input, ["installId"], "disableStreetLights");
      if (
        !/^street-lights:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(input.installId || ""),
        )
      )
        throw new TypeError("disableStreetLights.installId invalid.");
      return (await service()).disable(input.installId);
    }),
  );
}
