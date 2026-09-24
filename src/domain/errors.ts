/** Thrown by repositories; the API maps these onto HTTP status codes. */
export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
