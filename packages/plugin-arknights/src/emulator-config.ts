/** Explicit executable and selected instance; never arbitrary launch commands. */
import { z } from 'zod';
import { win32 } from 'node:path';
export const emulatorSchema=z.object({
 type:z.literal('mumu'),
 cliPath:z.string().max(1024).refine(path=>/^[A-Za-z]:[\\/]/.test(path)&&!/[\x00-\x1f"<>|?*]/.test(path)&&!path.split(/[\\/]/).includes('..')&&win32.basename(path).toLowerCase()==='mumu-cli.exe','absolute local mumu-cli.exe path required'),
 instanceIndex:z.number().int().min(0).max(9999),
}).strict();
