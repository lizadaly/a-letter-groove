const BATCH_SIZE = 20
const MIN_WORDS_FOUND = 0
const CUT_FREQUENCY = 1 // One out of every n pages will on average be cut
const WORD_FREQUENCY = 3 // One of of every n words will on average be cut
const SCHEDULER_WORKERS = 3
let imageMaxWidth = 600 // Max width for fetched images (uses IIIF Image API)

// Construct a sized image URL using IIIF Image API, or fall back to full URL
const getImageUrl = (resource) => {
  const service = resource.service
  if (service && service['@id']) {
    const size = imageMaxWidth === 'full' ? 'full' : `${imageMaxWidth},`
    return `${service['@id']}/full/${size}/0/default.jpg`
  }
  return resource['@id']
}

const setImageMaxWidth = (width) => {
  imageMaxWidth = width // number for max width, or 'full' for original size
}

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
const browseNav = document.querySelector('#browse-nav')
const pageCurrentEl = document.querySelector('.page-current')
const pageTotalEl = document.querySelector('.page-total')
const pageReadyEl = document.querySelector('.page-ready')
const prevButton = document.querySelector('#prev-btn')
const nextButton = document.querySelector('#next-btn')
const downloadButton = document.querySelector('#download-btn')
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

const initScheduler = async () => {
  if (scheduler) return scheduler
  scheduler = Tesseract.createScheduler()
  for (let i = 0; i < SCHEDULER_WORKERS; i++) {
    const worker = Tesseract.createWorker()
    await worker.load()
    await worker.loadLanguage('eng')
    await worker.initialize('eng')
    scheduler.addWorker(worker)
  }
  return scheduler
}

const main = document.querySelector('main')
const splash = document.querySelector('#splash')
const form = document.querySelector('#manifest-form')

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  url = form['url'].value
  lastStart = 0
  splash.classList.add('hidden')
  showLoading('Initializing OCR...')
  await initScheduler()
  bookRender(url, 0)
})

const getManifest = async (url) => {
  if (manifestCache) return manifestCache
  const req = await fetch(url)
  manifestCache = await req.json()
  console.log(manifestCache)
  totalManifestPages = manifestCache.sequences[0].canvases.length
  return manifestCache
}

const prefetchNextBatch = (manifestUrl, start) => {
  if (prefetchInProgress) return
  prefetchInProgress = true
  prefetchBatchStart = start
  prefetchedCanvases = []

  getManifest(manifestUrl).then(manifest => {
    const canvases = manifest.sequences[0].canvases.slice(start, start + BATCH_SIZE)
    if (canvases.length === 0) {
      prefetchInProgress = false
      return
    }

    console.log(`Prefetching batch starting from ${start}...`)
    let prefetchCompleted = 0
    const completedCanvases = new Array(canvases.length).fill(null)
    currentPrefetchProgress = { completed: 0, total: canvases.length, startPage: start }
    updateStatus()

    canvases.forEach((item, itemIndex) => {
      setTimeout(() => {
        const resource = item.images[0].resource
        const imageUrl = getImageUrl(resource)
        const width = imageMaxWidth === 'full' ? resource.width : imageMaxWidth
        const height = imageMaxWidth === 'full' ? resource.height : Math.round(imageMaxWidth * resource.height / resource.width)

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
            const result = await scheduler.addJob('recognize', imageUrl)
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

          if (data.words.length > MIN_WORDS_FOUND) {
            ctx.drawImage(image, 0, 0)
            const cutFrequency = Math.floor(Math.random() * CUT_FREQUENCY) + 1
            if (cutFrequency === 1) {
              for (const word of data.words) {
                const { bbox } = word
                const wordFrequency = Math.floor(Math.random() * WORD_FREQUENCY) + 1
                if (wordFrequency === 1) {
                  const boxwidth = bbox.x1 - bbox.x0
                  const boxheight = bbox.y1 - bbox.y0
                  ctx.save()
                  ctx.globalCompositeOperation = 'destination-out'
                  ctx.rect(bbox.x0, bbox.y0, boxwidth, boxheight)
                  ctx.fill()
                  ctx.restore()
                  ctx.globalCompositeOperation = 'source-over'
                  ctx.strokeStyle = 'black'
                  ctx.strokeRect(bbox.x0, bbox.y0, boxwidth, boxheight)
                }
              }
            }
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
  const canvases = manifest.sequences[0].canvases.slice(start, start + BATCH_SIZE)
  const totalPages = canvases.length
  let pagesCompleted = 0
  const completedCanvases = new Array(canvases.length).fill(null)
  currentOcrProgress = { completed: 0, total: totalPages, startPage: start }
  showLoading(`Processing 0/${totalPages}...`)
  updateStatus()

  canvases.forEach((item, itemIndex) => {
    setTimeout(() => {
      const resource = item.images[0].resource
      const imageUrl = getImageUrl(resource)
      const width = imageMaxWidth === 'full' ? resource.width : imageMaxWidth
      const height = imageMaxWidth === 'full' ? resource.height : Math.round(imageMaxWidth * resource.height / resource.width)

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
          const result = await scheduler.addJob('recognize', imageUrl)
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
        if (data.words.length > MIN_WORDS_FOUND) {
          ctx.drawImage(image, 0, 0)

          const cutFrequency = Math.floor(Math.random() * CUT_FREQUENCY) + 1
          if (cutFrequency === 1) {
            for (const word of data.words) {
              const { bbox } = word
              const wordFrequency = Math.floor(Math.random() * WORD_FREQUENCY) + 1
              if (wordFrequency === 1) {
                const boxwidth = bbox.x1 - bbox.x0
                const boxheight = bbox.y1 - bbox.y0
                ctx.save()
                ctx.globalCompositeOperation = 'destination-out'
                ctx.rect(bbox.x0, bbox.y0, boxwidth, boxheight)
                ctx.fill()
                ctx.restore()
                ctx.globalCompositeOperation = 'source-over'
                ctx.strokeStyle = 'black'
                ctx.strokeRect(bbox.x0, bbox.y0, boxwidth, boxheight)
              }
            }
          }
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

const downloadCurrentImage = () => {
  const canvases = [...main.querySelectorAll('canvas')]
  if (canvases.length === 0) return

  // Get dimensions from the bottom canvas (they should all be the same size)
  const bottomCanvas = canvases[0]
  const { width, height } = bottomCanvas

  // Create a composite canvas
  const composite = document.createElement('canvas')
  composite.width = width
  composite.height = height
  const ctx = composite.getContext('2d')

  // Draw canvases from bottom to top (first in DOM is bottom of stack visually)
  for (const canvas of canvases) {
    ctx.drawImage(canvas, 0, 0)
  }

  // Download the composite
  const title = manifestCache?.label || 'a-letter-groove'
  const safeTitle = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const link = document.createElement('a')
  link.download = `${safeTitle}-page-${currentPage}.png`
  link.href = composite.toDataURL('image/png')
  link.click()
}

nextButton.addEventListener('click', revealNextPage)
prevButton.addEventListener('click', revealPreviousPage)
downloadButton.addEventListener('click', downloadCurrentImage)

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