import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Download, FileJson, FlaskConical, History, RotateCcw, X } from 'lucide-react';
import Questionnaire from '@/pages/Questionnaire';
import { buildExpressSubmissionPayload } from '@/lib/expressQuestionnairePayload';
import { readDraftIdentityFromHash } from '@/lib/questionnaireDraftIdentity';
import { installLocalNetworkGuard } from './networkGuard';
import '@/index.css';
import './preview.css';

installLocalNetworkGuard();
const post = async (endpoint, body = {}) => {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Local preview request failed.'); return data;
};
const download = (value, filename) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const identity = () => readDraftIdentityFromHash(window.location.hash) || { sessionId: '', accessKey: '' };
const openDraft = ({ sessionId, accessKey }) => {
  // The questionnaire ignores browser snapshots belonging to another session.
  // Prior drafts and browser recovery backups remain available.
  window.location.assign('/#' + new URLSearchParams({ draft: sessionId, key: accessKey }));
  window.location.reload();
};

function PreviewTools() {
  const [snapshot, setSnapshot] = useState(null);
  const [panel, setPanel] = useState('');
  const [error, setError] = useState('');
  const [versions, setVersions] = useState([]);
  const [captures, setCaptures] = useState([]);
  useEffect(() => {
    const listener = (event) => setSnapshot(event.detail);
    window.addEventListener('express-local-snapshot', listener);
    return () => window.removeEventListener('express-local-snapshot', listener);
  }, []);
  let payload;
  let payloadError = '';
  try {
    if (snapshot) payload = buildExpressSubmissionPayload({ formData: snapshot.formData, businessName: snapshot.businessName || 'Local test', domain: snapshot.domain || 'local-example.test', sessionId: identity().sessionId, submitAttemptId: '' });
  } catch (issue) { payloadError = issue.message; }
  const cleanPayload = payload ? { metadata: payload.metadata, userdata: payload.userdata } : null;
  const fixture = async (type) => {
    try { setError(''); openDraft(await post('/_local/api/fixture', { fixture: type })); }
    catch (issue) { setError(issue.message); }
  };
  const history = async () => {
    try { setError(''); const result = await post('/_local/api/history', identity()); setVersions(result.versions); setPanel('history'); }
    catch (issue) { setError(issue.message); }
  };
  const inspectCaptures = async () => {
    try { setError(''); const result = await fetch('/_local/api/state').then((response) => response.json()); setCaptures(result.captures); setPanel('captures'); }
    catch (issue) { setError(issue.message); }
  };
  return <>
    <aside className="local-toolbar" aria-label="Local Express testing tools">
      <div className="local-toolbar-title"><FlaskConical size={23} /><div><strong>Express · Local testing workspace</strong><span>Base44 and Zapier disconnected · drafts saved on this computer</span></div><span className="local-port">localhost:5174</span></div>
      <div className="local-tool-actions">
        <button type="button" onClick={() => fixture('legacy')}><RotateCcw size={15} />Load legacy sample</button>
        <button type="button" onClick={() => fixture('blank')}>Start blank draft</button>
        <button type="button" onClick={() => setPanel('json')}><FileJson size={15} />Inspect JSON</button>
        <button type="button" disabled={!cleanPayload} onClick={() => download(cleanPayload, 'express-questionnaire-local.json')}><Download size={15} />Export JSON</button>
        <button type="button" onClick={history}><History size={15} />Saved versions</button>
        <button type="button" onClick={inspectCaptures}>Submission captures</button>
      </div>
      {error && <p role="alert" className="local-error">{error}</p>}
    </aside>
    {panel && <div className="local-panel-backdrop" onClick={() => setPanel('')}><section role="dialog" aria-modal="true" aria-label={panel === 'json' ? 'Express payload preview' : panel === 'history' ? 'Saved local versions' : 'Local submission captures'} className="local-panel" onClick={(event) => event.stopPropagation()}>
      <header><div><h2>{panel === 'json' ? 'Express payload preview' : panel === 'history' ? 'Saved local versions' : 'Local submission captures'}</h2><p>{panel === 'json' ? 'Current answers, including unsaved edits. Nothing is sent externally.' : 'These records exist only on this computer.'}</p></div><button type="button" aria-label="Close local panel" onClick={() => setPanel('')}><X /></button></header>
      {panel === 'json' && <><p className="local-json-status">{payloadError || (payload?.metadata.questionnaire_payload_version === 2 ? 'Version 2 · organized pages' : 'Legacy format · organizer not yet adopted')}</p><pre>{JSON.stringify(cleanPayload || { message: payloadError || 'Waiting for the local questionnaire to load.' }, null, 2)}</pre></>}
      {panel === 'history' && <><p className="local-notice">Restoring creates a separate local draft. The current draft and its history are retained.</p>{!versions.length && <p>No saved versions yet.</p>}{versions.map((entry) => <div className="local-record" key={entry.id}><span>Revision {entry.revision}<small>{new Date(entry.capturedAt).toLocaleString()} · {entry.type}</small></span><button type="button" onClick={async () => { try { openDraft(await post('/_local/api/restore', { ...identity(), versionId: entry.id })); } catch (issue) { setError(issue.message); } }}>Restore as new draft</button></div>)}</>}
      {panel === 'captures' && <>{!captures.length && <p>No submissions captured yet. Submit the local questionnaire to create one.</p>}{[...captures].reverse().map((entry) => <div className="local-record" key={entry.id}><span>{entry.payload.metadata?.business_name || 'Local capture'}<small>{entry.route} · {new Date(entry.capturedAt).toLocaleString()}</small><small>{entry.destination}</small></span><button type="button" onClick={() => download(entry.payload, `${entry.id}.json`)}>Download JSON</button></div>)}</>}
    </section></div>}
  </>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<BrowserRouter><PreviewTools /><Questionnaire /></BrowserRouter>);
