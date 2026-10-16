export type OutputFormat = 'image/webp' | 'image/jpeg' | 'image/png'

export type RecipeId =
  | 'soul'
  | 'postcard'
  | 'pocket'
  | 'whisper'
  | 'target'
  | 'custom'

export type Recipe = {
  id: RecipeId
  name: string
  blurb: string
  maxEdge: number | null
  quality: number
  format: OutputFormat
  targetBytes: number | null
}

export const recipes: Recipe[] = [
  {
    id: 'soul',
    name: 'Keep the soul',
    blurb: 'Almost lossless. Full size, gentle WebP.',
    maxEdge: null,
    quality: 0.92,
    format: 'image/webp',
    targetBytes: null,
  },
  {
    id: 'postcard',
    name: 'Postcard',
    blurb: 'Share-ready. 1600px JPEG.',
    maxEdge: 1600,
    quality: 0.78,
    format: 'image/jpeg',
    targetBytes: null,
  },
  {
    id: 'pocket',
    name: 'Pocket',
    blurb: 'Phone-friendly. 1080px WebP.',
    maxEdge: 1080,
    quality: 0.7,
    format: 'image/webp',
    targetBytes: null,
  },
  {
    id: 'whisper',
    name: 'Whisper',
    blurb: 'Tiny on purpose. 720px, squeezed.',
    maxEdge: 720,
    quality: 0.48,
    format: 'image/webp',
    targetBytes: null,
  },
  {
    id: 'target',
    name: 'Hit a number',
    blurb: 'Chase a file size and stop there.',
    maxEdge: 1920,
    quality: 0.82,
    format: 'image/webp',
    targetBytes: 200 * 1024,
  },
  {
    id: 'custom',
    name: 'Custom',
    blurb: 'You set the squeeze.',
    maxEdge: 1920,
    quality: 0.8,
    format: 'image/webp',
    targetBytes: null,
  },
]

export type CompressSettings = {
  maxEdge: number | null
  quality: number
  format: OutputFormat
  targetBytes: number | null
}

export type CompressResult = {
  blob: Blob
  width: number
  height: number
  quality: number
}

const FORMAT_EXTENSION: Record<OutputFormat, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export function extensionFor(format: OutputFormat): string {
  return FORMAT_EXTENSION[format]
}

export function outputName(originalName: string, format: OutputFormat): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'image'
  return `${base}-lighter.${extensionFor(format)}`
}

export async function supportsFormat(format: OutputFormat): Promise<boolean> {
  if (format === 'image/jpeg' || format === 'image/png') return true
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, format, 0.8)
  })
  return Boolean(blob && blob.type === format)
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Could not read this image.'))
        img.src = url
      })
      return await createImageBitmap(image)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

function scaleSize(
  width: number,
  height: number,
  maxEdge: number | null,
): { width: number; height: number } {
  if (!maxEdge || Math.max(width, height) <= maxEdge) {
    return { width, height }
  }
  const scale = maxEdge / Math.max(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function drawToCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  return canvas
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: OutputFormat,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Could not encode as ${format}.`))
          return
        }
        resolve(blob)
      },
      format,
      format === 'image/png' ? undefined : quality,
    )
  })
}

async function encodeAtSize(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  format: OutputFormat,
  quality: number,
): Promise<Blob> {
  const canvas = drawToCanvas(bitmap, width, height)
  try {
    return await encodeCanvas(canvas, format, quality)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function compressImage(
  file: File,
  settings: CompressSettings,
  signal?: AbortSignal,
): Promise<CompressResult> {
  const bitmap = await loadBitmap(file)
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const format = (await supportsFormat(settings.format))
      ? settings.format
      : 'image/jpeg'

    let { width, height } = scaleSize(
      bitmap.width,
      bitmap.height,
      settings.maxEdge,
    )

    if (!settings.targetBytes || format === 'image/png') {
      const blob = await encodeAtSize(
        bitmap,
        width,
        height,
        format,
        settings.quality,
      )
      return { blob, width, height, quality: settings.quality }
    }

    let quality = settings.quality
    let blob = await encodeAtSize(bitmap, width, height, format, quality)

    const huntQuality = async (w: number, h: number) => {
      let low = 0.08
      let high = 0.95
      let best = await encodeAtSize(bitmap, w, h, format, high)
      let used = high

      if (best.size <= settings.targetBytes!) {
        return { blob: best, quality: used }
      }

      for (let i = 0; i < 8; i += 1) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const mid = (low + high) / 2
        const candidate = await encodeAtSize(bitmap, w, h, format, mid)
        if (candidate.size <= settings.targetBytes!) {
          best = candidate
          used = mid
          low = mid
        } else {
          high = mid
          if (candidate.size < best.size) {
            best = candidate
            used = mid
          }
        }
      }
      return { blob: best, quality: used }
    }

    let hunted = await huntQuality(width, height)
    blob = hunted.blob
    quality = hunted.quality

    while (
      blob.size > settings.targetBytes &&
      Math.max(width, height) > 320
    ) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      width = Math.max(1, Math.round(width * 0.85))
      height = Math.max(1, Math.round(height * 0.85))
      hunted = await huntQuality(width, height)
      blob = hunted.blob
      quality = hunted.quality
    }

    return { blob, width, height, quality }
  } finally {
    bitmap.close()
  }
}
