import { spawn } from 'node:child_process';

/**
 * Two ways to reach Claude, and they are not interchangeable:
 *
 *  - 'cli'  spawns the local `claude` binary in headless mode. It authenticates
 *           with the OAuth token stored by `claude login`, so a Pro or Max
 *           subscription pays for the call. This only works on a machine where
 *           you have signed in — it cannot be used from a hosted deployment.
 *  - 'api'  posts to api.anthropic.com with ANTHROPIC_API_KEY. Billed as API
 *           credit, separate from a Pro subscription. The hosting escape hatch.
 */
export type ClaudeMode = 'cli' | 'api' | 'none';

const MODEL = process.env.WAYPOINT_CLAUDE_MODEL || 'claude-sonnet-5';
const CLI = process.env.WAYPOINT_CLAUDE_BIN || 'claude';
const TIMEOUT_MS = Number(process.env.WAYPOINT_CLAUDE_TIMEOUT_MS || 120_000);

let cachedMode: { mode: ClaudeMode; detail: string } | null = null;

function run(cmd: string, args: string[], input?: string, timeout = TIMEOUT_MS) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    // The CLI falls back to key-based billing if it sees ANTHROPIC_API_KEY, which
    // would silently charge API credit instead of the subscription. Strip it.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out after ${timeout}ms`)); }, timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function detectMode(force = false): Promise<{ mode: ClaudeMode; detail: string }> {
  if (cachedMode && !force) return cachedMode;
  const preferred = process.env.WAYPOINT_CLAUDE_MODE;

  if (preferred !== 'api') {
    try {
      const v = await run(CLI, ['--version'], undefined, 15_000);
      if (v.code === 0) {
        cachedMode = { mode: 'cli', detail: `Claude Code CLI ${v.stdout.trim()} · your subscription` };
        return cachedMode;
      }
    } catch {
      /* fall through to the API path */
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    cachedMode = { mode: 'api', detail: 'ANTHROPIC_API_KEY · billed as API credit' };
    return cachedMode;
  }
  cachedMode = { mode: 'none', detail: 'No Claude available. Run `claude login`, or set ANTHROPIC_API_KEY.' };
  return cachedMode;
}

async function askViaCli(system: string, prompt: string): Promise<string> {
  const args = ['-p', '--output-format', 'json', '--model', MODEL, '--append-system-prompt', system];
  const res = await run(CLI, args, prompt);
  if (res.code !== 0) throw new Error(`claude exited ${res.code}: ${res.stderr.slice(0, 400) || res.stdout.slice(0, 400)}`);
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed.is_error) throw new Error(String(parsed.result || 'claude reported an error'));
    return String(parsed.result ?? '');
  } catch (e) {
    if (res.stdout.trim().startsWith('{')) throw e;
    return res.stdout; // older CLIs that ignore --output-format
  }
}

async function askViaApi(system: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
}

export async function ask(system: string, prompt: string): Promise<string> {
  const { mode, detail } = await detectMode();
  if (mode === 'none') throw new Error(detail);
  return mode === 'cli' ? askViaCli(system, prompt) : askViaApi(system, prompt);
}

/** Models drift into prose around JSON; take the outermost brace-balanced span. */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error(`No JSON in model output: ${text.slice(0, 200)}`);
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error(`Unbalanced JSON in model output: ${text.slice(0, 200)}`);
}

export async function askJson<T>(system: string, prompt: string): Promise<T> {
  return extractJson(await ask(system, prompt)) as T;
}
