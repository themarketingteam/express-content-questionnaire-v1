import { createClient } from '@base44/sdk';
import { appParams } from '../lib/app-params.js';
import { buildBase44FunctionEndpoint, resolveBase44RuntimeConfig } from '../lib/base44RuntimeConfig.js';

export const base44RuntimeConfig = Object.freeze(resolveBase44RuntimeConfig(appParams, appParams));
const { appId, serverUrl, token, functionsVersion } = base44RuntimeConfig;

export const getBase44FunctionEndpoint = (functionName) =>
  buildBase44FunctionEndpoint(base44RuntimeConfig, functionName);

//Create a client with authentication required
export const base44 = createClient({
  appId,
  serverUrl,
  token,
  functionsVersion,
  requiresAuth: false
});
