/**
 * Install-time patch for whatsapp-web.js 1.34.7 (runs on `npm install` / `npm ci` via "postinstall").
 *
 * Bug: since WhatsApp Web builds of mid-September 2026, sending any media fails with
 *   "Data passed to getter must include an id property (it's how we memoize) but got undefined".
 * whatsapp-web.js spreads the media model (which has a private `__x_id`) into the outgoing
 * message, and that field breaks the message's own id. Text messages are not affected.
 *
 * Fix: the same one line as upstream PR wwebjs/whatsapp-web.js#201923 (`delete message.__x_id`).
 * Remove this script once a whatsapp-web.js release includes the fix.
 */
const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'wa-link-sender patch: upstream PR #201923';
const PATCHED_VERSION = '1.34.7';
// The end of the outgoing-message object literal in WWebJS.sendMessage.
const ANCHOR = /(\n([ \t]*)const message = \{[\s\S]*?\n[ \t]*\.\.\.extraOptions,\n[ \t]*\};\n)/;

/** Returns the patched source, the same source if already fixed, or null when the code isn't recognised. */
function patchSource(src) {
  if (src.includes(MARKER) || src.includes('delete message.__x_id')) return src;
  const m = src.match(ANCHOR);
  if (!m) return null;
  const indent = m[2];
  return src.replace(ANCHOR, `$1${indent}// ${MARKER}: the media model's private __x_id must not override the message id.\n${indent}delete message.__x_id;\n`);
}

function main() {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('whatsapp-web.js/package.json', { paths: [process.cwd(), __dirname] }));
  } catch {
    console.log('[patch-whatsapp-web] whatsapp-web.js not installed; nothing to patch.');
    return;
  }
  const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  const file = path.join(pkgDir, 'src', 'util', 'Injected', 'Utils.js');
  const src = fs.readFileSync(file, 'utf8');
  const patched = patchSource(src);

  if (patched === null) {
    const msg = `[patch-whatsapp-web] could not find the code to patch in whatsapp-web.js ${version}.`;
    if (version === PATCHED_VERSION) {
      console.error(`${msg} Image sends will fail. Check scripts/patch-whatsapp-web.cjs.`);
      process.exit(1);
    }
    console.warn(`${msg} This version may already include the fix; test sending an image.`);
    return;
  }
  if (patched === src) {
    console.log(`[patch-whatsapp-web] whatsapp-web.js ${version} already has the media fix.`);
    return;
  }
  fs.writeFileSync(file, patched);
  console.log(`[patch-whatsapp-web] patched whatsapp-web.js ${version} (media send fix).`);
}

module.exports = { patchSource, MARKER };
if (require.main === module) main();
