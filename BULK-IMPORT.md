# Bulk pack entry

You can write your own content in a spreadsheet, paste a list into one question, or ask for your supplied list to be converted into a pack file. Importing does not publish anything automatically; review the filled editor and publish when ready.

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
