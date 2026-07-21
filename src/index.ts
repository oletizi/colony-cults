import { runCli } from '@/cli/dispatch';

runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`bib: ${message}`);
    process.exitCode = 1;
  });
