#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const extensionRoot = path.resolve(process.argv[2] || '.');
const manifestPath = path.join(extensionRoot, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`❌ Missing manifest.json in ${extensionRoot}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`❌ Invalid manifest.json: ${error.message}`);
  process.exit(1);
}

const resources = [];

function addResource(value, field) {
  if (typeof value === 'string' && value.length > 0) {
    resources.push({ value: value.replace(/^\/+/, ''), field });
  }
}

addResource(manifest.background?.service_worker, 'background.service_worker');
addResource(manifest.action?.default_popup, 'action.default_popup');
addResource(manifest.side_panel?.default_path, 'side_panel.default_path');
addResource(manifest.options_page, 'options_page');
addResource(manifest.options_ui?.page, 'options_ui.page');
addResource(manifest.devtools_page, 'devtools_page');

for (const [size, value] of Object.entries(manifest.icons || {})) {
  addResource(value, `icons.${size}`);
}
for (const [size, value] of Object.entries(manifest.action?.default_icon || {})) {
  addResource(value, `action.default_icon.${size}`);
}
for (const [name, value] of Object.entries(manifest.chrome_url_overrides || {})) {
  addResource(value, `chrome_url_overrides.${name}`);
}
for (const [index, contentScript] of (manifest.content_scripts || []).entries()) {
  for (const [scriptIndex, value] of (contentScript.js || []).entries()) {
    addResource(value, `content_scripts[${index}].js[${scriptIndex}]`);
  }
  for (const [styleIndex, value] of (contentScript.css || []).entries()) {
    addResource(value, `content_scripts[${index}].css[${styleIndex}]`);
  }
}
for (const [index, resourceGroup] of (manifest.web_accessible_resources || []).entries()) {
  for (const [resourceIndex, value] of (resourceGroup.resources || []).entries()) {
    addResource(value, `web_accessible_resources[${index}].resources[${resourceIndex}]`);
  }
}
for (const [index, value] of (manifest.sandbox?.pages || []).entries()) {
  addResource(value, `sandbox.pages[${index}]`);
}

function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

const packagedFiles = listFiles(extensionRoot);
const missing = [];
const unsafe = [];

for (const resource of resources) {
  if (resource.value.split('/').includes('..')) {
    unsafe.push(resource);
    continue;
  }

  const exists = resource.value.includes('*') || resource.value.includes('?')
    ? packagedFiles.some(file => globToRegExp(resource.value).test(file))
    : fs.existsSync(path.join(extensionRoot, resource.value))
      && fs.statSync(path.join(extensionRoot, resource.value)).isFile();

  if (!exists) missing.push(resource);
}

for (const resource of unsafe) {
  console.error(`❌ Unsafe manifest resource path: ${resource.value} (${resource.field})`);
}
for (const resource of missing) {
  console.error(`❌ Missing manifest resource: ${resource.value} (${resource.field})`);
}

if (unsafe.length > 0 || missing.length > 0) {
  process.exit(1);
}

console.log(`✅ Validated ${resources.length} manifest resources in ${extensionRoot}`);
