const request = async (endpoint, body) => {
  if (!endpoint.startsWith('/_local/')) throw new Error('Only local Express endpoints are permitted.');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Local request failed.'), { status: response.status, code: data.code, response: { status: response.status, data } });
  return data;
};
export const base44RuntimeConfig = Object.freeze({ appId: 'local-express-questionnaire', serverUrl: typeof window === 'undefined' ? 'http://localhost:5174' : window.location.origin, token: null, functionsVersion: undefined });
export const getBase44FunctionEndpoint = (name) => {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid local function name.');
  return `/_local/api/functions/${name}`;
};
const disabled = async () => { throw new Error('This external integration is disconnected in the local Express preview.'); };
export const base44 = {
  functions: { invoke: async (name, body) => ({ data: await request(getBase44FunctionEndpoint(name), body) }) },
  entities: new Proxy({}, { get: (_, entityName) => { const name = String(entityName); return ({
    create: (data) => request(`/_local/api/entities/${name}/create`, { data }),
    update: (id, data) => request(`/_local/api/entities/${name}/update`, { id, data }),
    get: (id) => request(`/_local/api/entities/${name}/get`, { id }),
    filter: (query) => request(`/_local/api/entities/${name}/filter`, { query }),
    list: () => request(`/_local/api/entities/${name}/filter`, {}), subscribe: () => () => {}
  }); } }),
  auth: { me: async () => ({ id: 'local-user', role: 'admin' }), logout: () => {}, isAuthenticated: async () => true },
  integrations: { Core: { InvokeLLM: disabled, UploadFile: disabled, SendEmail: disabled } },
  agents: { createConversation: disabled, addMessage: disabled },
  appLogs: { logUserInApp: async () => {} }, analytics: { track: () => {} }
};
