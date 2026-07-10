import pica from 'pica';
import {
  calculateResizeDimensions,
  createOutputFilename,
  MAX_PIXEL_AREA,
} from './resize-policy';

type StatusState = 'idle' | 'error' | 'success';

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Image resizer is missing required element: ${selector}`);
  }

  return element;
}

function formatDimensions(width: number, height: number): string {
  const pixels = new Intl.NumberFormat('en-US').format(width * height);
  return `${width} × ${height} · ${pixels} pixels`;
}

export function initImageResizer(root: HTMLElement): () => void {
  const fileInput = requireElement<HTMLInputElement>(root, '[data-role="file-input"]');
  const convertButton = requireElement<HTMLButtonElement>(root, '[data-action="convert"]');
  const downloadButton = requireElement<HTMLButtonElement>(root, '[data-action="download"]');
  const sourceImage = requireElement<HTMLImageElement>(root, '[data-role="source-image"]');
  const outputImage = requireElement<HTMLImageElement>(root, '[data-role="output-image"]');
  const sourcePlaceholder = requireElement<HTMLElement>(root, '[data-role="source-placeholder"]');
  const outputPlaceholder = requireElement<HTMLElement>(root, '[data-role="output-placeholder"]');
  const sourceDetails = requireElement<HTMLElement>(root, '[data-role="source-details"]');
  const outputDetails = requireElement<HTMLElement>(root, '[data-role="output-details"]');
  const status = requireElement<HTMLElement>(root, '[data-role="status"]');
  const imageProcessor = pica();

  let sourceFile: File | null = null;
  let sourceUrl: string | null = null;
  let outputUrl: string | null = null;
  let outputFilename = '';
  let resizeRequired = false;
  let busy = false;

  function setStatus(message: string, state: StatusState = 'idle'): void {
    status.textContent = message;
    status.dataset.state = state;
  }

  function updateControls(): void {
    fileInput.disabled = busy;
    convertButton.disabled = busy || !sourceFile || !resizeRequired;
    downloadButton.disabled = busy || !outputUrl;
    root.setAttribute('aria-busy', String(busy));
  }

  function setBusy(nextBusy: boolean): void {
    busy = nextBusy;
    updateControls();
  }

  function clearOutput(): void {
    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      outputUrl = null;
    }

    outputImage.removeAttribute('src');
    outputImage.hidden = true;
    outputPlaceholder.hidden = false;
    outputDetails.textContent = 'Awaiting conversion';
    outputFilename = '';
    updateControls();
  }

  function clearSource(): void {
    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = null;
    }

    sourceFile = null;
    resizeRequired = false;
    sourceImage.removeAttribute('src');
    sourceImage.hidden = true;
    sourcePlaceholder.hidden = false;
    sourceDetails.textContent = 'No image selected';
    updateControls();
  }

  async function loadSource(file: File): Promise<void> {
    setBusy(true);
    clearOutput();
    clearSource();
    setStatus('Reading the source image…');

    try {
      if (file.type && !file.type.startsWith('image/')) {
        throw new Error('not-an-image');
      }

      sourceUrl = URL.createObjectURL(file);
      sourceImage.src = sourceUrl;
      sourceImage.alt = `Preview of ${file.name}`;
      await sourceImage.decode();

      const { naturalWidth, naturalHeight } = sourceImage;
      const target = calculateResizeDimensions(naturalWidth, naturalHeight);

      sourceFile = file;
      resizeRequired = target.resized;
      sourceImage.hidden = false;
      sourcePlaceholder.hidden = true;
      sourceDetails.textContent = formatDimensions(naturalWidth, naturalHeight);

      if (resizeRequired) {
        setStatus('Source ready. Resize it to create a locally generated PNG.', 'success');
      } else {
        setStatus(
          `No conversion needed: this image is already within the ${MAX_PIXEL_AREA.toLocaleString('en-US')}-pixel limit.`,
          'success',
        );
      }
    } catch {
      clearSource();
      fileInput.value = '';
      setStatus('This file could not be decoded as an image. Choose a different file.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function convertSource(): Promise<void> {
    if (!sourceFile || !resizeRequired) {
      return;
    }

    const target = calculateResizeDimensions(sourceImage.naturalWidth, sourceImage.naturalHeight);
    setBusy(true);
    clearOutput();
    setStatus('Resizing locally…');

    try {
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;

      await imageProcessor.resize(sourceImage, canvas, {
        filter: 'mks2013',
        unsharpAmount: 80,
        unsharpThreshold: 2,
      });

      const blob = await imageProcessor.toBlob(canvas, 'image/png');
      outputUrl = URL.createObjectURL(blob);
      outputFilename = createOutputFilename(sourceFile.name);
      outputImage.src = outputUrl;
      outputImage.alt = `Resized preview of ${sourceFile.name}`;
      await outputImage.decode();

      outputImage.hidden = false;
      outputPlaceholder.hidden = true;
      outputDetails.textContent = formatDimensions(target.width, target.height);
      setStatus('Resize complete. The PNG is ready to download.', 'success');
    } catch {
      clearOutput();
      setStatus('The image could not be resized. Try a different or smaller source image.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function downloadOutput(): void {
    if (!outputUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = outputUrl;
    link.download = outputFilename;
    link.hidden = true;
    root.appendChild(link);
    link.click();
    link.remove();
  }

  function handleFileChange(): void {
    const file = fileInput.files?.[0];

    if (file) {
      void loadSource(file);
    }
  }

  function cleanup(): void {
    fileInput.removeEventListener('change', handleFileChange);
    convertButton.removeEventListener('click', handleConvert);
    downloadButton.removeEventListener('click', downloadOutput);
    window.removeEventListener('pagehide', cleanup);
    clearOutput();
    clearSource();
  }

  function handleConvert(): void {
    void convertSource();
  }

  fileInput.addEventListener('change', handleFileChange);
  convertButton.addEventListener('click', handleConvert);
  downloadButton.addEventListener('click', downloadOutput);
  window.addEventListener('pagehide', cleanup, { once: true });
  updateControls();

  return cleanup;
}
