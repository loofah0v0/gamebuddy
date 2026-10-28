/** Native DSH + isolated headless browser fixtures; not model/game E2E. */
process.env.GAMEGUY_VERIFY_BROWSER = '1';
await import('./smoke-native.mjs');
