import { GoogleGenAI } from '@google/genai';
import { config } from '../utils/config.js';

/**
 * Server-side AI helpers (Google Gemini). Every function degrades gracefully
 * when GEMINI_API_KEY is unset so the panel works fine without AI.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!config.geminiApiKey) {
    throw Object.assign(
      new Error('AI features are disabled — set GEMINI_API_KEY in .env to enable them.'),
      { statusCode: 503 },
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

export function isAiEnabled(): boolean {
  return Boolean(config.geminiApiKey);
}

async function generate(prompt: string, systemInstruction: string): Promise<string> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { systemInstruction, temperature: 0.4, maxOutputTokens: 1200 },
  });
  return response.text ?? '';
}

/** Explain a crash / error log and suggest concrete fixes. */
export async function analyzeCrash(logExcerpt: string, context: {
  serverType: string;
  version: string;
  ram: number;
}): Promise<string> {
  const trimmed = logExcerpt.slice(-12_000);
  return generate(
    [
      `Server software: ${context.serverType} ${context.version}, ${context.ram} GB RAM allocated.`,
      'Console output:',
      '```',
      trimmed,
      '```',
    ].join('\n'),
    [
      'You are a Minecraft server administrator assistant inside a hosting panel.',
      'Diagnose the problem from the log. Answer with: 1) a one-line summary,',
      '2) the probable cause, 3) numbered, concrete fix steps referencing real files',
      '(server.properties, plugins/, mods/) or panel actions. Be concise and never invent',
      'plugin names that are not in the log.',
    ].join(' '),
  );
}

/** Explain a server.properties key in plain language. */
export async function explainProperty(key: string, value: string): Promise<string> {
  return generate(
    `Explain the Minecraft server.properties option "${key}" (currently "${value}").`,
    'You are a concise Minecraft documentation assistant. Answer in at most three sentences: what the option does, valid values, and the practical performance/gameplay impact.',
  );
}

/** Suggest performance tuning for a server configuration. */
export async function suggestOptimizations(input: {
  serverType: string;
  version: string;
  ram: number;
  cpu: number;
  players: number;
  properties?: Record<string, string>;
}): Promise<string> {
  return generate(
    JSON.stringify(input, null, 2),
    [
      'You are a Minecraft server performance expert. Given a server configuration as JSON,',
      'return a short markdown list of the highest impact changes: JVM flags, server.properties',
      'values (view-distance, simulation-distance, entity limits) and recommended plugins/mods.',
      'Mention the trade-off for each suggestion. Maximum 8 bullet points.',
    ].join(' '),
  );
}

/** Free-form assistant used by the console helper. */
export async function askAssistant(question: string, serverContext?: string): Promise<string> {
  return generate(
    serverContext ? `Server context:\n${serverContext}\n\nQuestion: ${question}` : question,
    'You are the JTG Panel assistant. Help the user operate their game server. Prefer exact commands and file paths. Keep answers under 200 words unless asked for detail.',
  );
}
