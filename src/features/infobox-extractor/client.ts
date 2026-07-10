import {
  abortableDelay,
  isAbortError,
  MediaWikiClient,
  normaliseCategoryName,
  normaliseWikiUrl,
} from './mediawiki';
import { PAGE_COLUMN, serialiseTsv, type TsvRow } from './tsv';
import { parseTemplate } from './wikitext-template-parser';

const BATCH_SIZE = 50;
const BATCH_DELAY = 500;
const LARGE_CATEGORY = 50;

type StatusState = 'error' | 'neutral' | 'success';

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Infobox extractor is missing ${selector}.`);
  return element;
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export function mountInfoboxExtractor(root: HTMLElement): void {
  const form = requiredElement<HTMLFormElement>(root, '[data-extractor-form]');
  const wikiInput = requiredElement<HTMLInputElement>(root, '[data-wiki-url]');
  const categoryInput = requiredElement<HTMLInputElement>(root, '[data-category]');
  const loadCategoryButton = requiredElement<HTMLButtonElement>(root, '[data-load-category]');
  const pagesInput = requiredElement<HTMLTextAreaElement>(root, '[data-pages]');
  const templatesInput = requiredElement<HTMLTextAreaElement>(root, '[data-templates]');
  const runButton = requiredElement<HTMLButtonElement>(root, '[data-run]');
  const cancelButton = requiredElement<HTMLButtonElement>(root, '[data-cancel]');
  const progress = requiredElement<HTMLProgressElement>(root, '[data-progress]');
  const progressLabel = requiredElement<HTMLElement>(root, '[data-progress-label]');
  const status = requiredElement<HTMLElement>(root, '[data-status]');
  const result = requiredElement<HTMLTextAreaElement>(root, '[data-result]');
  const downloadButton = requiredElement<HTMLButtonElement>(root, '[data-download]');
  const lockedControls = root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >('[data-lock-while-running]');

  const clients = new Map<string, MediaWikiClient>();
  let activeController: AbortController | null = null;

  const setStatus = (message: string, state: StatusState = 'neutral') => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const setProgress = (value: number, maximum: number, label: string) => {
    progress.max = Math.max(maximum, 1);
    progress.value = Math.min(value, progress.max);
    progressLabel.textContent = label;
  };

  const setBusy = (busy: boolean) => {
    lockedControls.forEach((control) => {
      control.disabled = busy;
    });
    runButton.disabled = busy;
    loadCategoryButton.disabled = busy;
    cancelButton.disabled = !busy;
    root.dataset.busy = String(busy);
  };

  const beginTask = () => {
    if (activeController) return null;
    activeController = new AbortController();
    setBusy(true);
    return activeController;
  };

  const finishTask = (controller: AbortController) => {
    if (activeController !== controller) return;
    activeController = null;
    setBusy(false);
  };

  const readWikiUrl = (): URL | null => {
    wikiInput.setCustomValidity('');

    try {
      const url = normaliseWikiUrl(wikiInput.value);
      wikiInput.value = url.href;
      return url;
    } catch (error) {
      const message = errorMessage(error);
      wikiInput.setCustomValidity(message);
      wikiInput.reportValidity();
      setStatus(message, 'error');
      return null;
    }
  };

  const clientFor = (url: URL) => {
    const cached = clients.get(url.href);
    if (cached) return cached;

    const client = new MediaWikiClient(url);
    clients.set(url.href, client);
    return client;
  };

  wikiInput.addEventListener('input', () => wikiInput.setCustomValidity(''));

  loadCategoryButton.addEventListener('click', async () => {
    const category = normaliseCategoryName(categoryInput.value);
    if (!category) {
      setStatus('Enter a category name before loading its members.', 'error');
      categoryInput.focus();
      return;
    }

    const wikiUrl = readWikiUrl();
    if (!wikiUrl) return;

    const controller = beginTask();
    if (!controller) return;

    setProgress(0, 1, 'Discovering the wiki API…');
    setStatus(`Inspecting Category:${category}…`);

    try {
      const client = clientFor(wikiUrl);
      const size = await client.getCategorySize(category, controller.signal);

      if (
        size !== null &&
        size > LARGE_CATEGORY &&
        !window.confirm(
          `Category “${category}” contains ${size.toLocaleString()} members. Load all of them?`,
        )
      ) {
        setStatus('Category loading cancelled.');
        setProgress(0, Math.max(size, 1), 'No category members loaded');
        return;
      }

      setStatus(`Loading members of Category:${category}…`);
      const members = await client.getCategoryMembers(
        category,
        controller.signal,
        (loaded) => {
          setProgress(
            loaded,
            Math.max(size ?? loaded, loaded),
            `${loaded.toLocaleString()} member${loaded === 1 ? '' : 's'} loaded`,
          );
        },
      );

      if (members.length === 0) {
        setStatus(`Category:${category} has no members or does not exist.`, 'error');
        setProgress(0, Math.max(size ?? 1, 1), 'No category members found');
        return;
      }

      const currentTitles = lines(pagesInput.value);
      const seen = new Set(currentTitles);
      const additions = members.filter((title) => {
        if (seen.has(title)) return false;
        seen.add(title);
        return true;
      });

      pagesInput.value = [...currentTitles, ...additions].join('\n');
      const duplicates = members.length - additions.length;
      const duplicateNote = duplicates > 0 ? `; ${duplicates.toLocaleString()} already listed` : '';
      setStatus(
        `Added ${additions.length.toLocaleString()} page title${additions.length === 1 ? '' : 's'}${duplicateNote}.`,
        'success',
      );
      setProgress(members.length, members.length, `${members.length.toLocaleString()} members loaded`);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        setStatus('Category loading stopped; the page list was left unchanged.');
      } else {
        setStatus(errorMessage(error), 'error');
      }
    } finally {
      finishTask(controller);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const pageTitles = lines(pagesInput.value);
    const templateNames = lines(templatesInput.value);

    if (pageTitles.length === 0) {
      setStatus('Enter at least one page title.', 'error');
      pagesInput.focus();
      return;
    }
    if (templateNames.length === 0) {
      setStatus('Enter at least one template name.', 'error');
      templatesInput.focus();
      return;
    }

    const wikiUrl = readWikiUrl();
    if (!wikiUrl) return;

    const controller = beginTask();
    if (!controller) return;

    const columns = [PAGE_COLUMN];
    const knownColumns = new Set(columns);
    const rows: TsvRow[] = [];
    const missingTitles: string[] = [];
    let matchedPages = 0;

    const renderRows = () => {
      result.value = serialiseTsv(columns, rows);
      result.scrollTop = result.scrollHeight;
      downloadButton.disabled = rows.length === 0;
    };

    renderRows();
    setProgress(0, pageTitles.length, `0 of ${pageTitles.length.toLocaleString()} pages processed`);
    setStatus('Discovering the wiki API…');

    try {
      const client = clientFor(wikiUrl);

      for (let start = 0; start < pageTitles.length; start += BATCH_SIZE) {
        controller.signal.throwIfAborted();
        const batch = pageTitles.slice(start, start + BATCH_SIZE);
        const end = Math.min(start + batch.length, pageTitles.length);
        setStatus(
          `Fetching pages ${(start + 1).toLocaleString()}–${end.toLocaleString()} of ${pageTitles.length.toLocaleString()}…`,
        );

        const pages = await client.getPages(batch, controller.signal);

        for (const page of pages) {
          controller.signal.throwIfAborted();
          const row = new Map<string, string>([[PAGE_COLUMN, page.requestedTitle]]);

          if (page.missing) {
            missingTitles.push(page.requestedTitle);
          } else {
            let pageMatched = false;

            templateNames.forEach((templateName, templateIndex) => {
              const parsed = parseTemplate(page.wikitext, templateName);
              if (!parsed) return;
              pageMatched = true;

              for (const [parameter, value] of parsed.params) {
                const column =
                  templateNames.length === 1
                    ? parameter
                    : `${templateIndex + 1}_${parameter}`;
                row.set(column, value);

                if (!knownColumns.has(column)) {
                  knownColumns.add(column);
                  columns.push(column);
                }
              }
            });

            if (pageMatched) matchedPages += 1;
          }

          rows.push(row);
          setProgress(
            rows.length,
            pageTitles.length,
            `${rows.length.toLocaleString()} of ${pageTitles.length.toLocaleString()} pages processed`,
          );
          await abortableDelay(0, controller.signal);
        }

        renderRows();

        if (end < pageTitles.length) await abortableDelay(BATCH_DELAY, controller.signal);
      }

      const missingNote =
        missingTitles.length > 0
          ? ` ${missingTitles.length.toLocaleString()} missing page${missingTitles.length === 1 ? ' was' : 's were'} kept as blank rows.`
          : '';
      setStatus(
        `Extraction complete: ${matchedPages.toLocaleString()} of ${pageTitles.length.toLocaleString()} pages contained a requested template.${missingNote}`,
        'success',
      );
    } catch (error) {
      renderRows();
      if (isAbortError(error) || controller.signal.aborted) {
        setStatus(
          `Extraction stopped after ${rows.length.toLocaleString()} of ${pageTitles.length.toLocaleString()} pages. Partial results were kept.`,
        );
      } else {
        setStatus(errorMessage(error), 'error');
      }
    } finally {
      finishTask(controller);
    }
  });

  cancelButton.addEventListener('click', () => {
    if (!activeController) return;
    cancelButton.disabled = true;
    setStatus('Stopping after the current synchronous parsing step…');
    activeController.abort();
  });

  downloadButton.addEventListener('click', () => {
    if (!result.value.trim()) return;

    const blob = new Blob([result.value], {
      type: 'text/tab-separated-values;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'infobox-export.tsv';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  setBusy(false);
  result.value = serialiseTsv([PAGE_COLUMN], []);
  setProgress(0, 1, 'Ready');
}
