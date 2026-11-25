/**
 * Starts the backend and the frontend together and stops both when either
 * exits or you press Ctrl-C.
 *
 * (`bun run --filter '*' dev` is not used because the frontend depends on the
 * backend package for its types, and Bun would wait for the backend's dev
 * script to finish before starting the frontend.)
 */
const apps = ["backend", "frontend"];

const children = apps.map((app) =>
  Bun.spawn(["bun", "run", "dev"], {
    cwd: `${import.meta.dir}/../${app}`,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
);

const stop = (): void => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const code = await Promise.race(children.map((child) => child.exited));
stop();
process.exit(code);
