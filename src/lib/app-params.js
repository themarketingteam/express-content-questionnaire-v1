import {
	resolveBase44RuntimeConfig,
	sanitizeBase44AppId,
	sanitizeBase44ServerUrl,
} from './base44RuntimeConfig.js';

const isNode = typeof window === 'undefined';
const memoryStorage = new Map();
const nodeStorage = {
	getItem: (key) => memoryStorage.get(key) ?? null,
	setItem: (key, value) => memoryStorage.set(key, String(value)),
	removeItem: (key) => memoryStorage.delete(key),
};
const windowObj = isNode ? { localStorage: nodeStorage } : window;
const storage = windowObj.localStorage;

export const EXPRESS_BASE44_APP_ID = '6913611c0ea0f6b631343af8';
export const EXPRESS_BASE44_BACKEND_URL = 'https://base44.app';

const safeStorageGet = (key) => {
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
};

const safeStorageSet = (key, value) => {
	try {
		storage.setItem(key, value);
	} catch {
		// Storage may be unavailable in privacy-restricted browsers.
	}
};

const safeStorageRemove = (key) => {
	try {
		storage.removeItem(key);
	} catch {
		// Storage may be unavailable in privacy-restricted browsers.
	}
};

const PUBLISHED_EXPRESS_HOSTS = new Set([
	'expressform.tmtwebsiteresources.xyz',
	'it-business-insights-31343af8.base44.app',
]);

export function isPublishedExpressHost(hostname = '') {
	return PUBLISHED_EXPRESS_HOSTS.has(String(hostname).trim().toLowerCase());
}

export function getPublishedExpressRuntimeParams({ token = null, fromUrl = '' } = {}) {
	return resolveBase44RuntimeConfig({
		appId: EXPRESS_BASE44_APP_ID,
		serverUrl: EXPRESS_BASE44_BACKEND_URL,
		token,
		fromUrl,
		functionsVersion: undefined,
	}, {
		appId: EXPRESS_BASE44_APP_ID,
		serverUrl: EXPRESS_BASE44_BACKEND_URL,
	});
}

const viteEnv = import.meta.env || {};
const defaultAppId = sanitizeBase44AppId(viteEnv.VITE_BASE44_APP_ID, EXPRESS_BASE44_APP_ID);
const defaultBackendUrl = sanitizeBase44ServerUrl(viteEnv.VITE_BASE44_BACKEND_URL, EXPRESS_BASE44_BACKEND_URL);

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		safeStorageSet(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		safeStorageSet(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = safeStorageGet(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	const hostname = isNode ? '' : window.location.hostname;

	if (isPublishedExpressHost(hostname)) {
		safeStorageRemove('base44_app_id');
		safeStorageRemove('base44_server_url');
		safeStorageRemove('base44_functions_version');

		return getPublishedExpressRuntimeParams({
			token: getAppParamValue('access_token', { removeFromUrl: true }),
			fromUrl: window.location.href,
		});
	}

	return resolveBase44RuntimeConfig({
		appId: getAppParamValue("app_id", { defaultValue: defaultAppId }),
		serverUrl: getAppParamValue("server_url", { defaultValue: defaultBackendUrl }),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: isNode ? '' : window.location.href }),
		functionsVersion: getAppParamValue("functions_version"),
	}, {
		appId: EXPRESS_BASE44_APP_ID,
		serverUrl: EXPRESS_BASE44_BACKEND_URL,
	});
}


export const appParams = {
	...getAppParams()
}
