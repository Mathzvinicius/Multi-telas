import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';

const buildDir = path.join(process.cwd(), 'build');
const pngs = [path.join(buildDir, 'icon-256x256.png')];
const ico = await pngToIco(pngs);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
console.log('ICO: ' + ico.length + ' bytes');
