/** An error with an HTTP status and a plain-language message that is safe to show users. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code?: string, extra?: Record<string, unknown>) => new AppError(400, msg, code, extra);
export const forbidden = (msg = 'You don’t have permission to do that.', code = 'forbidden') => new AppError(403, msg, code);
export const notFound = (msg = 'Not found.') => new AppError(404, msg, 'not_found');
export const conflict = (msg: string, code?: string, extra?: Record<string, unknown>) => new AppError(409, msg, code, extra);
