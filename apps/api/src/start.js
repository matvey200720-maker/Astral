import { startServer } from "./server.js";

export const { server, serverReady } = startServer();

serverReady.then((activeServer) => {
  const address = activeServer.address();
  const port =
    typeof address === "object" && address ? address.port : "unknown";
  console.log(`Astral API: http://127.0.0.1:${port}`);
});
