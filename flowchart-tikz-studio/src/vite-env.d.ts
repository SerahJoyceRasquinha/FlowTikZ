/// <reference types="vite/client" />

/*
 * Declares Vite's ambient module types, including the side-effect CSS import
 * in `main.tsx`. Without it `npm run typecheck` (and therefore `npm run
 * build`, which typechecks first) fails on that import alone.
 */
