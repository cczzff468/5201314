import sharp from 'sharp';
const [,, src, out, x, y, w, h] = process.argv;
await sharp(src).extract({ left: +x, top: +y, width: +w, height: +h }).resize(+w * 3, +h * 3, { kernel: 'nearest' }).png().toFile(out);
console.log('crop ok');
