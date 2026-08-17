import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
fs.mkdirSync('public/icon', { recursive: true });
const svg = fs.readFileSync('assets/ubicon-icon.svg', 'utf8');
for (const size of [16, 32, 48, 96, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(`public/icon/${size}.png`, png);
}
console.log('icons built');
