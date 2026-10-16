# Comprehensor

A local image compressor. Drop photos in, pick a mood or a target size, and download lighter files. Nothing is uploaded.

## Run

```bash
npm install
npm run dev
```

## What it does

- Compresses JPEG, PNG, WebP, GIF, BMP, and AVIF in the browser
- Recipes: Keep the soul, Postcard, Pocket, Whisper, Hit a number, Custom
- Before/after slider, batch download as a zip
- Optional longest-edge resize and WebP / JPEG / PNG output

## How does it work

Comprehensor is a fully client-side image compressor. Files never leave the browser. It does not invent a codec — it uses the browser’s canvas encoder (canvas.toBlob) and chooses how much to resize and how hard to encode.

Pipeline

Decode the file with createImageBitmap (with EXIF orientation), falling back to an <img> if needed.
Optionally downscale so the longest edge is under a cap. Pixel count is the first, and usually biggest, size lever: file size scales roughly with width × height.
Draw onto a canvas with high-quality smoothing. Redrawing also strips metadata (EXIF, etc.), which is extra bytes you don’t need for sharing.
Re-encode as WebP, JPEG, or PNG. JPEG/WebP take a quality scalar; PNG does not (it’s lossless, so we only shrink by resizing). If WebP isn’t supported, we fall back to JPEG.
Default vs target-size mode

Most presets are one encode: cap + quality + format.
“Hit a number” is a search: binary-search quality (~8 probes) until the blob is under the byte budget. If even low quality is too big, shrink dimensions by 15% and search again, down to ~320px. That’s why a 6MB photo can land near 200KB without the user picking a quality.

App layer

Recipes are just named settings. Changing files or settings retriggers compression with an AbortController so stale jobs don’t overwrite newer ones. The UI compares original vs result object URLs. Batch download is a zip of already-compressed blobs (store method — images are already compressed, so zip deflate wouldn’t help much).