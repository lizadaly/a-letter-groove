const url = 'https://iiif.lib.harvard.edu/manifests/drs:5735821'

const req = await fetch(url)
const manifest = await req.json()
console.log(manifest)

let i = 0
const main = document.querySelector('main')



for (const item of manifest.sequences[0].canvases) {
  if (i > 51 && i < 55) {
    const imageUrl = item.images[0].resource["@id"]
    const {
      width,
      height
    } = item.images[0].resource

    const main = document.querySelector('main')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', {willReadFrequently: true})

    const image = new Image(width, height)
    image.crossOrigin = `Anonymous`
    image.src = imageUrl
    image.onload = async () => {


      const worker = Tesseract.createWorker()
      await worker.load()
      await worker.loadLanguage('eng')
      await worker.initialize('eng')

      const {
        data
      } = await worker.recognize(imageUrl)

      console.log(data)

      ctx.drawImage(image, 0, 0)
      image.style.display = 'none'

      for (const word of data.words) {
        const {
          bbox
        } = word
        ctx.fillStyle = 'white'

        window.requestAnimationFrame(() => {
          const idata = ctx.getImageData(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);

          // Create a throwaway canvas to do data transformations on
          const c = document.createElement('canvas')
          c.width = bbox.x1 - bbox.x0
          c.height = bbox.y1 - bbox.y0


          const cctx = c.getContext('2d')

          cctx.putImageData(idata, 0, 0)
          const im = new Image(c.width, c.height)
          im.src = c.toDataURL()
          im.onload = () => {
            const nc = drawRotated(im, 45)
            ctx.drawImage(nc, bbox.x0, bbox.y0)
          }

        })
      }
      await worker.terminate()

    }



    main.append(canvas)

  }
  i++
}


const drawRotated = (image, degrees) => {
  const canvas = document.createElement('canvas')
  canvas.width = image.width * 2
  canvas.height = image.height * 2
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(degrees * Math.PI / 180)
  ctx.drawImage(image, -image.width / 2, -image.height / 2)

  ctx.restore()
  return canvas
}