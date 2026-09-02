import type { AnswerConfig } from '../../config.js';
import { fetchWithTimeout } from '../../http.js';
import type { Synthesizer } from '../types.js';

export interface SynthesisExtract {
  id: number;
  source: string;
  text: string;
}

export interface SynthesisInput {
  query: string;
  extracts: SynthesisExtract[];
}

export interface LlmSynthesizer {
  readonly name: string;
  readonly kind: Extract<Synthesizer, `llm-${string}`>;
  readonly configured: boolean;
  /** Return prose that answers the query using only the extracts, with `[n]` markers. */
  weave(input: SynthesisInput, signal?: AbortSignal): Promise<string>;
}

export const SYNTHESIS_SYSTEM_PROMPT = [
  'You write a short, accurate answer to the user question using ONLY the numbered extracts provided.',
  'Rules:',
  '- Every sentence must end with the bracketed number(s) of the extract(s) that support it, e.g. "Water boils at 100C at sea level [2].".',
  '- Never state anything that is not directly supported by an extract. Do not use outside knowledge.',
  '- If the extracts do not contain the answer, reply with exactly: The available sources do not answer this question.',
  '- Be concise: at most 5 sentences. No preamble, no headings, no bullet points.',
].join('\n');

function buildUserMessage(input: SynthesisInput): string {
  const extracts = input.extracts.map((e) => `[${e.id}] (${e.source})\n${e.text}`).join('\n\n');
  return `Question: ${input.query}\n\nExtracts:\n${extracts}\n\nWrite the cited answer now.`;
}

function truncateForError(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/** Anthropic Messages API, called over raw HTTP (matches the plate providers). */
export class AnthropicSynthesizer implements LlmSynthesizer {
  readonly name = 'Anthropic';
  readonly kind = 'llm-anthropic' as const;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnswerConfig, fetchImpl?: typeof fetch) {
    this.apiKey = config.anthropicApiKey?.trim() || undefined;
    this.model = config.anthropicModel;
    this.timeoutMs = config.llmTimeoutMs;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async weave(input: SynthesisInput, signal?: AbortSignal): Promise<string> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        system: SYNTHESIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      }),
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      parentSignal: signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic API HTTP ${response.status}: ${truncateForError(raw)}`);
    }
    const body = JSON.parse(raw) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('Anthropic API returned no text content');
    return text;
  }
}

/** Any OpenAI-compatible chat-completions endpoint (OpenAI, Ollama, llama.cpp…). */
export class OpenAiCompatibleSynthesizer implements LlmSynthesizer {
  readonly name = 'OpenAI-compatible';
  readonly kind = 'llm-openai' as const;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnswerConfig, fetchImpl?: typeof fetch) {
    this.apiKey = config.openaiApiKey?.trim() || undefined;
    this.baseUrl = config.openaiBaseUrl.replace(/\/+$/, '');
    this.model = config.openaiModel;
    this.timeoutMs = config.llmTimeoutMs;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.model);
  }

  async weave(input: SynthesisInput, signal?: AbortSignal): Promise<string> {
    if (!this.apiKey || !this.model) {
      throw new Error('OPENAI_API_KEY / BEACON_ANSWER_OPENAI_MODEL are not configured');
    }
    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input) },
        ],
      }),
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      parentSignal: signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI-compatible API HTTP ${response.status}: ${truncateForError(raw)}`);
    }
    const body = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI-compatible API returned no content');
    return text;
  }
}

/** Ordered list of configured LLM synthesizers (Anthropic first, then OpenAI). */
export function createLlmSynthesizers(
  config: AnswerConfig,
  fetchImpl?: typeof fetch,
): LlmSynthesizer[] {
  return [
    new AnthropicSynthesizer(config, fetchImpl),
    new OpenAiCompatibleSynthesizer(config, fetchImpl),
  ].filter((s) => s.configured);
}
