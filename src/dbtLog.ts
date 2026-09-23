/**
 * The one sink for lines about dbt invocations — wired to the "dbt booster"
 * output channel in `activate()`. It lives in its own module rather than in
 * `dbtProcess.ts` so that `dbtTerminal.ts` can log too without the two forming
 * an import cycle (`dbtProcess` already reads `dbtCommand()` from it).
 */

type Log = (message: string) => void;

let sink: Log = () => {
  /* discarded until activate() wires up the output channel */
};

/** Point every dbt invocation's log line at the extension's output channel. */
export function setDbtLog(log: Log): void {
  sink = log;
}

/** Write one line to the output channel, if one has been wired up. */
export function dbtLog(message: string): void {
  sink(message);
}
