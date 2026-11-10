import { createApp } from "../server/app.js";

const app = createApp();

export default function handler(request, response) {
  return app(request, response);
}
