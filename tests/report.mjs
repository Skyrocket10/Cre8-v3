/** Shared pass/fail reporting, so every suite reads the same way. */

export function createReport() {
  let failed = 0;
  let total = 0;

  return {
    check(name, ok, detail = '') {
      total++;
      if (!ok) failed++;
      console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
      return ok;
    },
    group(title) {
      console.log(`\n${title}`);
    },
    /** Exits non-zero when anything failed, so CI and `&&` chains work. */
    finish() {
      console.log(`\n${total - failed}/${total} checks passed`);
      process.exit(failed ? 1 : 0);
    },
    get failed() {
      return failed;
    },
  };
}
