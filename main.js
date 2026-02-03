const BATCH_SIZE = 20
const MIN_WORDS_FOUND = 0
const CUT_FREQUENCY = 1 // One out of every n pages will on average be cut
const WORD_FREQUENCY = 3 // One of of every n words will on average be cut
const SCHEDULER_WORKERS = 3

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
let maxCachedPages = 0

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
  const canvasCount = main.querySelectorAll('canvas').length
  maxCachedPages = Math.max(maxCachedPages, canvasCount)

  // Show max pages ready (only increases)
  pageReadyEl.textContent = maxCachedPages > 0 ? `${maxCachedPages} ready` : ''

  // Show OCR or prefetch progress with current page number
  if (currentOcrProgress.total > 0 && currentOcrProgress.completed < currentOcrProgress.total) {
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
    currentPrefetchProgress = { completed: 0, total: canvases.length, startPage: start }
    updateStatus()

    for (const item of canvases) {
      setTimeout(() => {
        const imageUrl = item.images[0].resource["@id"]
        const { width, height } = item.images[0].resource

        const canvas = document.createElement('canvas')
        canvas.width = width || 1600
        canvas.height = height || 2000
        const ctx = canvas.getContext('2d', { willReadFrequently: true })

        const image = new Image(width, height)
        image.crossOrigin = 'Anonymous'

        image.addEventListener('error', () => {
          prefetchCompleted++
          currentPrefetchProgress.completed = prefetchCompleted
          updateStatus()
          if (prefetchCompleted === canvases.length) {
            console.log(`Prefetched ${prefetchedCanvases.length} canvases`)
            prefetchInProgress = false
            currentPrefetchProgress = { completed: 0, total: 0, startPage: 0 }
            updateStatus()
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
              console.log(`Prefetched ${prefetchedCanvases.length} canvases`)
              prefetchInProgress = false
              currentPrefetchProgress = { completed: 0, total: 0, startPage: 0 }
              updateStatus()
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
            prefetchedCanvases.push(canvas)
          }

          prefetchCompleted++
          currentPrefetchProgress.completed = prefetchCompleted
          updateStatus()
          if (prefetchCompleted === canvases.length) {
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

        image.src = imageUrl
      }, 300)
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
  let firstCanvasRendered = false
  let prefetchStarted = false
  currentOcrProgress = { completed: 0, total: totalPages, startPage: start }
  showLoading(`Processing 0/${totalPages}...`)
  updateStatus()

  for (const item of canvases) {

    setTimeout(() => {
      const imageUrl = item.images[0].resource["@id"]
      const {
        width,
        height
      } = item.images[0].resource

      const canvas = document.createElement('canvas')
      canvas.width = width || 1600
      canvas.height = height || 2000
      const ctx = canvas.getContext('2d', {
        willReadFrequently: true
      })

      const image = new Image(width, height)
      image.crossOrigin = 'Anonymous'

      image.addEventListener('error', () => {
        console.warn(`Failed to load image: ${imageUrl}`)
        pagesCompleted++
        currentOcrProgress.completed = pagesCompleted
        updateStatus()
        if (!firstCanvasRendered) {
          if (pagesCompleted === totalPages) {
            hideLoading()
            batchInProgress = false
            currentOcrProgress = { completed: 0, total: 0, startPage: 0 }
            updateStatus()
          } else {
            showLoading(`Processing ${pagesCompleted}/${totalPages}...`)
          }
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
          updateStatus()
          if (!firstCanvasRendered) {
            if (pagesCompleted === totalPages) {
              hideLoading()
              batchInProgress = false
              currentOcrProgress = { completed: 0, total: 0, startPage: 0 }
              updateStatus()
            } else {
              showLoading(`Processing ${pagesCompleted}/${totalPages}...`)
            }
          }
          return
        }

        pagesCompleted++
        currentOcrProgress.completed = pagesCompleted
        updateStatus()
        if (!firstCanvasRendered) {
          if (pagesCompleted === totalPages) {
            hideLoading()
            batchInProgress = false
            currentOcrProgress = { completed: 0, total: 0, startPage: 0 }
            updateStatus()
          } else {
            showLoading(`Processing ${pagesCompleted}/${totalPages}...`)
          }
        }

        // Only draw the image if there are at least some OCR detections
        if (data.words.length > MIN_WORDS_FOUND) {

          ctx.drawImage(image, 0, 0)

          const cutFrequency = Math.floor(Math.random() * CUT_FREQUENCY) + 1
          if (cutFrequency === 1) {

            for (const word of data.words) {
              const {
                bbox
              } = word

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
          main.insertBefore(canvas, main.firstChild)
          browseNav.classList.remove('hidden')
          updateStatus()

          if (!firstCanvasRendered) {
            firstCanvasRendered = true
            hideLoading()
            batchInProgress = false
            currentOcrProgress = { completed: 0, total: 0, startPage: 0 }
            currentPage = 1
            updatePageCounter()
            updateStatus()
            // Start prefetching next batch after first canvas renders
            if (!prefetchStarted) {
              prefetchStarted = true
              prefetchNextBatch(url, start + BATCH_SIZE)
            }
          }
        }
      })

      image.src = imageUrl
    }, 300)
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
  const canvas = main.querySelector('canvas:last-of-type')
  if (!canvas) return

  // Create a temporary link and trigger download
  const link = document.createElement('a')
  link.download = `a-letter-groove-page-${currentPage}.png`
  link.href = canvas.toDataURL('image/png')
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