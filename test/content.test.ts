import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanBlocks } from '../src/common/blocks';
import { cleanHtml, slugify } from '../src/common/sanitize';

test('cleanHtml strips script vectors', () => {
  const out = cleanHtml(`<p onclick="x()">a</p><script>x()</script><img src="javascript:x" onerror="x()"><a href="javascript:x()">b</a>`);
  assert.doesNotMatch(out, /script|onclick|onerror|javascript/i);
});

test('cleanHtml drops unsafe CSS but keeps placement styles', () => {
  const out = cleanHtml(`<img src="https://a.b/c.jpg" style="float:left;width:40%;background-image:url(x);position:fixed">`);
  assert.match(out, /float:left/);
  assert.match(out, /width:40%/);
  assert.doesNotMatch(out, /url\(|position/);
});

test('cleanHtml only allows known iframe hosts', () => {
  assert.doesNotMatch(cleanHtml('<iframe src="https://evil.example/x"></iframe>'), /evil/);
  assert.match(cleanHtml('<iframe src="https://www.youtube.com/embed/x"></iframe>'), /youtube/);
});

test('cleanBlocks rejects unknown types', () => {
  assert.throws(() => cleanBlocks([{ type: 'nope' }]), /unknown type/);
  assert.throws(() => cleanBlocks([{ type: 'constructor' }]), /unknown type/);
});

test('cleanBlocks neutralises hostile style and URLs', () => {
  const [b] = cleanBlocks([
    { type: 'hero', data: { imageUrl: 'javascript:alert(1)', buttonHref: 'https://ok.example/a', overlay: 500 }, style: { background: 'red;}body{display:none', backgroundImage: 'x);evil(', paddingTop: 99999 } },
  ]) as { data: Record<string, unknown>; style: Record<string, unknown> }[];
  assert.equal(b.data.imageUrl, '');
  assert.equal(b.data.buttonHref, 'https://ok.example/a');
  assert.equal(b.data.overlay, 90);
  assert.equal(b.style.background, '');
  assert.equal(b.style.backgroundImage, '');
  assert.equal(b.style.paddingTop, 320);
});

test('slugify', () => {
  assert.equal(slugify('AI & SI — Überblick!'), 'ai-and-si-uberblick');
});

test('cleanBlocks accepts the governance block with no data', () => {
  const [b] = cleanBlocks([{ type: 'governance', data: { names: ['x'] } }]) as { data: Record<string, unknown> }[];
  assert.deepEqual(b.data, {});
});
