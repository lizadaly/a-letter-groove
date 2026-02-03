import {
  BATCH_SIZE,
  MIN_WORDS_FOUND,
  CUT_FREQUENCY,
  WORD_FREQUENCY,
  SCHEDULER_WORKERS,
  DEFAULT_IMAGE_MAX_WIDTH
} from './src/config.js'

import {
  isV3Manifest,
  getCanvases,
  getImageResource,
  getManifestLabel
} from './src/iiif.js'

import { createImageService } from './src/image-service.js'

import {
  applyCutouts,
  selectWordsForCutout,
  shouldCutPage
} from './src/cutout.js'

// Extract words from Tesseract.js v7 blocks structure
const extractWords = (data) => {
  if (!data.blocks) return []
  return data.blocks.flatMap(block =>
    block.paragraphs?.flatMap(para =>
      para.lines?.flatMap(line => line.words ?? []) ?? []
    ) ?? []
  )
}

// Create image service instance
const imageService = createImageService()
let imageMaxWidth = DEFAULT_IMAGE_MAX_WIDTH

// Store cut data per canvas for full-size download
// Maps canvas -> { resource, cutBoxes, previewWidth, previewHeight }
const canvasCutData = new WeakMap()

let url, lastStart
let scheduler = null
let prefetchedCanvases = []
let prefetchInProgress = false
let prefetchBatchStart = 0
let batchInProgress = false
let waitingForPrefetch = false
let manifestCache = null
let currentPage = 0
let totalManifestPages = 0

const loadingEl = document.querySelector('#loading')
const loadingText = document.querySelector('#loading-text')
const errorEl = document.querySelector('#error')
const errorText = document.querySelector('#error-text')
const browseNav = document.querySelector('#browse-nav')
const pageCurrentEl = document.querySelector('.page-current')
const pageTotalEl = document.querySelector('.page-total')
const pageReadyEl = document.querySelector('.page-ready')
const prevButton = document.querySelector('#prev-btn')
const nextButton = document.querySelector('#next-btn')
const downloadButton = document.querySelector('#download-btn')
const homeButton = document.querySelector('#home-btn')
const statusProcessingEl = document.querySelector('#status-processing')

// Track removed canvases for "previous" navigation
let removedCanvases = []

// Status tracking
let currentOcrProgress = { completed: 0, total: 0, startPage: 0 }
let currentPrefetchProgress = { completed: 0, total: 0, startPage: 0 }

const updateStatus = () => {
  const canvasesInDom = main.querySelectorAll('canvas').length
  const totalProcessed = canvasesInDom + removedCanvases.length

  // Show total processed pages (viewable + already viewed)
  pageReadyEl.textContent = totalProcessed > 0 ? `${totalProcessed} ready` : ''

  // Disable next button if only one canvas left (nothing to reveal)
  const atCacheBoundary = canvasesInDom <= 1
  nextButton.disabled = atCacheBoundary

  // Show OCR or prefetch progress with current page number
  if (atCacheBoundary && (prefetchInProgress || waitingForPrefetch)) {
    statusProcessingEl.textContent = 'loading more pages...'
  } else if (currentOcrProgress.total > 0 && currentOcrProgress.completed < currentOcrProgress.total) {
    const pageNum = currentOcrProgress.startPage + currentOcrProgress.completed + 1
    statusProcessingEl.textContent = `OCRing page ${pageNum}`
  } else if (prefetchInProgress && currentPrefetchProgress.total > 0) {
    const pageNum = currentPrefetchProgress.startPage + currentPrefetchProgress.completed + 1
    statusProcessingEl.textContent = `fetching page ${pageNum}`
  } else if (waitingForPrefetch) {
    statusProcessingEl.textContent = 'waiting...'
  } else {
    statusProcessingEl.textContent = ''
  }
}

const updatePageCounter = () => {
  if (totalManifestPages > 0) {
    pageCurrentEl.textContent = currentPage
    pageTotalEl.textContent = totalManifestPages
    browseNav.classList.remove('hidden')
    // Enable/disable prev button based on history
    prevButton.disabled = removedCanvases.length === 0
  }
}

const showLoading = (text) => {
  loadingText.textContent = text
  loadingEl.classList.remove('hidden')
}

const hideLoading = () => {
  loadingEl.classList.add('hidden')
}

const showError = (message) => {
  errorText.textContent = message
  errorEl.classList.remove('hidden')
  hideLoading()
}

const hideError = () => {
  errorEl.classList.add('hidden')
}

const initScheduler = async () => {
  if (scheduler) return scheduler
  scheduler = Tesseract.createScheduler()
  for (let i = 0; i < SCHEDULER_WORKERS; i++) {
    const worker = await Tesseract.createWorker('eng')
    scheduler.addWorker(worker)
  }
  return scheduler
}

const main = document.querySelector('main')
const splash = document.querySelector('#splash')
const form = document.querySelector('#manifest-form')

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  hideError()
  url = form['url'].value
  lastStart = 0
  const newUrl = new URL(window.location)
  newUrl.searchParams.set('manifest', url)
  window.history.replaceState({}, '', newUrl)
  splash.classList.add('hidden')
  showLoading('Initializing OCR...')
  try {
    await initScheduler()
    await bookRender(url, 0)
  } catch (err) {
    showError(`Failed to load manifest: ${err.message}`)
    splash.classList.remove('hidden')
  }
})

// Check for manifest URL parameter and auto-load
const urlParams = new URLSearchParams(window.location.search)
const manifestParam = urlParams.get('manifest')
if (manifestParam) {
  form['url'].value = manifestParam
  form.dispatchEvent(new Event('submit'))
}

const getManifest = async (url) => {
  if (manifestCache) return manifestCache
  const req = await fetch(url)
  if (!req.ok) {
    throw new Error(`HTTP ${req.status}: ${req.statusText}`)
  }
  const manifest = await req.json()
  console.log(manifest)

  // Validate required structure
  const canvases = getCanvases(manifest)
  if (!canvases || canvases.length === 0) {
    throw new Error('No canvases found in manifest')
  }

  manifestCache = manifest
  totalManifestPages = canvases.length
  return manifest
}

const prefetchNextBatch = (manifestUrl, start) => {
  if (prefetchInProgress) return
  prefetchInProgress = true
  prefetchBatchStart = start
  prefetchedCanvases = []

  getManifest(manifestUrl).then(manifest => {
    const allCanvases = getCanvases(manifest)
    const canvases = allCanvases.slice(start, start + BATCH_SIZE)
    if (canvases.length === 0) {
      prefetchInProgress = false
      return
    }

    const isV3 = isV3Manifest(manifest)
    console.log(`Prefetching batch starting from ${start}...`)
    let prefetchCompleted = 0
    const completedCanvases = new Array(canvases.length).fill(null)
    currentPrefetchProgress = { completed: 0, total: canvases.length, startPage: start }
    updateStatus()

    canvases.forEach((item, itemIndex) => {
      setTimeout(async () => {
        const resource = getImageResource(item, isV3)
        const { url: imageUrl, width, height } = await imageService.getImageUrlAndSize(resource, imageMaxWidth)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })

        const image = new Image(width, height)
        image.crossOrigin = 'Anonymous'

        image.addEventListener('error', () => {
          prefetchCompleted++
          currentPrefetchProgress.completed = prefetchCompleted
          updateStatus()
          if (prefetchCompleted === canvases.length) {
            finishPrefetch()
          }
        })

        image.addEventListener('load', async () => {
          let data
          try {
            const result = await scheduler.addJob('recognize', imageUrl, {}, { blocks: true })
            data = result.data
          } catch (err) {
            prefetchCompleted++
            currentPrefetchProgress.completed = prefetchCompleted
            updateStatus()
            if (prefetchCompleted === canvases.length) {
              finishPrefetch()
            }
            return
          }

          const words = extractWords(data)
          if (words.length > MIN_WORDS_FOUND) {
            ctx.drawImage(image, 0, 0)
            let cutBoxes = []
            if (shouldCutPage(CUT_FREQUENCY)) {
              cutBoxes = selectWordsForCutout(words, WORD_FREQUENCY)
              applyCutouts(ctx, cutBoxes)
            }
            canvasCutData.set(canvas, {
              resource,
              cutBoxes,
              previewWidth: width,
              previewHeight: height
            })
            completedCanvases[itemIndex] = canvas
          }

          prefetchCompleted++
          currentPrefetchProgress.completed = prefetchCompleted
          updateStatus()
          if (prefetchCompleted === canvases.length) {
            finishPrefetch()
          }
        })

        image.src = imageUrl
      }, 300)
    })

    const finishPrefetch = () => {
      // Store canvases in manifest order
      prefetchedCanvases = completedCanvases.filter(c => c !== null)
      console.log(`Prefetched ${prefetchedCanvases.length} canvases`)
      prefetchInProgress = false
      currentPrefetchProgress = { completed: 0, total: 0, startPage: 0 }
      updateStatus()

      // If we were waiting for prefetch, use the canvases now
      if (waitingForPrefetch) {
        waitingForPrefetch = false
        // Reset lastStart to match the prefetched batch
        lastStart = prefetchBatchStart
        bookRender(url, prefetchBatchStart, true)
      }
    }
  })
}

const bookRender = async (url, start, usePrefetched = false) => {
  if (batchInProgress) return

  const manifest = await getManifest(url)

  // Use prefetched canvases if available
  if (usePrefetched && prefetchedCanvases.length > 0) {
    console.log(`Using ${prefetchedCanvases.length} prefetched canvases`)
    for (const canvas of prefetchedCanvases) {
      main.insertBefore(canvas, main.firstChild)
    }
    nextButton.classList.remove('hidden')
    prefetchedCanvases = []
    updateStatus()
    prefetchNextBatch(url, start + BATCH_SIZE)
    return
  }

  // If prefetch is in progress, wait for it instead of competing for scheduler
  if (prefetchInProgress) {
    waitingForPrefetch = true
    updateStatus()
    return
  }

  batchInProgress = true
  const allCanvases = getCanvases(manifest)
  const canvases = allCanvases.slice(start, start + BATCH_SIZE)
  const isV3 = isV3Manifest(manifest)
  const totalPages = canvases.length
  let pagesCompleted = 0
  const completedCanvases = new Array(canvases.length).fill(null)
  currentOcrProgress = { completed: 0, total: totalPages, startPage: start }
  showLoading(`Processing 0/${totalPages}...`)
  updateStatus()

  canvases.forEach((item, itemIndex) => {
    setTimeout(async () => {
      const resource = getImageResource(item, isV3)
      const { url: imageUrl, width, height } = await imageService.getImageUrlAndSize(resource, imageMaxWidth)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', {
        willReadFrequently: true
      })

      const image = new Image(width, height)
      image.crossOrigin = 'Anonymous'

      image.addEventListener('error', () => {
        console.warn(`Failed to load image: ${imageUrl}`)
        pagesCompleted++
        currentOcrProgress.completed = pagesCompleted
        showLoading(`Processing ${pagesCompleted}/${totalPages}...`)
        updateStatus()
        if (pagesCompleted === totalPages) {
          finishBatch()
        }
      })

      image.addEventListener('load', async () => {
        console.log(`OCRing ${imageUrl}...`)
        let data
        try {
          const result = await scheduler.addJob('recognize', imageUrl, {}, { blocks: true })
          data = result.data
        } catch (err) {
          console.warn(`OCR failed for ${imageUrl}:`, err.message)
          pagesCompleted++
          currentOcrProgress.completed = pagesCompleted
          showLoading(`Processing ${pagesCompleted}/${totalPages}...`)
          updateStatus()
          if (pagesCompleted === totalPages) {
            finishBatch()
          }
          return
        }

        pagesCompleted++
        currentOcrProgress.completed = pagesCompleted
        showLoading(`Processing ${pagesCompleted}/${totalPages}...`)
        updateStatus()

        // Only draw the image if there are at least some OCR detections
        const words = extractWords(data)
        if (words.length > MIN_WORDS_FOUND) {
          ctx.drawImage(image, 0, 0)
          let cutBoxes = []
          if (shouldCutPage(CUT_FREQUENCY)) {
            cutBoxes = selectWordsForCutout(words, WORD_FREQUENCY)
            applyCutouts(ctx, cutBoxes)
          }
          canvasCutData.set(canvas, {
            resource,
            cutBoxes,
            previewWidth: width,
            previewHeight: height
          })
          completedCanvases[itemIndex] = canvas
        }

        if (pagesCompleted === totalPages) {
          finishBatch()
        }
      })

      image.src = imageUrl
    }, 300)
  })

  const finishBatch = () => {
    // Insert canvases in manifest order (earlier pages inserted later so they end up last in DOM = on top)
    const orderedCanvases = completedCanvases.filter(c => c !== null)
    for (const canvas of orderedCanvases) {
      main.insertBefore(canvas, main.firstChild)
    }

    hideLoading()
    batchInProgress = false
    currentOcrProgress = { completed: 0, total: 0, startPage: 0 }
    if (orderedCanvases.length > 0) {
      browseNav.classList.remove('hidden')
      currentPage = 1
      updatePageCounter()
    }
    updateStatus()
    prefetchNextBatch(url, start + BATCH_SIZE)
  }
}

const revealNextPage = () => {
  const canvas = main.querySelector('canvas:last-of-type')
  if (!canvas) return

  // Store removed canvas for "previous" navigation
  canvas.parentNode.removeChild(canvas)
  removedCanvases.push(canvas)
  currentPage++
  updatePageCounter()
  updateStatus()

  const remaining = [...main.querySelectorAll('canvas')].length

  if (remaining < 5 && !waitingForPrefetch && !batchInProgress) {
    lastStart = lastStart + BATCH_SIZE
    const hasPrefetched = prefetchedCanvases.length > 0
    bookRender(url, lastStart, hasPrefetched)
  }
}

const revealPreviousPage = () => {
  if (removedCanvases.length === 0) return

  const canvas = removedCanvases.pop()
  main.appendChild(canvas)
  currentPage--
  updatePageCounter()
  updateStatus()
}

// Load an image and return a promise
const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image()
  img.crossOrigin = 'Anonymous'
  img.onload = () => resolve(img)
  img.onerror = reject
  img.src = url
})

const downloadCurrentImage = async () => {
  const canvases = [...main.querySelectorAll('canvas')]
  if (canvases.length === 0) return

  // Check if we have cut data for all canvases
  const allHaveCutData = canvases.every(c => canvasCutData.has(c))
  if (!allHaveCutData) {
    // Fallback to preview-size download if cut data missing
    const bottomCanvas = canvases[0]
    const { width, height } = bottomCanvas
    const composite = document.createElement('canvas')
    composite.width = width
    composite.height = height
    const ctx = composite.getContext('2d')
    for (const canvas of canvases) {
      ctx.drawImage(canvas, 0, 0)
    }
    const title = getManifestLabel(manifestCache) || 'a-letter-groove'
    const safeTitle = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const link = document.createElement('a')
    link.download = `${safeTitle}-page-${currentPage}.png`
    link.href = composite.toDataURL('image/png')
    link.click()
    return
  }

  // Show loading state
  downloadButton.disabled = true
  downloadButton.textContent = 'Loading full-size...'

  try {
    // Use the TOP layer to determine output dimensions
    const topCanvas = canvases[canvases.length - 1]
    const topCutData = canvasCutData.get(topCanvas)
    const { width: fullWidth, height: fullHeight } = await imageService.getFullSizeImageUrl(topCutData.resource)

    // Create composite canvas at full size
    const composite = document.createElement('canvas')
    composite.width = fullWidth
    composite.height = fullHeight
    const ctx = composite.getContext('2d')

    // Process canvases from bottom to top (DOM order)
    for (const canvas of canvases) {
      const cutData = canvasCutData.get(canvas)
      const { resource, cutBoxes, previewWidth } = cutData

      // Fetch full-size image
      const { url: fullSizeUrl } = await imageService.getFullSizeImageUrl(resource)
      const img = await loadImage(fullSizeUrl)

      // Create a temporary canvas for this layer
      const layerCanvas = document.createElement('canvas')
      layerCanvas.width = fullWidth
      layerCanvas.height = fullHeight
      const layerCtx = layerCanvas.getContext('2d')

      // Draw the full-size image, scaling to fit the composite dimensions
      layerCtx.drawImage(img, 0, 0, fullWidth, fullHeight)

      // Calculate scale factor from preview to composite size
      const scale = fullWidth / previewWidth

      // Apply scaled cutouts
      applyCutouts(layerCtx, cutBoxes, scale)

      // Composite this layer onto the main canvas
      ctx.drawImage(layerCanvas, 0, 0)
    }

    // Download the composite
    const title = getManifestLabel(manifestCache) || 'a-letter-groove'
    const safeTitle = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const link = document.createElement('a')
    link.download = `${safeTitle}-page-${currentPage}-full.png`
    link.href = composite.toDataURL('image/png')
    link.click()
  } catch (err) {
    console.error('Failed to generate full-size image:', err)
    alert('Failed to generate full-size image. Try again or check console for details.')
  } finally {
    downloadButton.disabled = false
    downloadButton.textContent = 'Download'
  }
}

nextButton.addEventListener('click', revealNextPage)
prevButton.addEventListener('click', revealPreviousPage)
downloadButton.addEventListener('click', downloadCurrentImage)
homeButton.addEventListener('click', (e) => {
  e.preventDefault()
  history.pushState({}, '', '/')
  splash.classList.remove('hidden')
  browseNav.classList.add('hidden')
  document.querySelector('main').innerHTML = ''

  // Reset all state variables
  url = undefined
  lastStart = undefined
  prefetchedCanvases = []
  prefetchInProgress = false
  prefetchBatchStart = 0
  batchInProgress = false
  waitingForPrefetch = false
  manifestCache = null
  currentPage = 0
  totalManifestPages = 0
  removedCanvases = []
  currentOcrProgress = { completed: 0, total: 0, startPage: 0 }
  currentPrefetchProgress = { completed: 0, total: 0, startPage: 0 }

  // Clear the form input
  form['url'].value = ''
})

document.addEventListener('keydown', (e) => {
  if (browseNav.classList.contains('hidden')) return
  if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    revealNextPage()
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    revealPreviousPage()
  }
})
