import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyCutouts, selectWordsForCutout, shouldCutPage } from '../../src/cutout.js'

describe('applyCutouts', () => {
  let ctx

  beforeEach(() => {
    ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      strokeRect: vi.fn(),
      globalCompositeOperation: 'source-over',
      strokeStyle: 'black',
      lineWidth: 1
    }
  })

  it('should apply cutouts at scale 1', () => {
    const cutBoxes = [
      { x0: 10, y0: 20, x1: 50, y1: 60 }
    ]

    applyCutouts(ctx, cutBoxes, 1)

    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.rect).toHaveBeenCalledWith(10, 20, 40, 40)
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 40, 40)
  })

  it('should scale cutout coordinates', () => {
    const cutBoxes = [
      { x0: 10, y0: 20, x1: 50, y1: 60 }
    ]

    applyCutouts(ctx, cutBoxes, 2)

    expect(ctx.rect).toHaveBeenCalledWith(20, 40, 80, 80)
    expect(ctx.strokeRect).toHaveBeenCalledWith(20, 40, 80, 80)
    expect(ctx.lineWidth).toBe(2)
  })

  it('should handle multiple cutouts', () => {
    const cutBoxes = [
      { x0: 0, y0: 0, x1: 10, y1: 10 },
      { x0: 20, y0: 20, x1: 30, y1: 30 }
    ]

    applyCutouts(ctx, cutBoxes, 1)

    expect(ctx.rect).toHaveBeenCalledTimes(2)
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2)
  })

  it('should handle empty cutBoxes', () => {
    applyCutouts(ctx, [], 1)

    expect(ctx.rect).not.toHaveBeenCalled()
    expect(ctx.fill).not.toHaveBeenCalled()
  })
})

describe('selectWordsForCutout', () => {
  it('should select words based on frequency', () => {
    const words = [
      { bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { bbox: { x0: 20, y0: 0, x1: 30, y1: 10 } },
      { bbox: { x0: 40, y0: 0, x1: 50, y1: 10 } }
    ]

    // With frequency 1, all words should be selected
    const allSelected = selectWordsForCutout(words, 1)
    expect(allSelected).toHaveLength(3)
  })

  it('should return copies of bounding boxes', () => {
    const words = [
      { bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }
    ]

    const selected = selectWordsForCutout(words, 1)

    // Verify it's a copy, not the same object
    expect(selected[0]).not.toBe(words[0].bbox)
    expect(selected[0]).toEqual(words[0].bbox)
  })

  it('should return empty array for empty words', () => {
    expect(selectWordsForCutout([], 1)).toEqual([])
  })

  it('should select approximately 1/n words for frequency n', () => {
    // Create many words to get statistical significance
    const words = Array.from({ length: 1000 }, (_, i) => ({
      bbox: { x0: i, y0: 0, x1: i + 1, y1: 1 }
    }))

    const frequency = 3
    const selected = selectWordsForCutout(words, frequency)

    // Should be roughly 1/3 of words, allow some variance
    expect(selected.length).toBeGreaterThan(200)
    expect(selected.length).toBeLessThan(500)
  })
})

describe('shouldCutPage', () => {
  it('should always return true when frequency is 1', () => {
    for (let i = 0; i < 10; i++) {
      expect(shouldCutPage(1)).toBe(true)
    }
  })

  it('should return true approximately 1/n times for frequency n', () => {
    const results = Array.from({ length: 1000 }, () => shouldCutPage(4))
    const trueCount = results.filter(Boolean).length

    // Should be roughly 1/4, allow variance
    expect(trueCount).toBeGreaterThan(150)
    expect(trueCount).toBeLessThan(350)
  })
})
