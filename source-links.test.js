import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLink } from './source-links.js';

test('portal items link to their individual HubSpot update, including existing saved items', () => {
  assert.equal(sourceLink({ source: 'portal-updates', id: 'portal-14134431', sourceUrl: 'https://www.hubspot.com/product-updates' }), 'https://app-eu1.hubspot.com/product-updates/139633041/all?update=14134431');
});
test('non-portal sources retain their article links', () => {
  assert.equal(sourceLink({ source: 'dev-changelog', id: 'example', sourceUrl: 'https://developers.hubspot.com/changelog/example' }), 'https://developers.hubspot.com/changelog/example');
});
test('malformed portal IDs are not normalized into invented IDs', () => {
  assert.equal(sourceLink({ source: 'portal-updates', id: 'portal-123x', sourceUrl: 'https://example.com/article' }), 'https://example.com/article');
});
