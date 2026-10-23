import { requireUser, json } from './_auth.js';
import { dataSourceStatus } from './_data-source.js';
export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  return json(dataSourceStatus(context.env, context.request));
}
