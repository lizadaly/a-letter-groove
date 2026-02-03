import { describe, it, expect, vi } from 'vitest'
import { findBestSize, createImageService } from '../../src/image-service.js'

import infoJson from '../fixtures/info.json'

describe('findBestSize', () => {
  const sizes = [
    { width: 150, height: 200 },
    { width: 600, height: 800 },
    { width: 300, height: 400 },
    { width: 1200, height: 1600 }
  ]

  it('should return smallest size >= target when available', () => {
    expect(findBestSize(sizes, 500)).toEqual({ width: 600, height: 800 })
  })

  it('should return exact match when target equals a size', () => {
    expect(findBestSize(sizes, 600)).toEqual({ width: 600, height: 800 })
  })

  it('should return largest size when all sizes are below target', () => {
    expect(findBestSize(sizes, 2000)).toEqual({ width: 1200, height: 1600 })
  })

  it('should return smallest size when target is very small', () => {
    expect(findBestSize(sizes, 100)).toEqual({ width: 150, height: 200 })
  })

  it('should return null for empty or missing sizes', () => {
    expect(findBestSize([], 500)).toBeNull()
    expect(findBestSize(null, 500)).toBeNull()
    expect(findBestSize(undefined, 500)).toBeNull()
  })
})

describe('createImageService', () => {
  const mockFetch = vi.fn()

  it('should fetch and cache info.json', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(infoJson)
    })

    const service = createImageService(mockFetch)
    const info = await service.fetchImageInfo('https://example.org/iiif/image1')

    expect(info).toEqual(infoJson)
    expect(mockFetch).toHaveBeenCalledWith('https://example.org/iiif/image1/info.json')

    // Second call should use cache
    mockFetch.mockClear()
    const cached = await service.fetchImageInfo('https://example.org/iiif/image1')
    expect(cached).toEqual(infoJson)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should cache null on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const service = createImageService(mockFetch)
    const info = await service.fetchImageInfo('https://example.org/bad')

    expect(info).toBeNull()

    // Second call should return cached null without fetching
    mockFetch.mockClear()
    const cached = await service.fetchImageInfo('https://example.org/bad')
    expect(cached).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  describe('getImageUrlAndSize', () => {
    it('should use pre-computed size from info.json', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(infoJson)
      })

      const service = createImageService(mockFetch)
      const resource = {
        width: 3000,
        height: 4000,
        service: { '@id': 'https://example.org/iiif/image1' }
      }

      const result = await service.getImageUrlAndSize(resource, 500)

      expect(result.url).toBe('https://example.org/iiif/image1/full/600,800/0/default.jpg')
      expect(result.width).toBe(600)
      expect(result.height).toBe(800)
    })

    it('should return full URL when maxWidth is "full"', async () => {
      const service = createImageService(mockFetch)
      const resource = {
        width: 3000,
        height: 4000,
        service: { '@id': 'https://example.org/iiif/image1' }
      }

      const result = await service.getImageUrlAndSize(resource, 'full')

      expect(result.url).toBe('https://example.org/iiif/image1/full/full/0/default.jpg')
      expect(result.width).toBe(3000)
      expect(result.height).toBe(4000)
    })

    it('should fall back to static URL when no service', async () => {
      const service = createImageService(mockFetch)
      const resource = {
        '@id': 'https://example.org/static/image.jpg',
        width: 800,
        height: 600
      }

      const result = await service.getImageUrlAndSize(resource, 500)

      expect(result.url).toBe('https://example.org/static/image.jpg')
      expect(result.width).toBe(800)
      expect(result.height).toBe(600)
    })
  })

  describe('getFullSizeImageUrl', () => {
    it('should return largest pre-computed size', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(infoJson)
      })

      const service = createImageService(mockFetch)
      const resource = {
        width: 3000,
        height: 4000,
        service: { '@id': 'https://example.org/iiif/image1' }
      }

      const result = await service.getFullSizeImageUrl(resource)

      expect(result.url).toBe('https://example.org/iiif/image1/full/3000,4000/0/default.jpg')
      expect(result.width).toBe(3000)
      expect(result.height).toBe(4000)
    })

    it('should fall back to explicit dimensions when no sizes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ width: 2000, height: 3000 })
      })

      const service = createImageService(mockFetch)
      const resource = {
        width: 2000,
        height: 3000,
        service: { '@id': 'https://example.org/iiif/image2' }
      }

      const result = await service.getFullSizeImageUrl(resource)

      expect(result.url).toBe('https://example.org/iiif/image2/full/2000,3000/0/default.jpg')
    })
  })
})
