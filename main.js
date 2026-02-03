const BATCH_SIZE = 20
const MIN_WORDS_FOUND = 100
const CUT_FREQUENCY = 1 // One out of every n pages will on average be cut
const WORD_FREQUENCY = 3 // One of of every n words will on average be cut
const SCHEDULER_WORKERS = 3

let url, lastStart
let scheduler = null
let pagesCompleted = 0
let totalPages = 0

const loadingEl = document.querySelector('#loading')
const loadingText = document.querySelector('#loading-text')

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
main.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  url = form['url'].value
  lastStart = 0
  showLoading('Initialising OCR...')
  await initScheduler()
  bookRender(url, 0)
})

const bookRender = async (url, start) => {
  document.querySelector('form').style.display = 'none'
  const req = await fetch(url)
  const manifest = await req.json()
  console.log(manifest)

  const canvases = manifest.sequences[0].canvases.slice(start, start + BATCH_SIZE)
  totalPages = canvases.length
  pagesCompleted = 0
  let firstCanvasRendered = false
  showLoading(`Processing 0/${totalPages}...`)

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
      image.src = imageUrl

      image.addEventListener('error', () => {
        console.warn(`Failed to load image: ${imageUrl}`)
        pagesCompleted++
        if (!firstCanvasRendered) {
          if (pagesCompleted === totalPages) {
            hideLoading()
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
          if (!firstCanvasRendered) {
            if (pagesCompleted === totalPages) {
              hideLoading()
            } else {
              showLoading(`Processing ${pagesCompleted}/${totalPages}...`)
            }
          }
          return
        }

        pagesCompleted++
        if (!firstCanvasRendered) {
          if (pagesCompleted === totalPages) {
            hideLoading()
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
          document.querySelector('button').classList.remove('hidden')

          if (!firstCanvasRendered) {
            firstCanvasRendered = true
            hideLoading()
          }
        }
      })
    }, 300)
  }
}

document.querySelector('button').addEventListener('click', () => {
  const canvas = main.querySelector('canvas:last-of-type')
  canvas.parentNode.removeChild(canvas)
  console.log([...main.querySelectorAll('canvas')].length)

  if ([...main.querySelectorAll('canvas')].length < 5) {
    lastStart = lastStart + BATCH_SIZE

    console.log(`Triggering new batch starting from ${lastStart}`)
    bookRender(url, lastStart)
  }
})