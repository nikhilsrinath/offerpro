/**
 * Ensure an image source is a base64 data URL for jsPDF compatibility.
 * If already base64 or null, returns as-is.
 * If a hosted URL, fetches and converts to base64.
 */
export async function resolveImageToBase64(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;

  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

/**
 * Resolve all image fields in a form data object to base64.
 */
export async function resolveFormImages(formData, imageFields) {
  const resolved = { ...formData };
  for (const field of imageFields) {
    if (resolved[field]) {
      resolved[field] = await resolveImageToBase64(resolved[field]);
    }
  }
  return resolved;
}
