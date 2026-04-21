import { createApp } from "./app.js";

const PORT = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(PORT, () => {
  console.log(`local proxy listening on http://127.0.0.1:${PORT}`);
});
