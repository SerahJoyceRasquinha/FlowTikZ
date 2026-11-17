/**
 * The few Node.js APIs the project-import tests use (reading fixture zips,
 * running pdflatex and Python). Declared here instead of pulling @types/node
 * into the whole program, which would change browser typings for the app.
 */
declare const __dirname: string;

declare class Buffer extends Uint8Array {
  static from(data: ArrayBuffer | Uint8Array | string, encoding?: string): Buffer;
  equals(other: Uint8Array): boolean;
  toString(encoding?: string): string;
}

declare module 'node:fs' {
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { size: number };
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:child_process' {
  interface SpawnResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }
  export function execFileSync(cmd: string, args: string[], opts?: { stdio?: string; cwd?: string; timeout?: number; maxBuffer?: number }): Buffer;
  export function spawnSync(cmd: string, args: string[], opts?: { cwd?: string; encoding?: string; timeout?: number }): SpawnResult;
}
