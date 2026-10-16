'use strict';
const { parentPort, workerData } = require('worker_threads');
const { runGames } = require('./runner');

const { specs, gameIndices, seed, config } = workerData;
try {
  const results = runGames(specs, gameIndices, seed, config, null);
  parentPort.postMessage({ ok: true, results });
} catch (e) {
  parentPort.postMessage({ ok: false, error: (e && e.stack) || String(e) });
}
