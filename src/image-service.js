import { getServiceId } from './iiif.js'

// Find the best pre-computed size closest to target width
export const findBestSize = (sizes, targetWidth) => {
  if (!sizes || sizes.length === 0) return null

  // Sort by width
  const sorted = [...sizes].sort((a, b) => a.width - b.width)

  // Find sizes at or above target
  const atOrAbove = sorted.filter(s => s.width >= targetWidth)
  if (atOrAbove.length > 0) {
    // Return smallest size that's >= target
    return atOrAbove[0]
  }

  // All sizes are below target, return the largest available
  return sorted[sorted.length - 1]
}

// Factory function to create an image service with injected fetch
export const createImageService = (fetchFn = fetch) => {
  const cache = new Map()

  const fetchImageInfo = async (serviceId) => {
    if (cache.has(serviceId)) {
      return cache.get(serviceId)
    }
    try {
      const response = await fetchFn(`${serviceId}/info.json`)
      if (!response.ok) {
        cache.set(serviceId, null)
        return null
      }
      const info = await response.json()
      cache.set(serviceId, info)
      return info
    } catch (err) {
      console.warn(`Failed to fetch info.json for ${serviceId}:`, err.message)
      cache.set(serviceId, null)
      return null
    }
  }

  const getImageUrlAndSize = async (resource, maxWidth) => {
    const service = resource.service
    const serviceId = service && getServiceId(service)
    const fullWidth = resource.width
    const fullHeight = resource.height

    if (serviceId) {
      if (maxWidth === 'full') {
        return {
          url: `${serviceId}/full/full/0/default.jpg`,
          width: fullWidth,
          height: fullHeight
        }
      }

      // Try to find a pre-computed size close to our target
      const info = await fetchImageInfo(serviceId)
      if (info?.sizes) {
        const bestSize = findBestSize(info.sizes, maxWidth)
        if (bestSize) {
          console.log(`Using pre-computed size ${bestSize.width}x${bestSize.height} (target: ${maxWidth})`)
          return {
            url: `${serviceId}/full/${bestSize.width},${bestSize.height}/0/default.jpg`,
            width: bestSize.width,
            height: bestSize.height
          }
        }
      }

      // Fall back to requesting our target width
      const scaledHeight = Math.round(maxWidth * fullHeight / fullWidth)
      return {
        url: `${serviceId}/full/${maxWidth},/0/default.jpg`,
        width: maxWidth,
        height: scaledHeight
      }
    }

    // No service, use static URL with original dimensions
    return {
      url: resource.id || resource['@id'],
      width: fullWidth,
      height: fullHeight
    }
  }

  const getFullSizeImageUrl = async (resource) => {
    const service = resource.service
    const serviceId = service && getServiceId(service)
    const fullWidth = resource.width
    const fullHeight = resource.height

    if (serviceId) {
      // Check info.json for the largest available pre-computed size
      const info = await fetchImageInfo(serviceId)
      if (info?.sizes && info.sizes.length > 0) {
        const largest = info.sizes.reduce((a, b) => a.width > b.width ? a : b)
        return {
          url: `${serviceId}/full/${largest.width},${largest.height}/0/default.jpg`,
          width: largest.width,
          height: largest.height
        }
      }
      // Fall back to requesting explicit full dimensions
      return {
        url: `${serviceId}/full/${fullWidth},${fullHeight}/0/default.jpg`,
        width: fullWidth,
        height: fullHeight
      }
    }
    return {
      url: resource.id || resource['@id'],
      width: fullWidth,
      height: fullHeight
    }
  }

  return {
    fetchImageInfo,
    getImageUrlAndSize,
    getFullSizeImageUrl
  }
}
