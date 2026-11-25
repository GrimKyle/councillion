/* Councillion bulk authoring. Parses data only; never executes imported content. */
(function (root) {
  'use strict';
  const LIMIT = 1024 * 1024;
  const ROW_LIMIT = 7000;
  const TIERS = { dino: 'dino', '10': 'dino', kalen: 'kalen', '15': 'kalen', cavaughn: 'cavaughn', '30': 'cavaughn', donovan: 'donovan', '60': 'donovan', grimkyle: 'grimkyle', '85': 'grimkyle', councillion: 'councillion', oneinacouncillion: 'councillion', '100': 'councillion' };
  const uuid = () => root.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.random() * 16 | 0; return (c === 'x' ? n : (n & 3 | 8)).toString(16); });
  const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function inputText(value) {
    if (typeof value !== 'string') throw new Error('Paste text or choose a CSV, TSV, or JSON file.');
    const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : value.length;
    if (bytes > LIMIT) throw new Error('Import files must be 1 MB or smaller.');
    if (value.includes('\0')) throw new Error('This file contains a null character. Export it as UTF-8 text first.');
    return value.replace(/^\uFEFF/, '');
  }
  function text(value, label, max, empty = true) {
    if (typeof value !== 'string') throw new Error(label + ' must be text.');
    const s = value.trim();
    if (!empty && !s) throw new Error(label + ' cannot be blank.');
    if (s.length > max) throw new Error(label + ' must be ' + max + ' characters or fewer.');
    return s;
  }
  function tier(value, fallback) {
    const raw = value == null || String(value).trim() === '' ? fallback : String(value);
    const result = TIERS[normalize(raw)];
    if (!result) throw new Error('Unknown rank “' + String(raw ?? '') + '”. Use a Council rank or 10, 15, 30, 60, 85, 100.');
    return result;
  }
  // Strict RFC-style quoted fields; delimiter can also be a tab or vertical bar.
  function rows(source, delimiter) {
    const result = [];
    let row = [], cell = '', quoted = false, endedQuote = false, atStart = true;
    function field() { row.push(cell); cell = ''; endedQuote = false; atStart = true; }
    function line() { field(); if (row.some(c => c.trim() !== '')) result.push(row); row = []; if (result.length > ROW_LIMIT + 1) throw new Error('Imports may contain at most 7,000 answer rows.'); }
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (quoted) {
        if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; endedQuote = true; } }
        else cell += c;
        continue;
      }
      if (c === delimiter) { field(); continue; }
      if (c === '\r' || c === '\n') { if (c === '\r' && source[i + 1] === '\n') i++; line(); continue; }
      if (endedQuote) { if (c === ' ' || (c === '\t' && delimiter !== '\t')) continue; throw new Error('Unexpected text after a closing quote near row ' + (result.length + 1) + '.'); }
      if (c === '"') { if (!atStart) throw new Error('Put quotes around the whole field near row ' + (result.length + 1) + '.'); quoted = true; atStart = false; continue; }
      cell += c; atStart = false;
    }
    if (quoted) throw new Error('A quoted field is not closed. Check the last quotation mark.');
    if (row.length || cell || endedQuote) line();
    return result;
  }
  function aliases(value, separator = '|') {
    if (Array.isArray(value)) return value.map((v, i) => text(v, 'Alias ' + (i + 1), 160, false));
    return String(value ?? '').split(separator).map(v => v.trim()).filter(Boolean).map(v => text(v, 'Alias', 160, false));
  }
  function makeAnswer(value, fallback = 'dino', label = 'Answer') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object.');
    const canonical = text(value.canonical ?? value.answer ?? '', label, 160, false);
    if (!normalize(canonical)) throw new Error(label + ' must contain a letter or number.');
    const result = { id: uuid(), canonical, tier: tier(value.tier, fallback), aliases: aliases(value.aliases ?? []), explanation: text(value.explanation ?? '', label + ' explanation', 1000) };
    if (result.aliases.length > 100) throw new Error(label + ' has more than 100 aliases.');
    return result;
  }
  function mergeAnswers(values) {
    if (values.length > 1000) throw new Error('A question may contain at most 1,000 accepted answers.');
    const merged = new Map();
    for (const value of values) {
      const key = normalize(value.canonical), existing = merged.get(key);
      if (existing) {
        if (existing.tier !== value.tier) throw new Error('“' + value.canonical + '” appears twice with different ranks.');
        if (existing.explanation && value.explanation && existing.explanation !== value.explanation) throw new Error('“' + value.canonical + '” appears twice with different explanations.');
        existing.explanation ||= value.explanation;
        existing.aliases.push(...value.aliases);
      } else merged.set(key, { ...value, aliases: [...value.aliases] });
    }
    const seen = new Map();
    for (const answer of merged.values()) {
      const canonicalKey = normalize(answer.canonical), ownAliases = new Map();
      for (const spelling of [answer.canonical, ...answer.aliases]) {
        const n = normalize(spelling);
        if (!n) throw new Error('An alias must contain a letter or number.');
        const previous = seen.get(n);
        if (previous && previous !== canonicalKey) throw new Error('“' + spelling + '” matches two different answers. Remove or change that alias.');
        seen.set(n, canonicalKey);
        if (n !== canonicalKey && !ownAliases.has(n)) ownAliases.set(n, spelling);
      }
      answer.aliases = [...ownAliases.values()];
      if (answer.aliases.length > 100) throw new Error('“' + answer.canonical + '” has more than 100 aliases.');
    }
    return [...merged.values()];
  }
  function makePack(questions, options, metadata = {}) {
    if (!Array.isArray(questions) || questions.length !== 7) throw new Error('A pack must contain exactly seven questions, numbered 1–7.');
    return {
      id: null,
      title: text(metadata.title ?? options.title ?? 'Imported pack', 'Pack title', 80, false),
      description: text(metadata.description ?? options.description ?? '', 'Pack description', 300),
      icon: ['turkey', 'crown', 'game', 'music', 'film', 'globe', 'food', 'sport', 'book', 'star'].includes(metadata.icon) ? metadata.icon : 'turkey',
      color: /^#[0-9a-f]{6}$/i.test(metadata.color || '') ? metadata.color : '#d38966',
      published: false,
      questions: questions.map((q, i) => {
        if (!q || typeof q !== 'object' || !Array.isArray(q.answers)) throw new Error('Question ' + (i + 1) + ' needs an answers array.');
        return { id: uuid(), prompt: text(q.prompt ?? '', 'Question ' + (i + 1) + ' prompt', 500, false), answers: mergeAnswers(q.answers.map((a, j) => makeAnswer(a, 'dino', 'Question ' + (i + 1) + ', answer ' + (j + 1)))) };
      })
    };
  }
  function parsePack(value, options = {}) {
    const source = inputText(value).trim();
    if (!source) throw new Error('Paste a pack or choose a file first.');
    const format = (options.format || 'auto').toLowerCase();
    if (!['auto', 'csv', 'tsv', 'json'].includes(format)) throw new Error('Choose CSV, TSV, JSON, or automatic detection.');
    if (format === 'json' || (format === 'auto' && /^[\[{]/.test(source))) {
      let parsed;
      try { parsed = JSON.parse(source); } catch { throw new Error('The JSON is not valid. Check commas, brackets, and quotation marks.'); }
      if (Array.isArray(parsed)) { if (parsed.length !== 1) throw new Error('Import one pack at a time. This JSON contains ' + parsed.length + ' packs.'); parsed = parsed[0]; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The JSON must contain one Councillion pack.');
      return makePack(parsed.questions, options, parsed);
    }
    const delimiter = format === 'tsv' || (format === 'auto' && source.split(/\r?\n/, 1)[0].includes('\t')) ? '\t' : ',';
    const table = rows(source, delimiter);
    if (table.length < 2) throw new Error('Include a header and rows for all seven questions.');
    const header = table.shift().map(s => s.trim().toLowerCase());
    const names = ['question', 'prompt', 'answer', 'tier', 'aliases', 'explanation'];
    if (new Set(header).size !== header.length) throw new Error('The header contains duplicate column names.');
    for (const name of names) if (!header.includes(name)) throw new Error('Missing column “' + name + '”. Use the downloadable CSV template.');
    const questions = new Map();
    table.forEach((row, index) => {
      const rowNumber = index + 2;
      if (row.length > header.length) throw new Error('Row ' + rowNumber + ' has too many columns. Put fields containing commas in quotation marks.');
      const get = key => row[header.indexOf(key)] ?? '';
      if (!/^[1-7]$/.test(get('question').trim())) throw new Error('Row ' + rowNumber + ': question must be a whole number from 1 to 7.');
      const n = Number(get('question').trim()), prompt = get('prompt').trim();
      let q = questions.get(n);
      if (!q) { q = { prompt: '', answers: [] }; questions.set(n, q); }
      if (prompt && q.prompt && prompt !== q.prompt) throw new Error('Question ' + n + ' has conflicting prompt text on row ' + rowNumber + '.');
      if (prompt) q.prompt = prompt;
      if (get('answer').trim()) q.answers.push({ canonical: get('answer'), tier: get('tier'), aliases: aliases(get('aliases')), explanation: get('explanation') });
      else if ([get('tier'), get('aliases'), get('explanation')].some(s => s.trim())) throw new Error('Row ' + rowNumber + ' has answer details but no answer.');
    });
    if (questions.size !== 7) throw new Error('Include all seven questions, numbered 1–7.');
    return makePack(Array.from({ length: 7 }, (_, i) => questions.get(i + 1)), options);
  }
  function parseAnswers(value, options = {}) {
    const source = inputText(value).trim();
    if (!source) throw new Error('Paste at least one answer first.');
    const fallback = tier(options.defaultTier, 'dino');
    let format = (options.format || 'auto').toLowerCase();
    if (!['auto', 'plain', 'tsv', 'pipe'].includes(format)) throw new Error('Choose one answer per line, tab-separated, or vertical-bar-separated text.');
    if (format === 'auto') format = source.includes('\t') ? 'tsv' : source.split(/\r?\n/).some(l => /^.*?\s\|\s[^|]+(?:\s\||$)/.test(l)) ? 'pipe' : 'plain';
    let table;
    if (format === 'plain') table = source.split(/\r?\n/).map(s => [s]).filter(r => r[0].trim());
    else table = rows(source, format === 'tsv' ? '\t' : '|');
    if (table.length > 1000) throw new Error('Paste at most 1,000 answers for one question.');
    // Optional spreadsheet header for convenience when copying a whole selection.
    if (format !== 'plain' && /^(answer|canonical)$/i.test(table[0]?.[0]?.trim() || '') && /^tier$/i.test(table[0]?.[1]?.trim() || '')) table.shift();
    if (!table.length) throw new Error('Paste at least one answer below the header.');
    const answers = table.map((row, i) => {
      if (row.length > 4) throw new Error('Answer row ' + (i + 1) + ' has too many columns; use answer, rank, aliases, explanation.');
      return makeAnswer({ canonical: row[0], tier: row[1], aliases: aliases(row[2] || '', format === 'pipe' ? ';' : '|'), explanation: row[3] || '' }, fallback, 'Answer row ' + (i + 1));
    });
    return mergeAnswers(answers);
  }
  const template = () => 'question,prompt,answer,tier,aliases,explanation\r\n' + Array.from({ length: 7 }, (_, i) => (i + 1) + ',,,,,').join('\r\n') + '\r\n';
  function mergeExisting(existing, incoming) {
    if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('Existing and imported answers must be arrays.');
    // A newly opened question contains an empty editor row, not an accepted answer.
    const populated = existing.filter(value => !(value && typeof value.canonical === 'string' && !value.canonical.trim()));
    const values = [...populated, ...incoming].map((value, i) => {
      const answer = makeAnswer(value, 'dino', 'Answer ' + (i + 1));
      if (typeof value.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)) answer.id = value.id;
      return answer;
    });
    return mergeAnswers(values);
  }
  const api = Object.freeze({ parsePack, parseAnswers, mergeAnswers: mergeExisting, template });
  root.CouncilBulk = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
