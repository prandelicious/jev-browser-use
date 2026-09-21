export function createFixtureTab({ origin, page, sequence, staleAfterReads = 0 }) {
  const clicks = [];
  const scrolls = [];
  let version = 0;
  let axSeq = 0;

  function snapshot() {
    const url = `${origin}/${page}`;
    const body = sequence[Math.min(version, sequence.length - 1)];
    return `Browser tab: Fixture URL: "${url}".\n${body}`;
  }

  return {
    clicks,
    scrolls,
    get version() { return version; },
    async getAXState() {
      axSeq += 1;
      if (staleAfterReads && axSeq > staleAfterReads) {
        version = Math.min(version + 1, sequence.length - 1);
      }
      return snapshot();
    },
    async click(index) {
      clicks.push({ index, version });
      version = Math.min(version + 1, sequence.length - 1);
    },
    async scroll() {
      scrolls.push({ version });
      version = Math.min(version + 1, sequence.length - 1);
    },
    async pressKey(key) {
      if (key === 'PageDown' || key === 'PageUp') {
        this.scrolls.push({ version, key });
        version = Math.min(version + 1, sequence.length - 1);
      }
    },
    async reload() {},
    mutate() {
      version = Math.min(version + 1, sequence.length - 1);
    },
    get axReads() { return axSeq; },
  };
}
