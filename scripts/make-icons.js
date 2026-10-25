// 生成扩展图标：蓝底圆角方块 + 白色简历页 + 蓝色文字线条
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // alpha blend over existing
    const A = a / 255;
    px[i] = px[i] * (1 - A) + r * A;
    px[i + 1] = px[i + 1] * (1 - A) + g * A;
    px[i + 2] = px[i + 2] * (1 - A) + b * A;
    px[i + 3] = Math.min(255, px[i + 3] + a);
  };
  const inRoundRect = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
    const corners = [[x0 + rad, y0 + rad], [x1 - rad, y0 + rad], [x0 + rad, y1 - rad], [x1 - rad, y1 - rad]];
    const inCornerZone =
      (x < x0 + rad && y < y0 + rad) ? corners[0] :
      (x > x1 - rad && y < y0 + rad) ? corners[1] :
      (x < x0 + rad && y > y1 - rad) ? corners[2] :
      (x > x1 - rad && y > y1 - rad) ? corners[3] : null;
    if (!inCornerZone) return 1;
    const dx = x - inCornerZone[0], dy = y - inCornerZone[1];
    return dx * dx + dy * dy <= rad * rad ? 1 : 0;
  };
  const u = size / 128; // 以128为基准缩放
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 背景：圆角方块，深蓝渐变
      if (inRoundRect(x, y, 0, 0, size - 1, size - 1, 24 * u)) {
        const t = y / size;
        set(x, y, Math.round(30 + t * 10), Math.round(90 + t * 30), Math.round(220 - t * 30), 255);
      }
      // 白色简历页
      const px0 = 34 * u, py0 = 22 * u, px1 = 94 * u, py1 = 106 * u;
      if (inRoundRect(x, y, px0, py0, px1, py1, 6 * u)) {
        set(x, y, 255, 255, 255, 255);
        // 头像圆点
        const cx = 48 * u, cy = 38 * u, rr = 7 * u;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rr * rr) set(x, y, 37, 99, 235, 255);
        // 文字线条
        const lines = [[58, 34, 86, 38], [58, 41, 80, 45], [40, 54, 88, 58], [40, 63, 88, 67], [40, 72, 88, 76], [40, 81, 72, 85], [40, 90, 88, 94]];
        for (const [lx0, ly0, lx1, ly1] of lines) {
          if (x >= lx0 * u && x <= lx1 * u && y >= ly0 * u && y <= ly1 * u) set(x, y, 147, 178, 244, 255);
        }
        // 底部对勾（速填寓意）：绿色
        for (let tstep = 0; tstep <= 100; tstep++) {
          const t = tstep / 100;
          let gx, gy;
          if (t < 0.4) { gx = (50 + t / 0.4 * 12) * u; gy = (95 + t / 0.4 * 8) * u; }
          else { gx = (62 + (t - 0.4) / 0.6 * 24) * u; gy = (103 - (t - 0.4) / 0.6 * 18) * u; }
          if (Math.abs(x - gx) < 3.2 * u && Math.abs(y - gy) < 3.2 * u) set(x, y, 34, 197, 94, 255);
        }
      }
    }
  }
  return px;
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), encodePNG(size, draw(size)));
  console.log('icon' + size + '.png done');
}
