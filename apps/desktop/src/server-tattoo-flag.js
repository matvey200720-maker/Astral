const ENV_NAME = "ASTRAL_SERVER_TATTOO_APPLY";
const ENV_ON = "1";
const ARGV_SWITCH = "--astral-server-tattoo-apply=1";

// Переменная проверяется первой: если она включила, argv не читается совсем.
const switches = [
  (env) => env[ENV_NAME] === ENV_ON,
  (env, argv) => argv.includes(ARGV_SWITCH),
];

export function serverTattooApplyEnabled(options = {}) {
  const { env = process.env, argv = process.argv } = options;
  return switches.some((isOn) => isOn(env, argv));
}
