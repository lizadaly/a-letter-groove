// Apply cutouts to a canvas context at a given scale
export const applyCutouts = (ctx, cutBoxes, scale = 1) => {
  for (const bbox of cutBoxes) {
    const x = bbox.x0 * scale
    const y = bbox.y0 * scale
    const boxwidth = (bbox.x1 - bbox.x0) * scale
    const boxheight = (bbox.y1 - bbox.y0) * scale
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.rect(x, y, boxwidth, boxheight)
    ctx.fill()
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'black'
    ctx.lineWidth = scale // Scale stroke width proportionally
    ctx.strokeRect(x, y, boxwidth, boxheight)
  }
}

// Select which words to cut based on frequency
export const selectWordsForCutout = (words, wordFrequency) => {
  const cutBoxes = []
  for (const word of words) {
    const { bbox } = word
    const roll = Math.floor(Math.random() * wordFrequency) + 1
    if (roll === 1) {
      cutBoxes.push({ ...bbox })
    }
  }
  return cutBoxes
}

// Determine if a page should be cut based on frequency
export const shouldCutPage = (cutFrequency) => {
  const roll = Math.floor(Math.random() * cutFrequency) + 1
  return roll === 1
}
