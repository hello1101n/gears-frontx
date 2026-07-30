/**
 * HAI3 Dependency Cruiser Gear Configuration
 * Rules for capability packages that ship both an L1-pure core and an L2 framework adapter.
 *
 * The boundary is a path, not a package:
 * - packages/<gear>/src, excluding src/plugin -> ZERO @gears-frontx dependencies, no React
 * - packages/<gear>/src/plugin -> may import @gears-frontx/framework only, still no React
 */

const base = require('./base.cjs');

module.exports = {
  forbidden: [
    ...base.forbidden,

    {
      name: 'gear-core-no-hai3-imports',
      severity: 'error',
      from: { path: '^packages/telemetry/src/(?!plugin/)' },
      to: { path: '(^packages/(state|screensets|api|i18n|framework|react)/|node_modules/@gears-frontx/)' },
      comment: 'GEAR VIOLATION: the gear core must have ZERO @gears-frontx dependencies. Only src/plugin may reach the framework.',
    },
    {
      name: 'gear-no-react',
      severity: 'error',
      from: { path: '^packages/telemetry/src/' },
      to: { path: 'node_modules/react' },
      comment: 'GEAR VIOLATION: gears are framework-agnostic. Neither the core nor the plugin adapter can import React.',
    },
    {
      name: 'gear-plugin-no-react-package',
      severity: 'error',
      from: { path: '^packages/telemetry/src/plugin/' },
      to: { path: '(^packages/react/|node_modules/@gears-frontx/react)' },
      comment: 'GEAR VIOLATION: the plugin adapter is headless. It cannot import @gears-frontx/react.',
    },
  ],
  options: base.options,
};
