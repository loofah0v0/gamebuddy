import {z} from 'zod';
export const homeActionSchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,64}$/),label:z.string().min(1).max(80),prompt:z.string().min(1).max(6000)}).strict();
export const homeMetadataSchema=z.object({actions:z.array(homeActionSchema).min(1).max(8).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'Home action IDs must be unique')}).strict();
