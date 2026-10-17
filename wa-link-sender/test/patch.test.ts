import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);
const { patchSource, MARKER } = require_('../scripts/patch-whatsapp-web.cjs') as { patchSource: (s: string) => string | null; MARKER: string };

describe('whatsapp-web.js media-send patch', () => {
  it('is applied to the installed library (image sends fail without it)', () => {
    const file = path.join(path.dirname(require_.resolve('whatsapp-web.js/package.json')), 'src', 'util', 'Injected', 'Utils.js');
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain('delete message.__x_id');
    // Exactly once, right after the outgoing message object.
    expect(src.split('delete message.__x_id').length).toBe(2);
    expect(src).toMatch(/\.\.\.extraOptions,\n\s*\};\n\s*\/\/ wa-link-sender patch[^\n]*\n\s*delete message\.__x_id;/);
  });

  it('patches the 1.34.7 shape, is idempotent, and refuses unknown code', () => {
    const sample = "x\n        const message = {\n            ...options,\n            ...mediaOptions,\n            ...extraOptions,\n        };\n        next();\n";
    const once = patchSource(sample)!;
    expect(once).toContain(MARKER);
    expect(once).toContain('        delete message.__x_id;\n        next();');
    expect(patchSource(once)).toBe(once);
    expect(patchSource('something else entirely')).toBeNull();
  });
});
