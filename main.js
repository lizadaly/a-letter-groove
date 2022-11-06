const BATCH_SIZE = 20
const MIN_WORDS_FOUND = 100
const CUT_FREQUENCY = 1 // One out of every n pages will on average be cut
const WORD_FREQUENCY = 3 // One of of every n words will on average be cut

let url, lastStart

const main = document.querySelector('main')
main.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault()
  const form = e.target
  url = form['url'].value
  lastStart = 0
  bookRender(url, 0)
})

const bookRender = async (url, start) => {
  document.querySelector('form').style.display = 'none'
  const req = await fetch(url)
  const manifest = await req.json()
  console.log(manifest)

  for (const item of manifest.sequences[0].canvases.slice(start, start + BATCH_SIZE)) {

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

      image.addEventListener('load', async () => {
        console.log(`OCRing ${imageUrl}...`)
        const worker = Tesseract.createWorker()
        await worker.load()
        await worker.loadLanguage('eng')
        await worker.initialize('eng')

        const {
          data
        } = await worker.recognize(imageUrl)

        worker.terminate()
        // console.log(`Got ${data.words.length} words for this page...`)

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