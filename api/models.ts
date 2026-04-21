import { handleModelsRequest } from "../server/core.js";

type VercelRequestLike = {
  method?: string;
  body?: unknown;
};

type VercelResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponseLike;
  json(payload: unknown): void;
};

export default async function handler(req: VercelRequestLike, res: VercelResponseLike) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "只支持 POST 请求。" });
    return;
  }

  const result = await handleModelsRequest(req.body);
  res.status(result.status).json(result.body);
}
