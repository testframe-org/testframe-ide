/** Data that cannot be stored in the project format (answered with HTTP 400). */
export class FormatError extends Error {
  readonly issues: string[];

  constructor(issues: string | string[]) {
    const list = Array.isArray(issues) ? issues : [issues];
    super(list.join('; '));
    this.name = 'FormatError';
    this.issues = [...list];
  }
}

/** An API failure with its HTTP status ({status, message, problems?} body). */
export class ApiError extends Error {
  readonly status: number;
  readonly problems?: string[];

  constructor(status: number, message: string, problems?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problems = problems;
  }
}
