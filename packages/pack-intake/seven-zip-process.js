import { realpathSync } from "node:fs";
import SevenZip from "7z-wasm";

const CRASH_CODE = 255;

const crashReply = (text) => ({ code: CRASH_CODE, out: [], err: [text], crashed: true });

const mountAll = (sevenZip, mounts) => {
  Object.entries(mounts).forEach(([point, folder]) => {
    sevenZip.FS.mkdir(point);
    const options = { root: realpathSync(folder) };
    sevenZip.FS.mount(sevenZip.NODEFS, options, point);
  });
};

const exited = (code) => ({ code, crashed: false });

// Итог callMain: число — код выхода; выход Emscripten со status — тоже код; остальное — падение.
const runMain = (sevenZip, args, err) => {
  try {
    const result = sevenZip.callMain(args);
    return exited(Number.isInteger(result) ? result : 0);
  } catch (thrown) {
    if (Number.isInteger(thrown?.status)) return exited(thrown.status);
    err.push(String(thrown?.message || thrown));
    return { code: CRASH_CODE, crashed: true };
  }
};

const serve = async ({ args, mounts = {} }) => {
  const lines = { out: [], err: [] };
  const sevenZip = await SevenZip({
    print: (line) => lines.out.push(line),
    printErr: (line) => lines.err.push(line),
  });
  mountAll(sevenZip, mounts);
  const { code, crashed } = runMain(sevenZip, args, lines.err);
  return { code, out: lines.out, err: lines.err, crashed };
};

const hangUp = () => {
  if (process.connected) process.disconnect();
};

const send = (message) => {
  process.send(message, hangUp);
};

process.once("message", (request) => {
  serve(request).then(send, (error) => send(crashReply(error?.stack || String(error))));
});
