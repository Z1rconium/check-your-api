import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleCheckRequest, handleModelsRequest } from "./core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../../dist");

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.post("/api/models", async (req, res) => {
    const result = await handleModelsRequest(req.body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/check", async (req, res) => {
    const result = await handleCheckRequest(req.body);
    res.status(result.status).json(result.body);
  });

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(distDir));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}
