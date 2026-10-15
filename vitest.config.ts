import { defineConfig } from 'vitest/config';

// Les tests d'authentification enchaînent plusieurs hachages scrypt (volontairement lents).
export default defineConfig({ test: { testTimeout: 20_000 } });
