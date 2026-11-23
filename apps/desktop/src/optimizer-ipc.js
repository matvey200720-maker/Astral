import * as layers from "./optimization-layers-ipc.js";
import * as customizer from "./optimizer-customizer.js";

export function registerOptimizerIpc(deps) {
  const { IPC } = deps;
  const { handleIpc, trusted } = deps;
  const { safeInput, nativeContext, installOptions } = deps;
  const { gtaSettingsPath, runtimeGuard } = deps;

  // Менеджеру передаются по порядку: вход, контекст, stateDir (из ответа хранилища) и, если нужны, инструменты.
  async function callManager(method, input, toolsOf) {
    const storage = await installOptions();
    return customizer[method](
      safeInput(input),
      nativeContext(),
      storage.stateDir,
      ...(toolsOf ? [toolsOf()] : []),
    );
  }

  const route = (method, toolsOf) => (event, input) => trusted(event, () => callManager(method, input, toolsOf));

  const applyTools = () => {
    const tools = { ...runtimeGuard };
    tools.settingsPath = gtaSettingsPath();
    return tools;
  };
  const rollbackTools = () => ({ settingsPath: gtaSettingsPath() });

  // Слои из модов регистрируются первыми и получают тот же объект зависимостей.
  layers.registerOptimizationLayersIpc(deps);
  handleIpc(IPC.WORKSHOP_PLAN_OPTIMIZER, route("planOptimizerProfile"));
  handleIpc(IPC.WORKSHOP_APPLY_OPTIMIZER, route("applyOptimizerProfile", applyTools));
  handleIpc(IPC.WORKSHOP_ROLLBACK_OPTIMIZER, route("rollbackOptimizerProfile", rollbackTools));
}
