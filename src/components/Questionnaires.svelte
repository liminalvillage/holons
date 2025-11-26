<script lang="ts">
  import { getContext, onDestroy, onMount } from 'svelte';
  import { ID } from '../dashboard/store';
  import { writable, get } from 'svelte/store';
  import { browser } from '$app/environment';
  import type { HoloSphere } from "holosphere";

  // Access the global holosphere instance provided via context
  let holosphere = getContext('holosphere') as HoloSphere | undefined;

  // Map survey IDs to question texts
  const questionLabel: Record<string, string> = {
    '1': "👤 Come ti chiami? Nome e cognome",
    '2': "📧 Qual è il tuo indirizzo email? E il tuo numero di telefono?(Per contattarti per informazioni importanti sull'evento)",
    '3': "📍 Da dove vieni?",
    '4': "📢 Come sei venuto a conoscenza dell'evento?",
    '5': "🏕 Hai già partecipato a un evento simile?",
    '6': "🌱 Perché vuoi partecipare allo ZeitCamp? Cos'è che ti chiama? Cosa ti muove?",
    '7': "🔮 Cosa ti aspetti da questa esperienza? (Mettici dentro anche i sogni, se vuoi.)",
    '8': "🧠 Quali sono i tuoi interessi principali? (Raccontaci un po' di te)",
    '9': "🛠 Quali competenze o passioni condividerai con il resto del gruppo? (Arte, falegnameria, yoga, informatica, cucinare, facilitare, altro...)",
    '10': "🎁 Vuoi offrire un dono? (Materiale o immateriale. Una conoscenza, un libro o qualsiasi altra cosa).",
    '11': "🦾 Sei disponibile a contribuire alla buona riuscita del camp?",
    '12': "🎤 Vuoi proporre una presentazione, laboratorio o attività di tuo interesse?",
    '13': "🧬 Su quale tema importante ti piacerebbe confrontarti? (Una domanda sull'Economia Basata sulle Risorse e sulle Leggi Naturali (NL- RBE), un tema che ti appassiona o un'idea che vuoi mettere in circolo).",
    '14': "⏳ Sei disponibile per tutta la settimana che va dal 24 al 31 agosto (2025)? Se solo per alcuni giorni (specifica le date), ti avvertiamo che verrà data priorità a chi parteciperà all'intero periodo; ma se sarà possibile, accoglieremo comunque la tua prenotazione.",
    '15': "🧸 Porterai con te figli? Cani?",
    '16': "🛌 Dove alloggerai? Tenda (propria), camper (proprio), alloggi condivisi (posti limitati), altro…",
    '17': "🍲 Hai esigenze alimentari specifiche? (Intolleranze, diete, preferenze...) Considera comunque che ci saranno sempre opzioni di pasto a base vegetale.",
    '18': "👥 Come e con chi viaggi? (Specifica il mezzo. Se vieni con altre persone scrivi i loro nomi).",
    '19': "🚗 Se ti muovi con un mezzo tuo, sei disposto a offrire un passaggio?",
    '20': "📷 Dai il consenso per documentazione (foto, video, report scritti...)?",
    '21': "🚧 Hai bisogni particolari o altre necessità specifiche?"
  };

  // Local stores for questionnaires and table state
  const rows = writable<any[]>([]);
  const columns = writable<string[]>([]);

  // Sorting state
  const sortField = writable<string>('');
  const sortAsc = writable<boolean>(true);

  // Loading and error states
  let isLoading = true;
  let error = '';
  let connectionReady = false;

  // Helper: derive sorted data whenever sort settings or rows change
  let sortedRows: any[] = [];
  const updateSorted = () => {
    const data = [...get(rows)];
    const field = get(sortField);
    if (!field) {
      sortedRows = data;
      return;
    }
    data.sort((a: any, b: any) => {
      const aVal = a[field];
      const bVal = b[field];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return get(sortAsc) ? aVal - bVal : bVal - aVal;
      }
      return get(sortAsc)
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    sortedRows = data;
  };

  // Subscribe to relevant stores to keep sortedRows up-to-date
  const unsubSortField = sortField.subscribe(updateSorted);
  const unsubSortDir = sortAsc.subscribe(updateSorted);
  const unsubRows = rows.subscribe(updateSorted);

  // Wait for holosphere to be ready
  async function waitForHolosphere(): Promise<boolean> {
    if (holosphere) {
      return true;
    }
    
    let retries = 0;
    const maxRetries = 10;
    
    while (retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 200));
      try {
        holosphere = getContext("holosphere");
        if (holosphere) {
          return true;
        }
      } catch (error) {
        // Silently handle context errors
      }
      retries++;
    }
    
    return false;
  }

  /**
   * Export current table data to CSV file.
   */
  function exportCSV() {
    const cols = get(columns);
    if (!cols.length) return;

    // Build header row using question labels when available
    const header = cols
      .map((c) => `"${(questionLabel[c] ?? c).replace(/"/g, '""')}"`)
      .join(',');

    const body = sortedRows
      .map((row) =>
        cols
          .map((c) => {
            const val = row[c] != null ? String(row[c]) : '';
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\n');

    const csvContent = `${header}\n${body}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `questionnaires_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  onDestroy(() => {
    unsubSortField();
    unsubSortDir();
    unsubRows();
  });

  // Fetch questionnaires whenever the current holon ID changes
  async function loadQuestionnaires(holonId: string | null) {
    if (!holonId) {
      isLoading = false;
      return;
    }

    isLoading = true;
    error = '';

    try {
      // Wait for holosphere to be ready
      const holosphereAvailable = await waitForHolosphere();
      if (!holosphereAvailable) {
        error = 'Connection not available. Please refresh the page.';
        isLoading = false;
        return;
      }

      const data = await holosphere?.getAll(holonId, 'questionnaires');
      // "data" is expected to be an object map ⇒ convert to array
      const list: any[] = data ? Object.values(data) : [];

      // Flatten nested "answers" object (if present) so that each answer key becomes its own column.
      const expandedList = list.map((item) => {
        if (item && typeof item.answers === 'object' && item.answers !== null) {
          const expanded: any = { ...item };
          for (const [aKey, aVal] of Object.entries(item.answers)) {
            // Use the answer key itself as column name.
            expanded[aKey] = aVal;
          }
          // Optionally remove the original answers field to avoid [object Object] noise
          delete expanded.answers;
          return expanded;
        }
        return item;
      });

      rows.set(expandedList);
      // Determine union of all keys to build table headers (after expansion)
      const fieldSet = new Set<string>();
      expandedList.forEach((q) => Object.keys(q || {}).forEach((k) => fieldSet.add(k)));

      const allCols = Array.from(fieldSet);

      // Define meta fields that should appear after answer columns
      const metaFields = [
        'id'
      ];

      const answerCols: string[] = [];
      const metaCols: string[] = [];

      allCols.forEach((c) => {
        if (metaFields.includes(c)) {
          metaCols.push(c);
        } else {
          answerCols.push(c);
        }
      });

      // Sort answer columns: numeric keys ("1".."21") first in ascending order,
      // followed by any other answer keys alphabetically.
      const numericKeys = answerCols.filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
      const otherKeys   = answerCols.filter(k => !/^\d+$/.test(k)).sort((a, b) => a.localeCompare(b));
      const orderedAnswerCols = [...numericKeys, ...otherKeys];

      // Sort meta columns alphabetically (or leave as-is if specific order desired)
      metaCols.sort((a, b) => a.localeCompare(b));

      const cols = [...orderedAnswerCols, ...metaCols];
      columns.set(cols);

      // Default sort by first column, if available
      if (cols.length > 0) {
        sortField.set(cols[0]);
      }

      console.log(`Successfully loaded questionnaires for holon ${holonId}:`, expandedList.length, 'responses');

    } catch (err) {
      console.error('Failed to load questionnaires:', err);
      error = 'Failed to load questionnaires. Please try again.';
      rows.set([]);
      columns.set([]);
    } finally {
      isLoading = false;
    }
  }

  // Initial load + reactive to ID changes
  let idUnsub: () => void;
  onMount(async () => {
    // Wait for holosphere to be ready
    const holosphereAvailable = await waitForHolosphere();
    if (!holosphereAvailable) {
      error = 'Connection not available. Please refresh the page.';
      isLoading = false;
      return;
    }

    connectionReady = true;

    // Initial load
    loadQuestionnaires(get(ID));
    
    // Set up ID subscription
    idUnsub = ID.subscribe((val) => {
      if (val) {
        loadQuestionnaires(val);
      }
    });
  });

  onDestroy(() => {
    idUnsub && idUnsub();
  });

  // Header click handler
  function toggleSort(col: string) {
    if (get(sortField) === col) {
      sortAsc.update((v) => !v);
    } else {
      sortField.set(col);
      sortAsc.set(true);
    }
  }
</script>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #374151; /* gray-700 */
    color: #f9fafb; /* white text */
    font-size: 1rem; /* larger text */
  }

  th {
    white-space: pre-wrap; /* allow multi-line questions */
  }

  td {
    white-space: pre-wrap; /* allow wrapping and preserve newlines */
    min-width: 30ch; /* roughly accommodates six average-length words */
    word-break: break-word;
  }
  th {
    cursor: pointer;
    user-select: none;
    background-color: #1f2937; /* gray-800 */
    color: #f9fafb; /* white */
  }
  tr:nth-child(even) {
    background-color: #111827; /* gray-900 */
  }
  .export-btn {
    background-color: #2563eb; /* blue-600 */
    color: #fff;
    padding: 0.4rem 0.75rem;
    border-radius: 0.375rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background-color 0.2s;
  }
  .export-btn:hover {
    background-color: #1d4ed8; /* blue-700 */
  }
</style>

{#if isLoading}
  <div class="flex items-center justify-center py-12">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
      <p class="text-gray-400">Loading questionnaires...</p>
    </div>
  </div>
{:else if error}
  <div class="text-center py-12">
    <div class="w-16 h-16 mx-auto mb-4 bg-red-700/20 rounded-full flex items-center justify-center">
      <svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    </div>
    <h3 class="text-lg font-medium text-white mb-2">Error Loading Questionnaires</h3>
    <p class="text-gray-400 mb-4">{error}</p>
    <button 
      class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      on:click={() => loadQuestionnaires(get(ID))}
    >
      Try Again
    </button>
  </div>
{:else if $columns.length === 0}
  <p class="text-gray-400">No questionnaires found for this holon.</p>
{:else}
  <button class="export-btn" on:click={exportCSV}>Export CSV</button>
  <div class="overflow-auto mt-2">
    <table>
      <thead>
        <tr>
          {#each $columns as col}
            <th on:click={() => toggleSort(col)}>
              {questionLabel[col] ?? col}
              {#if $sortField === col}
                {#if $sortAsc}
                  ▲
                {:else}
                  ▼
                {/if}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as row}
          <tr>
            {#each $columns as col}
              <td>{row[col] ?? '-'}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if} 