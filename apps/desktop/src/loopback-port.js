// Порты, к которым браузер не подключается (Chromium: ERR_UNSAFE_PORT, fetch: «bad port»).
const UNSAFE_PORTS = `
  1 7 9 11 13 15 17 19 20 21 22 23 25 37 42 43 53 69 77 79 87 95 101 102 103 104 109 110
  111 113 115 117 119 123 135 137 139 143 161 179 389 427 465 512 513 514 515 526 530 531 532
  540 548 554 556 563 587 601 636 989 990 993 995 1719 1720 1723 2049 3659 4045 4190 5060 5061
  6000 6566 6665 6666 6667 6668 6669 6679 6697 10080
`;

export const BROWSER_UNSAFE_PORTS = Object.freeze(new Set(UNSAFE_PORTS.trim().split(/\s+/).map(Number)));

const NO_SAFE_PORT_MESSAGE = "Не нашёлся порт, который браузер откроет, для возврата входа.";

export function isBrowserUnsafePort(port) {
  return BROWSER_UNSAFE_PORTS.has(Number(port));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Сам отклоняющий вызов служит обработчиком error: тот же объект ставится и снимается.
// Снимается только после удачного listen; если listen бросил сразу, подписка остаётся.
function listenOnAnyPort(server, host) {
  return new Promise((resolve, reject) => {
    function onListening() {
      server.off("error", reject);
      resolve();
    }
    server.once("error", reject);
    server.listen(0, host, onListening);
  });
}

// Один заход: слушать → проверить порт → небезопасный снова закрыть и попробовать ещё раз, пока не кончатся попытки.
// Попытки считаются счётчиком и сравниваются с исходным tries на каждом шаге (а не вычитанием из tries) —
// так совпадают и BigInt, и объект со своим valueOf (число обращений к нему).
async function trySafePort(server, host, tries, attempt = 0) {
  if (!(attempt < tries)) throw new Error(NO_SAFE_PORT_MESSAGE);
  await listenOnAnyPort(server, host);
  const { port } = server.address();
  if (!isBrowserUnsafePort(port)) return port;
  await closeServer(server);
  return trySafePort(server, host, tries, attempt + 1);
}

export async function listenOnSafePort(server, host = "127.0.0.1", tries = 25) {
  return trySafePort(server, host, tries);
}
