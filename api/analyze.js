import { createApp } from "../server/app.js";

// Vercel reuses a warm function instance, so the Express app and the shared
// Chromium process stay initialized between scans.
const app = createApp();

export default function handler(request, response) {
  return app(request, response);
}
