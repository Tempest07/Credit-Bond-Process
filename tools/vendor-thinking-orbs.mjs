import { copyFile, mkdir } from "node:fs/promises";
const source = new URL("../node_modules/thinking-orbs/", import.meta.url);
const destination = new URL("../vendor/thinking-orbs/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(new URL("dist/engine.es.js", source), new URL("engine.es.js", destination));
await copyFile(new URL("LICENSE", source), new URL("LICENSE", destination));
