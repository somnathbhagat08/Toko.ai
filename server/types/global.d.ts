/// <reference types="node" />

// Global type augmentations and module declarations
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL?: string;
      DB_MAX_CONNECTIONS?: string;
      DB_IDLE_TIMEOUT?: string;
      DB_CONNECTION_TIMEOUT?: string;
      DB_RETRY_ATTEMPTS?: string;
      DB_RETRY_DELAY?: string;
      DB_ENABLE_METRICS?: string;
      DB_ENABLE_QUERY_LOGGING?: string;
      DB_SLOW_QUERY_THRESHOLD?: string;
      DB_ENABLE_CIRCUIT_BREAKER?: string;
      NODE_ENV?: 'development' | 'production' | 'test';
      LOG_LEVEL?: string;
      JWT_SECRET?: string;
      JWT_REFRESH_SECRET?: string;
      REDIS_URL?: string;
      CORS_ORIGIN?: string;
      TRUST_PROXY?: string;
      PORT?: string;
      LIVEKIT_API_KEY?: string;
      LIVEKIT_API_SECRET?: string;
      LIVEKIT_SERVER_URL?: string;
      EMAIL_PROVIDER?: string;
      SMTP_HOST?: string;
      SMTP_PORT?: string;
      SMTP_USER?: string;
      SMTP_PASS?: string;
    }
  }
}

// Module declarations for packages without types
declare module 'bcrypt' {
  export function hash(data: string | Buffer, saltOrRounds: string | number): Promise<string>;
  export function hashSync(data: string | Buffer, saltOrRounds: string | number): string;
  export function compare(data: string | Buffer, encrypted: string): Promise<boolean>;
  export function compareSync(data: string | Buffer, encrypted: string): boolean;
  export function genSalt(rounds?: number, minor?: 'a' | 'b'): Promise<string>;
  export function genSaltSync(rounds?: number, minor?: 'a' | 'b'): string;
}

declare module 'compression' {
  import { RequestHandler } from 'express';
  
  interface CompressionOptions {
    chunkSize?: number;
    filter?: (req: any, res: any) => boolean;
    level?: number;
    memLevel?: number;
    strategy?: number;
    threshold?: string | number;
    windowBits?: number;
  }

  function compression(options?: CompressionOptions): RequestHandler;
  namespace compression {
    function filter(req: any, res: any): boolean;
  }
  export = compression;
}

declare module 'helmet' {
  import { RequestHandler } from 'express';
  
  interface HelmetOptions {
    contentSecurityPolicy?: boolean | object;
    crossOriginEmbedderPolicy?: boolean | object;
    crossOriginOpenerPolicy?: boolean | object;
    crossOriginResourcePolicy?: boolean | object;
    dnsPrefetchControl?: boolean | object;
    expectCt?: boolean | object;
    frameguard?: boolean | object;
    hidePoweredBy?: boolean | object;
    hsts?: boolean | object;
    ieNoOpen?: boolean | object;
    noSniff?: boolean | object;
    originAgentCluster?: boolean | object;
    permittedCrossDomainPolicies?: boolean | object;
    referrerPolicy?: boolean | object;
    xssFilter?: boolean | object;
  }

  function helmet(options?: HelmetOptions): RequestHandler;
  export = helmet;
}

declare module 'jsonwebtoken' {
  export interface JwtPayload {
    [key: string]: any;
    iss?: string;
    sub?: string;
    aud?: string | string[];
    exp?: number;
    nbf?: number;
    iat?: number;
    jti?: string;
  }

  export interface SignOptions {
    algorithm?: string;
    expiresIn?: string | number;
    notBefore?: string | number;
    audience?: string | string[];
    subject?: string;
    issuer?: string;
    jwtid?: string;
    mutatePayload?: boolean;
    noTimestamp?: boolean;
    header?: object;
    encoding?: string;
  }

  export interface VerifyOptions {
    algorithms?: string[];
    audience?: string | RegExp | (string | RegExp)[];
    clockTimestamp?: number;
    clockTolerance?: number;
    complete?: boolean;
    issuer?: string | string[];
    ignoreExpiration?: boolean;
    ignoreNotBefore?: boolean;
    jwtid?: string;
    nonce?: string;
    subject?: string;
    maxAge?: string | number;
  }

  export function sign(
    payload: string | Buffer | object,
    secretOrPrivateKey: string | Buffer,
    options?: SignOptions,
    callback?: (err: Error | null, encoded: string) => void
  ): string;

  export function verify(
    token: string,
    secretOrPublicKey: string | Buffer,
    options?: VerifyOptions,
    callback?: (err: Error | null, decoded: object | string) => void
  ): string | JwtPayload;

  export function decode(
    token: string,
    options?: { complete?: boolean; json?: boolean }
  ): null | { [key: string]: any } | string;
}

declare module 'multer' {
  import { RequestHandler } from 'express';

  interface MulterOptions {
    dest?: string;
    storage?: any;
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
    preservePath?: boolean;
    fileFilter?: (req: any, file: any, cb: any) => void;
  }

  interface Multer {
    single(fieldname: string): RequestHandler;
    array(fieldname: string, maxCount?: number): RequestHandler;
    fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
    none(): RequestHandler;
    any(): RequestHandler;
  }

  function multer(options?: MulterOptions): Multer;
  export = multer;
}

// Ensure this file is treated as a module
export {};

// Express module declarations
declare module 'express' {
  export interface Request {
    ip?: string;
    user?: any;
    file?: Express.Multer.File;
    files?: Express.Multer.File[];
    body: any;
    query: any;
    params: any;
    headers: any;
    method: string;
    url: string;
    path: string;
    socket: any;
    get(header: string): string | undefined;
  }
  
  export interface Response {
    json(body?: any): Response;
    status(code: number): Response;
    send(body?: any): Response;
    setHeader(name: string, value: string | number | string[]): Response;
    set(field: string, value?: string | string[]): Response;
    cookie(name: string, value: any, options?: any): Response;
  }
  
  export interface NextFunction {
    (error?: any): void;
  }
  
  export interface Express {
    use(...args: any[]): Express;
    get(path: string, ...handlers: any[]): Express;
    post(path: string, ...handlers: any[]): Express;
    put(path: string, ...handlers: any[]): Express;
    delete(path: string, ...handlers: any[]): Express;
    patch(path: string, ...handlers: any[]): Express;
    listen(port: number, callback?: () => void): any;
  }

  export interface Application extends Express {}
  
  export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void;
  export type ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => void;
  
  function express(): Express;
  export = express;
}

declare namespace Express {
  export interface Multer {
    File: {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer: Buffer;
    };
  }
}
