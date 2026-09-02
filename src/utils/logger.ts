/* eslint-disable no-console */
const enabled = __DEV__;

function fmt(scope: string, msg: string) {
  return `[UnbreakableLock/${scope}] ${msg}`;
}

export const log = {
  debug(scope: string, msg: string, ...rest: unknown[]) {
    if (enabled) console.log(fmt(scope, msg), ...rest);
  },
  warn(scope: string, msg: string, ...rest: unknown[]) {
    if (enabled) console.warn(fmt(scope, msg), ...rest);
  },
  error(scope: string, msg: string, ...rest: unknown[]) {
    // Errors are logged in production too — they are rare and diagnostic.
    console.error(fmt(scope, msg), ...rest);
  },
};
