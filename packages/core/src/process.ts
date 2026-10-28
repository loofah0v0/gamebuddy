/** Run bounded subprocesses without a shell and without retaining command arguments. */
import { spawn } from 'node:child_process';
export function command(file: string, args: string[], signal?: AbortSignal, timeoutMs = 20000, maxBytes = 8 * 1024 * 1024, environment?: NodeJS.ProcessEnv): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('cancelled')); return; }
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(environment ? {env: {...process.env, ...environment}} : {}) });
    const chunks: Buffer[] = []; let bytes = 0; let err = ''; let failure: Error | undefined;
    const stop = (reason: string): void => { failure ??= new Error(reason); child.kill(); };
    const cancel = (): void => stop('cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop('process deadline exceeded'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) stop('output limit exceeded'); else chunks.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-2000); });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure); else if (code !== 0) reject(new Error(`process exit ${code}: ${err}`)); else resolve(Buffer.concat(chunks));
    });
  });
}
