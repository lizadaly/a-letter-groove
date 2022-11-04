

(async () => {


  for (const image of document.querySelectorAll('.page')) {
    const worker = Tesseract.createWorker()
    await worker.load()
    await worker.loadLanguage('eng')
    await worker.initialize('eng')
    const {
      data
    } = await worker.recognize(image.src)
    console.log(data)

    const main = document.querySelector('main')
    const canvas = document.createElement('canvas')
    canvas.willReadFrequently = true
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
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
          const nc = drawRotated(im, 180)
          ctx.drawImage(nc, bbox.x0, bbox.y0)
        }
        // const outer = document.createElement('canvas')
        // outer.width = im.width
        // outer.height = im.height
        // const octx = outer.getContext('2d')

        // octx.drawImage(im, 0, 0)
        // main.append(outer)
      })
    }



    main.append(canvas)

    await worker.terminate()
  }
})()


const drawRotated = (image, degrees) => {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(degrees * Math.PI / 180)
  ctx.drawImage(image, -image.width / 2, -image.height / 2)

  ctx.restore()
  return canvas
}