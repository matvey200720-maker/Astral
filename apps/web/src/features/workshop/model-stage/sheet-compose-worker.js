import { composeSheetPixels } from "./sheet-compose.js";

const describeFailure = (failure) => String(failure?.message || failure);

// Ответ собирается целиком до отправки: аргументы postMessage лежат в списке,
// у ошибки он из одного элемента, и списка переноса нет.
function buildReply(id, jobs) {
  try {
    const out = jobs.map(composeSheetPixels);
    return [{ id, out }, out.map((sheet) => sheet.rgba.buffer)];
  } catch (failure) {
    return [{ id, error: describeFailure(failure) }];
  }
}

self.onmessage = ({ data }) => {
  const { id, jobs } = data || {};
  self.postMessage(...buildReply(id, jobs));
};
