'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bulk = require('../bulk.js');

// Parser fixtures only; no trivia is added to the playable website.
const csv = () => 'question,prompt,answer,tier,aliases,explanation\n' + Array.from({ length: 7 }, (_, i) => `${i + 1},Fixture prompt ${i + 1},Fixture answer ${i + 1},10,,`).join('\n');
const pack = () => ({ id: 'old-pack-id', title: 'Fixture pack', description: 'Test only', published: true, questions: Array.from({ length: 7 }, (_, i) => ({ id: 'old-q-' + i, prompt: 'Fixture ' + i, answers: [{ id: 'old-a-' + i, canonical: 'Fixture answer', tier: 'dino', aliases: [], explanation: '' }] })) });

test('CSV imports all seven questions as a private draft with fresh IDs', () => {
  const p = bulk.parsePack(csv(), { title: 'My supplied pack' });
  assert.equal(p.title, 'My supplied pack'); assert.equal(p.published, false); assert.equal(p.id, null); assert.equal(p.questions.length, 7);
  assert.equal(p.questions[0].answers[0].tier, 'dino'); assert.match(p.questions[0].id, /^[a-f0-9-]{36}$/i);
  assert.notEqual(p.questions[0].id, bulk.parsePack(csv()).questions[0].id);
});
test('repeated question rows reuse prompt text and merge one canonical answer’s aliases', () => {
  const content = csv() + '\n1,,Fixture answer 1,Dino,Alternative fixture|Alias fixture,\n1,,Second fixture,85,Other name,Detail';
  const p = bulk.parsePack(content);
  assert.equal(p.questions[0].prompt, 'Fixture prompt 1'); assert.equal(p.questions[0].answers.length, 2);
  assert.deepEqual(p.questions[0].answers[0].aliases, ['Alternative fixture', 'Alias fixture']);
});
test('CSV supports UTF-8 BOM, case-insensitive headers, quoted commas, newlines and escaped quotation marks', () => {
  const content = '\uFEFFQUESTION,PROMPT,ANSWER,TIER,ALIASES,EXPLANATION\r\n1,"Fixture, prompt\nsecond line","Fixture ""quoted"" answer",100,Alias one|Alias two,"Explanation, with comma"\r\n' + csv().split('\n').slice(2).join('\r\n');
  const p = bulk.parsePack(content);
  assert.equal(p.questions[0].prompt, 'Fixture, prompt\nsecond line');
  assert.equal(p.questions[0].answers[0].canonical, 'Fixture "quoted" answer');
  assert.equal(p.questions[0].answers[0].explanation, 'Explanation, with comma');
});
test('spreadsheet TSV imports without changing Unicode names or apostrophes', () => {
  const source = csv().replaceAll(',', '\t').replace('Fixture answer 1', 'Kai’Sa');
  const p = bulk.parsePack(source); assert.equal(p.questions[0].answers[0].canonical, 'Kai’Sa');
});
test('all rank names and numeric points resolve to the official tiers', () => {
  const names = [['Dino','dino'],['Kalen','kalen'],['Cavaughn','cavaughn'],['Donovan','donovan'],['Grimkyle','grimkyle'],['One in a Councillion','councillion']];
  const points = [10,15,30,60,85,100];
  names.forEach(([name, id], i) => {
    assert.equal(bulk.parseAnswers('Fixture | ' + name, { format: 'pipe' })[0].tier, id);
    assert.equal(bulk.parseAnswers('Fixture\t' + points[i], { format: 'tsv' })[0].tier, id);
  });
});
test('plain answer lists use the explicitly chosen default tier', () => {
  const answers = bulk.parseAnswers('First fixture\nSecond fixture\n\nThird fixture', { defaultTier: 'Donovan' });
  assert.equal(answers.length, 3); assert.ok(answers.every(a => a.tier === 'donovan'));
});
test('per-question TSV and vertical-bar rows import rank, aliases and explanation', () => {
  const a = bulk.parseAnswers('answer\ttier\taliases\texplanation\nFixture\t100\tAlternative|Another alias\tSpecial subtitle');
  assert.equal(a[0].tier, 'councillion'); assert.deepEqual(a[0].aliases, ['Alternative', 'Another alias']); assert.equal(a[0].explanation, 'Special subtitle');
  const b = bulk.parseAnswers('Fixture | Grimkyle | Alternative;Another alias | A supplied explanation');
  assert.deepEqual(b[0].aliases, a[0].aliases); assert.equal(b[0].tier, 'grimkyle');
});
test('JSON export and singleton arrays import as fresh unpublished drafts', () => {
  const original = pack();
  for (const value of [original, [original]]) {
    const parsed = bulk.parsePack(JSON.stringify(value)); assert.equal(parsed.title, original.title); assert.equal(parsed.published, false);
    assert.notEqual(parsed.questions[0].id, original.questions[0].id); assert.notEqual(parsed.questions[0].answers[0].id, original.questions[0].answers[0].id);
  }
  assert.throws(() => bulk.parsePack(JSON.stringify([original, original])), /one pack at a time/i);
});
test('invalid headers, missing question groups and out-of-range question numbers fail clearly', () => {
  assert.throws(() => bulk.parsePack(csv().replace('aliases,', 'other,')), /Missing column/);
  assert.throws(() => bulk.parsePack(csv().split('\n').slice(0, 7).join('\n')), /all seven/);
  assert.throws(() => bulk.parsePack(csv().replace('1,Fixture', '8,Fixture')), /1 to 7/);
  assert.throws(() => bulk.parsePack(csv().replace('question,prompt', 'question,question')), /duplicate column/);
});
test('unknown ranks, conflicting prompts, duplicate ranks and explanations are rejected', () => {
  assert.throws(() => bulk.parsePack(csv().replace(',10,', ',999,')), /Unknown rank/);
  assert.throws(() => bulk.parsePack(csv() + '\n1,Different fixture,Extra answer,15,,'), /conflicting prompt/);
  assert.throws(() => bulk.parseAnswers('Fixture | Dino\nFIXTURE | Grimkyle'), /different ranks/);
  assert.throws(() => bulk.parseAnswers('Fixture | Dino | | First explanation\nFixture | Dino | | Different explanation'), /different explanations/);
});
test('normalization merges duplicate spellings but rejects cross-answer alias collisions', () => {
  const a = bulk.parseAnswers('Kai’Sa | Dino | Fixture alias\nKAI SA | Dino | Other alias');
  assert.equal(a.length, 1); assert.deepEqual(a[0].aliases, ['Fixture alias', 'Other alias']);
  assert.throws(() => bulk.parseAnswers('First fixture | Dino | Shared alias\nSecond fixture | Dino | SHARED-ALIAS'), /two different answers/);
  assert.throws(() => bulk.parseAnswers('First fixture | Dino | Second fixture\nSecond fixture | Dino'), /two different answers/);
});
test('merging pasted answers preserves existing IDs and rejects cross-list conflicts', () => {
  const existing = bulk.parseAnswers('First fixture | Dino | Original alias');
  const incoming = bulk.parseAnswers('FIRST FIXTURE | Dino | New alias\nSecond fixture | Kalen');
  const merged = bulk.mergeAnswers(existing, incoming);
  assert.equal(merged.length, 2); assert.equal(merged[0].id, existing[0].id); assert.equal(merged[1].id, incoming[1].id);
  assert.deepEqual(merged[0].aliases, ['Original alias', 'New alias']);
  assert.throws(() => bulk.mergeAnswers(existing, bulk.parseAnswers('Second fixture | Kalen | Original alias')), /two different answers/);
  assert.throws(() => bulk.mergeAnswers(existing, bulk.parseAnswers('First fixture | Grimkyle')), /different ranks/);
  assert.equal(bulk.mergeAnswers([{canonical:'',tier:'dino',aliases:[],explanation:''}], incoming).length, 2);
});
test('malformed CSV quoting is rejected rather than silently shifting columns', () => {
  assert.throws(() => bulk.parsePack(csv() + '\n1,,"Unclosed,10,,'), /not closed/);
  assert.throws(() => bulk.parsePack(csv().replace('Fixture answer 1', 'Bad"quote')), /whole field/);
  assert.throws(() => bulk.parsePack(csv().replace('Fixture answer 1', '"Answer"junk')), /closing quote/);
  assert.throws(() => bulk.parsePack(csv() + '\n1,,Too,many,unquoted,commas,here'), /too many columns/);
});
test('draft imports permit missing top-tier explanations and empty answer lists, but require supplied prompts', () => {
  const p = bulk.parsePack(csv().replace('Fixture answer 1,10', 'Fixture answer 1,100'));
  assert.equal(p.questions[0].answers[0].explanation, '');
  const noAnswer = bulk.parsePack(csv().replace('Fixture answer 1,10,,', ',,,')); assert.equal(noAnswer.questions[0].answers.length, 0);
  assert.throws(() => bulk.parsePack(bulk.template()), /prompt cannot be blank/);
});
test('HTML and spreadsheet-like content remain inert strings; no content is evaluated', () => {
  const original = pack(); original.questions[0].prompt = '<img src=x onerror=alert(1)>';
  original.questions[0].answers[0].canonical = '=HYPERLINK("https://invalid.example", "fixture")';
  const p = bulk.parsePack(JSON.stringify(original)); assert.equal(p.questions[0].prompt, original.questions[0].prompt);
  assert.equal(p.questions[0].answers[0].canonical, original.questions[0].answers[0].canonical);
});
test('input limits, field lengths and null bytes are enforced', () => {
  assert.throws(() => bulk.parsePack('a'.repeat(1024 * 1024 + 1)), /1 MB/);
  assert.throws(() => bulk.parseAnswers('Fixture\0answer'), /null character/);
  assert.throws(() => bulk.parseAnswers('a'.repeat(161)), /160 characters/);
  assert.throws(() => bulk.parseAnswers(Array.from({length:1001},(_,i)=>'Fixture '+i).join('\n')), /1,000 answers/);
});
test('downloadable template exactly matches template() apart from native line endings and contains no seeded prompts', () => {
  const source = fs.readFileSync(path.join(__dirname,'../pack-template.csv'),'utf8');
  assert.equal(source.replace(/\r\n/g,'\n'), bulk.template().replace(/\r\n/g,'\n'));
  assert.equal(source.trim().split('\n').length, 8);
  assert.ok(source.trim().split('\n').slice(1).every(line=>/^[1-7],,,,,$/.test(line)));
});

const textPack = () => 'Pack: Supplied fixture pack\nDescription: Only parser fixtures.\n\n' + Array.from({length:7},(_,i)=>`Q${i+1}: Supplied fixture prompt ${i+1}\nFixture answer ${i+1} | ${i===0?100:10} | Alias ${i+1};Other alias ${i+1} | ${i===0?'Supplied special subtitle':''}`).join('\n\n');
test('readable text imports authored prompts, ranks, aliases and subtitles as a private pack',()=>{
 const value=bulk.parsePack(textPack());assert.equal(value.title,'Supplied fixture pack');assert.equal(value.description,'Only parser fixtures.');assert.equal(value.id,null);assert.equal(value.published,false);assert.equal(value.questions.length,7);
 const first=value.questions[0].answers[0];assert.equal(first.tier,'councillion');assert.equal(first.explanation,'Supplied special subtitle');assert.deepEqual(first.aliases,['Alias 1','Other alias 1']);assert.equal(value.questions[6].answers[0].tier,'dino');
 assert.notEqual(first.id,bulk.parsePack(textPack()).questions[0].answers[0].id);
});
test('a numbered list creates only seven supplied prompts with no fabricated answers',()=>{
 const source=Array.from({length:7},(_,i)=>`${i+1}. Supplied prompt ${i+1}`).join('\n');const value=bulk.parsePack(source,{title:'Prompt draft'});
 assert.equal(value.title,'Prompt draft');assert.ok(value.questions.every(q=>q.answers.length===0));assert.equal(value.questions[6].prompt,'Supplied prompt 7');assert.equal(value.published,false);
});
test('text blocks accept Markdown headings, bulleted answers and a complete ChatGPT text fence',()=>{
 const source='```text\n'+Array.from({length:7},(_,i)=>`## Q${i+1}: Supplied prompt ${i+1}\n- Fixture answer ${i+1}\n* Other fixture ${i+1} | Grimkyle\n- 2. A numeric answer ${i+1} | 15`).join('\n\n')+'\n```';
 const value=bulk.parsePack(source);assert.equal(value.questions[0].answers.length,3);assert.equal(value.questions[0].answers[0].tier,'dino');assert.equal(value.questions[0].answers[1].tier,'grimkyle');assert.equal(value.questions[0].answers[2].canonical,'2. A numeric answer 1');assert.equal(value.questions[0].answers[2].tier,'kalen');
 assert.equal(bulk.parsePack('```json\n'+JSON.stringify(pack())+'\n```').title,'Fixture pack');
});
test('readable question numbering and metadata errors identify the conflicting line',()=>{
 assert.throws(()=>bulk.parsePack(textPack().replace('Q7:','Q6:')),/Line \d+: question 6 appears more than once/);
 assert.throws(()=>bulk.parsePack(textPack().replace('Q2:','Q3:')),/question 2 is missing or out of order/);
 assert.throws(()=>bulk.parsePack(textPack().replace('Q7:','Q8:')),/question number must be from 1 to 7/);
 assert.throws(()=>bulk.parsePack(textPack().split('\n\n').slice(0,-1).join('\n\n')),/exactly seven/);
 assert.throws(()=>bulk.parsePack('Pack: First\nTitle: Second\n'+textPack()),/pack title appears more than once/);
 assert.throws(()=>bulk.parsePack('```text\n'+textPack()),/complete fenced text block/);
 assert.throws(()=>bulk.parsePack('Unlabelled preamble\n'+textPack(),{format:'text'}),/Line 1: start your pack/);
});
test('readable rows validate ranks, fields and collisions while merging matching duplicates',()=>{
 const value=bulk.parsePack(textPack()+'\nFIXTURE ANSWER 7 | Dino | New alias');assert.equal(value.questions[6].answers.length,1);assert.ok(value.questions[6].answers[0].aliases.includes('New alias'));
 assert.throws(()=>bulk.parsePack(textPack()+'\nFixture answer 7 | Kalen'),/different ranks/);
 assert.throws(()=>bulk.parsePack(textPack()+'\nDifferent fixture | 10 | Alias 7'),/two different answers/);
 assert.throws(()=>bulk.parsePack(textPack()+'\nDifferent fixture | 999'),/Line \d+: Unknown rank/);
 assert.throws(()=>bulk.parsePack(textPack()+'\nDifferent fixture | constructor'),/Unknown rank/);
 assert.throws(()=>bulk.parsePack(textPack()+'\n'+ 'A'.repeat(161)),/160 characters/);
 assert.throws(()=>bulk.parsePack(textPack()+'\nOne | 10 | Alias | Subtitle | Extra'),/Use answer \| rank/);
});
test('readable quoted pipes, punctuation and supplied executable-looking content stay inert',()=>{
 const source=textPack().replace('Supplied fixture prompt 1','<img src=x onerror=alert(1)>').replace('Fixture answer 1 | 100 | Alias 1;Other alias 1 | Supplied special subtitle','"Fixture | quoted answer" | 100 | Alternative | "Subtitle, with a pipe | kept"');
 const value=bulk.parsePack(source);assert.equal(value.questions[0].prompt,'<img src=x onerror=alert(1)>');assert.equal(value.questions[0].answers[0].canonical,'Fixture | quoted answer');assert.equal(value.questions[0].answers[0].explanation,'Subtitle, with a pipe | kept');
 const original='alert("fixture")';assert.equal(bulk.parsePack(textPack()+'\n'+original).questions[6].answers.at(-1).canonical,original);
});
test('text imports allow incomplete private answers but still require each supplied prompt',()=>{
 const source=Array.from({length:7},(_,i)=>`Q${i+1}: Supplied prompt ${i+1}`).join('\n');const value=bulk.parsePack(source+'\nFixture answer | 100',{format:'txt'});assert.equal(value.questions[6].answers[0].explanation,'');assert.ok(value.questions.slice(0,6).every(q=>q.answers.length===0));
 assert.throws(()=>bulk.parsePack(source.replace('Q3: Supplied prompt 3','Q3:')),/Question 3 prompt cannot be blank/);
});
test('text imports enforce file size, per-question answer limits and unsupported format errors',()=>{
 assert.throws(()=>bulk.parsePack(textPack()+'\n'+Array.from({length:1000},(_,i)=>'Additional fixture '+i).join('\n')),/1,000 accepted answers/);
 assert.throws(()=>bulk.parsePack('Q1: '+ 'a'.repeat(1024*1024)),/1 MB/);
 assert.throws(()=>bulk.parsePack(textPack(),{format:'executable'}),/Choose readable text/);
});
test('readable scaffold matches the downloadable blank file and cannot become a pack unfilled',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../pack-template.txt'),'utf8');assert.equal(source,bulk.textTemplate());assert.deepEqual(source.trim().split(/\n\s*\n/).map(s=>s.trim()),Array.from({length:7},(_,i)=>`Q${i+1}:`));
 assert.throws(()=>bulk.parsePack(source),/Question 1 prompt cannot be blank/);
});
