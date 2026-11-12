import type { CategoryPreset } from './knowledge';

/** Suggestions only: importing this module never seeds or changes the database. */
export const CATEGORY_PRESETS = [
  {
    key: 'ai_prompts',
    name: 'Prompts de IA',
    description: 'Prompts reutilizáveis, suas variáveis e exemplos de resultado.',
    contentLabel: 'Prompt completo',
    schema: {
      formatVersion: 1,
      fields: [
        { key: 'objective', label: 'Objetivo', type: 'multiline' },
        { key: 'tool', label: 'Ferramenta', type: 'text' },
        { key: 'variables', label: 'Variáveis', type: 'text_list' },
        { key: 'example_result', label: 'Exemplo de resultado', type: 'multiline' },
      ],
    },
  },
  {
    key: 'recipes',
    name: 'Receitas',
    description: 'Ingredientes, quantidades e modo de preparo.',
    contentLabel: 'Modo de preparo',
    schema: {
      formatVersion: 1,
      fields: [
        { key: 'ingredients', label: 'Ingredientes', type: 'text_list' },
        { key: 'quantities', label: 'Quantidades', type: 'text_list' },
        { key: 'time_minutes', label: 'Tempo em minutos', type: 'number' },
        { key: 'yield', label: 'Rendimento', type: 'text' },
      ],
    },
  },
  {
    key: 'exercises',
    name: 'Exercícios',
    description: 'Execução, equipamento e organização dos exercícios.',
    contentLabel: 'Instruções',
    schema: {
      formatVersion: 1,
      fields: [
        { key: 'muscle_group', label: 'Grupo muscular', type: 'text' },
        { key: 'equipment', label: 'Equipamento', type: 'text' },
        { key: 'sets', label: 'Séries', type: 'number' },
        { key: 'repetitions', label: 'Repetições', type: 'text' },
      ],
    },
  },
  {
    key: 'ethical_hacking',
    name: 'Ethical Hacking',
    description: 'Procedimentos e referências de laboratórios autorizados.',
    contentLabel: 'Procedimentos',
    schema: {
      formatVersion: 1,
      fields: [
        { key: 'tool', label: 'Ferramenta', type: 'text' },
        { key: 'operating_system', label: 'Sistema operacional', type: 'text' },
        { key: 'authorized_lab', label: 'Laboratório autorizado', type: 'text' },
        { key: 'commands', label: 'Comandos', type: 'multiline' },
        { key: 'references', label: 'Referências', type: 'text_list' },
      ],
    },
  },
] as const satisfies readonly CategoryPreset[];

