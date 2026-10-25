import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { loadPng } from './zxingNode';
const require = createRequire(import.meta.url);
const bin = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
await prepareZXingModule({ overrides: { wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) }, fireImmediately: true });
for (const f of process.argv.slice(2)) {
  const img = loadPng(f); const out: string[] = [];
  for (const binarizer of ['LocalAverage', 'GlobalHistogram', 'FixedThreshold', 'BoolCast'])
    for (const tryDownscale of [true, false]) {
      const r = await readBarcodes({ data: img.data, width: img.width, height: img.height, colorSpace: 'srgb' } as ImageData, { formats: ['Code128','Code39','Code93','Codabar','ITF'], tryHarder: true, tryRotate: true, tryDownscale, binarizer, returnErrors: true } as any);
      out.push(`${binarizer[0]}${tryDownscale?'d':''}:${r.map(x => x.isValid ? x.format + '=' + x.text : 'ERR:' + x.error).join('|') || '-'}`);
    }
  console.log(f.split('/').pop().padEnd(18), out.join('  '));
}
