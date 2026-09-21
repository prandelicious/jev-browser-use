export function createProcessManager() {
  const children = [];

  function track(entry) {
    children.push({ ...entry, startTime: Date.now() });
    return entry.handle;
  }

  async function shutdown(timeoutMs = 2000) {
    const errors = [];
    for (const child of [...children].reverse()) {
      try {
        await Promise.race([
          child.stop(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`${child.purpose} shutdown timeout`)), timeoutMs)),
        ]);
      } catch (error) {
        errors.push(error);
        try { child.force?.(); } catch { /* ignore */ }
      }
    }
    children.length = 0;
    if (errors.length) throw errors[0];
  }

  return { track, shutdown, list: () => [...children] };
}
