import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { appendFile, readFile, writeFile } from "node:fs/promises";

await build({
  absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
  entryPoints: ["tools/search-border-beam.jsx"],
  outfile: "vendor/search-border-beam.js",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  plugins: [{
    name: "beam-production-csp",
    setup(plugin) {
      plugin.onLoad({ filter: /border-beam[\\/]dist[\\/]index\.es\.js$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        const styleElement = 'ze("style", { children: Se })';
        if (source.split(styleElement).length !== 2) throw new Error("Review BorderBeam style integration after upgrading the dependency.");
        return {
          contents: 'import { BeamStyles } from "../../../tools/beam-styles.jsx";\n' + source.replace(styleElement, 'ze(BeamStyles, { children: Se })'),
          loader: "js",
        };
      });
    },
  }],
});

for (const name of ["border-beam", "react", "react-dom", "scheduler"]) {
  const license = await readFile(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), "utf8");
  await appendFile(new URL("../vendor/search-border-beam.js.LEGAL.txt", import.meta.url), `\n${name}\n${license}\n`);
}
const legalFile = new URL("../vendor/search-border-beam.js.LEGAL.txt", import.meta.url);
await writeFile(legalFile, (await readFile(legalFile, "utf8")).trimEnd() + "\n");
