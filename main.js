const BATCH_SIZE = 20

let url, lastStart

const main = document.querySelector('main')
main.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault()
  const form = e.target
  url = form['url'].value
  lastStart = 0
  bookRender(url, 0)
})

let i = 0

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
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', {
        willReadFrequently: true
      })

      const image = new Image(width, height)
      image.crossOrigin = 'Anonymous'
      image.src = imageUrl

      image.addEventListener('load', async () => {
        console.log("rendering ocr...")
        const worker = Tesseract.createWorker()
        await worker.load()
        await worker.loadLanguage('eng')
        await worker.initialize('eng')

        const {
          data
        } = await worker.recognize(imageUrl)

        worker.terminate()

        // Only draw the image if there are at least some OCR detections
        if (data.words.length > 200) {

          ctx.drawImage(image, 0, 0)

          for (const word of data.words) {
            const {
              bbox
            } = word

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
          main.insertBefore(canvas, main.firstChild)
          document.querySelector('button').classList.remove('hidden')
        }
      })

    }, 300)

    i += 1
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