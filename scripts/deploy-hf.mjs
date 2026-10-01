// Mirror the game to the Hugging Face Static Space. GitHub stays the source of truth.
// Usage: npm run deploy:hf            (stage, commit on top of the Space's main, push)
//        npm run deploy:hf -- --dry   (stage only, print the staging folder)
// Auth: uses git's normal credential flow for the "hf" remote. No token is read or stored here.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const GITHUB = 'https://github.com/ncypher/chasing.the.flush';
const PAGES = 'https://ncypher.github.io/chasing.the.flush/';
const DIRECT = 'https://strange-loop-chasing-the-flush.static.hf.space/';
const RUNTIME = ['index.html', 'css', 'js']; // everything the game needs; nothing else ships

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();

const spaceReadme = `---
title: Chasing the Flush
emoji: 🍄
colorFrom: green
colorTo: yellow
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Hunt spring morels in 3D. Beware the false morels.
---

# Chasing the Flush

A 3D mushroom-foraging game that runs in the browser. Walk a Michigan hardwood woodland during ten days of spring morel season, watch soil temperature and rain, inspect mushrooms up close, cut them in half, and decide what goes in the basket. A false morel in the basket costs you a day.

**[Open it full screen](${DIRECT})** for the biggest view. It also plays fine embedded on this page, with mouse look.

- Source and full README: ${GITHUB}
- Also hosted on GitHub Pages: ${PAGES}

This Space is an automatic mirror of the GitHub repo. Do not edit it here.
`;

function main() {
  const hfUrl = git(root, 'remote', 'get-url', 'hf');
  const sha = git(root, 'rev-parse', '--short', 'HEAD');
  const stage = path.join(os.tmpdir(), 'ctf-hf-stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  // Keep the Space's history: fetch its main into the staging repo and commit on top.
  git(stage, 'init', '-q', '-b', 'main');
  git(stage, 'remote', 'add', 'hf', hfUrl);
  let hasHead = true;
  try { git(stage, 'fetch', '-q', 'hf', 'main'); git(stage, 'checkout', '-q', '-B', 'main', 'FETCH_HEAD'); } catch { hasHead = false; }

  // Replace the working tree (keep .git and the Space's .gitattributes).
  for (const name of fs.readdirSync(stage)) {
    if (name === '.git' || name === '.gitattributes') continue;
    fs.rmSync(path.join(stage, name), { recursive: true, force: true });
  }
  for (const item of RUNTIME) {
    const src = path.join(root, item);
    if (!fs.existsSync(src)) throw new Error(`missing runtime path: ${item}`);
    fs.cpSync(src, path.join(stage, item), { recursive: true });
  }
  fs.writeFileSync(path.join(stage, 'README.md'), spaceReadme, 'utf8');

  const files = git(stage, 'ls-files', '--others', '--exclude-standard', '--cached').split('\n').length;
  console.log(`staged ${files} files in ${stage}`);
  if (DRY) { console.log('dry run: nothing committed or pushed'); return; }

  for (const key of ['user.name', 'user.email']) {
    let v = ''; try { v = git(root, 'config', key); } catch { /* unset */ }
    if (v) git(stage, 'config', key, v);
  }
  git(stage, 'add', '-A');
  if (hasHead && git(stage, 'status', '--porcelain') === '') { console.log('Space already up to date.'); return; }
  git(stage, 'commit', '-q', '-m', `Mirror GitHub ${sha}`);
  try {
    console.log(git(stage, 'push', 'hf', 'main') || 'pushed');
  } catch (e) {
    const msg = String(e.stderr || e.message);
    console.error(msg);
    if (/auth|403|401|denied|could not read|Username/i.test(msg)) {
      console.error('\nAuth failed for the hf remote. Wire git to your hf login once, then rerun:\n  hf auth login --add-to-git-credential');
    }
    process.exit(1);
  }
  console.log(`Mirrored ${sha} to ${hfUrl}`);
  console.log(`Play: ${DIRECT}`);
}

main();
