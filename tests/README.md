# Foundation tests

Run `npm test` from the project directory. For interactive reruns use `npm run test:watch`.

The scripts retain Vitest 5.0.5 and use a small launcher that uppercases the Windows drive letter in the working directory and Vitest entry URL before loading Vitest. On Node 26.12.0 / Windows 11, the ordinary lowercase-drive launch failed at suite registration with `Cannot read properties of undefined (reading 'config')`; an uppercase-drive launch executed the original four tests. This is evidence for a module-identity/casing problem, not a definitive diagnosis of Vitest internals. No dependency downgrade or native-runner fallback was necessary.

## Coverage

- SQLite: real sql.js WASM, small and retail datasets at variants 0 and 1, row counts, foreign-key enforcement/checks, prices, revenue, NULL/duplicate/left-join/CTE/window examples, binary export/reset, SQL guards, independent read-only protection, input limits and truncation.
- Evaluator: NULL distinctions, duplicate multiplicity, ordering, aliases/column shape, numeric tolerance and overlapping numeric candidates, truncated output.
- Storage: fake-indexeddb load/save, snapshots, queued writes, invalid imports/saves, legacy migration, corrupt stored records, JSON round trips, schema bounds, UTF-8 backup size boundaries.
- Client: mock Worker with controlled timers; response correlation, timeout termination/restart, pending-request rejection, worker errors, posting failure and disposal.

## Regression fixes

1. sql.js binary export reopens its connection and clears connection PRAGMAs. The engine now restores foreign-key and read-only settings after export.
2. Numeric tolerance is non-transitive. The comparator now uses one-to-one bipartite matching instead of greedy removal, avoiding order-dependent false negatives while preserving duplicates.

## Verification and limits

The suite contains 61 tests across four files. All passed on the environment above; the production build also passed, with a warning for a minified application chunk over 500 kB. The dependency audit reported zero vulnerabilities.

SQLite assertions execute real WASM through the existing constructor injection; the browser WASM URL/network loading path is not exercised. fake-indexeddb does not model browser quota, eviction or disk failures. Mock Worker tests verify client lifecycle, not real browser scheduling or termination of a running WASM query. No browser/UI end-to-end tests, exhaustive curriculum-answer audit, coverage percentage, or cross-platform runner validation is claimed. The application build type-checks application sources, not the test files. This verifies the foundation subtask only, not completion of the whole application.
