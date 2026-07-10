export const MAX_PIXEL_AREA = 100_000;

export interface ResizeDimensions {
  width: number;
  height: number;
  pixelArea: number;
  resized: boolean;
}

export function calculateResizeDimensions(
  width: number,
  height: number,
  maxPixelArea = MAX_PIXEL_AREA,
): ResizeDimensions {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError('Image dimensions must be positive safe integers.');
  }

  if (!Number.isSafeInteger(maxPixelArea) || maxPixelArea <= 0) {
    throw new RangeError('The pixel-area limit must be a positive safe integer.');
  }

  const sourceWidth = width;
  const sourceHeight = height;
  const sourcePixelArea = sourceWidth * sourceHeight;

  if (sourcePixelArea <= maxPixelArea) {
    return {
      width: sourceWidth,
      height: sourceHeight,
      pixelArea: sourcePixelArea,
      resized: false,
    };
  }

  const scale = Math.sqrt(maxPixelArea / sourcePixelArea);
  let targetWidth = Math.max(1, Math.floor(sourceWidth * scale));
  let targetHeight = Math.max(1, Math.floor(sourceHeight * scale));

  // A one-pixel dimension can make a uniform scale impossible for extreme
  // aspect ratios. Constrain the longer side so the area invariant still holds.
  if (targetWidth * targetHeight > maxPixelArea) {
    if (targetWidth >= targetHeight) {
      targetWidth = Math.max(1, Math.floor(maxPixelArea / targetHeight));
    } else {
      targetHeight = Math.max(1, Math.floor(maxPixelArea / targetWidth));
    }
  }

  return {
    width: targetWidth,
    height: targetHeight,
    pixelArea: targetWidth * targetHeight,
    resized: true,
  };
}

export function createOutputFilename(sourceName: string): string {
  const trimmedName = sourceName.trim();
  const extensionIndex = trimmedName.lastIndexOf('.');
  const stem = extensionIndex > 0 ? trimmedName.slice(0, extensionIndex) : trimmedName;

  return `${stem || 'image'}-100k.png`;
}
