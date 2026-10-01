// Spring season: pure data. A new season (summer chanterelles, fall maitake...) is another
// file like this one plus an environment module; the core never hardcodes spring.

export default {
  id: 'spring',
  title: 'Spring - Morel Season',
  location: 'Michigan hardwoods',
  startDate: { month: 'April', day: 22 },
  days: 10,
  dayLengthSec: 85,
  dayStartHour: 7,
  dayEndHour: 19.5,
  loadEnvironment: () => import('../world/environments/spring.js'),

  // A 10-day spring window. Jitter is seeded, so a seed replays the same weather.
  weather: {
    soilTemp: [41, 43, 45, 48, 51, 54, 56, 59, 62, 65], // F at 4 in depth
    rain: [0.0, 0.4, 0.1, 0.0, 0.35, 0.0, 0.1, 0.5, 0.0, 0.0], // inches
    soilJitter: 1.4,
    rainJitter: 0.3,
    strayRainChance: 0.1,
  },

  species: {
    morel: {
      id: 'morel', kind: 'true', label: 'True morel', latin: 'Morchella',
      // soil temp trapezoid [zero, full, full, zero]; yesterday's conditions drive today's fruiting
      flush: { temp: [43, 50, 57, 63], moistureBase: 0.25, rainFull: 0.7, lag: 1, peakNew: 34, jitter: 0.18 },
      lifespan: 3,
      sites: 360,
      habitat: { weights: { elm_dying: 3.4, ash_dying: 3.1, apple_old: 2.9, tulip_poplar: 2.3 }, background: 0.16, biasShare: 0.84, hostRadius: [1.1, 5.8] },
    },
    gyromitra: {
      id: 'gyromitra', kind: 'false', label: 'False morel', latin: 'Gyromitra',
      // cooler, earlier fruiting; overlaps the true-morel habitat
      flush: { temp: [36, 42, 50, 58], moistureBase: 0.3, rainFull: 0.7, lag: 1, peakNew: 16, jitter: 0.2 },
      lifespan: 3,
      sites: 170,
      habitat: { weights: { elm_dying: 1.7, ash_dying: 1.6, apple_old: 0.9, tulip_poplar: 1.3 }, background: 0.55, biasShare: 0.62, hostRadius: [1.2, 6.5] },
    },
  },

  // Names shown for habitat tallies (host tree type or 'open')
  habitatLabels: {
    elm_dying: 'Dying elm / ash',
    ash_dying: 'Dying elm / ash',
    apple_old: 'Old apple tree',
    tulip_poplar: 'Tulip poplar',
    open: 'Open leaf litter',
  },
};
