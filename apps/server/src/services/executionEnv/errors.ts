export type ExecutionEnvErrorCode =
  | 'DECRYPT_FAILED'
  | 'ENV_REF_REQUIRED'
  | 'INVALID_ENV_FILE'
  | 'INVALID_ENV_KEY'
  | 'INVALID_REQUEST'
  | 'LOAD_FAILED'
  | 'RESERVED_ENV_KEY';

/** A deliberately value-free error safe for logs, traces, and browser error envelopes. */
export class ExecutionEnvError extends Error {
  readonly code: ExecutionEnvErrorCode;

  constructor(code: ExecutionEnvErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ExecutionEnvError';
  }

  toJSON() {
    return { code: this.code, message: this.message, name: this.name };
  }
}
