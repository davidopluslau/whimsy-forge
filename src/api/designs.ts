export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const designUrl = (id: string) => `/api/designs/${encodeURIComponent(id)}`;

export async function putDesignJson(id: string, json: string): Promise<void> {
  const response = await fetch(designUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: json,
  });
  if (!response.ok) throw new ApiError(response.status, `Save failed (${response.status})`);
}

/** Returns the stored text; pass it through `parseDesign` to get a migrated Design. */
export async function getDesignJson(id: string): Promise<string> {
  const response = await fetch(designUrl(id));
  if (!response.ok) throw new ApiError(response.status, `Load failed (${response.status})`);
  return response.text();
}
