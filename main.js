
const main = document.querySelector('main')
const form = main.querySelector('form')
form.addEventListener('submit', (e) => {
  e.preventDefault()
  const form = e.target
  bookRender(form['url'].value)
})

let i = 0

const bookRender = async (url) => {
  form.style.display = 'none'
  const req = await fetch(url)
  const manifest = await req.json()
  console.log(manifest)

  for (const item of manifest.sequences[0].canvases) {
    if (i > 100 && i <= 150) {

      setTimeout(() => {
      const imageUrl = item.images[0].resource["@id"]
      const {
        width,
        height
      } = item.images[0].resource

      const main = document.querySelector('main')
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', {
        willReadFrequently: true
      })

      const image = new Image(width, height)
      image.crossOrigin = 'Anonymous'
      image.src = imageUrl

      const render = async () => {

        const worker = Tesseract.createWorker()
        await worker.load()
        await worker.loadLanguage('eng')
        await worker.initialize('eng')

        const {
          data
        } = await worker.recognize(imageUrl)


        // Only draw the image if there are at least some OCR detections
        if (data.words.length < 200) {
          canvas.parentNode.removeChild(canvas)
          return
        }
        ctx.drawImage(image, 0, 0)

        for (const word of data.words) {
          const {
            bbox
          } = word

          const boxwidth = bbox.x1 - bbox.x0
          const boxheight = bbox.y1 - bbox.y0
          const boxarea = boxwidth * boxheight

          ctx.save()
          ctx.globalCompositeOperation = 'destination-out'
          ctx.rect(bbox.x0, bbox.y0, boxwidth, boxheight)
          ctx.fill()
          ctx.restore()

          ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = 'black'
          ctx.strokeRect(bbox.x0, bbox.y0, boxwidth, boxheight)

        }
        await worker.terminate()

      }
      image.onload = render

      // if (i % 2 == 0) {
      //   image.onload = render

      // } else {
      //   image.onload = () => ctx.drawImage(image, 0, 0)
      // }
      main.append(canvas)

      }, 300)
    }
    i += 1
  }
}