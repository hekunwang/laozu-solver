'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const SERVICE = 'laozu-local-talent-ocr-v1';
function buildInfo(root = __dirname) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  const hash = crypto.createHash('sha256');
  for (const file of ['index.html', 'app.js', 'serve.cjs', 'recognition-service.cjs', 'local-build.cjs', 'talent-ocr.swift', 'talent-ocr-match.cjs', '.local-bin/talent-ocr', 'data/game-catalog.json', 'data/Ability.json', 'data/manifest.json']) {
    hash.update(file); hash.update(fs.existsSync(path.join(root,file)) ? fs.readFileSync(path.join(root,file)) : 'missing');
  }
  return {service:SERVICE, buildId:hash.digest('hex').slice(0,20),resourceVersion:manifest.resourceVersion,
    builtForDate:manifest.builtForDate,available:fs.existsSync(path.join(root,'.local-bin/talent-ocr'))};
}
function resolvePort(value = process.env.LAOZU_PORT) {
  const port = value === undefined || value === '' ? 18765 : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('LAOZU_PORT 必须为 1024–65535 的整数');
  return port;
}
module.exports = {SERVICE, buildInfo, resolvePort};
