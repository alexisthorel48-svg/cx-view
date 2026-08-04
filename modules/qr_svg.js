'use strict';
const QRCode = require('./vendor_qr');
const QRErrorCorrectLevel = require('./vendor_qr/QRErrorCorrectLevel');

function qrSvg(text, options = {}) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(String(text || ''));
  qr.make();
  const count = qr.getModuleCount();
  const margin = Math.max(0, Number(options.margin ?? 4));
  const size = count + margin * 2;
  const paths = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) paths.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="100%" height="100%" fill="#fff"/><path d="${paths.join('')}" fill="#000"/></svg>`;
}

function qrDataUri(text, options) {
  return `data:image/svg+xml;base64,${Buffer.from(qrSvg(text, options), 'utf8').toString('base64')}`;
}

module.exports = { qrSvg, qrDataUri };
