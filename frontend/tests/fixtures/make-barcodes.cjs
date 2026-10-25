// Generates raw synthetic barcode PNGs (fictional identifiers only) with bwip-js.
// Usage: node make-barcodes.cjs <outDir>
const bwipjs = require('bwip-js');
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'raw');
fs.mkdirSync(out, { recursive: true });
const specs = [
  ['code128-24CS104', 'code128', '24CS104'],
  ['code128-0012345', 'code128', '0012345'],
  ['code39-24CS104', 'code39', '24CS104'],
  ['qr-24CS104', 'qrcode', '24CS104'],
  ['pdf417-24CS104', 'pdf417', '24CS104'],
  ['code128-UNKNOWN99', 'code128', '99ZZ999'],
  ['code128-lower-24cs104', 'code128', '24cs104'],
  ['code128-bad-chars', 'code128', '24CS104;DROP'],
  ['aztec-24CS104', 'azteccode', '24CS104'],
  // MaxiCode: a symbology the scanner deliberately does not enable (unsupported-format test).
  ['maxicode-24CS104', 'maxicode', '24CS104'],
];
(async () => {
  for (const [name, bcid, text] of specs) {
    const twoD = ['qrcode', 'pdf417', 'azteccode', 'maxicode'].includes(bcid);
    const opts = { bcid, text, scale: 3, includetext: false, paddingwidth: 6, paddingheight: 4, backgroundcolor: 'FFFFFF' };
    if (!twoD) opts.height = 12;
    const png = await bwipjs.toBuffer(opts);
    fs.writeFileSync(path.join(out, name + '.png'), png);
  }
  console.log('wrote', specs.length, 'barcodes to', out);
})();
