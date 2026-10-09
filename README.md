# HSK 词卡

A vocabulary flashcard app for learning HSK words chapter by chapter. It schedules reviews with an Ebbinghaus forgetting-curve model. Everything is static HTML, CSS and JavaScript: there is no backend and no build step.

```
index.html          app shell
css/style.css       all styles
js/app.js           routing, screens, session logic
js/srs.js           memory model / scheduling (pure functions)
js/storage.js       localStorage + backup/restore
data/hsk5.json      vocabulary (HSK标准教程 5上, 第1–18课)
```

## Run locally

`fetch()` cannot load the JSON files when you open `index.html` by double-clicking it (`file://`). Serve the folder over HTTP instead, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/. On GitHub Pages it works as is.

## Deploy to GitHub Pages

1. Sign in to GitHub and click **New repository**. Give it a name (e.g. `hsk-cika`), make it **Public**, and click **Create repository**.
2. On the new repo page, click **uploading an existing file**. Drag in `index.html`, `README.md` and the `css`, `js` and `data` folders, keeping the folder structure. Click **Commit changes**.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Set **Branch** to `main` with folder `/ (root)`, then click **Save**.
5. Wait a minute or two, then open `https://<username>.github.io/<repo>/`.

To update the site later, upload the changed files to the repo again. Pages redeploys automatically.

## Vocabulary files

Each level has one file, `data/hsk1.json` … `data/hsk6.json`. A level without a file is shown as disabled.

```json
{
  "level": 5,
  "book": "HSK标准教程 5（上）",
  "chapters": [
    {
      "n": 1, "en": "Details of Love", "zh": "爱的细节",
      "words": [
        {
          "h": "抱怨", "py": "bàoyuàn", "pos": "v.",
          "meaning": "mengeluh, menggerutu",
          "s": "他从来不抱怨工作累，总是笑着面对。",
          "t": "Dia tidak pernah mengeluh soal pekerjaan yang melelahkan; dia selalu menghadapinya dengan senyum.",
          "tw": "mengeluh",
          "fd": ["对比", "爱护", "递"]
        }
      ]
    }
  ]
}
```

| field | meaning |
|---|---|
| `h` | word (characters) |
| `py` | pinyin, exactly as in the book |
| `pos` | part of speech, exactly as in the book (may be `""`) |
| `meaning` | Indonesian meaning |
| `s` | Chinese example sentence. It must contain `h` **exactly once**. |
| `t` | Indonesian translation of `s` |
| `tw` | *(optional)* the part of `t` that translates `h`. It is highlighted in 译句 questions and hidden in 印→中 example hints. |
| `fd` | 3 fill-in-the-blank distractors. They must be words from the same level file, and none of them may also fit the sentence. |
| `syn` | *(optional)* near-synonyms in the same level, e.g. `"syn": ["老婆"]` on 太太. These words are never used as each other's distractors in multiple-choice questions. |
| `sense` | *(optional)* set `"sense": 2` on a second entry with the same characters but another meaning (e.g. 则 m. in 第7课 and 则 conj. in 第14课). Each sense is learned and scheduled separately. |
| `star` | *(optional)* `true` for words marked * in the book (beyond the HSK 5 syllabus). They are studied like any other word and show a red * next to the headword. |

### Add a chapter

Append a new object to `chapters`, e.g. `{ "n": 2, "en": "…", "zh": "…", "words": [ … ] }`. Chapter tiles appear automatically.

### Add a level

Create `data/hskN.json` with the same structure and `"level": N`. The level button is enabled automatically.

### Validator

When the app loads, it checks every level file and prints warnings in the browser console (F12 → Console). It warns when:

- a sentence does not contain its word exactly once
- an `fd` word is not in that level
- a required field is missing
- a word is duplicated (same characters without a different `sense`)
- `tw` does not appear in `t`
- a `syn` word is not in that level, or appears in `fd`

Fix all warnings before publishing.

## Memory model (js/srs.js)

- Retention: `R(t) = e^(−t/S)`, where `t` is the number of days since the last review and `S` is stability.
- Critical point: `t* = S · ln(1/target)`. The next review is due at `last + t*`.
- After a study session, the first review is in 1 day. If the word was missed during the session, it is in 12 h.
- After a review, the first attempt is graded:
  - correct: `S' = S · (1 + k · f · e^(1.6·(1−R)))`, where `f` is 1.6 if the answer took under 3 s, 1.4 normally, and 0.45 if it took over 8 s. `f` is multiplied by 1.1 for Indonesian→Chinese questions.
  - wrong: `S' = max(0.3, 0.35·S)`, and the next review is at least 12 h later.
- Calibration `k` (0.5–2) is based on the last 40 reviews: `k ← k · (1 + 0.15 · (actual − predicted))`.

## Data & backup

Progress is saved in `localStorage` and belongs to one browser on one device. To move it to another device:

1. On the old device, open **设置 · Settings → Backup** and tap **Copy code 复制**.
2. On the new device, paste the code into the box and tap **Restore 恢复**.
