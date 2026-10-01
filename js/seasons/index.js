// Season registry. Adding a season = one config file + one environment module, then list it here.
export const SEASONS = {
  spring: () => import('./spring.js').then((m) => m.default),
  // summer: () => import('./summer.js').then((m) => m.default),   // chanterelles, black trumpets
  // fall: () => import('./fall.js').then((m) => m.default),       // maitake
};
export const DEFAULT_SEASON = 'spring';
