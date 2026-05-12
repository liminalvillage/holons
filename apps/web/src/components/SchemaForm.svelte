<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    // @ts-ignore - Fix for h3-js module error
    import * as h3 from 'h3-js';
    
    export let schema: string;
    export let schemaDefinition: Record<string, any> | null = null;
    export let initialData: Record<string, any> = {};
    
    const dispatch = createEventDispatcher();
    
    // Update system fields to be hidden
    const HIDDEN_FIELDS = ['id', 'linked_schemas', 'geolocation', 'latitude', 'longitude'];
    const SYSTEM_FIELDS = ['date', 'created_at', 'updated_at'];
    const TIME_FIELDS = ['when', 'date', 'expires_at', 'founding_date', 'created_at', 'updated_at'];
    
    // Add fields that should be dropdowns
    const DROPDOWN_FIELDS = [
        'status',
        'exchange_type',
        'item_type',
        'geographic_scope',
        'category',
        'movement',
        'legal_form',
        'monetary_model',
        'unit_of_account_type'
    ];
    
    interface Field {
        type: string;
        required?: boolean;
        title?: string;
        description?: string;
        enum?: string[];
        enumNames?: string[];
        format?: string;
        items?: {
            type?: string;
            enum?: string[];
            enumNames?: string[];
        };
    }
    
    interface Schema {
        [key: string]: Field;
    }
    
    // Common field types mapping
    const fieldTypes: Record<string, string> = {
        string: 'text',
        number: 'number',
        integer: 'number',
        boolean: 'checkbox'
    };
    
    function isTimeField(fieldName: string): boolean {
        return TIME_FIELDS.includes(fieldName) || fieldName.toLowerCase().includes('date') || fieldName.toLowerCase().includes('time');
    }
    
    function unixToDateTimeLocal(timestamp: number): string {
        const date = new Date(timestamp);
        return date.toISOString().slice(0, 16); // Format: YYYY-MM-DDThh:mm
    }
    
    function dateTimeLocalToUnix(datetime: string): number {
        return new Date(datetime).getTime();
    }
    
    function isDropdownField(fieldName: string, field: Field): boolean {
        return DROPDOWN_FIELDS.includes(fieldName) || 
               (field.type === 'string' && field.enum !== undefined && !field.items);
    }
    
    function getSchemaDefinition(schemaName: string): Schema {
        if (schemaDefinition) {
            const filteredProperties = Object.entries(schemaDefinition.properties)
                .filter(([key]) => !HIDDEN_FIELDS.includes(key))
                .reduce((acc, [key, value]) => {
                    // Add datetime format for time fields
                    if (isTimeField(key)) {
                        return { 
                            ...acc, 
                            [key]: { 
                                ...(value as Field), 
                                type: 'string',
                                format: 'datetime-local' 
                            } 
                        };
                    }
                    // Convert string fields with limited options to dropdowns
                    if (isDropdownField(key, value as Field)) {
                        return {
                            ...acc,
                            [key]: {
                                ...(value as Field),
                                type: 'select'
                            }
                        };
                    }
                    return { ...acc, [key]: value };
                }, {});

            return filteredProperties;
        }
        return {};
    }

    let currentSchema = getSchemaDefinition(schema);

    // Build time-field defaults, then assign formData ONCE.
    // Mutating formData[key] mid-init triggers Svelte's $$invalidate while the {#each ... as [fieldName, field]}
    // block is being constructed, throwing "ReferenceError: field is not defined" and wedging the page.
    const _timeDefaults: Record<string, string> = {};
    for (const fieldName of Object.keys(currentSchema)) {
        if (isTimeField(fieldName)) {
            _timeDefaults[fieldName] = new Date().toISOString().slice(0, 16);
        }
    }
    let formData: Record<string, any> = { ..._timeDefaults, ...initialData };

    // Add prop for hexId
    export let hexId: string | null = null;

    function getGeolocationFromHexId(): { lat: number; lon: number } | null {
        if (!hexId) return null;
        try {
            if (!h3.isValidCell(hexId)) return null;
            const [lat, lon] = h3.cellToLatLng(hexId);
            return { lat, lon };
        } catch {
            return null;
        }
    }

    function handleTagInput(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const tag = event.currentTarget.value.trim();
            if (tag) {
                // Remove any commas from the tag
                const cleanTag = tag.replace(/,/g, '');
                if (cleanTag) {
                    formData.tags = [...(formData.tags || []), cleanTag];
                    event.currentTarget.value = '';
                }
            }
        }
    }

    let tagInputValue = ''; // Add state for tag input

    function handleTagDirectInput(event: Event & { currentTarget: HTMLInputElement }) {
        const value = event.currentTarget.value;
        tagInputValue = value; // Update the state
        
        // Check if the value ends with a comma
        if (value.endsWith(',')) {
            const tag = value.slice(0, -1).trim();
            if (tag) {
                formData.tags = [...(formData.tags || []), tag];
                tagInputValue = ''; // Clear the input state
                event.currentTarget.value = ''; // Clear the input
            }
        }
    }

    function handleSubmit() {
        // Convert datetime-local values to Unix timestamps where needed
        const processedData = Object.entries(formData).reduce((acc, [key, value]) => {
            if (isTimeField(key) && value) {
                return { ...acc, [key]: dateTimeLocalToUnix(value) };
            }
            return { ...acc, [key]: value };
        }, {});

        // Get geolocation from hexId
        const geolocation = getGeolocationFromHexId();

        // Add system fields and geolocation
        const finalData = {
            ...processedData,
            id: crypto.randomUUID(),
            date: Date.now(),
            updated_at: Date.now(),
            ...(geolocation && {
                geolocation,
                latitude: geolocation.lat,
                longitude: geolocation.lon
            })
        };

        dispatch('submit', finalData);
    }

    function removeTag(tag: string) {
        formData.tags = formData.tags.filter((t: string) => t !== tag);
    }

    function handleCheckboxInput(event: Event, fieldName: string) {
        const target = event.target as HTMLInputElement;
        const value = target.value;
        
        // Initialize array if it doesn't exist
        if (!formData[fieldName]) {
            formData[fieldName] = [];
        }
        
        // Ensure formData[fieldName] is an array
        if (!Array.isArray(formData[fieldName])) {
            formData[fieldName] = [];
        }
        
        if (target.checked) {
            // Add value if checked and not already in array
            if (!formData[fieldName].includes(value)) {
                formData[fieldName] = [...formData[fieldName], value];
            }
        } else {
            // Remove value if unchecked
            formData[fieldName] = formData[fieldName].filter((v: string) => v !== value);
        }
    }

    function getInputType(field: Field): string {
        if (field.format === 'datetime-local') return 'datetime-local';
        return fieldTypes[field.type] || 'text';
    }

    function handleInputChange(event: Event, fieldName: string) {
        const target = event.target as HTMLInputElement;
        
        if (isTimeField(fieldName)) {
            formData[fieldName] = target.value;
        } else {
            formData[fieldName] = target.type === 'number' ? Number(target.value) : target.value;
        }
    }

    // Add viewOnly prop
    export let viewOnly = false;
    export let isSubmitting = false;
</script>

<form on:submit|preventDefault={handleSubmit} class="space-y-4">
    {#each Object.entries(currentSchema) as [fieldName, field]}
        <div class="form-field">
            <label class="block text-sm font-medium mb-1 flex items-center gap-2" for={fieldName}>
                <span class={field.required ? 'text-blue-400' : 'text-gray-200'}>
                    {field.title || fieldName.replace(/_/g, ' ')}
                </span>
            </label>

            {#if isDropdownField(fieldName, field)}
                <!-- Dropdown fields -->
                {#if viewOnly}
                    <div class="w-full bg-gray-700 text-white rounded-lg p-2 border border-gray-600">
                        {formData[fieldName] || '-'}
                    </div>
                {:else}
                    <select 
                        id={fieldName}
                        bind:value={formData[fieldName]}
                        class="w-full bg-gray-700 text-white rounded-lg p-2 border border-gray-600"
                        required={field.required}
                        disabled={viewOnly}
                        aria-label={field.title || fieldName.replace(/_/g, ' ')}
                    >
                        <option value="">Select {fieldName.replace(/_/g, ' ')}</option>
                        {#each field.enum || [] as value, i}
                            <option value={value}>
                                {field.enumNames?.[i] || value}
                            </option>
                        {/each}
                    </select>
                {/if}

            {:else if field.type === 'array' && field.items?.enum}
                <!-- Checkboxes for array of enums -->
                <div class="space-y-2 p-2 bg-gray-700 rounded-lg border border-gray-600" role="group" aria-label={field.title || fieldName.replace(/_/g, ' ')}>
                    {#each field.items.enum as value, i}
                        <label class="flex items-center space-x-2 hover:bg-gray-600 p-2 rounded transition-colors" for={`${fieldName}-${value}`}>
                            <input
                                id={`${fieldName}-${value}`}
                                type="checkbox"
                                value={value}
                                checked={Array.isArray(formData[fieldName]) && formData[fieldName]?.includes(value)}
                                on:change={(e) => handleCheckboxInput(e, fieldName)}
                                class="bg-gray-600 border-gray-500"
                                aria-label={field.items.enumNames?.[i] || value}
                            />
                            <span class="text-sm text-gray-200">
                                {field.items.enumNames?.[i] || value}
                            </span>
                        </label>
                    {/each}
                </div>

            {:else if field.type === 'array' && field.items?.type === 'string'}
                {#if viewOnly}
                    <div class="flex flex-wrap gap-2">
                        {#if formData[fieldName]}
                            {#each formData[fieldName] as tag}
                                <span class="bg-gray-600 text-white px-2 py-1 rounded-full text-sm">
                                    {tag}
                                </span>
                            {/each}
                        {/if}
                    </div>
                {:else}
                    <!-- Tags input -->
                    <div class="space-y-2">
                        <input
                            id={fieldName}
                            type="text"
                            placeholder="Type and press Enter or comma to add tags"
                            on:keydown={handleTagInput}
                            on:input={handleTagDirectInput}
                            bind:value={tagInputValue}
                            class="w-full bg-gray-700 text-white rounded-lg p-2 border border-gray-600"
                            aria-label={`Add ${field.title || fieldName.replace(/_/g, ' ')}`}
                        />
                        <div class="flex flex-wrap gap-2" role="list" aria-label="Added tags">
                            {#if formData[fieldName]}
                                {#each formData[fieldName] as tag}
                                    <span class="bg-gray-600 text-white px-2 py-1 rounded-full text-sm flex items-center" role="listitem">
                                        {tag}
                                        <button
                                            type="button"
                                            on:click={() => removeTag(tag)}
                                            class="ml-2 text-gray-400 hover:text-white"
                                            aria-label={`Remove tag ${tag}`}
                                        >
                                            ×
                                        </button>
                                    </span>
                                {/each}
                            {/if}
                        </div>
                    </div>
                {/if}

            {:else}
                {#if viewOnly}
                    <div class="w-full bg-gray-700 text-white rounded-lg p-2 border border-gray-600">
                        {formData[fieldName] || '-'}
                    </div>
                {:else}
                    <!-- Input fields based on type -->
                    {#if getInputType(field) === 'datetime-local'}
                        <input
                            id={fieldName}
                            type="datetime-local"
                            value={formData[fieldName] || ''}
                            on:input={(e) => handleInputChange(e, fieldName)}
                            class="w-full bg-gray-700 text-white rounded-lg p-2 border border-gray-600"
                            placeholder={field.description || `Enter ${fieldName.replace(/_/g, ' ')}`}
                            aria-label={field.title || fieldName.replace(/_/g, ' ')}
                        />
                    {:else if getInputType(field) === 'number'}
                        <input
                            id={fieldName}
                            type="number"
                            value={formData[fieldName] || ''}
                            on:input={(e) => handleInputChange(e, fieldName)}
                            class="w-full bg-gray-700 text-white rounded-lg p-2 border border-gray-600"
                            placeholder={field.description || `Enter ${fieldName.replace(/_/g, ' ')}`}
                            aria-label={field.title || fieldName.replace(/_/g, ' ')}
                        />
                    {:else if getInputType(field) === 'checkbox'}
                        <input
                            id={fieldName}
                            type="checkbox"
                            checked={formData[fieldName] || false}
                            on:change={(e) => handleCheckboxInput(e, fieldName)}
                            class="bg-gray-700 border-gray-600"
                            aria-label={field.title || fieldName.replace(/_/g, ' ')}
                        />
                    {:else}
                        <input
                            id={fieldName}
                            type="text"
                            value={formData[fieldName] || ''}
                            on:input={(e) => handleInputChange(e, fieldName)}
                            class="w-full bg-gray-700 text-white rounded-lg p-2 border border-gray-600"
                            placeholder={field.description || `Enter ${fieldName.replace(/_/g, ' ')}`}
                            aria-label={field.title || fieldName.replace(/_/g, ' ')}
                        />
                    {/if}
                {/if}
            {/if}

            {#if field.description}
                <p class="mt-1 text-sm text-gray-400" id={`${fieldName}-description`}>
                    {field.description}
                </p>
            {/if}
        </div>
    {/each}

    {#if !viewOnly}
        <button
            type="submit"
            disabled={isSubmitting}
            class="w-full bg-blue-600 text-white rounded-lg py-2 px-4 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {isSubmitting ? 'Saving…' : 'Submit'}
        </button>
    {/if}
</form>

<style lang="postcss">
    /* Add styles for required fields focus */
    input:required:focus,
    select:required:focus {
        border-color: theme('colors.blue.500');
        box-shadow: 0 0 0 1px theme('colors.blue.500');
    }

    /* Style checkboxes */
    input[type="checkbox"] {
        @apply rounded border-gray-500;
    }
</style> 