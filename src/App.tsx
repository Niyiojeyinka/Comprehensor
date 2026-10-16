import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { formatBytes, savingsRatio } from './lib/bytes'
import {
  compressImage,
  outputName,
  recipes,
  type CompressSettings,
  type OutputFormat,
  type RecipeId,
} from './lib/compress'
import { zipBlobs } from './lib/zip'

type Item = {
  id: string
  file: File
  originalUrl: string
  originalSize: number
  error?: string
  result?: {
    blob: Blob
    url: string
    width: number
    height: number
    quality: number
  }
}

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|bmp|avif)$/i

function isImageFile(file: File) {
  return IMAGE_TYPES.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [recipeId, setRecipeId] = useState<RecipeId>('postcard')
  const [settings, setSettings] = useState<CompressSettings>(() => {
    const postcard = recipes.find((recipe) => recipe.id === 'postcard')!
    return {
      maxEdge: postcard.maxEdge,
      quality: postcard.quality,
      format: postcard.format,
      targetBytes: postcard.targetBytes,
    }
  })
  const [busy, setBusy] = useState(false)
  const [split, setSplit] = useState(50)
  const [dragging, setDragging] = useState(false)
  const compareRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const itemIds = items.map((item) => item.id).join('|')
  const itemsRef = useRef(items)
  itemsRef.current = items

  const totals = useMemo(() => {
    const original = items.reduce((sum, item) => sum + item.originalSize, 0)
    const next = items.reduce(
      (sum, item) => sum + (item.result?.blob.size ?? item.originalSize),
      0,
    )
    return { original, next, saved: savingsRatio(original, next) }
  }, [items])

  function applyRecipe(id: RecipeId) {
    const recipe = recipes.find((entry) => entry.id === id)
    if (!recipe) return
    setRecipeId(id)
    setSettings({
      maxEdge: recipe.maxEdge,
      quality: recipe.quality,
      format: recipe.format,
      targetBytes: recipe.targetBytes,
    })
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter(isImageFile)
    if (!incoming.length) return
    const next = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      originalUrl: URL.createObjectURL(file),
      originalSize: file.size,
    }))
    setItems((current) => [...current, ...next])
    setSelectedId((current) => current ?? next[0].id)
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (files?.length) addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  useEffect(() => {
    if (!itemIds) return
    const controller = new AbortController()
    setBusy(true)
    const snapshot = itemsRef.current

    void (async () => {
      for (const item of snapshot) {
        if (controller.signal.aborted) return
        try {
          const result = await compressImage(item.file, settings, controller.signal)
          if (controller.signal.aborted) return
          setItems((current) =>
            current.map((entry) => {
              if (entry.id !== item.id) return entry
              if (entry.result?.url) URL.revokeObjectURL(entry.result.url)
              return {
                ...entry,
                error: undefined,
                result: {
                  blob: result.blob,
                  url: URL.createObjectURL(result.blob),
                  width: result.width,
                  height: result.height,
                  quality: result.quality,
                },
              }
            }),
          )
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    error:
                      error instanceof Error
                        ? error.message
                        : 'Could not compress this image.',
                  }
                : entry,
            ),
          )
        }
      }
      if (!controller.signal.aborted) setBusy(false)
    })()

    return () => {
      controller.abort()
    }
  }, [itemIds, settings])

  function updateSplit(clientX: number) {
    const box = compareRef.current?.getBoundingClientRect()
    if (!box) return
    const next = ((clientX - box.left) / box.width) * 100
    setSplit(Math.min(92, Math.max(8, next)))
  }

  async function downloadAll() {
    const ready = items.filter((item) => item.result)
    if (!ready.length) return
    if (ready.length === 1) {
      const only = ready[0]
      downloadBlob(only.result!.blob, outputName(only.file.name, settings.format))
      return
    }
    const zip = await zipBlobs(
      ready.map((item) => ({
        name: outputName(item.file.name, settings.format),
        blob: item.result!.blob,
      })),
    )
    downloadBlob(zip, 'comprehensor.zip')
  }

  function clearAll() {
    for (const item of items) {
      URL.revokeObjectURL(item.originalUrl)
      if (item.result?.url) URL.revokeObjectURL(item.result.url)
    }
    setItems([])
    setSelectedId(null)
    setBusy(false)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div>
            <h1>Comprehensor</h1>
            <p>Shrink images by feel, not by guesswork. Files never leave this browser.</p>
          </div>
        </div>
      </header>

      {!items.length ? (
        <section
          className={`drop${dragging ? ' active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            addFiles(event.dataTransfer.files)
          }}
        >
          <div>
            <p className="hint">Drop · browse · paste</p>
            <h2>Make the picture lighter.</h2>
            <p>
              Pick a mood, chase a file size, or squeeze by hand. JPEG, PNG,
              WebP, GIF, and AVIF, compressed on your machine.
            </p>
            <button className="primary" type="button" onClick={() => inputRef.current?.click()}>
              Choose images
            </button>
          </div>
        </section>
      ) : (
        <div className="studio">
          <aside className="panel film">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`thumb${item.id === selected?.id ? ' active' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <img src={item.originalUrl} alt="" />
                <span>
                  <strong className="file-name">{item.file.name}</strong>
                  <span>
                    {formatBytes(item.originalSize)}
                    {item.result ? ` → ${formatBytes(item.result.blob.size)}` : ''}
                  </span>
                </span>
              </button>
            ))}
            <button className="ghost" type="button" onClick={() => inputRef.current?.click()}>
              Add more
            </button>
          </aside>

          <section className="panel stage">
            {selected && (
              <>
                <div
                  ref={compareRef}
                  className="compare"
                  style={{ '--split': `${split}%` } as CSSProperties}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    updateSplit(event.clientX)
                  }}
                  onPointerMove={(event) => {
                    if (event.buttons) updateSplit(event.clientX)
                  }}
                >
                  <img src={selected.originalUrl} alt="Original" />
                  {selected.result && (
                    <img className="after" src={selected.result.url} alt="Compressed" />
                  )}
                  <div className="handle" />
                </div>
                <div className="labels">
                  <span>Original</span>
                  <span>{busy ? 'Squeezing…' : 'Lighter'}</span>
                </div>
                <div className="meter">
                  <div
                    className="meter-bar"
                    style={
                      {
                        '--saved': `${Math.round(totals.saved * 100)}%`,
                      } as CSSProperties
                    }
                  >
                    <span />
                  </div>
                  <div className="stats">
                    <span>
                      {formatBytes(totals.original)} → {formatBytes(totals.next)}
                    </span>
                    <b>{Math.round(totals.saved * 100)}% lighter</b>
                  </div>
                </div>
                {selected.error && <p className="error">{selected.error}</p>}
                {selected.result && (
                  <p className="footer-note">
                    {selected.result.width}×{selected.result.height} · quality{' '}
                    {Math.round(selected.result.quality * 100)}%
                  </p>
                )}
              </>
            )}
          </section>

          <aside className="panel controls">
            <div className="recipes">
              {recipes.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  className={`recipe${recipe.id === recipeId ? ' active' : ''}`}
                  onClick={() => applyRecipe(recipe.id)}
                >
                  <strong>{recipe.name}</strong>
                  <span>{recipe.blurb}</span>
                </button>
              ))}
            </div>

            <label className="field">
              <span>
                Keep detail
                <span>{Math.round(settings.quality * 100)}%</span>
              </span>
              <input
                id="quality"
                type="range"
                min={0.1}
                max={0.98}
                step={0.01}
                value={settings.quality}
                onChange={(event) => {
                  setRecipeId('custom')
                  setSettings((current) => ({
                    ...current,
                    quality: Number(event.target.value),
                  }))
                }}
              />
            </label>

            <div className="row">
              <label className="field">
                Longest edge
                <select
                  value={settings.maxEdge ?? 'original'}
                  onChange={(event) => {
                    setRecipeId('custom')
                    setSettings((current) => ({
                      ...current,
                      maxEdge:
                        event.target.value === 'original'
                          ? null
                          : Number(event.target.value),
                    }))
                  }}
                >
                  <option value="original">Original</option>
                  <option value="2560">2560px</option>
                  <option value="1920">1920px</option>
                  <option value="1600">1600px</option>
                  <option value="1080">1080px</option>
                  <option value="720">720px</option>
                </select>
              </label>
              <label className="field">
                Format
                <select
                  value={settings.format}
                  onChange={(event) => {
                    setRecipeId('custom')
                    setSettings((current) => ({
                      ...current,
                      format: event.target.value as OutputFormat,
                    }))
                  }}
                >
                  <option value="image/webp">WebP</option>
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/png">PNG</option>
                </select>
              </label>
            </div>

            <label className="field">
              Target size (KB), optional
              <input
                type="number"
                min={10}
                placeholder="e.g. 200"
                value={settings.targetBytes ? Math.round(settings.targetBytes / 1024) : ''}
                onChange={(event) => {
                  const kb = Number(event.target.value)
                  setRecipeId(event.target.value ? 'target' : 'custom')
                  setSettings((current) => ({
                    ...current,
                    targetBytes: kb > 0 ? kb * 1024 : null,
                  }))
                }}
              />
            </label>

            <div className="actions">
              <button
                className="primary"
                type="button"
                disabled={!selected?.result}
                onClick={() => {
                  if (!selected?.result) return
                  downloadBlob(
                    selected.result.blob,
                    outputName(selected.file.name, settings.format),
                  )
                }}
              >
                Download this
              </button>
              <button className="ghost" type="button" disabled={busy} onClick={() => void downloadAll()}>
                Download all
              </button>
              <button className="ghost" type="button" onClick={clearAll}>
                Start over
              </button>
            </div>
          </aside>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}
