export async function readResponse(response) {
  let value;
  try { value = await response.json(); }
  catch { throw new Error('The Nudge server is unavailable. Please check the deployment configuration and runtime logs.'); }
  if (!response.ok) throw new Error(value.error || 'The request could not finish. Please try again.');
  return value;
}
