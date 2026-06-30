import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suites boot an in-memory MongoDB replica set in beforeAll;
    // first run downloads the mongod binary, so allow a generous hook timeout.
    hookTimeout: 120000,
    testTimeout: 30000,
    // Each integration FILE spins up its own in-memory MongoDB (a real mongod process).
    // Running all files at full parallelism launches many mongods at once and overwhelms
    // the machine, tripping mongod's 10s startup timeout. Cap concurrency so only a couple
    // start at a time — slower, but reliable on any machine.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      include: ['server.js', 'lib/**/*.js'],
      exclude: ['lib/**/*.test.js', 'test/**'],
    },
  },
});
