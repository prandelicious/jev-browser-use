import http from 'node:http';

function probabilities(choice, keys) {
  const rest = keys.filter((key) => key !== choice);
  const leftover = rest.length ? (1 - 0.94) / rest.length : 0;
  return Object.fromEntries(keys.map((key) => [key, key === choice ? 0.94 : leftover]));
}

export function startJevMock({ scenarioId, script }) {
  const calls = [];
  let unexpected = null;
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
      res.writeHead(400);
      res.end('invalid json');
      return;
    }
    const criteria = body?.questions?.next?.criteria ?? {};
    const keys = Object.keys(criteria);
    const browser = body?.state?.browser ?? '';
    const step = calls.length;
    const match = script.find((row) => row.step === step);
    const observation = { step, browser, keys, goal: body?.state?.goal };
    if (!match) {
      unexpected = { ...observation, reason: 'unexpected Jev call' };
      res.writeHead(409);
      res.end('unexpected');
      return;
    }
    if (match.includes && !browser.includes(match.includes)) {
      unexpected = { ...observation, reason: 'unexpected observation', expected: match.includes };
      res.writeHead(409);
      res.end('unexpected observation');
      return;
    }
    if (match.excludes && browser.includes(match.excludes)) {
      unexpected = { ...observation, reason: 'unexpected element set', excluded: match.excludes };
      res.writeHead(409);
      res.end('unexpected element set');
      return;
    }
    if (!keys.includes(match.choice)) {
      unexpected = { ...observation, reason: 'choice not offered', choice: match.choice };
      res.writeHead(409);
      res.end('choice not offered');
      return;
    }
    calls.push(observation);
    const payload = {
      model: 'jev-latest',
      answers: {
        next: {
          type: 'choice',
          choice: match.choice,
          confidence: 0.99,
          probabilities: probabilities(match.choice, keys),
        },
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/`,
        scenarioId,
        calls,
        get unexpected() { return unexpected; },
        stop: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
    server.on('error', reject);
  });
}
