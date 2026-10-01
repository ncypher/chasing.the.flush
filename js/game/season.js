import { clamp } from '../core/util.js';

// Season/flush logic. Entirely data-driven from a season config.

const trapezoid = (x, [a, b, c, d]) => (x <= a ? 0 : x < b ? (x - a) / (b - a) : x <= c ? 1 : x < d ? (d - x) / (d - c) : 0);

export class Season {
  constructor(config, rng) {
    this.cfg = config;
    this.days = config.days;
    const w = config.weather;
    this.weather = [];
    const wr = rng.fork('weather');
    for (let d = 0; d < this.days; d++) {
      const soil = w.soilTemp[d] + wr.gauss() * w.soilJitter;
      let rain = w.rain[d];
      rain = rain > 0 ? Math.max(0.05, rain * (1 + wr.range(-w.rainJitter, w.rainJitter))) : (wr.chance(w.strayRainChance) ? wr.range(0.05, 0.2) : 0);
      const sky = rain >= 0.3 ? 'rain' : rain >= 0.08 ? 'cloudy' : (wr.chance(0.15) ? 'cloudy' : 'sunny');
      this.weather.push({ day: d, soil: Math.round(soil * 10) / 10, rain: Math.round(rain * 100) / 100, sky });
    }
    this.counters = {};
  }

  date(d) {
    const s = this.cfg.startDate;
    return `${s.month} ${s.day + d}`;
  }

  rain3(d) {
    let s = 0;
    for (let i = Math.max(0, d - 2); i <= d; i++) s += this.weather[i].rain;
    return Math.round(s * 100) / 100;
  }

  // 0..1 fruiting pressure for a species on a given day
  flushIndex(speciesId, d) {
    const f = this.cfg.species[speciesId].flush;
    const src = clamp(d - f.lag, 0, this.days - 1);
    const temp = trapezoid(this.weather[src].soil, f.temp);
    const rain = this.rain3(src);
    const moist = clamp(f.moistureBase + (1 - f.moistureBase) * Math.min(1, rain / f.rainFull), 0, 1);
    return temp * moist;
  }

  newCount(speciesId, d, rng) {
    const f = this.cfg.species[speciesId].flush;
    const idx = this.flushIndex(speciesId, d);
    return Math.max(0, Math.round(f.peakNew * idx * (1 + rng.range(-f.jitter, f.jitter))));
  }
}
