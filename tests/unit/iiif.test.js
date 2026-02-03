import { describe, it, expect } from 'vitest'
import {
  isV3Manifest,
  getCanvases,
  getImageResource,
  getServiceId,
  getManifestLabel
} from '../../src/iiif.js'

import manifestV2 from '../fixtures/manifest-v2.json'
import manifestV3 from '../fixtures/manifest-v3.json'

describe('isV3Manifest', () => {
  it('should detect v2 manifest by string context', () => {
    expect(isV3Manifest(manifestV2)).toBe(false)
  })

  it('should detect v3 manifest by string context', () => {
    expect(isV3Manifest(manifestV3)).toBe(true)
  })

  it('should detect v3 manifest when context is an array', () => {
    const manifest = {
      '@context': [
        'http://www.w3.org/ns/anno.jsonld',
        'http://iiif.io/api/presentation/3/context.json'
      ]
    }
    expect(isV3Manifest(manifest)).toBe(true)
  })
})

describe('getCanvases', () => {
  it('should extract canvases from v2 manifest sequences', () => {
    const canvases = getCanvases(manifestV2)
    expect(canvases).toHaveLength(2)
    expect(canvases[0]['@id']).toBe('https://example.org/iiif/book1/canvas/p1')
  })

  it('should extract canvases from v3 manifest items', () => {
    const canvases = getCanvases(manifestV3)
    expect(canvases).toHaveLength(2)
    expect(canvases[0].id).toBe('https://example.org/iiif/book2/canvas/p1')
  })
})

describe('getImageResource', () => {
  it('should extract resource from v2 canvas', () => {
    const canvas = getCanvases(manifestV2)[0]
    const resource = getImageResource(canvas, false)
    expect(resource['@id']).toBe('https://example.org/iiif/book1/res/page1.jpg')
    expect(resource.width).toBe(750)
    expect(resource.height).toBe(1000)
  })

  it('should extract resource from v3 canvas and inherit dimensions', () => {
    const canvas = getCanvases(manifestV3)[0]
    const resource = getImageResource(canvas, true)
    expect(resource.id).toBe('https://example.org/iiif/book2/page1/full/max/0/default.jpg')
    expect(resource.width).toBe(800)
    expect(resource.height).toBe(1200)
  })
})

describe('getServiceId', () => {
  it('should extract @id from v2 service object', () => {
    const service = { '@id': 'https://example.org/iiif/image1' }
    expect(getServiceId(service)).toBe('https://example.org/iiif/image1')
  })

  it('should extract id from v3 service array', () => {
    const service = [{ id: 'https://example.org/iiif/image2' }]
    expect(getServiceId(service)).toBe('https://example.org/iiif/image2')
  })

  it('should handle null/undefined service', () => {
    expect(getServiceId(null)).toBeUndefined()
    expect(getServiceId(undefined)).toBeUndefined()
  })
})

describe('getManifestLabel', () => {
  it('should extract string label from v2 manifest', () => {
    expect(getManifestLabel(manifestV2)).toBe('Book of Hours')
  })

  it('should extract label from v3 language map', () => {
    expect(getManifestLabel(manifestV3)).toBe('Medieval Manuscript')
  })

  it('should handle missing label', () => {
    expect(getManifestLabel({})).toBeNull()
    expect(getManifestLabel(null)).toBeNull()
  })

  it('should handle "none" language key', () => {
    const manifest = { label: { none: ['Untitled'] } }
    expect(getManifestLabel(manifest)).toBe('Untitled')
  })
})
