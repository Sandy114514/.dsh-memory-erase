#!/usr/bin/env node
/**
 * Write the memory-erase marker to any mounted storage medium (cross-platform).
 *
 *   node tools/make-usb-key.mjs                     # scan mounted volumes, list marked ones
 *   node tools/make-usb-key.mjs --drive E:          # write to a Windows drive letter
 *   node tools/make-usb-key.mjs --drive /Volumes/X  # write to a POSIX mount path
 *   node tools/make-usb-key.mjs --drive E: --force
 *   node tools/make-usb-key.mjs --drive E: --dry-run
 *
 * The plugin does not care about the drive letter, label, or serial number:
 * the marker file existing at the root of any mounted volume is the whole
 * trigger condition. This script only decides where to put that file.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, exit, platform } from 'node:process';

const MARKER = '.dsh-memory-erase.key';
const PLUGIN = 'memory-erase';
const WINDOWS_ROOTS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`);
const POSIX_MOUNT_ROOTS = ['/Volumes', '/media', '/run/media', '/mnt'];

function parseArgs(args) {
  const options = { drive: undefined, force: false, dryRun: false, list: false, id: 'plastic-memories', label: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--force' || arg === '-f') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--drive' || arg === '-d') options.drive = args[++index];
    else if (arg.startsWith('--drive=')) options.drive = arg.slice('--drive='.length);
    else if (arg === '--id') options.id = args[++index];
    else if (arg.startsWith('--id=')) options.id = arg.slice('--id='.length);
    else if (arg === '--label') options.label = args[++index];
    else if (arg.startsWith('--label=')) options.label = arg.slice('--label='.length);
    else if (arg === '--list') options.list = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

/** Every directory that could be a mounted volume root. */
function mountRoots() {
  if (platform === 'win32') return WINDOWS_ROOTS;
  const roots = [];
  for (const base of POSIX_MOUNT_ROOTS) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isSymbolicLink()) roots.push(join(base, entry.name));
      }
    } catch {
      // Unreadable mount base: skip it.
    }
  }
  return roots;
}

function markedVolumes() {
  return mountRoots().filter((root) => existsSync(join(root, MARKER)));
}

function resolveTarget(options) {
  if (options.drive !== undefined) {
    const raw = options.drive.trim();
    if (platform === 'win32') {
      const normalized = raw.replace(/[\\/]+$/, '').toUpperCase();
      if (!/^[A-Za-z]:$/.test(normalized)) throw new Error(`invalid Windows drive letter: ${options.drive} (example: E:)`);
      return { root: `${normalized}\\`, id: normalized };
    }
    const root = resolve(raw);
    return { root, id: root };
  }
  const marked = markedVolumes();
  if (marked.length === 1) {
    return { root: marked[0], id: marked[0] };
  }
  if (marked.length > 1) {
    throw new Error(`more than one volume already carries the marker; choose one with --drive:\n${marked.map((entry) => `  ${entry}`).join('\n')}`);
  }
  throw new Error('no volume carries the marker yet; pass --drive to choose where to write it (for example --drive E:)');
}

function main() {
  let options;
  try {
    options = parseArgs(argv.slice(2));
  } catch (error) {
    console.error(error.message);
    exit(2);
  }
  if (options.help) {
    console.log('Usage: node tools/make-usb-key.mjs [--drive E: | --drive /Volumes/USB] [--force] [--dry-run] [--list] [--id NAME] [--label TEXT]');
    return;
  }
  const marked = markedVolumes();
  if (options.list || options.drive === undefined) {
    if (marked.length === 0) console.log('no mounted volume currently carries the marker');
    else {
      console.log('volumes the plugin will recognize:');
      for (const root of marked) console.log(`  ${root}`);
    }
    if (options.list || options.drive === undefined) {
      console.log('\nchoose a target with --drive (for example --drive E:).');
      return;
    }
  }
  const target = resolveTarget(options);
  const markerPath = join(target.root, MARKER);
  const marker = {
    plugin: PLUGIN,
    id: options.id,
    label: options.label ?? 'MEMORY ERASE MEDIUM',
    volumeLabel: options.label ?? null,
    createdAt: new Date().toISOString(),
  };
  const json = `${JSON.stringify(marker, null, 2)}\n`;
  console.log(`target : ${markerPath}`);
  if (options.dryRun) {
    console.log('\n--- marker (dry run, nothing written) ---');
    process.stdout.write(json);
    return;
  }
  if (existsSync(markerPath) && !options.force) {
    console.error(`marker already exists: ${markerPath}\nre-run with --force to overwrite it`);
    exit(1);
  }
  writeFileSync(markerPath, json, { encoding: 'utf8' });
  console.log('\nmarker written (UTF-8, no BOM). Plug this medium in, open DSH Web, and confirm the prompt.');
}

main();
