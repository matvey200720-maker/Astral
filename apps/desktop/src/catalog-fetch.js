// Обёртка отправки запросов каталога: вошедшему человеку страница уходит с подписанным DPoP,
// гостю — как есть. Запоминает, уходили ли страницы без входа.

// Адрес для подписи: схема, хост, порт и путь — без query, фрагмента и учётных данных.
export function catalogProofTarget(target) {
  const parsed = new URL(`${target}`);
  return parsed.origin + parsed.pathname;
}

// Адрес запроса строкой: сама строка, иначе url объекта (как у Request), иначе сам объект.
function addressOf(input) {
  if (typeof input === "string") return input;
  const url = input?.url;
  return String(url === undefined || url === null ? input : url);
}

class CatalogClient {
  #io;
  #userAgent;
  #wentAnonymous = false;

  // Зависимости оборачиваются в вызовы «с нуля», чтобы настоящая fetch не получала чужой this.
  constructor({ fetchImpl, readState, authorized, proof, userAgent = "" }) {
    this.#io = {
      transmit: (target, init) => fetchImpl(target, init),
      account: () => readState(),
      delegate: (send) => authorized(send),
      sign: (account, htu) => proof(account, htu),
    };
    this.#userAgent = userAgent;
  }

  isAnonymous() {
    return this.#wentAnonymous;
  }

  reset() {
    this.#wentAnonymous = false;
  }

  // Адрес запроса вычисляется до чтения учётки, даже если гостю он не понадобится.
  async fetch(input, init) {
    const target = addressOf(input);
    const account = await this.#io.account();
    return account ? this.#asMember(input, init, target) : this.#asGuest(input, init);
  }

  // Гость (и публичный повтор): запрос уходит с исходными input и init, флаг поднимается.
  #asGuest(input, init) {
    this.#wentAnonymous = true;
    return this.#io.transmit(input, init);
  }

  // Вошедший: адрес для подписи считается до отправки, повтор после 401 делает authorized.
  async #asMember(input, init, target) {
    const htu = catalogProofTarget(target);
    const { stored, response } = await this.#io.delegate((account) => this.#send(account, target, htu, init));
    return stored && response ? response : this.#asGuest(input, init);
  }

  #send(account, target, htu, init) {
    // init.headers читается раньше подписи: init = null роняет отправку до proof
    const headers = Object.assign({}, init.headers, this.#loginHeaders(account, htu));
    return this.#io.transmit(target, Object.assign({}, init, { headers }));
  }

  #loginHeaders(account, htu) {
    const headers = { Authorization: "DPoP " + account.access_token, DPoP: this.#io.sign(account, htu) };
    if (this.#userAgent) headers["User-Agent"] = this.#userAgent;
    return headers;
  }
}

export function createCatalogFetch(options) {
  const client = new CatalogClient(options);
  return Object.assign((input, init = {}) => client.fetch(input, init), {
    anonymous: () => client.isAnonymous(),
    resetAnonymous: () => client.reset(),
  });
}
