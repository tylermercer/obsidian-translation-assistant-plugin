#!/usr/bin/env bun

// Bun allows direct JSON imports, but since we are modifying files, 
// using Bun.file() is safer for read/write operations.

const targetVersion = Bun.env.npm_package_version;

if (!targetVersion) {
  console.error("npm_package_version is not set.");
  process.exit(1);
}

// 1. Update manifest.json
const manifestFile = Bun.file("manifest.json");
const manifest = await manifestFile.json();

manifest.version = targetVersion;
const { minAppVersion } = manifest;

await Bun.write("manifest.json", JSON.stringify(manifest, null, "\t")+'\n');

// 2. Update versions.json
const versionsFile = Bun.file("versions.json");
const versions = await versionsFile.json();

if (!Object.values(versions).includes(minAppVersion)) {
  versions[targetVersion] = minAppVersion;
  await Bun.write("versions.json", JSON.stringify(versions, null, "\t")+'\n');
  console.log(`Updated versions.json to ${targetVersion}`);
} else {
  console.log("Version already exists in versions.json. Skipping write.");
}