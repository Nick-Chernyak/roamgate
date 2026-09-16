import { cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
async function run(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error(`Build failed: ${args.join(" ")}`);
}
await run([process.execPath, "run", "build:web"]);
await run([process.execPath, "scripts/gen-public.ts"]);
await run([
  process.execPath,
  "build",
  "--compile",
  "--minify",
  "--target=bun-windows-x64",
  "server/src/index.ts",
  "--outfile",
  "server/roamgate-desktop.exe",
]);
await mkdir(join(root, "desktop/dist"), { recursive: true });
for (const name of ["main", "preload"]) {
  const result = await Bun.build({
    entrypoints: [join(root, `desktop/src/${name}.ts`)],
    target: "node",
    format: "cjs",
    external: ["electron"],
    naming: `${name}.cjs`,
    outdir: join(root, "desktop/dist"),
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
}
await cp(
  join(root, "web/public/musipusi.png"),
  join(root, "desktop/assets/icon.png"),
);
