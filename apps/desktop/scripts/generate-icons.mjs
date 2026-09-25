// Regenerates every app icon in build/ from the "Bound Spine" mark: a green
// cover, a darker binding edge and three ivory page rules.
//
//   node scripts/generate-icons.mjs
//
// Chromium (via Playwright) rasterises each frame from SVG at its true pixel
// size, so the small frames get their own hinted geometry instead of a
// downscaled master. The ICO and ICNS containers are packed here by hand;
// both just wrap PNG frames.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build");

const COVER = "#157A5B";
const BINDING = "#0D4C38"; // cover at 62% luminance
const RULE = "#FAF9F5";

// The mark on a 100-unit square. At 32 px and below the third rule is
// dropped and the other two thicken so they never smear together; 16 px
// also tightens the corner radius.
function mark(size) {
  let corner = 21.5;
  let spine = 30;
  let rules;
  if (size <= 16) {
    corner = 18;
    spine = 31;
    rules = [{ x: 45, y: 30, w: 42, h: 12 }, { x: 45, y: 58, w: 42, h: 12 }];
  } else if (size <= 24) {
    rules = [{ x: 44, y: 28, w: 40, h: 10 }, { x: 44, y: 62, w: 40, h: 10 }];
  } else if (size <= 32) {
    rules = [{ x: 44, y: 28, w: 40, h: 9 }, { x: 44, y: 63, w: 40, h: 9 }];
  } else {
    rules = [
      { x: 44, y: 26, w: 40, h: 8 },
      { x: 44, y: 46, w: 40, h: 8 },
      { x: 44, y: 66, w: 25, h: 8 },
    ];
  }
  // Large frames keep the 1000/1024 optical footprint; small ones go
  // full-bleed so the edges land on whole pixels.
  const pad = size >= 128 ? 1.2 : 0;
  const view = `${-pad} ${-pad} ${100 + 2 * pad} ${100 + 2 * pad}`;
  const c = corner;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${view}">
<rect x="0" y="0" width="100" height="100" rx="${c}" fill="${COVER}"/>
<path d="M0 ${c} A${c} ${c} 0 0 1 ${c} 0 H${spine} V100 H${c} A${c} ${c} 0 0 1 0 ${100 - c} Z" fill="${BINDING}"/>
${rules.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.h / 2}" fill="${RULE}"/>`).join("\n")}
</svg>`;
}

function ico(frames) {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...frames.map((f) => f.png)]);
}

function icns(entries) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([head, data]);
  };
  const toc = Buffer.concat(entries.map(({ type, png }) => {
    const b = Buffer.alloc(8);
    b.write(type, 0, "ascii");
    b.writeUInt32BE(8 + png.length, 4);
    return b;
  }));
  const body = Buffer.concat([chunk("TOC ", toc), ...entries.map(({ type, png }) => chunk(type, png))]);
  return chunk("icns", body);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const cache = new Map();
async function render(size) {
  if (!cache.has(size)) {
    await page.setViewportSize({ width: Math.max(size, 16), height: Math.max(size, 16) });
    await page.setContent(`<html><body style="margin:0;background:transparent">${mark(size)}</body></html>`);
    const png = await page.locator("svg").screenshot({ omitBackground: true });
    cache.set(size, png);
  }
  return cache.get(size);
}

writeFileSync(path.join(BUILD_DIR, "icon.png"), await render(1024));

mkdirSync(path.join(BUILD_DIR, "icons"), { recursive: true });
for (const size of [32, 128, 256]) {
  writeFileSync(path.join(BUILD_DIR, "icons", `${size}x${size}.png`), await render(size));
}

const icoFrames = [];
for (const size of [16, 24, 32, 48, 64, 128, 256]) icoFrames.push({ size, png: await render(size) });
writeFileSync(path.join(BUILD_DIR, "icon.ico"), ico(icoFrames));

const icnsEntries = [];
for (const [type, size] of [
  ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024],
  ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512],
]) icnsEntries.push({ type, png: await render(size) });
writeFileSync(path.join(BUILD_DIR, "icon.icns"), icns(icnsEntries));

await browser.close();
console.log(`Icons written to ${BUILD_DIR}`);
