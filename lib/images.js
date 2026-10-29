// Photo preparation — every crew photo is normalised before Claude reads it
// and before a network fetches it.
//
// Phone photos arrive as 12–48 MP Display P3 JPEGs with an EXIF rotation flag
// and GPS coordinates. Instagram's API only takes JPEG, re-encodes anything
// wider than 1440 px and rejects aspect ratios outside 4:5 … 1.91:1. And
// job-site shots are often flat: haze over a skyline, fog, backlight, glass
// reflections. So each upload becomes:
//
//   <stem>-post.jpg  ≤ 2048 px, sRGB, metadata stripped, contrast lifted,
//                    progressive JPEG q90 with full-resolution chroma so thin
//                    railing lines stay crisp. Used by the dashboard, Claude,
//                    LinkedIn and Facebook.
//   <stem>-ig.jpg    the same picture, aspect ratio clamped into Instagram's
//                    range with a content-aware crop, ≤ 1440 px wide.
//
// The contrast lift is luminance-only (no colour shifts) and halo-limited:
//   1. local contrast with a large radius — the haze cut. Haze is a bright
//      veil, so the filter may pull luminance down freely but push it up only
//      a little; unlimited lift is what paints a glow around a dark subject
//      against a bright sky.
//   2. auto levels from the 0.3 / 99.7 percentiles, capped so a photo that is
//      already punchy stays as shot.
//   3. a mild S-curve and a touch of saturation.
//   4. a fine sharpen after the downscale.
// PHOTO_ENHANCE=off skips the lift; orientation, colour, size and the
// Instagram crop are correctness fixes and always happen.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_EDGE = 2048;
const CLAUDE_EDGE = 1568; // Claude downsamples past this anyway; smaller = fewer tokens
const IG = { maxWidth: 1440, minRatio: 4 / 5, maxRatio: 1.91 };
const JPEG = { quality: 90, progressive: true, chromaSubsampling: "4:4:4", mozjpeg: true };
const FINE_SHARPEN = { sigma: 0.8, m1: 0.4, m2: 1.1 };

export const TUNING = {
  clarity: 0.4,          // local-contrast gain
  clarityRadius: 0.02,   // blur sigma as a fraction of the long edge
  darkenLimit: 32,       // max luminance pull-down per pixel (0–255 scale)
  liftLimit: 8,          // max push-up — small on purpose, see above
  levels: [0.3, 99.7],   // percentiles that become black and white…
  maxBlack: 48,          // …but never stretch harder than this
  minWhite: 212,
  sCurve: 0.12,          // extra mid-tone slope (0 = none)
  saturation: 1.08,
};

export function enhanceEnabled() {
  return !/^(off|false|0|no)$/i.test(process.env.PHOTO_ENHANCE || "");
}

// Decode, bake in the EXIF orientation and fit inside MAX_EDGE. sharp converts
// an embedded Display P3 / Adobe RGB profile to sRGB at this point.
function decode(srcPath) {
  return sharp(srcPath).rotate().resize({
    width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true, kernel: "lanczos3",
  });
}

// The contrast lift, on raw sRGB pixels. Returns a new RGB buffer plus the
// levels it chose, so the caller can log them.
async function liftContrast(rgb, width, height, t = TUNING) {
  const n = width * height;
  const luma = Buffer.allocUnsafe(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const y = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    luma[i] = y + 0.5;
    hist[luma[i]]++;
  }
  // Large-radius blur of the luminance = the "neighbourhood" each pixel is
  // pushed away from.
  const sigma = Math.max(4, Math.round(Math.max(width, height) * t.clarityRadius));
  const blur = await sharp(luma, { raw: { width, height, channels: 1 } }).blur(sigma).raw().toBuffer();

  const percentile = (p) => {
    let acc = 0;
    const target = (n * p) / 100;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const black = Math.min(percentile(t.levels[0]), t.maxBlack);
  const white = Math.max(percentile(t.levels[1]), t.minWhite);
  const scale = 255 / Math.max(1, white - black);

  const out = Buffer.allocUnsafe(n * 3);
  for (let i = 0; i < n; i++) {
    const y = luma[i];
    // 1. local contrast, soft-limited (tanh) with the asymmetric ceilings
    let d = t.clarity * (y - blur[i]);
    const limit = d > 0 ? t.liftLimit : t.darkenLimit;
    d = limit * Math.tanh(d / limit);
    // 2. levels, 3. S-curve around mid grey
    let y2 = (y + d - black) * scale;
    const c = y2 / 255 - 0.5;
    y2 = 255 * (0.5 + c + t.sCurve * c * (0.25 - c * c) * 4);
    const dy = y2 - y;
    for (let k = 0; k < 3; k++) {
      let v = rgb[i * 3 + k] + dy;           // luminosity-only shift
      v = y2 + t.saturation * (v - y2);      // then the saturation nudge
      out[i * 3 + k] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
    }
  }
  return { rgb: out, black, white, sigma };
}

// Instagram accepts 4:5 (0.8) through 1.91:1. Anything outside is cropped to
// the nearest edge of that range; the content-aware crop keeps the busy part.
function instagramFrame(width, height) {
  const ratio = width / height;
  const targetWidth = Math.min(IG.maxWidth, width);
  if (ratio < IG.minRatio) {
    return { width: targetWidth, height: Math.floor(targetWidth / IG.minRatio), cropped: true, label: "4:5" };
  }
  if (ratio > IG.maxRatio) {
    return { width: targetWidth, height: Math.ceil(targetWidth / IG.maxRatio), cropped: true, label: "1.91:1" };
  }
  return { width: targetWidth, height: Math.round(targetWidth / ratio), cropped: false, label: null };
}

/**
 * Prepare one uploaded photo. Writes `<stem>-post.jpg` and `<stem>-ig.jpg`
 * next to the original (or into `dir`) and returns what it did.
 */
export async function preparePhoto(srcPath, { dir, stem, enhance = enhanceEnabled() } = {}) {
  const outDir = dir || join(srcPath, "..");
  mkdirSync(outDir, { recursive: true });
  const name = stem || basename(srcPath, extname(srcPath));
  const source = await sharp(srcPath).metadata();

  const { data, info } = await decode(srcPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let rgb = data;
  let levels = null;
  if (enhance) {
    const lifted = await liftContrast(rgb, width, height);
    rgb = lifted.rgb;
    levels = [lifted.black, lifted.white];
  }
  const fromRaw = () => sharp(rgb, { raw: { width, height, channels: 3 } });

  const main = { filename: `${name}-post.jpg`, path: join(outDir, `${name}-post.jpg`), width, height };
  const written = await fromRaw().sharpen(FINE_SHARPEN).withIccProfile("srgb").jpeg(JPEG).toFile(main.path);
  main.bytes = written.size;

  const frame = instagramFrame(width, height);
  const instagram = { filename: `${name}-ig.jpg`, path: join(outDir, `${name}-ig.jpg`), cropped: frame.cropped, ratio: frame.label };
  const ig = await fromRaw()
    .resize({ width: frame.width, height: frame.height, fit: "cover", position: sharp.strategy.attention, kernel: "lanczos3" })
    .sharpen(FINE_SHARPEN)
    .withIccProfile("srgb")
    .jpeg(JPEG)
    .toFile(instagram.path);
  Object.assign(instagram, { width: ig.width, height: ig.height, bytes: ig.size });

  return {
    main,
    instagram,
    enhanced: enhance,
    levels,
    source: { width: source.autoOrient?.width ?? source.width, height: source.autoOrient?.height ?? source.height, format: source.format },
  };
}

/** The image block Claude sees: ≤ 1568 px JPEG, orientation baked in. */
export async function imageForClaude(path) {
  const buf = await sharp(path)
    .rotate()
    .resize({ width: CLAUDE_EDGE, height: CLAUDE_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") };
}

// CLI for trying it on a photo without running the studio:
//   node lib/images.js photo.jpg [outDir]      (PHOTO_ENHANCE=off to compare)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, dir] = process.argv.slice(2);
  if (!src) {
    console.error("usage: node lib/images.js <photo> [outDir]");
    process.exit(1);
  }
  preparePhoto(src, { dir }).then((r) => {
    console.log(`${r.source.width}×${r.source.height} ${r.source.format} → ${r.main.width}×${r.main.height} ${r.main.filename} (${(r.main.bytes / 1024).toFixed(0)} KB)`);
    console.log(`  contrast: ${r.enhanced ? `lifted (levels ${r.levels[0]}–${r.levels[1]})` : "as shot"}`);
    console.log(`  instagram: ${r.instagram.width}×${r.instagram.height} ${r.instagram.filename}${r.instagram.cropped ? ` (cropped to ${r.instagram.ratio})` : ""}`);
  }, (err) => {
    console.error(err.message);
    process.exit(1);
  });
}
