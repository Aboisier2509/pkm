import { DatabaseError } from '../models/database';

export const MAX_CONTENT_LENGTH = 20_000;

/** Validate without rewriting the original content (including whitespace/Unicode). */
export function validateProbeContent(content: unknown): string {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new DatabaseError('INVALID_INPUT', 'Digite um texto para gravar o registro.');
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new DatabaseError('INVALID_INPUT', 'O texto deve ter no máximo 20.000 caracteres.');
  }
  if (content.includes('\u0000')) {
    throw new DatabaseError('INVALID_INPUT', 'O texto contém um caractere nulo não permitido.');
  }
  // UTF-8 encoders replace lone UTF-16 surrogates. Reject them rather than
  // acknowledging a write whose recovered content differs from the input.
  for (const character of content) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) {
      throw new DatabaseError('INVALID_INPUT', 'O texto contém uma sequência Unicode inválida.');
    }
  }
  return content;
}
