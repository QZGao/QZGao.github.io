import {
  parseReferences,
  serializeReference,
  serializeReferences,
  type ParsedReference,
} from './wikitext';

interface CitationField {
  id: string;
  key: string;
  value: string;
}

interface CitationTemplate {
  id: string;
  name: string;
  fields: CitationField[];
}

interface ReferenceEntry {
  id: string;
  name: string;
  templates: CitationTemplate[];
}

const keyOptions: Record<string, string[]> = {
  'cite web': ['author', 'title', 'url', 'website', 'date', 'access-date', 'language'],
  'cite news': ['author', 'title', 'url', 'work', 'date', 'access-date', 'language'],
  'cite book': ['author', 'title', 'publisher', 'year', 'isbn', 'language'],
  'cite journal': ['author', 'title', 'journal', 'volume', 'issue', 'pages', 'doi', 'language'],
  'cite video game': ['title', 'developer', 'publisher', 'date', 'platform', 'version', 'scene'],
};

const makeId = () => crypto.randomUUID();

function blankTemplate(): CitationTemplate {
  return { id: makeId(), name: '', fields: [] };
}

function blankEntry(): ReferenceEntry {
  return { id: makeId(), name: '', templates: [blankTemplate()] };
}

function fromParsed(reference: ParsedReference): ReferenceEntry {
  return {
    id: makeId(),
    name: reference.name,
    templates: reference.templates.map((template) => ({
      id: makeId(),
      name: template.name,
      fields: template.fields.map((field) => ({ id: makeId(), ...field })),
    })),
  };
}

function toParsed(entry: ReferenceEntry): ParsedReference {
  return {
    name: entry.name,
    templates: entry.templates.map((template) => ({
      name: template.name,
      fields: template.fields.map(({ key, value }) => ({ key, value })),
    })),
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function labelledInput(labelText: string, input: HTMLInputElement): HTMLLabelElement {
  const label = element('label');
  const span = element('span', {}, labelText);
  label.append(span, input);
  return label;
}

function actionButton(action: string, label: string, extra: Record<string, string> = {}): HTMLButtonElement {
  return element('button', { type: 'button', 'data-action': action, ...extra }, label);
}

export function mountReferenceMaker(): void {
  const root = document.querySelector<HTMLElement>('[data-reference-maker]');
  if (!root) return;

  const list = root.querySelector<HTMLElement>('[data-reference-list]');
  const emptyState = root.querySelector<HTMLElement>('[data-empty-state]');
  const status = root.querySelector<HTMLElement>('[data-status]');
  const importDialog = root.querySelector<HTMLDialogElement>('[data-import-dialog]');
  const importInput = root.querySelector<HTMLTextAreaElement>('[data-import-input]');
  const outputDialog = root.querySelector<HTMLDialogElement>('[data-output-dialog]');
  const outputInput = root.querySelector<HTMLTextAreaElement>('[data-output-input]');
  if (!list || !emptyState || !status || !importDialog || !importInput || !outputDialog || !outputInput) return;

  let entries: ReferenceEntry[] = [];

  const setStatus = (message: string, state: 'idle' | 'error' | 'success' = 'idle') => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const findEntry = (entryId: string) => entries.find((entry) => entry.id === entryId);
  const findTemplate = (entry: ReferenceEntry, templateId: string) =>
    entry.templates.find((template) => template.id === templateId);

  const refreshPreview = (entryId: string) => {
    const preview = list.querySelector<HTMLElement>(`[data-preview="${entryId}"]`);
    const entry = findEntry(entryId);
    if (!preview || !entry) return;
    try {
      preview.textContent = serializeReference(toParsed(entry));
    } catch (error) {
      preview.textContent = error instanceof Error ? error.message : 'This reference is incomplete.';
    }
  };

  const renderField = (entryId: string, templateId: string, field: CitationField): HTMLElement => {
    const row = element('div', { class: 'reference-field' });
    const key = element('input', {
      type: 'text',
      value: field.key,
      list: `keys-${templateId}`,
      'aria-label': 'Citation field name',
      'data-model': 'field-key',
      'data-entry-id': entryId,
      'data-template-id': templateId,
      'data-field-id': field.id,
    });
    const value = element('input', {
      type: 'text',
      value: field.value,
      'aria-label': 'Citation field value',
      'data-model': 'field-value',
      'data-entry-id': entryId,
      'data-template-id': templateId,
      'data-field-id': field.id,
    });
    const remove = actionButton('delete-field', 'Remove field', {
      class: 'compact-button compact-button--danger',
      'data-entry-id': entryId,
      'data-template-id': templateId,
      'data-field-id': field.id,
    });
    row.append(key, value, remove);
    return row;
  };

  const renderTemplate = (entryId: string, template: CitationTemplate, index: number, count: number): HTMLElement => {
    const fieldset = element('fieldset', { class: 'citation-template' });
    const legend = element('legend', {}, `Template ${index + 1}`);
    const toolbar = element('div', { class: 'template-toolbar' });
    toolbar.append(
      actionButton('move-template-up', 'Move up', {
        class: 'compact-button',
        'data-entry-id': entryId,
        'data-template-id': template.id,
        ...(index === 0 ? { disabled: '' } : {}),
      }),
      actionButton('move-template-down', 'Move down', {
        class: 'compact-button',
        'data-entry-id': entryId,
        'data-template-id': template.id,
        ...(index === count - 1 ? { disabled: '' } : {}),
      }),
      actionButton('delete-template', 'Remove template', {
        class: 'compact-button compact-button--danger',
        'data-entry-id': entryId,
        'data-template-id': template.id,
      }),
    );

    const nameInput = element('input', {
      type: 'text',
      value: template.name,
      list: 'citation-template-names',
      placeholder: 'cite web',
      autocomplete: 'off',
      'data-model': 'template-name',
      'data-entry-id': entryId,
      'data-template-id': template.id,
    });

    const fields = element('div', { class: 'reference-fields' });
    for (const field of template.fields) fields.append(renderField(entryId, template.id, field));
    if (template.fields.length === 0) {
      fields.append(element('p', { class: 'empty-fields' }, 'No fields yet. Choose a known template or add one manually.'));
    }

    const datalist = element('datalist', { id: `keys-${template.id}` });
    const options = keyOptions[template.name.trim().toLowerCase()] ?? keyOptions['cite web'];
    for (const option of options) datalist.append(element('option', { value: option }));

    const addField = actionButton('add-field', 'Add field', {
      class: 'button-secondary',
      'data-entry-id': entryId,
      'data-template-id': template.id,
    });

    fieldset.append(legend, toolbar, labelledInput('Template name', nameInput), fields, datalist, addField);
    return fieldset;
  };

  const renderEntry = (entry: ReferenceEntry, index: number): HTMLElement => {
    const article = element('article', { class: 'reference-entry', 'data-entry-id': entry.id });
    const header = element('header', { class: 'reference-entry__header' });
    const heading = element('h2', {}, `Reference ${index + 1}`);
    const entryActions = element('div', { class: 'entry-actions' });
    entryActions.append(
      actionButton('move-entry-up', 'Move up', {
        class: 'compact-button',
        'data-entry-id': entry.id,
        ...(index === 0 ? { disabled: '' } : {}),
      }),
      actionButton('move-entry-down', 'Move down', {
        class: 'compact-button',
        'data-entry-id': entry.id,
        ...(index === entries.length - 1 ? { disabled: '' } : {}),
      }),
      actionButton('delete-entry', 'Delete', {
        class: 'compact-button compact-button--danger',
        'data-entry-id': entry.id,
      }),
    );
    header.append(heading, entryActions);

    const nameInput = element('input', {
      type: 'text',
      value: entry.name,
      placeholder: 'Optional reusable reference name',
      autocomplete: 'off',
      'data-model': 'entry-name',
      'data-entry-id': entry.id,
    });

    const templates = element('div', { class: 'citation-templates' });
    entry.templates.forEach((template, templateIndex) => {
      templates.append(renderTemplate(entry.id, template, templateIndex, entry.templates.length));
    });

    const addTemplate = actionButton('add-template', 'Add citation template', {
      class: 'button-secondary',
      'data-entry-id': entry.id,
    });
    const previewDetails = element('details', { class: 'reference-preview' });
    const summary = element('summary', {}, 'Generated wikitext');
    const preview = element('code', { 'data-preview': entry.id });
    previewDetails.append(summary, preview);
    article.append(header, labelledInput('Reference name', nameInput), templates, addTemplate, previewDetails);
    queueMicrotask(() => refreshPreview(entry.id));
    return article;
  };

  const render = () => {
    list.replaceChildren(...entries.map(renderEntry));
    emptyState.hidden = entries.length > 0;
  };

  const move = <T>(items: T[], index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= items.length) return;
    const [item] = items.splice(index, 1);
    items.splice(destination, 0, item);
  };

  root.addEventListener('input', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-model]');
    if (!input) return;
    const entry = findEntry(input.dataset.entryId ?? '');
    if (!entry) return;
    const model = input.dataset.model;
    if (model === 'entry-name') entry.name = input.value;
    const template = findTemplate(entry, input.dataset.templateId ?? '');
    if (template && model === 'template-name') template.name = input.value;
    const field = template?.fields.find((item) => item.id === input.dataset.fieldId);
    if (field && model === 'field-key') field.key = input.value;
    if (field && model === 'field-value') field.value = input.value;
    refreshPreview(entry.id);
  });

  root.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-model="template-name"]');
    if (!input) return;
    const entry = findEntry(input.dataset.entryId ?? '');
    const template = entry && findTemplate(entry, input.dataset.templateId ?? '');
    if (!entry || !template || template.fields.length > 0) return;
    const defaults = keyOptions[template.name.trim().toLowerCase()];
    if (!defaults) return;
    template.fields = defaults.map((key) => ({ id: makeId(), key, value: '' }));
    render();
  });

  root.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const entry = findEntry(button.dataset.entryId ?? '');
    const template = entry && findTemplate(entry, button.dataset.templateId ?? '');

    if (action === 'add-entry') {
      const newEntry = blankEntry();
      entries.push(newEntry);
      render();
      list.querySelector<HTMLInputElement>(`[data-entry-id="${newEntry.id}"] input`)?.focus();
    } else if (action === 'clear') {
      if (entries.length > 0 && window.confirm('Clear every reference?')) {
        entries = [];
        render();
        setStatus('References cleared.');
      }
    } else if (action === 'sort') {
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      render();
      setStatus('References sorted by name.', 'success');
    } else if (action === 'open-import') {
      importDialog.showModal();
      importInput.focus();
    } else if (action === 'import') {
      const parsed = parseReferences(importInput.value);
      if (parsed.length === 0) {
        setStatus('No citation templates inside complete <ref> tags were found.', 'error');
        return;
      }
      entries.push(...parsed.map(fromParsed));
      importInput.value = '';
      importDialog.close();
      render();
      setStatus(`Imported ${parsed.length} reference${parsed.length === 1 ? '' : 's'}.`, 'success');
    } else if (action === 'open-output') {
      if (entries.length === 0) {
        setStatus('Add or import at least one reference before generating output.', 'error');
        return;
      }
      try {
        outputInput.value = serializeReferences(entries.map(toParsed));
        outputDialog.showModal();
        setStatus('Wikitext generated.', 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to generate wikitext.', 'error');
      }
    } else if (action === 'copy-output') {
      try {
        await navigator.clipboard.writeText(outputInput.value);
        setStatus('Generated wikitext copied.', 'success');
      } catch {
        outputInput.focus();
        outputInput.select();
        setStatus('Clipboard access was unavailable. The output has been selected for manual copying.');
      }
    } else if (action === 'delete-entry' && entry) {
      if (window.confirm('Delete this reference?')) {
        entries = entries.filter((item) => item.id !== entry.id);
        render();
      }
    } else if ((action === 'move-entry-up' || action === 'move-entry-down') && entry) {
      move(entries, entries.indexOf(entry), action === 'move-entry-up' ? -1 : 1);
      render();
    } else if (action === 'add-template' && entry) {
      entry.templates.push(blankTemplate());
      render();
    } else if (action === 'delete-template' && entry && template) {
      if (entry.templates.length === 1) {
        setStatus('A reference must keep at least one template.', 'error');
      } else if (window.confirm('Remove this citation template?')) {
        entry.templates = entry.templates.filter((item) => item.id !== template.id);
        render();
      }
    } else if ((action === 'move-template-up' || action === 'move-template-down') && entry && template) {
      move(entry.templates, entry.templates.indexOf(template), action === 'move-template-up' ? -1 : 1);
      render();
    } else if (action === 'add-field' && template) {
      template.fields.push({ id: makeId(), key: '', value: '' });
      render();
    } else if (action === 'delete-field' && template) {
      const field = template.fields.find((item) => item.id === button.dataset.fieldId);
      if (field && (field.key === '' && field.value === '' || window.confirm('Remove this citation field?'))) {
        template.fields = template.fields.filter((item) => item.id !== field.id);
        render();
      }
    }
  });

  render();
}
