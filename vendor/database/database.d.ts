/* tslint:disable */
/* eslint-disable */

export class Database {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Execute a DDL or DML statement. Returns a status string.
     */
    execute(sql: string): string;
    /**
     * Flush dirty pages from the write cache to the underlying storage provider.
     */
    flush(): void;
    constructor();
    /**
     * Execute a SELECT. Returns a JS Array of row arrays.
     */
    query(sql: string): any;
    /**
     * Create a Database backed by a custom JS storage provider.
     *
     * `provider` must implement the `PageStorageProvider` interface:
     * - `pageCount(): number`
     * - `setPageCount(n: number): void`
     * - `readPage(n: number): Uint8Array`   — exactly 4096 bytes
     * - `writePage(n: number, data: Uint8Array): void`
     * - `flush(): void`
     *
     * All methods are called synchronously. For async backends (S3, IndexedDB),
     * implement the provider in a Worker and use `Atomics.wait()` to block.
     */
    static withStorage(provider: any): Database;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_database_free: (a: number, b: number) => void;
    readonly database_execute: (a: number, b: number, c: number) => [number, number, number, number];
    readonly database_flush: (a: number) => [number, number];
    readonly database_new: () => number;
    readonly database_query: (a: number, b: number, c: number) => [number, number, number];
    readonly database_withStorage: (a: any) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
