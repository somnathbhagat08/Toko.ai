// Comprehensive type declarations for database packages

declare module '@neondatabase/serverless' {
  export interface PoolConfig {
    connectionString: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }
  
  export interface PoolClient {
    query(text: string, params?: any[]): Promise<any>;
    release(): void;
  }
  
  export class Pool {
    constructor(config: PoolConfig);
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  }
  
  export const neonConfig: {
    webSocketConstructor: any;
    [key: string]: any;
  };
}

declare module 'drizzle-orm/neon-serverless' {
  export function drizzle(config: {
    client: any;
    schema?: any;
    logger?: boolean;
  }): DrizzleDatabase;
  
  export interface DrizzleDatabase {
    transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
    [key: string]: any;
  }
}

declare module 'ws' {
  export default class WebSocket {
    constructor(url: string, protocols?: string | string[]);
    static WebSocket: typeof WebSocket;
    
    // Common WebSocket properties and methods
    readyState: number;
    url: string;
    protocol: string;
    
    // Event handlers
    onopen: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    
    // Methods
    send(data: string | ArrayBuffer | Blob): void;
    close(code?: number, reason?: string): void;
    
    // Constants
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;
  }
  
  export = WebSocket;
}
