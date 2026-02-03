// IIIF version detection and normalisation helpers

export const isV3Manifest = (manifest) => {
  const context = manifest['@context']
  if (Array.isArray(context)) {
    return context.some(c => typeof c === 'string' && c.includes('/presentation/3'))
  }
  return typeof context === 'string' && context.includes('/presentation/3')
}

export const getCanvases = (manifest) =>
  isV3Manifest(manifest)
    ? manifest.items
    : manifest.sequences[0].canvases

export const getImageResource = (canvas, isV3) => {
  const resource = isV3
    ? canvas.items[0].items[0].body
    : canvas.images[0].resource
  // In v3, dimensions are on the canvas, not the resource
  if (isV3 && !resource.width) {
    resource.width = canvas.width
    resource.height = canvas.height
  }
  return resource
}

export const getServiceId = (service) => {
  // v3 uses an array of services, v2 uses a single object
  const svc = Array.isArray(service) ? service[0] : service
  return svc?.id || svc?.['@id']
}

// Extract a string label from manifest (v2 uses string, v3 uses language map)
export const getManifestLabel = (manifest) => {
  const label = manifest?.label
  if (!label) return null
  if (typeof label === 'string') return label
  // v3 language map: { "en": ["Title"], "none": ["Title"] }
  const values = label.en || label.none || Object.values(label)[0]
  return Array.isArray(values) ? values[0] : values
}
