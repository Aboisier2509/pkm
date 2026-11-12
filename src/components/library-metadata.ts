import type { CategoryMetadataSchemaRecord, JsonObject, MetadataField } from '../models/knowledge';
import { field, node, option } from './library-dom';
import { LibraryTokens } from './library-tokens';

interface FieldDraft {
  value: string | string[];
  present: boolean;
  touched: boolean;
  pending?: string;
}

export type MetadataDraft = Record<string, FieldDraft>;

interface Binding {
  definition: MetadataField;
  state: FieldDraft;
  control?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  tokens?: LibraryTokens;
}

/** No implicit conversion of absent fields; list strings stay separate values. */
export class LibraryMetadata {
  readonly element = node('fieldset', 'library-metadata');
  private readonly bindings: Binding[] = [];

  constructor(
    readonly schema: CategoryMetadataSchemaRecord,
    values: JsonObject,
    draft: MetadataDraft | undefined,
    onChange: () => void,
  ) {
    this.element.append(node('legend', '', 'Campos da categoria'));
    if (!schema.schema_json.fields.length) {
      this.element.append(node('p', 'library-hint', 'Esta categoria usa apenas os campos gerais do conteúdo.'));
      return;
    }
    const grid = node('div', 'library-form-grid');
    for (const definition of schema.schema_json.fields) {
      const present = Object.hasOwn(values, definition.key);
      const raw = values[definition.key];
      const initial: FieldDraft = {
        value: definition.type === 'text_list' ? (Array.isArray(raw) ? [...raw] as string[] : [])
          : definition.type === 'boolean' ? (present ? String(raw) : '')
            : present ? String(raw) : '',
        present,
        touched: false,
      };
      const state = draft?.[definition.key] ? structuredClone(draft[definition.key]) : initial;
      const binding: Binding = { definition, state };
      const id = `metadata-${definition.key}`;
      if (definition.type === 'text_list') {
        const tokens = new LibraryTokens({
          id,
          label: definition.label,
          mode: 'text_list',
          values: state.value as string[],
          onChange: () => { state.touched = true; onChange(); },
        });
        tokens.setPending(state.pending ?? '');
        tokens.element.classList.add('library-full-width');
        binding.tokens = tokens;
        grid.append(tokens.element);
      } else {
        let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (definition.type === 'multiline') {
          const textarea = node('textarea', 'library-input');
          textarea.rows = 4;
          control = textarea;
        } else if (definition.type === 'select' || definition.type === 'boolean') {
          const select = node('select', 'library-input');
          select.append(option('Não informado', ''));
          if (definition.type === 'select') {
            for (const value of definition.options) select.append(option(value, value));
          } else {
            select.append(option('Sim', 'true'), option('Não', 'false'));
          }
          control = select;
        } else {
          const input = node('input', 'library-input');
          input.type = definition.type === 'number' ? 'number' : 'text';
          if (definition.type === 'number') input.step = 'any';
          control = input;
        }
        control.value = state.value as string;
        control.required = definition.required ?? false;
        control.addEventListener('input', () => { state.touched = true; onChange(); });
        control.addEventListener('change', () => { state.touched = true; onChange(); });
        binding.control = control;
        const wrapper = field(id, definition.label, control, definition.required ? 'Obrigatório' : undefined);
        if (definition.type === 'multiline') wrapper.classList.add('library-full-width');
        grid.append(wrapper);
      }
      this.bindings.push(binding);
    }
    this.element.append(grid);
  }

  capture(): MetadataDraft {
    return Object.fromEntries(this.bindings.map(({ definition, state, control, tokens }) => [definition.key, {
      present: state.present,
      touched: state.touched,
      value: tokens ? tokens.getValues() : control!.value,
      ...(tokens ? { pending: tokens.getPending() } : {}),
    }]));
  }

  read(): JsonObject {
    const result: JsonObject = {};
    for (const { definition, state, control, tokens } of this.bindings) {
      if (tokens) {
        tokens.commit();
        const values = tokens.getValues();
        if (definition.required && values.length === 0) throw new Error(`Adicione pelo menos um item em “${definition.label}”.`);
        if (state.present || state.touched || values.length > 0 || definition.required) result[definition.key] = values;
        continue;
      }
      const raw = control!.value;
      if (definition.type === 'number') {
        if (raw === '') {
          if (definition.required) throw new Error(`Preencha “${definition.label}”.`);
          continue;
        }
        const number = Number(raw);
        if (!Number.isFinite(number)) throw new Error(`Informe um número válido em “${definition.label}”.`);
        result[definition.key] = number;
      } else if (definition.type === 'boolean') {
        if (raw === '') {
          if (definition.required) throw new Error(`Escolha uma opção em “${definition.label}”.`);
          continue;
        }
        result[definition.key] = raw === 'true';
      } else if (definition.type === 'select') {
        if (raw === '') {
          if (definition.required) throw new Error(`Escolha uma opção em “${definition.label}”.`);
          continue;
        }
        result[definition.key] = raw;
      } else if (state.present || state.touched || raw !== '' || definition.required) {
        result[definition.key] = raw;
      }
    }
    return result;
  }

  setDisabled(value: boolean): void {
    for (const binding of this.bindings) {
      if (binding.control) binding.control.disabled = value;
      binding.tokens?.setDisabled(value);
    }
  }
}

