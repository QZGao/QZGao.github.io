import { QQMusicClient } from './client';
import {
  escapeTsvCell,
  extractLyric,
  formatAlbum,
  formatSearchResults,
  formatSingerAlbums,
  formatTrackNumber,
  sortTracks,
} from './formatters';
import type { ApiEnvelope, SongSummary } from './types';

const DEFAULT_SINGER_MID = '001uz8tl04tdL8';

type Action = 'album' | 'album-lyrics' | 'albums' | 'lyrics' | 'search';
type StatusState = 'error' | 'idle' | 'success' | 'working';

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`QQ Music tool is missing ${selector}`);
  return element;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);

    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function rawText(envelopes: ApiEnvelope<unknown>[]): string {
  return envelopes.map((envelope) => JSON.stringify(envelope, null, 2)).join('\n\n');
}

function requiredInput(value: string, description: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Enter ${description} first.`);
  return trimmed;
}

export function initializeQQMusicTool(root: HTMLElement): void {
  if (root.dataset.ready === 'true') return;
  root.dataset.ready = 'true';

  const client = new QQMusicClient();
  const input = requireElement<HTMLInputElement>(root, '[data-input]');
  const status = requireElement<HTMLElement>(root, '[data-status]');
  const cancelButton = requireElement<HTMLButtonElement>(root, '[data-cancel]');
  const actionButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-action]')];
  const tabButtons = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const tabPanels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  const formattedOutput = requireElement<HTMLTextAreaElement>(root, '[data-output="formatted"]');
  const rawOutput = requireElement<HTMLTextAreaElement>(root, '[data-output="raw"]');
  const tsvOutput = requireElement<HTMLTextAreaElement>(root, '[data-output="tsv"]');
  const progressRegion = requireElement<HTMLElement>(root, '[data-progress-region]');
  const progress = requireElement<HTMLProgressElement>(root, '[data-progress]');
  const progressText = requireElement<HTMLElement>(root, '[data-progress-text]');

  let activeController: AbortController | null = null;

  function setStatus(message: string, state: StatusState): void {
    status.textContent = message;
    status.dataset.state = state;
  }

  function setBusy(busy: boolean): void {
    root.setAttribute('aria-busy', String(busy));
    actionButtons.forEach((button) => { button.disabled = busy; });
    cancelButton.disabled = !busy;
  }

  function clearOutputs(): void {
    formattedOutput.value = '';
    rawOutput.value = '';
    tsvOutput.value = '';
    progressRegion.hidden = true;
    progress.value = 0;
    progressText.textContent = '';
  }

  function setProgress(completed: number, total: number): void {
    progressRegion.hidden = false;
    progress.max = Math.max(1, total);
    progress.value = completed;
    progressText.textContent = `${completed} of ${total} songs`;
  }

  function selectTab(selected: HTMLButtonElement): void {
    tabButtons.forEach((button) => {
      const active = button === selected;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    tabPanels.forEach((panel) => {
      panel.hidden = panel.id !== selected.getAttribute('aria-controls');
    });
  }

  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => selectTab(button));
    button.addEventListener('keydown', (event) => {
      let nextIndex: number | null = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabButtons.length - 1;
      if (nextIndex == null) return;
      event.preventDefault();
      const next = tabButtons[nextIndex];
      selectTab(next);
      next?.focus();
    });
  });

  cancelButton.addEventListener('click', () => activeController?.abort());

  async function runAction(action: Action): Promise<void> {
    const controller = new AbortController();
    activeController?.abort();
    activeController = controller;
    clearOutputs();
    setBusy(true);
    setStatus('Contacting the QQ Music metadata service…', 'working');

    try {
      if (action === 'search') {
        const keyword = requiredInput(input.value, 'a search keyword');
        const result = await client.query('getSearchByKey', { key: keyword, limit: 20 }, controller.signal);
        const output = formatSearchResults(keyword, result.response);
        formattedOutput.value = output.formatted;
        tsvOutput.value = output.tsv;
        rawOutput.value = rawText([result]);
        setStatus(`Found ${result.response.length} matching songs.`, 'success');
      }

      if (action === 'albums') {
        const singerMid = input.value.trim() || DEFAULT_SINGER_MID;
        const result = await client.query('getSingerAlbum', { singerMid, limit: 20 }, controller.signal);
        const output = formatSingerAlbums(singerMid, result.response);
        formattedOutput.value = output.formatted;
        tsvOutput.value = output.tsv;
        rawOutput.value = rawText([result]);
        setStatus(`Loaded ${result.response.length} albums.`, 'success');
      }

      if (action === 'album') {
        const albumMid = requiredInput(input.value, 'an album MID');
        const album = await client.query('getAlbumInfo', { albumMid }, controller.signal);
        const envelopes: ApiEnvelope<unknown>[] = [album];
        let songs = Array.isArray(album.response.list) ? album.response.list : [];
        if (!songs.length) {
          const tracks = await client.query(
            'getAlbumSong',
            { value: albumMid, num: 1000, page: 1 },
            controller.signal,
          );
          songs = tracks.response;
          envelopes.push(tracks);
        }
        const output = formatAlbum(album.response, songs);
        formattedOutput.value = output.formatted;
        tsvOutput.value = output.tsv;
        rawOutput.value = rawText(envelopes);
        setStatus(`Loaded album metadata and ${songs.length} tracks.`, 'success');
      }

      if (action === 'lyrics') {
        const songMid = requiredInput(input.value, 'a song MID');
        const result = await client.query('getLyricByMid', { songMid }, controller.signal);
        const lyric = extractLyric(result.response);
        formattedOutput.value = lyric;
        tsvOutput.value = `lyric\n${escapeTsvCell(lyric)}\n`;
        rawOutput.value = rawText([result]);
        setStatus(lyric ? 'Lyrics loaded.' : 'No lyrics were returned for this song.', 'success');
      }

      if (action === 'album-lyrics') {
        const albumMid = requiredInput(input.value, 'an album MID');
        const album = await client.query('getAlbumInfo', { albumMid }, controller.signal);
        const envelopes: ApiEnvelope<unknown>[] = [album];
        let songs: SongSummary[] = Array.isArray(album.response.list) ? album.response.list : [];
        if (!songs.length) {
          const tracks = await client.query(
            'getAlbumSong',
            { value: albumMid, num: 1000, page: 1 },
            controller.signal,
          );
          songs = tracks.response;
          envelopes.push(tracks);
        }

        songs = sortTracks(songs);
        const info = album.response.basicInfo ?? {};
        const formatted = [
          `Lyrics for all songs in ${info.albumName || ''} (${info.albumMid || ''}):`,
        ];
        const tsv = ['trackNo\tlyric'];
        setProgress(0, songs.length);

        for (const [index, song] of songs.entries()) {
          await abortableDelay(500, controller.signal);
          const songMid = requiredInput(song.songmid || song.mid || '', 'a song MID in the album response');
          const songName = song.songname || song.name || '';
          setStatus(`Fetching lyrics ${index + 1} of ${songs.length}: ${songName || songMid}`, 'working');
          const result = await client.query('getLyricByMid', { songMid }, controller.signal);
          envelopes.push(result);
          const lyric = extractLyric(result.response);
          const trackNumber = formatTrackNumber(song);
          formatted.push(`\n-- ${trackNumber}. ${songName} (${songMid}) --\n${lyric}`);
          tsv.push(`${escapeTsvCell(trackNumber)}\t${escapeTsvCell(lyric)}`);
          formattedOutput.value = `${formatted.join('\n')}\n`;
          tsvOutput.value = `${tsv.join('\n')}\n`;
          rawOutput.value = rawText(envelopes);
          setProgress(index + 1, songs.length);
        }

        if (!songs.length) {
          formattedOutput.value = `${formatted.join('\n')}\n`;
          tsvOutput.value = `${tsv.join('\n')}\n`;
          rawOutput.value = rawText(envelopes);
        }
        setStatus(`Loaded lyrics for ${songs.length} songs.`, 'success');
      }
    } catch (error) {
      if (isAbortError(error)) {
        setStatus('Request cancelled.', 'idle');
      } else {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        setStatus(message, 'error');
      }
    } finally {
      if (activeController === controller) {
        activeController = null;
        setBusy(false);
      }
    }
  }

  actionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action as Action | undefined;
      if (action) void runAction(action);
    });
  });

  setBusy(false);
  setStatus('', 'idle');
}

export function initializeQQMusicTools(): void {
  document.querySelectorAll<HTMLElement>('[data-qqmusic-tool]').forEach(initializeQQMusicTool);
}
