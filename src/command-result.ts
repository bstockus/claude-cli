export class CommandExit extends Error {
  constructor(readonly exitCode: 1 | 2) {
    super(`Command exited with status ${exitCode}`);
    this.name = "CommandExit";
  }
}

/** Stop an action without terminating the process; the CLI boundary assigns the exit code. */
export function terminate(exitCode: 1 | 2): never {
  throw new CommandExit(exitCode);
}
