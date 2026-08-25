const input = document.querySelector('#isbn-input');
const searchButton = document.querySelector('#search-button');
const refreshButton = document.querySelector('#refresh-button');
const statusNode = document.querySelector('#status');
const zoteroStatusNode = document.querySelector('#zotero-status');
const resultsNode = document.querySelector('#results');
let zoteroAvailable = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function splitISBNs(value) {
  return value
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function displayList(values) {
  return (values || []).filter(Boolean).join('; ');
}

function sourceStatuses(statuses) {
  return `<div class="source-grid">${statuses.map(source => `
    <div class="source-status ${source.ok ? '' : 'bad'}">
      <strong>${escapeHtml(source.source)}</strong><br>
      ${source.ok ? `${source.records} verified record${source.records === 1 ? '' : 's'}` : 'Unavailable'}
      ${source.message ? `<div class="small">${escapeHtml(source.message)}</div>` : ''}
    </div>`).join('')}</div>`;
}

function conflictsBlock(conflicts) {
  const entries = Object.entries(conflicts || {});
  if (!entries.length) return '';
  return `<div class="conflicts"><strong>Conflicts retained</strong><ul>${entries.map(([field, values]) =>
    `<li><strong>${escapeHtml(field.replaceAll('_', ' '))}:</strong> ${escapeHtml(values.join(' | '))}</li>`
  ).join('')}</ul></div>`;
}

function sourceRecords(records) {
  if (!records?.length) return '';
  return `<details class="sources"><summary>Source records (${records.length})</summary><ul>${records.map(record =>
    `<li><a href="${escapeHtml(record.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(record.source)}</a>: ` +
    `${escapeHtml(record.title)}${record.date ? ` (${escapeHtml(record.date)})` : ''}${record.edition ? `, ${escapeHtml(record.edition)}` : ''}${record.printing ? `, ${escapeHtml(record.printing)}` : ''}</li>`
  ).join('')}</ul></details>`;
}

function editField(label, field, value, full = false) {
  return `<label class="${full ? 'full' : ''}">${escapeHtml(label)}<input data-field="${field}" value="${escapeHtml(value || '')}"></label>`;
}

function choiceCard(result, choice, index) {
  const needsCheck = Boolean(choice.requires_physical_confirmation);
  const checkbox = needsCheck ? `
    <label class="physical-check">
      <input type="checkbox" data-role="physical-check">
      <span>I matched this candidate to the physical title page and copyright page.</span>
    </label>` : '';
  return `<article class="choice" data-isbn="${escapeHtml(result.raw_input)}" data-choice="${escapeHtml(choice.choice_id)}">
    <h3>${escapeHtml(choice.title || 'Untitled candidate')}</h3>
    <p class="meta">${escapeHtml(displayList(choice.authors) || 'Author not reported')} · ${escapeHtml(choice.publisher || 'Publisher not reported')} · ${escapeHtml(choice.date || 'Date not reported')} ${choice.edition ? `· ${escapeHtml(choice.edition)}` : ''} ${choice.printing ? `· ${escapeHtml(choice.printing)}` : ''}</p>
    <div class="warning"><strong>${escapeHtml(choice.confidence.toUpperCase())}.</strong> ${escapeHtml(choice.reason)}</div>
    ${conflictsBlock(choice.conflicts)}
    ${sourceRecords(choice.source_records)}
    <details><summary>Review or correct from the physical book</summary>
      <div class="edit-grid">
        ${editField('Title', 'title', choice.title, true)}
        ${editField('Authors, separated by semicolons', 'authors', displayList(choice.authors), true)}
        ${editField('Editors, separated by semicolons', 'editors', displayList(choice.editors), true)}
        ${editField('Publisher', 'publisher', choice.publisher)}
        ${editField('Place', 'place', choice.place)}
        ${editField('Year or date', 'date', choice.date)}
        ${editField('Edition statement', 'edition', choice.edition)}
        ${editField('Printing / cetakan statement', 'printing', choice.printing)}
        ${editField('Total numbered pages', 'num_pages', choice.num_pages)}
        ${editField('Physical description', 'extent', choice.extent, true)}
        ${editField('Language(s), separated by semicolons', 'languages', displayList(choice.languages), true)}
      </div>
    </details>
    <div class="export-row" data-needs-check="${needsCheck ? 'true' : 'false'}">
      ${checkbox}
      <button class="primary zotero-button" disabled>Send directly to Zotero</button>
      <button class="secondary export-button" ${needsCheck ? 'disabled' : ''}>Download RIS instead</button>
      <span class="small export-status"></span>
    </div>
  </article>`;
}

function renderResult(result) {
  if (!result.valid) {
    return `<article class="result"><div class="result-head"><div><h2>${escapeHtml(result.raw_input)}</h2><span class="state invalid">invalid</span></div></div><p class="error-text">${escapeHtml(result.validation_message)}</p></article>`;
  }
  const normalized = [result.isbn13, result.isbn10].filter(Boolean).join(' / ');
  return `<article class="result">
    <div class="result-head"><div><h2>${escapeHtml(result.raw_input)}</h2><div class="small">Normalized: ${escapeHtml(normalized)}</div><span class="state ${escapeHtml(result.state)}">${escapeHtml(result.state.replaceAll('_', ' '))}</span></div></div>
    <p>${escapeHtml(result.state_message)}</p>
    ${sourceStatuses(result.source_statuses)}
    ${result.choices.map((choice, index) => choiceCard(result, choice, index)).join('')}
  </article>`;
}

async function search(refresh = false) {
  const isbns = splitISBNs(input.value);
  if (!isbns.length) {
    statusNode.textContent = 'Enter or scan at least one ISBN.';
    input.focus();
    return;
  }
  searchButton.disabled = true;
  refreshButton.disabled = true;
  statusNode.textContent = `Searching ${isbns.length} ISBN${isbns.length === 1 ? '' : 's'}…`;
  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({isbns, refresh})
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Search failed');
    resultsNode.innerHTML = payload.results.map(renderResult).join('');
    bindResultActions();
    applyZoteroAvailability();
    statusNode.textContent = `Finished ${payload.results.length} search${payload.results.length === 1 ? '' : 'es'}.`;
  } catch (error) {
    statusNode.textContent = `Search failed: ${error.message}`;
  } finally {
    searchButton.disabled = false;
    refreshButton.disabled = false;
  }
}

function bindResultActions() {
  document.querySelectorAll('[data-role="physical-check"]').forEach(checkbox => {
    checkbox.addEventListener('change', event => {
      const card = event.target.closest('.choice');
      card.querySelector('.export-button').disabled = !event.target.checked;
      card.querySelector('.zotero-button').disabled = !event.target.checked || !zoteroAvailable;
    });
  });
  document.querySelectorAll('.export-button').forEach(button => {
    button.addEventListener('click', () => exportChoice(button.closest('.choice')));
  });
  document.querySelectorAll('.zotero-button').forEach(button => {
    button.addEventListener('click', () => sendToZotero(button.closest('.choice')));
  });
}

function choicePayload(card) {
  const overrides = {};
  card.querySelectorAll('[data-field]').forEach(field => { overrides[field.dataset.field] = field.value; });
  const physicalCheck = card.querySelector('[data-role="physical-check"]');
  return {
    isbn: card.dataset.isbn,
    choice_id: card.dataset.choice,
    overrides,
    physical_confirmed: physicalCheck ? physicalCheck.checked : false,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function contentDispositionFilename(response) {
  const header = response.headers.get('Content-Disposition') || '';
  const match = header.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : 'book.ris';
}

async function exportChoice(card) {
  const button = card.querySelector('.export-button');
  const exportStatus = card.querySelector('.export-status');
  button.disabled = true;
  exportStatus.textContent = 'Building RIS…';
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(choicePayload(card))
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || 'Export failed');
    }
    const blob = await response.blob();
    downloadBlob(blob, contentDispositionFilename(response));
    exportStatus.textContent = 'Downloaded. Open the RIS file to import it into Zotero.';
  } catch (error) {
    exportStatus.textContent = `Export failed: ${error.message}`;
  } finally {
    const physicalCheck = card.querySelector('[data-role="physical-check"]');
    button.disabled = physicalCheck ? !physicalCheck.checked : false;
  }
}

async function sendToZotero(card) {
  const button = card.querySelector('.zotero-button');
  const exportStatus = card.querySelector('.export-status');
  button.disabled = true;
  exportStatus.textContent = 'Approve the permission dialog in Zotero…';
  try {
    const response = await fetch('/api/zotero', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(choicePayload(card))
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Direct import failed');
    exportStatus.textContent = payload.message;
    if (payload.created || payload.duplicate) button.textContent = payload.duplicate ? 'Already in Zotero' : 'Added to Zotero';
  } catch (error) {
    exportStatus.textContent = `${error.message} RIS download remains available.`;
  } finally {
    const physicalCheck = card.querySelector('[data-role="physical-check"]');
    button.disabled = !zoteroAvailable || (physicalCheck && !physicalCheck.checked);
  }
}

function applyZoteroAvailability() {
  document.querySelectorAll('.zotero-button').forEach(button => {
    const row = button.closest('.export-row');
    const card = button.closest('.choice');
    const check = card.querySelector('[data-role="physical-check"]');
    button.disabled = !zoteroAvailable || (row.dataset.needsCheck === 'true' && !check?.checked);
    button.title = zoteroAvailable ? '' : 'Open Zotero 10 or later and enable local application access. RIS remains available.';
  });
}

async function checkZotero() {
  try {
    const response = await fetch('/api/zotero/status');
    const payload = await response.json();
    zoteroAvailable = Boolean(payload.available);
    zoteroStatusNode.textContent = payload.message;
  } catch (error) {
    zoteroAvailable = false;
    zoteroStatusNode.textContent = 'Direct Zotero access could not be checked. RIS export remains available.';
  }
  applyZoteroAvailability();
}

searchButton.addEventListener('click', () => search(false));
refreshButton.addEventListener('click', () => search(true));
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && splitISBNs(input.value).length === 1) {
    event.preventDefault();
    search(false);
  }
});
checkZotero();
