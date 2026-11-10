import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const PORT = Number(process.env.PORT) || 8787;

const app = createApp({ distDir });

const server = app.listen(PORT, () => {
  console.log(`[craftscope] API listening on http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export { app };
