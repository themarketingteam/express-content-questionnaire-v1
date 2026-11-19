import React from 'react';
import { buildExpressSeoPageCounts } from '../../lib/expressSeoPageCounts.js';

/** @param {any} props */
export default function ExpressSeoPageCounts({ draft = null, submission = null, version = null }) {
  const counts = buildExpressSeoPageCounts({ draft, submission, version });
  return <>{[
    ['Services', counts.services, 6],
    ['Industries', counts.industries, 3],
    ['Total SEO', counts.total, 9],
  ].map(([label, count, maximum]) => <p key={label} className="brand-detail">
    <span className="brand-detail__label">{label}:</span>
    <span className="brand-detail__value">{`${count === null ? '—' : count} / ${maximum}`}</span>
  </p>)}</>;
}
