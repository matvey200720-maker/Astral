const askEager = (ipc) => ipc.loadEager();
const askFor = (channel) => (ipc) => ipc.loadFor(channel);

function failureEntry(error) {
  const reason = error?.message || String(error);
  return {
    level: "error",
    source: "main",
    message: `Каналы мастерской не подключились: ${reason}`,
    detail: error?.stack || "",
  };
}

// Диспетчер хранит одну регистрацию отложенных модулей — вместе с её отказом.
class Dispatcher {
  #registerDeferred;
  #settleIpc;
  #appLog;
  #registration = null;

  constructor(registerDeferred, settleIpc, appLog) {
    this.#registerDeferred = registerDeferred;
    this.#settleIpc = settleIpc;
    this.#appLog = appLog;
  }

  #register() {
    // Функции зовутся «голыми», без this диспетчера.
    const registerDeferred = this.#registerDeferred;
    const settleIpc = this.#settleIpc;
    this.#registration ??= registerDeferred().catch((error) => {
      settleIpc();
      throw error;
    });
    return this.#registration;
  }

  run(action) {
    return this.#register()
      .then(action)
      .catch((error) => this.#appLog.record(failureEntry(error)));
  }
}

export function lazyWorkshopIpc({ registerDeferred, expectIpc, settleIpc, IPC, appLog }) {
  const dispatcher = new Dispatcher(registerDeferred, settleIpc, appLog);

  expectIpc(Object.values(IPC), {
    onCall: (channel) => dispatcher.run(askFor(channel)),
  });

  return () => dispatcher.run(askEager);
}
