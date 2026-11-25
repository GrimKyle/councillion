# Bulk pack entry

Paste readable text, copy a spreadsheet, or upload a pack file. Importing fills a private draft; publish it when it is complete. You can also give ChatGPT your prompts, accepted answers, ranks and special subtitles and ask for a copy-and-paste block in the format below. No AI connection or API key is needed by the website.

## Easiest: paste readable text

Use **Paste a pack** and paste one block containing questions Q1 through Q7 in order. A `Pack:` title and `Description:` are optional; put them before Q1. Use one accepted answer per line under its question:

```text
Pack: Your pack title
Description: Your description

Q1: Your first question
Your accepted answer | 100 | Alternative name;Another alias | Your Councillion subtitle
Another accepted answer | 30
A common accepted answer

Q2: Your second question
```

Continue through `Q7:`. The block above only illustrates the syntax and is intentionally incomplete. Download `pack-template.txt` for seven blank question headers, then fill in their prompts.

The answer columns are **answer | rank | aliases | explanation**. Rank may be a Council name or 10, 15, 30, 60, 85, 100. Separate aliases with semicolons. Omit trailing columns you do not need. An answer-only line explicitly uses **Dino / 10 points**; the importer does not decide rarity from the answer. A 100-point answer needs its subtitle before publication, though it can be added to the imported draft later.

Blank lines and Markdown answer bullets (`-`, `*`, `+`) are supported. A full ChatGPT ` ```text ` block can be pasted including its fences. If an answer starts like a numbered question, prefix it with a bullet: `- 2. Your numeric answer | 15`. A field containing a literal `|` must be quoted, for example `"Your answer | with a pipe" | 10`. Double an embedded quotation mark inside a quoted field.

You can also paste just seven numbered prompts:

```text
1. Your first question
2. Your second question
3. Your third question
4. Your fourth question
5. Your fifth question
6. Your sixth question
7. Your seventh question
```

This creates seven supplied questions with **empty answer lists**. It stays a private draft until you add accepted answers and publish. The importer never fabricates missing answers or promotes a draft to a public pack.

Readable text can be uploaded as `.txt` through the same pack uploader. CSV, TSV and exported JSON still work. Malformed numbering, duplicate questions, conflicting answer ranks and aliases are rejected with a useful error.

## Whole pack from Excel or another spreadsheet

Open `pack-template.csv` in Excel, Google Sheets, or another spreadsheet editor. Keep these column names:

| Column | Enter |
| --- | --- |
| `question` | A number from 1 through 7 |
| `prompt` | Your question text; repeat it or leave it blank on additional rows for the same question |
| `answer` | One canonical accepted answer per row |
| `tier` | Dino, Kalen, Cavaughn, Donovan, Grimkyle, One in a Councillion; or 10, 15, 30, 60, 85, 100 |
| `aliases` | Alternative names separated by `|` |
| `explanation` | Your special subtitle for a 100-point answer |

Add more rows with the same question number to add more accepted answers. Include all seven question numbers and supply one nonblank prompt for each. The empty template deliberately contains no questions or answer content.

Save as **CSV UTF-8**, then upload the CSV in Game Master. A copied tab-separated spreadsheet selection also works. This importer reads CSV/TSV text, not `.xlsx` workbooks. Quoted commas, quotation marks, and multiline fields are supported.

A complete pack needs accepted answers and top-tier explanations before publication. Import can leave a question's answer list empty as a private draft so you can finish it in the editor.

## Paste answers into one question

For a plain list, put one answer on each line and choose the default rank in the import controls. No rank is guessed from the content.

For mixed ranks, use one line per answer in either form:

```text
Answer text<TAB>Rank<TAB>Alias one|Alias two<TAB>Explanation
```

or:

```text
Answer text | Rank | Alias one;Alias two | Explanation
```

`<TAB>` means an actual tab from a spreadsheet. Leave optional alias and explanation columns blank. Use the rank name or its point value. Top-tier explanations can be filled in after importing, before you publish.

## Existing JSON packs

An exported Councillion JSON pack can be imported directly. Its questions and answers get fresh IDs, and it opens as a private draft. Import one pack at a time.

The importer validates rank names, all seven questions, conflicting duplicate answers, and aliases that would match different answers. Duplicate spellings for the same canonical answer merge when their ranks agree. No text is executed as code or as a spreadsheet formula; it is imported as data. Files are limited to 1 MB and 7,000 answer rows, with at most 1,000 accepted answers per question.
