// Habitat logic: where morels CAN fruit (sites, fixed per seed) and which of them actually
// fruit on a given day (weighted draw driven by the season's flush index).

export function buildSites(env, speciesCfg, rng) {
  const hab = speciesCfg.habitat;
  const hosts = env.hostTrees();
  const sites = [];
  const minGap = 0.9;
  const free = (x, z) => {
    for (const s of sites) {
      const dx = s.x - x, dz = s.z - z;
      if (dx * dx + dz * dz < minGap * minGap) return false;
    }
    return true;
  };

  let guard = 0;
  while (sites.length < speciesCfg.sites && guard++ < speciesCfg.sites * 30) {
    let x, z, host = 'open', tree = null, weight;
    if (rng.chance(hab.biasShare) && hosts.length) {
      tree = rng.weighted(hosts, (t) => hab.weights[t.host] ?? 0.2);
      const rr = tree.r + rng.range(hab.hostRadius[0], hab.hostRadius[1]);
      const a = rng.range(0, Math.PI * 2);
      x = tree.x + Math.cos(a) * rr;
      z = tree.z + Math.sin(a) * rr;
      host = tree.host;
      weight = (hab.weights[host] ?? 0.2) * rng.range(0.65, 1.35);
    } else {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (env.radius - 6);
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      weight = hab.background * rng.range(0.6, 1.4);
    }
    if (!env.canSpawn(x, z) || !free(x, z)) continue;
    sites.push({ id: `${speciesCfg.id}-${sites.length}`, species: speciesCfg.id, x, z, y: env.heightAt(x, z), host, weight, uses: 0, occupied: false });
  }
  return sites;
}

// Weighted sample without replacement (Efraimidis-Spirakis).
export function drawSites(sites, n, rng) {
  const keyed = [];
  for (const s of sites) {
    if (s.occupied) continue;
    const w = s.weight * (s.uses ? 0.35 : 1);
    keyed.push([Math.pow(rng.next(), 1 / Math.max(w, 1e-6)), s]);
  }
  keyed.sort((a, b) => b[0] - a[0]);
  return keyed.slice(0, n).map((k) => k[1]);
}
